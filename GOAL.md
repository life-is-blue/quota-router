# GOAL.md — quota-router

交接对象：接手实现的人 / Agent。读完本文件应该能直接开始写代码，不需要回头问"为什么"。

## 1. 这是什么

`quota-router` 是一个独立的 Claude Code 插件仓库，让 Opus 5 作为主控，把调研 / 小改动 / 批量重构 / 对抗审查这些任务分流给本地已安装的 CLI（agy / Cursor CLI / codebuddy / 官方 Codex 插件），省 Opus 的调用额度。

**现在到哪了（2026-08-23）**：三个 CLI 的**只读调研**都通了——`/agy:research`（含 `--background` + `/agy:status`）、`/cursor:research`、`/codebuddy:research`，`node --test tests/*.test.mjs` = 25 pass 0 fail 0 skip。**写文件的能力一个都还没做**（每个 Sprint 都主动收窄掉了），下一步该干什么见第 7 节。

**和 `codex-plugin-cc` 的关系**：只读参照物，不 fork、不改它的代码。原因见下方"已验证的事实"。这个仓库独立存在，自己有一份 `marketplace.json`。

## 2. 已验证的事实（不是猜测，全部对照源码/官方文档核实过）

- `openai/codex-plugin-cc` 是官方维护的单插件仓库，`plugins/codex/scripts/` 里约 3,584 行代码是与 Codex App Server JSON-RPC 强绑定的协议栈，其余约 1,840 行是"看起来通用"的基础设施（进程、状态、job 追踪）。
  - **但这 1,840 行不是干净的可复用层**：`job-control.mjs` 直接 `import` 了 `codex.mjs`，`state.mjs` 把状态目录硬编码成 `"codex-companion"`。**不要指望直接 import 这些模块**，真要参考也是照着模式重写，不是拿来当依赖。
- `agy`（Antigravity CLI）**有官方 headless 模式**，文档见 `agy-cli-docs-mirror/docs/antigravity/cli/headless.md`。这不是我们臆测出来的接口，是官方承诺的契约，细节见第 3 节。

## 3. Sprint 1（已完成，2026-08-23）：跑通 agy 适配器（详见下方 3.x 节）

### 3.1 范围

只做 agy。不碰 cursor、不碰 codebuddy、不建任何共享抽象层（`lib/subprocess.mjs`、`EngineAdapter` 之类的一律不做）。理由：现在只有一个已验证的具体实现，做抽象没有第二、第三个样本可比对，纯属过早设计。

### 3.2 交付物

- `plugins/agy/.claude-plugin/plugin.json`
- `plugins/agy/commands/research.md` → 对应 `/agy:research <topic>`
- `plugins/agy/scripts/agy-cli.mjs`（单文件，不拆 lib，预计 150–250 行）
- `.claude-plugin/marketplace.json`（注册这一个插件）
- `tests/agy-cli.test.mjs` + `tests/fixtures/fake-agy-bin.mjs`（假的 agy 可执行文件，用于测试不依赖真实网络/账号）

### 3.3 `agy-cli.mjs` 的具体调用契约（已核实，直接照做）

调用形式：

```bash
agy -p "<prompt>" \
  --output-format json \
  --print-timeout 3m \
  [--dangerously-skip-permissions]   # 只读调研任务不需要这个
```

- `stdout` 是**一整块 JSON**（不是 NDJSON），已完整跑完才打印，字段：
  `conversation_id`, `status`, `response`, `error`（失败时才有）, `duration_seconds`, `num_turns`, `usage{input_tokens,output_tokens,thinking_tokens,cache_read_tokens,total_tokens}`
- `status` 取值：`SUCCESS` / `ERROR` / `CANCELED` / `INTERRUPTED` / `INVALID` / `WAITING` / `RUNNING`。**判断成功与否要读 `status` 字段，不能只看进程退出码**——见 3.4 的坑。
- 认证是隐式的：headless 模式用本机已缓存的登录态，不会弹交互式登录。**没登录过的机器上跑会直接报 `authentication required` 错误退出，不会挂起**，所以不需要我们自己实现登录检测逻辑，直接透传 stderr 就行。
- 默认超时 5 分钟，用 `--print-timeout` 覆盖（接受 `3m`/`15m` 这种写法）。**优先用这个原生 flag，不要在 `spawn` 外面再包一层自己的 setTimeout kill——原生超时已经会正确终止并返回 `status: ERROR`，自己再包一层只会重复造轮子。**
- 多轮对话用 `--continue`/`-c`（接上一次）或 `--conversation <id>`（接指定会话）。Sprint 1 不需要支持这个，先做单轮 `/agy:research`，但落盘 job 记录时把 `conversation_id` 存下来，为 Sprint 2 的 `--continue` 铺路。
- 模型/强度可选 `--model <slug>` `--effort low|medium|high`，Sprint 1 不暴露给用户，用 agy 自己的默认值。

### 3.4 已知的坑（写测试时必须覆盖）

