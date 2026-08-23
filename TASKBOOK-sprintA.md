你是执行者，这份文档是你唯一的任务来源；中途没人可问，拿不准的写进 BLOCKED.md，跳过继续做别的，最后随交付提交。断线换新会话先读 PROGRESS.md 接着做，别重做；每做完一项立刻更新。这活为什么干：给 cursor 插件加写文件能力 `/cursor:implement`，与 `/cursor:research` 平级。**写路径和只读是两套契约（GOAL.md 第 9 节，全部隔离 fixture 实测）：失败信号更干净，但有一种"部分成功"——文件真改了、exit 0、is_error:false，实际它跳过了验证、把猜的答案写了进去。**防线都为它设。打架时让步顺序：不把"部分成功"当完全成功上报 > 真改文件 > 代码好看。"不许"违反算失败；"建议"有更好的路就走，在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- 只做单文件小改动，不做批量重构（写路径 JSON 里**没有改动清单**（9.3 节），范围越大越无法核实）｜代价：批量重构以后补。
- 权限 flag 只传 `--trust`，不传 `--force`（9.5 节探针 A 实测 `--trust` 单独就能写文件；`--force` 会额外开"自动批准跑命令"那道门）｜代价：任务含跑命令时会"部分成功"，靠 warning 防线兜。
- 默认超时 300000ms（5 分钟，写路径实测单次 10.9s）（猜的）｜代价小。

## 界限
- 白名单（只能改/建）：`plugins/cursor/**`、`tests/**`、`PROGRESS.md`、`BLOCKED.md`。**marketplace.json 插件已注册，不许动。**
- 不许碰 `plugins/agy/**`、`plugins/codebuddy/**`、`package.json`、`GOAL.md`（基线 `9f8a427`，交付时 `git diff 9f8a427 -- GOAL.md` 必须为空）、本文件、`../codex-plugin-cc/`。
- **测试和真机验收只准对隔离 fixture 目录动手**（`os.tmpdir()` 下现建现删，里面只放你自建的文件），**执行期间不许改 quota-router 自身任何文件**（PROGRESS/BLOCKED 除外）——写能力的执行者会真改文件，边改自己边测自己，出事分不清是谁弄坏的（9.7 节）。
- **不许传 `-y`/`--yolo`/`--force`/`-f`**（`--trust` 已实测够用；多开的每道门都是风险）。

## 必读契约（GOAL.md 第 9 节，先读完再动手）
1. **失败信号干净**：没过目录信任门（无 `--trust`）→ 硬失败 exit 1 + stdout 0 字节 + stderr 纯文本（9.1 节）。已有判法（exit 0 且 stdout 非空 → JSON.parse）直接可用。
2. **envelope 与只读逐字同构**：`result`/`session_id`/`usage`（驼峰），没有任何改动清单字段。
3. **部分成功陷阱（本 Sprint 核心）**：任务含跑命令、shell 被 `--trust` 挡下时，它会**自己猜结果写进文件**：文件真改、exit 0、`is_error:false`、stderr 干净，唯一破绽是 `result` 里"被拒绝/无法执行/未能实际执行"字样（9.5 节探针 B 实测原文）。**中英文关键词都要扫**（实测出过"被拒绝""无法执行""未能实际执行"）。

## 任务0
基线 `node --test tests/*.test.mjs` 应为 **25 pass 0 fail 0 skip**（commit `9f8a427`）；对不上就停并写 BLOCKED.md。核对后把"理解的目标／顺序／最大风险"（≤10 行）写进 PROGRESS.md 再动工。

## 任务1：命令文档
建 `plugins/cursor/commands/implement.md`：`/cursor:implement <instruction>`，frontmatter 格式照 `plugins/cursor/commands/research.md`。文档里**必须**写明两条：①默认只传 `--trust`，不自动批准跑命令；②**输出里"我已验证/测试通过"这类话不可信**——它可能在 shell 被拒后把猜的结果写进文件，最终以用户自己跑测试为准（9.5 节）。不许把命令写成"已安全验证"。
验收：文档存在、含这两条、frontmatter 能被 Claude Code 解析（格式与 research.md 一致）。

