# GOAL.md — quota-router

交接对象：接手实现的人 / Agent。读完本文件应该能直接开始写代码，不需要回头问"为什么"。

## 1. 这是什么

`quota-router` 是一个独立的 Claude Code 插件仓库，让 Opus 5 作为主控，把调研 / 小改动 / 批量重构 / 对抗审查这些任务分流给本地已安装的 CLI（agy / Cursor CLI / codebuddy / 官方 Codex 插件），省 Opus 的调用额度。

**和 `codex-plugin-cc` 的关系**：只读参照物，不 fork、不改它的代码。原因见下方"已验证的事实"。这个仓库独立存在，自己有一份 `marketplace.json`。

## 2. 已验证的事实（不是猜测，全部对照源码/官方文档核实过）

- `openai/codex-plugin-cc` 是官方维护的单插件仓库，`plugins/codex/scripts/` 里约 3,584 行代码是与 Codex App Server JSON-RPC 强绑定的协议栈，其余约 1,840 行是"看起来通用"的基础设施（进程、状态、job 追踪）。
  - **但这 1,840 行不是干净的可复用层**：`job-control.mjs` 直接 `import` 了 `codex.mjs`，`state.mjs` 把状态目录硬编码成 `"codex-companion"`。**不要指望直接 import 这些模块**，真要参考也是照着模式重写，不是拿来当依赖。
- `agy`（Antigravity CLI）**有官方 headless 模式**，文档见 `agy-cli-docs-mirror/docs/antigravity/cli/headless.md`。这不是我们臆测出来的接口，是官方承诺的契约，细节见第 3 节。

## 3. Sprint 1（已完成，2026-08-23）：跑通 agy 适配器

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

## 5. Sprint 2（当前目标）：`--background` / `/agy:status`

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

## 6. Sprint 2 之后的路线图（供后续接手人参考，不是现在要做的事）

- **Sprint 3**：接入 Cursor CLI 做 `/cheap:implement`。写之前先做一次和 3.3 节同等深度的 headless 契约调研（有没有 `--print`/`-p` 等价物、输出是不是结构化 JSON、超时怎么设、权限模型是什么），不要假设它和 agy 长得一样。
- **Sprint 4**：接入 codebuddy，同样先做契约调研。
- **抽象时机**：三个 CLI 适配器都各自独立写完之后，**手动 diff 三份 `*-cli.mjs`**，把逐字节相同的部分（大概率是"spawn + timeout + stdin ignore + stderr 截断"这类管道基建）提取成 `lib/subprocess.mjs`。CLI 各自的参数拼装、输出解析、错误映射永远留在各自文件里，不要往上提。
- **路由策略**（什么任务分给哪个 CLI）永远留在 Claude 侧的 prompt/markdown 里，不要写进插件代码。