1. **权限 soft-deny 陷阱**：headless 模式下，如果某个工具调用需要审批但又没有权限规则允许它，agy **不会让整个 run 失败**——它会跳过那个工具、把原因写到 stderr、然后整个进程**依然以 exit code 0 结束，`status` 也可能仍是 `SUCCESS`**。纯只读的 `/agy:research`（不需要写文件、不需要跑命令）理论上不会踩到这个，但适配器代码**不能假设 exit 0 = 完全按预期执行**，至少要把 stderr 里出现 "denied"/"not allowed" 关键字的情况透传给用户看,不要吞掉。
2. **模型名拼错会硬失败**：和交互式 UI 不同（UI 拼错模型名会静默 fallback），headless 模式拼错模型名会 `exit 1` + `status: ERROR`。Sprint 1 不传 `--model`，这条先记录，等 Sprint 2 需要模型选择时再处理。
3. **stdout 必须整体 JSON.parse，不能按行读**：`--output-format json` 是一次性打印一整行 JSON，不是流式的（那是 `stream-json` 才有的行为，Sprint 1 不用）。子进程 `close` 事件之后再统一 `JSON.parse(stdout)`，不要边收边解析。
4. **stdin 不需要专门处理**：headless 模式是单次 prompt 通过 `-p` 参数传入，不走 stdin，所以不存在"忘记喂 stdin 导致挂死"的问题；但仍然应该把子进程的 stdin 设为 `'ignore'`，防止 agy 某个异常路径意外尝试读 stdin 卡住父进程。
5. **顶层 `status: ERROR` 不等于真的失败**（2026-08-23 用 agy 自建 Sprint 1 代码时实测到一次）：agy 内部工具（`write_to_file`）在某些场景下会因为目标路径不在它自己的 artifact 目录（`~/.gemini/antigravity-cli/brain/<conversation_id>/`）而报错，导致整条 run 的顶层 `status` 被标成 `ERROR`、`error` 字段里写着这个内部路径错误——但实际请求的产物（比如要求它写的文件）可能已经落盘成功。这条和坑1（soft-deny 时 status 仍是 SUCCESS）方向相反：**不管 `status` 是 SUCCESS 还是 ERROR，都不能单凭这一个字段断定整条 run 的实际效果，涉及副作用（写文件、跑命令）的调用最终要落地核实**。Sprint 1 的 `/agy:research` 是纯只读调用，理论上不会触发 `write_to_file`，暂不需要为此改代码；Sprint 2 一旦涉及产物文件（job 记录）就要留意。

### 3.5 明确不做的事（防止范围蠕变）

- 不做 job 状态机、不做重试循环——失败就把截断后的 stderr/`error` 字段原样回传给 Claude 主会话，让 Opus 决定重试还是换路。
- 不做"自动检测有没有装 agy"这种探测框架——`/agy:research` 第一次跑失败（`ENOENT`）就直接告诉用户"agy 没装/不在 PATH"，参考 `codex-plugin-cc` 的 `/codex:setup` 做法即可，不用抽象成通用的"CLI 可用性检测"模块。
- 不建 `lib/` 目录，不建共享的 job-store。这些等 cursor、codebuddy 两个适配器都写完、能真正 diff 出重复代码之后再抽（见第 5 节）。

## 4. 验收标准

- `/agy:research "什么是 git rebase"` 在终端里能拿到一段人类可读的回答。
- 杀掉网络或不给权限，`/agy:research` 不会挂起终端，会在 `--print-timeout` 内退出并给出可读的错误信息。
- `npm test` 跑 `tests/agy-cli.test.mjs`，用假的 `fake-agy-bin.mjs`（一个会输出固定 JSON 的 shell/node 脚本）覆盖：正常 SUCCESS、ERROR 状态、soft-deny 场景（exit 0 但 stderr 有 denied 关键字）、`agy` 命令不存在（ENOENT）四种情况。

## 5. Sprint 2（已完成，2026-08-23）：`--background` / `/agy:status`

### 5.1 范围

只加两样：`/agy:research --background` 和新命令 `/agy:status [job-id]`。不做重试、不做进度轮询之外的状态机、不碰 cursor/codebuddy。

### 5.2 为什么现在才需要落盘

Sprint 1 是单轮调用，结果直接打印到终端就完事，不需要记住任何东西。后台模式意味着 `/agy:research --background` 要立刻返回一个 job id，真正的 agy 进程在后台跑，用户之后用 `/agy:status <job-id>` 才能看到结果——这中间必须有个地方存"这个 job 现在是什么状态"，这是第一次真正需要持久化，不是为了好看而加的。

### 5.3 状态目录：跟随 Claude Code 官方约定，不是编的

已核实 `codex-plugin-cc` 的 `state.mjs` 里状态目录解析方式：优先用环境变量 `CLAUDE_PLUGIN_DATA`（Claude Code 官方给插件分配的可写数据目录）下的 `state` 子目录；没有这个环境变量时 fallback 到 `os.tmpdir()`。我们独立实现同样的 fallback 逻辑，但目录名不能叫 `codex-companion`（那是别人的命名空间），用 `quota-router-agy` 自己的名字。**不 import `state.mjs`，照这个模式重写。**

### 5.4 Job 记录格式（越简单越好，不是状态机）

每个 job 一个 JSON 文件（文件名 = job id），字段：`{ id, prompt, status: "running"|"done"|"error", pid, conversationId, startedAt, finishedAt, response, error }`。`status` 只有这三个值，不做更细的阶段划分。写入时机：spawn 后立刻写 `running`；子进程 `close` 后覆盖写终态。**不做重试字段、不做进度百分比**——这些是 5.5 节明确排除的。

`/agy:status` 只做一件事：读 job 文件，人类可读地打印出来。不做轮询、不做 watch、不做通知。