## 任务2：核心脚本
给 `plugins/cursor/scripts/cursor-cli.mjs` 加 `runCursorImplement(prompt, options)`（同文件新函数，不改 `runCursorResearch` 的行为）：
- args 与 research 差两处：**去掉 `--mode ask`**（那是只读模式）、**加 `--trust`**。其余（spawn 选项、超时 SIGTERM→2s→SIGKILL、判成败 gate、ENOENT）沿用同文件已有模式。
- 返回值除 `result`/`session_id`/`usage`/`raw` 外新增 `warnings`：对 `result` 做**中英文**关键词扫描（至少覆盖：被拒绝、无法执行、未能实际执行、跳过、blocked、rejected、denied、skipped），命中加 warning。**不判失败**——文件可能真改对了，但必须让用户知道验证没做。
- CLI 入口 `implement` 子命令把 warning 打到 stderr、exit code 仍为 0（部分成功要可见，但不是失败）。不许吞掉或降级。
验收：在**隔离 fixture 目录**里 `node plugins/cursor/scripts/cursor-cli.mjs implement "把 math.js 的 add 改成支持三个参数"` 能改对文件并输出 result。

## 任务3：测试（全部用隔离 fixture，不许碰真实仓库）
建 `tests/cursor-implement.test.mjs`（fake 二进制照 `fake-cursor-bin.mjs` 的模式新建，记得 chmod +x）：
1. 成功：fake 吐正常 envelope → resolve，`warnings` 为空。
2. 硬失败：fake exit 1 + 空 stdout + stderr 纯文本（复刻 Workspace Trust 拒绝文案）→ reject，错误信息含 stderr 内容。
3. **部分成功（最重要）**：fake exit 0 + 正常 envelope，但 `result` 含"未能实际执行"→ resolve 且 `warnings` 非空、`result` 仍在。**防的就是探针 B 那种把猜的答案写进文件的假成功。**
4. **args 断言**：spawn 的 argv 里**必须有 `--trust`**、**必须没有 `--mode`/`--force`/`--yolo`/`-y`**（fake bin 把 argv 存到可读处供断言）。
5. 超时 kill：fake sleep 60s、超时压 500ms → 10s 内被杀。
6. **research 不回退**：跑一次 `runCursorResearch` 既有断言（证明加 implement 没改坏只读路径）。
不许 `.skip`、不许 mock 被测函数本身、不许删/改已有 25 个测试。
验收：`node --test tests/*.test.mjs` pass ≥ 31、fail 0、skip 0。

## 反向验证（两条都要，各贴输出）
1. 注释掉关键词扫描，跑测试3，应看到 warnings 变空、测试变红；恢复后全绿。证明"部分成功"防线真的在干活。
2. 给 args 里临时加 `--force`，跑测试4，应看到 argv 断言变红；去掉后全绿。证明权限门真的是最小开的。

## 完成条件
- 硬指标1：`node --test tests/*.test.mjs` ≥ 31 全过、0 fail、0 skip。
- 硬指标2：`git diff 9f8a427 -- GOAL.md` 为空；`plugins/agy/**`、`plugins/codebuddy/**`、`marketplace.json`、`package.json` 零改动。
- 硬指标3：真机验收在隔离 fixture 里跑一次 `/cursor:implement` 等价命令，贴 md5 前后对比证明文件真改了（不许只贴 agent 自己的话）。
- 每条贴真实命令输出（含两条反向验证证据），只说"做完了"不算。`BLOCKED.md` 随交付提交，没内容也写"无"。
- 不装新 npm 依赖。同一条验收连败 3 次换下一项；结果比基线差就回滚如实报告。跑满 10 轮未达标就停，如实汇报卡在哪。