### 5.5 明确不做的事

- 不做失败自动重试——job 记为 `error`，把 `error`/stderr 原样存进去，交给 Claude 主会话决定要不要再跑一次。
- 不做进度阶段（`step_update` 之类）——Sprint 1 用的是 `--output-format json`（一次性结果），不是 `stream-json`，Sprint 2 继续沿用，不引入流式进度。
- 涉及 job 文件的写入（尤其是"写完之后再确认一次内容对不对"）要留意 3.4 节第5条坑——不能光看 spawn 有没有报错就认为 job 文件真的写对了，起码在关键路径上读回来核对一次。

### 5.6 验收标准（草案，写代码前先按 3.4/3.5 节方式细化）

- `/agy:research --background "<topic>"` 立刻返回一个 job id，不阻塞终端。
- `/agy:status <job-id>` 在 job 跑完前后都能给出准确状态。
- 杀掉后台进程（模拟崩溃），`/agy:status` 不应该无限等待，要能识别"进程已死但状态文件还是 running"的情况并如实报告（不用做自动纠正，报告即可）。

## 6. Sprint 3 契约调研（已完成，2026-08-23）：Cursor CLI headless 模式

结论先说：**Cursor CLI 和 agy 长得不一样，尤其是错误处理和超时**。以下全部是 `agent --help` 和真实调用（本机已装 `2026.08.11-e8db854`，已登录 `g7rzcfpsty@privaterelay.appleid.com`）核实过的，不是抄文档。

### 6.1 基本调用

命令是 `agent`（不是 `cursor`），`cursor-agent`/`cursor` 是同一个二进制的别名，本机都存在。

```bash
agent -p "<prompt>" --output-format json
```

- `-p`/`--print`：非交互模式，**默认就有全部工具权限（含写文件、跑 shell）**，和 agy 不同——agy 默认工具需要审批，Cursor 默认是"能用就用"。
- `--output-format`：`text`/`json`/`stream-json`，同 agy 一样三选一。

### 6.2 真实 JSON envelope（实测，字段和 agy 完全不同）

```json
{"type":"result","subtype":"success","is_error":false,"duration_ms":8040,"duration_api_ms":8040,"result":"...","session_id":"...","request_id":"...","usage":{"inputTokens":...,"outputTokens":...,"cacheReadTokens":...,"cacheWriteTokens":0}}
```

对照 agy：响应文本字段叫 `result` 不是 `response`；会话 id 叫 `session_id` 不是 `conversation_id`；成功与否看 `is_error`（布尔）不是 `status`（字符串枚举）；`usage` 字段是驼峰命名（`inputTokens`）不是下划线（`input_tokens`）。**照抄 agy-cli.mjs 的字段名会全错，必须重新写解析逻辑。**

### 6.3 硬失败时完全不给 JSON（关键坑，和 agy 相反，官方文档已确认）

实测两种真实失败场景（模型名拼错、API key 无效）：stdout 是空的（0 字节），错误信息是纯文本打在 stderr，退出码非0。**官方文档 `cli/reference/output-format.md` 明确写了这就是设计行为**：「On failure, the process exits with a non-zero code and writes an error message to stderr. No well-formed JSON object is emitted in failure cases.」——不是我们运气不好没试出来，是它就这么设计的。这和 agy"失败也给 JSON，status 写 ERROR"完全相反。适配器判断成功与否**必须先看 exit code + stdout 是否为空**，不能假设失败时也有 JSON 可解析。
- 连带结论：`is_error` 这个字段**只在成功路径才会出现，且文档明确写死是"Always `false` for successful responses"**——也就是说 JSON 里的 `is_error` 实际上不携带任何有效信息（它出现时必然是 false），**不能拿它当判断依据**，真正的判断依据是"有没有拿到 stdout / exit code 是不是 0"。这点和 agy 的 `status` 字段（会在 JSON 里真实变化）本质不同。

### 6.4 没有权限硬拒绝、没有 hang，但拒绝信号混在自然语言里

实测：不给 `--force`/`--yolo`，让 agent 跑一个 shell 命令，它会自己重试两次、被环境拒绝，**然后把"这个命令被环境拦截了"这句话写进 `result` 的自然语言文本里，整条 run 仍然 `is_error:false`、退出码 0 正常结束——不会挂起**。好消息是不会 hang；坏消息是这个拒绝信号没有像 agy 那样在 stderr 里给固定关键字，只能在 `result` 文本里模糊匹配"blocked"/"rejected"这类词，不如 agy 的 soft-deny 信号干净。

### 6.5 没有原生超时 flag（和 agy 相反，必须自己包超时；官方参数表已确认无遗漏）

`agent --help` 和官方 `cli/reference/parameters.md`（全量参数表）都通读过，**没有任何 `--timeout`/`--print-timeout` 之类的参数**（唯一带 timeout 字样的是 `agent worker --idle-release-timeout`，那是云端 worker 空闲释放时间，跟我们的单次调研请求无关）。Sprint 1 我们特意不给 agy 包外层超时，因为它有原生 flag；Cursor 没有，**Sprint 3 必须自己用 `spawn` 的进程外层超时（`setTimeout` + `child.kill()`）兜底**，这条和 GOAL.md 3.3 节给 agy 的建议正好相反，写 Sprint 3 任务书时不能照搬。
- 顺带一提：CLI 里另有一个完全不相关的"Shell Mode"（交互式对话里直接跑 shell 命令的功能）有固定 30 秒、不可配置的超时——这是那个功能自己的限制，跟 `-p` headless 模式下 agent 自己调 shell 工具的耗时无关，别搞混。

### 6.6 权限/认证/会话相关 flag（供 Sprint 3 设计参考）

- 认证：`CURSOR_API_KEY` 环境变量，或提前 `agent login`（本机已登录，headless 会用已缓存的登录态，同 agy）。
- 自动批准：`-f/--force`（等价 `--yolo`）批准命令类操作、`--approve-mcps` 批准 MCP、`--trust` 批准工作区信任——是三个独立 flag，不像 agy 一个 `--dangerously-skip-permissions` 打包所有。只读调研场景大概率一个都不需要传。
- 会话延续：`--resume [chatId]` / `--continue`，同 agy 的 `--conversation`/`--continue` 概念对应，`session_id` 就是要存的那个 id。
- 模型：`--model <slug>`、`--list-models` 列出可用模型（列表很长，已实测拿到过一次完整清单）。
- 没有本地后台/异步机制——文档提到的"Cloud Agents"是完全不同的远程托管执行方式（且只在交互模式下用 `&` 前缀触发，headless 文档里没提怎么从 `-p` 触发），不是本地 spawn，Sprint 3 如果要做后台模式，还是得照 Sprint 2 的路子自己用 `detached+unref` 实现，不能指望 Cursor 自带。

### 6.7 只读调研场景推荐用 `--mode ask`，而不是裸 `-p`

官方文档明确有一个 `--mode ask`："Ask mode to explore code without making changes. The agent searches your codebase and provides answers without editing files."——这是专门为只读探索设计的模式。裸 `-p`（不加 `--force`）虽然实测也不会真的落盘写文件，但官方定位是"提议但不应用"，防御层级比 `ask` 模式弱一层。**Sprint 3 的 `/cursor:research` 建议默认带上 `--mode ask`**，而不是依赖"不给 --force 所以不会写文件"这种消极默认值。
权限还有一层更细的机制——`~/.cursor/cli-config.json` / `<project>/.cursor/cli.json` 里可以配 `Shell()`/`Read()`/`Write()`/`WebFetch()`/`Mcp()` 白名单——但这是配置文件级别的机制，比 agy 的单一 flag 复杂得多。Sprint 3 的适配器不碰这个配置文件，只用命令行 flag，把这条记在这里供以后需要更细粒度权限时参考。

## 7. 路线图（2026-08-23 三个适配器齐活后，基于实测重写）

原来这一节写的是"Sprint 3 做 `/cheap:implement`、Sprint 4 做 codebuddy、然后 diff 三份抽 `lib/subprocess.mjs`"。前两条已完成但范围有变（Sprint 3/4 都主动收窄成了只读 research，写能力没做）；第三条**经实测已被推翻，见 7.1**。这一节替换掉旧版，后续接手人以此为准。

### 7.1 抽象这件事：实测结论是「不抽」，而且这是好结果

三个适配器都写完了，按约定做了手动 diff。**结论：不抽 `lib/subprocess.mjs`，也不建 `lib/`。** 不是偷懒，是量出来的：

| 对比 | 差异行 | 逐字节相同的非空行 |
| --- | --- | --- |
| cursor ↔ codebuddy | 89 | 126 |
| agy ↔ cursor | 275 | 89 |
| agy ↔ codebuddy | — | 92 |

「89~126 行相同」听着像有得抽，但**把相同的行按内容归类，绝大多数是语法噪音**：`}`（5 次）、`});`（4 次）、`try {`、`return reject(err);`、`process.exit(1);`、`/**`、`*/`。它们相同的原因是 JS 的括号长得一样，不是因为共享了逻辑。

真正成块的实质共同点只有三处，合计不到 10 行：
1. `stdio: ['ignore', 'pipe', 'pipe']`（一行常量）
2. `stdoutData += chunk` / `stderrData += chunk` 两行累积
3. ENOENT → "XX 没装/不在 PATH" 的分支（三家文案各不同，只有 `err.code === 'ENOENT'` 这个判断相同）

**为不到 10 行的噪音级共性建一个 `lib/`，代价是给三个已绿的适配器同时引入一个共享依赖**——以后任一 CLI 改契约都要先问"改这里会不会碰坏另两个"。这正是第 2 节说 `codex-plugin-cc` 那 1,840 行"看起来通用"的基础设施为什么不能用的同一个病因。**抽象不做，就是这次的正确交付。**

顺带订正旧路线图的两处预判错误（留着当教训）：
- 旧版说「大概率只剩 spawn + stdin ignore + **stderr 截断**」——实测 stderr 截断**只有 codebuddy 一家实现了**（`MAX_STDERR_TRUNCATE`），agy 和 cursor 压根没截。**预判的共用点里有一个根本不存在。**
- 旧版说超时逻辑不能共用，这条对了：agy 走原生 `--print-timeout`，另两个自己 `setTimeout`+`SIGTERM`→`SIGKILL`，agy 文件里连 `SIGTERM` 字样都没有。

**给后续接手人的判据**：以后再想抽象，先跑一次 `diff --unchanged-group-format` 量相同行，再把相同的行 `sort | uniq -c` 看是不是括号。**「相同行数多」不等于「有共性」，这是这个项目验证过的一次。**

### 7.2 待办（按建议顺序，都不是马上要做）

- **A. 写能力（价值最高，契约调研已完成 → 见第 9 节）**：Sprint 3/4 各自收窄掉的写文件能力，一直没做。三个 CLI 只读调研全通了，但省 Opus 额度最狠的场景是"小改动/批量重构"，那必须能写文件。**做 cursor 的**（写路径已实测，第 9 节）。三条结论决定了任务书长什么样：①失败信号比只读干净（不给 `--force` 是硬失败 exit 1，不是假成功），Sprint 3 的判断逻辑可直接复用；②第一道门是 **Workspace Trust**（目录级），stderr 必须透传；③**JSON 里没有任何改动清单**，改了哪些文件只在自然语言里，所以**必须在适配器外看磁盘核实**。测试只准动隔离 fixture（9.5 节）。
- **B. codebuddy 后台模式（已调研，2026-08-24 挂起）**：唯一自带后台的（`--bg`/`--name`/`ps`/`logs`/`kill`）。**实测 `--bg` 在本机 `2.137.1` 上功能性损坏**（模型回复不落盘、文件不改、会话空转，两次复现，详见 8.7 节），等上游修复后重测；重测通过前不做。届时也别照搬 Sprint 2 给 agy 手写的 job-store，先实测原生那套够不够用。
- **C. cursor/agy 的 stderr 截断**：codebuddy 有、另两个没有。一个 CLI 吐几百 KB stderr 就会把主会话上下文冲掉。**这条最小、最实用**，但不许借它顺手建 `lib/`（见 7.1）。
- **D. 路由策略**：什么任务分给哪个 CLI。**永远留在 Claude 侧的 prompt/markdown 里，不写进插件代码。**

### 7.3 这个项目已经验证过的三条判断（别推翻，除非有新实测）

1. **不魔改上游**：`codex-plugin-cc` 只读参照，独立仓库自己一份 marketplace。
2. **契约靠实测，不靠文档**：三家 CLI 的官方文档都有和实际不符的地方（codebuddy 文档里 JSON 响应格式那段甚至是空的 `{...}`，全靠实测拿到 envelope）。**新增任何 CLI，先契约调研、后写代码，这个顺序不许调换。**
3. **反向验证不能省**：每个 Sprint 都故意制造一次失败证明防线会响（注释 kill 证明进程真挂起、换判法证明会误判）。**Sprint 4 那次还额外证明了任务书本身可以是错的**——当时任务书要求的反向验证 2 在逻辑上不成立（空 stdout 会被旧判法拦下，两种判法结论相同），执行者发现后订正并在 PROGRESS.md 记了原因。**书是人写的，实测才是裁判。**


## 8. Sprint 4 契约调研（已完成，2026-08-23）：codebuddy CLI headless 模式

结论先说：**codebuddy 是 Claude Code 的 fork，flag 名字几乎一模一样（`-p`/`--output-format`/`--resume`/`--permission-mode`/`--allowedTools`），这恰恰是最大的陷阱——长得像不等于行为一样，它的 JSON 形状和退出码语义跟 agy、Cursor 都不同**。以下全部用 `codebuddy --help` + 本机真实调用核实（本机装的是 `2.137.1`，已登录），配合官方文档库 `codebuddy-docs`（379 篇，`search-docs read codebuddy-docs headless.md` / `cli-reference.md` / `permission-modes.md`）交叉验证，不是只抄文档。

### 8.1 基本调用

命令是 `codebuddy`（别名 `cbc`）。

```bash
codebuddy -p "<prompt>" --permission-mode dontAsk --tools Read,Glob,Grep --output-format json
```

- `-p`/`--print`：非交互模式，打印结果后退出。
- `--output-format`：`text`/`json`/`stream-json`，三选一，同 agy/Cursor。

### 8.2 真实 JSON envelope：**stdout 是一个数组，不是单个对象**（最大差异）

这是三个 CLI 里唯一这么干的。`--output-format json` 吐出的是**整条 transcript 的 JSON 数组**，实测长度会随对话轮数变化（简单问答 4–5 个元素，触发了工具调用的 12 个元素）：

```
types: message | file-history-snapshot | reasoning | function_call | ... | result/success
```

真正要的结果在**最后那个 `type:"result"` 元素**里：

```json
{"type":"result","subtype":"success","is_error":false,"result":"...","uuid":"...","session_id":"...",
 "duration_ms":3319,"duration_api_ms":3317,"num_turns":3,"total_cost_usd":0,
 "usage":{"input_tokens":26112,"output_tokens":135,"cache_creation_input_tokens":26112,"cache_read_input_tokens":0},
 "permission_denials":[],"__timestamp":"..."}
```

- **不能拿 `JSON.parse(stdout)` 当对象直接取字段**——parse 出来是数组，`.result` 会是 `undefined`。必须 `Array.isArray()` 之后找 `find(x => x.type === "result")`，**不要写死 `j[j.length-1]`**（数组长度不固定，虽然实测 result 都在末尾，但按 `type` 找才是契约）。
- 字段名对照：响应文本 `result`（同 Cursor，不同 agy 的 `response`）；会话 id `session_id`（同 Cursor）；`usage` 是**下划线**命名（同 agy，不同 Cursor 的驼峰）——**三个 CLI 各占一种组合，抄任何一份都会错**。
- 数组里还夹着 `reasoning`（思维链原文）、`function_call`/`function_call_result`（工具调用明细）、`file-history-snapshot`。只读调研只需要 `result` 那一个元素，其余忽略；但要知道它们存在——**stdout 体积比另两个 CLI 大一个量级**（一句话问答就 17–18KB，因为整个 system prompt 都在数组第一个 `message` 元素里回显了），做截断/日志时别整份存。

### 8.3 退出码完全不可信（第三种失败模式，比 Cursor 更坑）

实测两种失败，退出码不一致：

| 失败场景 | exit code | stdout | stderr |
| --- | --- | --- | --- |
| 模型名不存在（API 层 400） | **0** | **0 字节** | 纯文本 `400 model [xxx] service info not found` + 可用模型清单 |
| flag 拼错（参数层） | 1 | 0 字节 | `error: unknown option '--xxx'` |

模型名那条我**连测了两次都是 exit 0**，不是偶发。对照另两个：agy 失败给 JSON+`status:ERROR`；Cursor 失败 exit 非 0 + 空 stdout；**codebuddy 可以 exit 0 + 空 stdout + 纯文本 stderr**。

- **所以判成败的唯一可靠依据是"stdout 能否 parse 出数组、且数组里能找到 `type:"result"` 元素"**。Sprint 3 给 Cursor 定的"exit===0 且 stdout 非空"这条规则在这里**不够**——exit 0 也可能是彻底失败。**照抄 cursor-cli.mjs 的判断会把 API 失败误判成成功。**
- `is_error` 同 Cursor 一样只在成功路径出现且恒为 `false`，**不能用来判成败**。

### 8.4 只读边界：用 `--tools` 白名单，而不是只靠 `--permission-mode`

- `--permission-mode plan` 实测**确实拦住了写文件**（让它建 `note.txt`，目录事后是空的，进程正常退出不挂起），但官方 `permission-modes.md` 写明 plan 模式是"**委托给进入 plan 前的那个模式**（默认 `default`），额外允许写入会话计划文件"——也就是说它的只读性是"继承来的"，不是硬保证，而且它**本身就会往 `~/.codebuddy/plans/` 落盘写计划文件**（本机该目录已有 16 个历史文件）。**对纯只读调研来说这是个不该有的副作用。**
- 官方对非交互自动化推荐的是 `--permission-mode dontAsk`（"不弹框，直接拒绝未预批准动作"，注意它是**更严**不是更宽松）。实测只读调研正常出结果。
- 更硬的一层是 `--tools Read,Glob,Grep`（工具白名单，`""` 禁用全部内置工具、`"default"` 全给）。这是**工具层面直接不给写工具**，不依赖任何模式语义。实测 `--permission-mode dontAsk --tools Read,Glob,Grep` 正常出结果。**Sprint 4 的 `/codebuddy:research` 建议两层都上**（`dontAsk` + `--tools` 白名单），比 Cursor 的 `--mode ask` 单层更严，因为 codebuddy 默认权限比 Cursor 更开放。
- ⚠️ **`-y` / `--dangerously-skip-permissions` 绝对不要传**。官方 headless 文档把它写成"非交互模式的必需参数"，那是针对需要写文件/跑命令的自动化场景说的；只读调研传了它等于自己把所有防线拆掉。

### 8.5 权限拒绝信号和 Cursor 一样脏，`permission_denials` 是个空壳

`result` 元素里有个 `permission_denials` 数组，看名字像是结构化的拒绝信号——**实测在真的发生拒绝时它依然是 `[]`**。plan 模式下写文件被拦那次，拒绝原因只出现在 `result` 的自然语言文本里（"该权限被拒绝"/"计划模式禁止我进行任何文件写入"），`is_error` 还是 `false`、`subtype` 还是 `success`。

- 所以只能和 Cursor 一样做启发式关键字匹配。**但关键词表不能照抄 cursor-cli.mjs**：codebuddy 中文回复居多，实测原文是"**被拒绝**"、"**禁止**"、"**无法完成**"，英文的 `blocked`/`rejected`/`denied` 一个都没出现。中英文关键词都要覆盖。
- `permission_denials` 字段可以存下来备查，但**不能拿它当判断依据**（和 `is_error` 一样是空壳字段）。

### 8.6 没有原生超时 flag（同 Cursor，必须自己包）

`codebuddy --help` 全量通读 + 官方 `cli-reference.md` 全量参数表核对，**没有任何 `--timeout` 参数**。同 Cursor，必须自己 `setTimeout` + `SIGTERM` → 2s → `SIGKILL`。另有 `--max-turns <n>` 可以限制 agent 轮次（这是"逻辑刹车"不是"时间刹车"，两者不能互相替代，只读调研可以顺手加一个防跑飞）。

### 8.7 其它已核实的 flag（供后续 Sprint 参考，Sprint 4 不用）

- **它自带后台机制**（agy/Cursor 都没有）：`--bg` detached 运行 + `--name <name>` 命名，配套 `codebuddy ps` / `logs <pid|name>` / `kill <pid|name>`，日志落 `~/.codebuddy/logs/`。
  - **⚠️ 2026-08-24 实测（本机 `2.137.1`）：`--bg` 功能性损坏，不可用。**两次独立探针（隔离 fixture，改一个 5 行文件）：任务被接（`ps` 显示 busy）、模型响应 1.2 秒就完成（遥测 `finish_reason=stop`），但 **assistant 回复不落 transcript（jsonl 只有 user/snapshot/ai-title 三行）、文件不改、会话永久空转**（只有内存探针心跳，5 分钟后手动 kill）。另两个坑：启动时打印的 `~/.codebuddy/logs/{name}.log` 恒为 0 字节，真遥测在 `~/.codebuddy/logs/YYYY-MM-DD/` 日期目录里；官方 daemon.md 声称 `--bg` 以 `--print -y` 模式运行（自动跳过权限确认），虽因功能损坏未能直接验证，但意味着**如果哪天修好了，后台任务默认就是全权限的**，届时适配器必须显式覆盖 `--permission-mode`。**结论：B（codebuddy 后台模式）挂起，等上游修复后重测；重测通过前不许基于 `--bg` 写适配器。**同步模式（`-p`）不受影响，Sprint 4 交付的 `/codebuddy:research` 照常可用。
- 还有更重的 `codebuddy daemon start/stop/status`（HTTP 服务）、`--serve`、`--acp`、`--sandbox`、`--worktree`、`--prewarm`（消除冷启动）。这些都是 agy/Cursor 没有的能力面，**但也是"别把单引擎桥接当多引擎底座"这条教训的活例子——能力面越大越不该硬塞进共享抽象**。
- 会话延续：`--resume <id>` / `--continue`，`session_id` 就是要存的 id（三个 CLI 概念一致）。
- 结构化输出：`--json-schema '<JSON Schema>'` 可以强制输出落到 `structured_output` 字段（agy/Cursor 都没有）。只读调研不需要，但这是它独有的强项，记下来。
- 认证隐式，用本机已登录态；`--model` 支持的模型清单很长（实测跑到过 `deepseek-v4-flash-ioa`——**说明默认模型不一定是 Claude，做质量预期时要注意**）。

### 8.8 三个 CLI 契约差异总表（写代码前必读，防止照抄）

| 维度 | agy | Cursor (`agent`) | codebuddy |
| --- | --- | --- | --- |
| stdout 形状 | 单个 JSON 对象 | 单个 JSON 对象 | **JSON 数组（整条 transcript）** |
| 响应文本字段 | `response` | `result` | `result` |
| 会话 id | `conversation_id` | `session_id` | `session_id` |
| `usage` 命名 | 下划线 | **驼峰** | 下划线 |
| 判成败依据 | `status` 枚举 | exit 0 且 stdout 非空 | **stdout 里找得到 `type:"result"`** |
| 失败时退出码 | 0（给 JSON） | 非 0 | **可能是 0（API 失败）也可能 1（参数失败）** |
| 失败时给 JSON 吗 | 给 | 不给 | 不给 |
| 超时 | **原生 `--print-timeout`** | 自己包 | 自己包 |
| 只读手段 | 默认需审批 | `--mode ask` | `dontAsk` + `--tools` 白名单 |
| 拒绝信号 | stderr 干净关键字 | `result` 里英文关键字 | **`result` 里中文关键字**（`permission_denials` 是空壳） |
| 自带后台 | 无 | 无（Cloud Agents 是远程） | **有（`--bg`/`ps`/`logs`/`kill`）** |

**这张表就是"不要过早抽象"的证据**：11 个维度里有 9 个三家都不一样。（Sprint 4 写完后已按约定做了 diff，实测结论是**不抽象**，连"spawn + stdio ignore + stderr 截断"这个预判也部分落空——详见 7.1 节。）

## 9. Sprint A 契约调研（已完成，2026-08-23）：Cursor CLI **写路径**

只读路径的契约在第 6 节。**写路径是另一套东西，单独实测过**（隔离 fixture `/tmp/probe-*`，一个 5 行 `math.js`，让它把 `add(a,b)` 改成支持第三个可选参数，跑了给 `--force` / 不给 `--force` 两次对照）。

### 9.1 好消息：写路径的失败信号比只读路径**干净**（和预期相反）

原本担心的是"写被拒还假报成功"（只读路径 6.4 节就是这毛病：被环境拦截却把话写进 `result`、照样 `is_error:false` + exit 0）。**实测结论相反**：

| | 给 `--force` | 不给 `--force` |
| --- | --- | --- |
| exit code | 0 | **1** |
| stdout | 456 字节 JSON | **0 字节** |
| stderr | 空 | 309 字节纯文本 |
| 文件真改了吗（md5 前后比） | **YES** | **NO** |

不给 `--force` 时它**硬失败**（exit 1 + 空 stdout + stderr 纯文本），走的是 6.3 节那条"失败不给 JSON"的路，**不是**假成功。所以 Sprint 3 已经写好的判断逻辑（`exit===0 && stdout非空` 前置于 `JSON.parse`）**在写路径上直接可用，不需要为"假成功"另加防线**。

### 9.2 真正的坑：拦住写操作的是 **Workspace Trust**，不是 `--force`

不给 `--force` 时的 stderr 原文：

```
⚠ Workspace Trust Required
  Cursor Agent can execute code and access files in this directory.
  Do you trust the contents of this directory?
    /tmp/probe-noforce
  To proceed, you can either:
    • Run 'agent' interactively to decide
    • Pass --trust, --yolo, or -f if you trust this directory
```

- 这是**目录级信任门**，在 agent 干活之前就拦下了，和"某个工具调用要不要批准"是两回事。**6.6 节把 `--trust` 记成了"批准工作区信任"的独立 flag，但没测出它是写路径的第一道门。**
- 三个 flag 都能过这道门：`--trust`、`--yolo`、`-f`/`--force`。**`--force` 顺带就把信任门开了**，所以只传 `--force` 就能写（实测确实写成了）。
- **对适配器的含义**：报错时必须能把这段 stderr 透传出来。用户看到 "Workspace Trust Required" 才知道该加 flag；只报 "exit 1" 等于让他去猜。
- ⚠️ **反过来说，这道门是只读调研一直安全的真正原因之一**。`/cursor:research` 用的是 `--mode ask` 且从不传 `--trust`/`--force`，等于双保险。**写能力一旦传了 `--force`，这层保护就整体消失了——它同时开了信任门和工具批准。**

### 9.3 写路径的 JSON envelope：和只读**完全一样**，没有改动清单

```json
{"type":"result","subtype":"success","is_error":false,"duration_ms":10875,"duration_api_ms":10875,
 "result":"先看一下 math.js 里 add 的现有实现。已改好：add 现在是 add(a, b, c = 0)……","session_id":"...","request_id":"...","usage":{"inputTokens":13971,...}}
```

顶层 key 和 6.2 节只读路径**逐字相同**：`type,subtype,is_error,duration_ms,duration_api_ms,result,session_id,request_id,usage`。

- **没有 `files_changed`、没有 diff、没有 `permission_denials`、没有任何结构化的改动清单。**改了哪些文件只以自然语言写在 `result` 里（"已改好：add 现在是 add(a, b, c = 0)"）。
- **这是写能力最本质的风险**：适配器**无法从 JSON 得知它到底动了哪些文件**。想知道只有一个办法——**在适配器外面看磁盘**（git status / md5 前后对比）。
- 所以 GOAL.md 3.4 节第 5 条那个教训在这里升级成硬规矩：**涉及副作用的调用，最终必须落地核实，不能信 JSON 的自述。**本次实测就是靠 md5 前后比才敢说"文件真改了"。

### 9.5 `--trust` 单独就够写文件；但"部分成功"才是写路径的真陷阱（2026-08-23 补充实测）

任务书定 flag 前又跑了两条对照（都是隔离 fixture + md5 前后比）：

**A. 只传 `--trust`（不传 `--force`），纯写文件任务 → 成功。** 文件精准改对（`add(a, b, c = 0)`），exit 0，stderr 0 字节，envelope 与 `--force` 路径逐字同构。**写能力不需要 `--force`，目录信任门过了，文件编辑工具本身就可用。**所以适配器默认只传 `--trust`——比 `--force` 少开"自动批准跑命令"那道门。

**B. 只传 `--trust`，任务需要跑 shell 命令 → 「部分成功」，最危险的形态。**让它「跑 `node -e "console.log(2+2)"` 并把输出追加到文件末尾」，实测：exit 0、`is_error:false`、文件**真的改了**（追加了 `// 4`）、stderr 0 字节——但 `result` 自己写着「Shell 工具调用被拒绝，未能实际执行该命令；结果按该表达式的正确输出写入」。

拆开看这个形态为什么坑：
- **文件层检测防不住**：md5 确实变了，"文件动没动"这道检测会放行。
- **exit code / `is_error` / stderr 全部干净**：和真成功无法区分。
- **唯一的破绽在 `result` 自然语言里**："被拒绝"/"无法执行"这类字样 + 它描述的行为和用户要求的行为不一致（要求跑命令，它没跑）。
- **这正是 6.4 节只读路径那个坑的写路径版本**，但更险：只读时"被拒"只是答案不完整；写路径时**它会把"没验证过的猜测"写进你的文件**——`2+2=4` 它猜对了，换个跑 `npm test` 的任务它就敢把猜的测试结果写进去。

**给适配器的含义（Sprint A 任务书的硬要求）**：①对 `result` 做"跳过/被拒"关键词扫描（中英文）,命中必须在输出里带 warning，不能只报成功；②**凡是任务要求跑命令/跑测试的，适配器无法从 JSON 判断验证是否真做了——这个限制要如实写进命令文档**，让用户知道 `/cursor:implement` 的输出里"验证过了"这句话不一定可信，最终以用户自己跑测试为准。

### 9.6 这次没观察到的副作用（写任务书时不必防，但也别假设永远如此）

fixture 目录跑完仍然只有 `math.js` 一个文件：没有顺手 `git commit`、没装依赖、没留临时文件、没有备份文件。改动精准命中要求（`add(a, b, c = 0)`，`module.exports` 没动）。

### 9.7 写能力的自建方式必须换（前四个 Sprint 的做法在这里会出事）

Sprint 1–4 都是"让 CLI 拿任务书改 quota-router 自己"。只读适配器写错最多是代码难看；**写能力的执行者会真的改文件**，如果它同时又在 quota-router 里跑，就变成"一边改自己、一边测改文件的能力"，出事时分不清是被测代码写坏的还是执行者手滑。

**规矩**：写能力的测试只准对**隔离的 fixture 目录**动手（`os.tmpdir()` 下现建现删），quota-router 自身继续走白名单保护。真机验收也只准在 fixture 里跑。

