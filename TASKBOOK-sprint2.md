你是执行者，这份文档是你唯一的任务来源；中途没人可问，拿不准的写进 BLOCKED.md，跳过继续做别的，最后随交付提交。断线换新会话先读 PROGRESS.md 接着做，别重做；每做完一项立刻更新。这活为什么干：给 agy 适配器加后台模式，让耗时调研不用占着终端等，用户随时用 `/agy:status` 查结果。打架时让步顺序：job 状态判断准确 > 进程存活检测靠谱 > 代码好看。"只允许"/"不许"违反算失败；"建议"有更好的路就走，在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- 代码组织 → 默认继续写在 `plugins/agy/scripts/agy-cli.mjs` 单文件里；超过约400行就拆出同目录下的 `plugins/agy/scripts/job-store.mjs`（只准拆到这一个新文件，不许建 `lib/`）（猜的）｜代价小。
- job id 生成 → 默认 `crypto.randomUUID()`（Node 内置，已实测本机可用）｜无实质影响。
- 状态目录 fallback 名 → 默认 `os.tmpdir()/quota-router-agy`（不叫 codex-companion）（猜的）｜代价小。

## 界限
- 白名单（只能改/建）：`plugins/agy/**`、`tests/**`、`PROGRESS.md`、`BLOCKED.md`。不许碰 `.claude-plugin/marketplace.json`、`package.json`（除非新增字段确实必要，必要就写 BLOCKED.md 别直接改）。
- 不许碰 `GOAL.md`、`TASKBOOK-sprint2.md`（这份文档本身）：基线 commit `b2a1579`，交付时 `git diff b2a1579 -- GOAL.md` 必须为空，`TASKBOOK-sprint2.md` 不出现在 `git status` 里。
- 不许碰 `../codex-plugin-cc/` 任何文件。
- 重要澄清：**agy 这个 CLI 本身没有 `--background` 这个参数**（已用 `agy --help` 核实过，不存在）。"后台"是我们自己 `agy-cli.mjs` 的行为，靠 Node 的 `spawn(..., {detached:true, stdio:'ignore'})` + `child.unref()` 实现，不是往 `agy` 命令上加 flag。
- 顺手活写 BLOCKED.md 跳过：自动重试、进度百分比/阶段追踪、给 cursor/codebuddy 建目录——GOAL.md 5.5 节已经禁过。

## 现状与任务0（2026-08-23）
- 基线 commit `b2a1579`：`agy-cli.mjs` 162 行，`node --test tests/*.test.mjs` 应为 4 pass 0 fail 0 skip。
- `crypto.randomUUID()` 本机实测可用。`CLAUDE_PLUGIN_DATA` 环境变量在 Claude Code 插件运行时会被设置成该插件的专属数据目录（本机验证过这个变量真实存在，值随当前插件变化）；脚本里必须做成"有则用，没有则 fallback 到 tmpdir"，不能假设它一定存在。

任务0：重跑 `node --test tests/*.test.mjs` 确认基线还是 4/0/0，对不上就停，证据写 BLOCKED.md；核对后把"理解的目标/顺序/最大风险"（≤10行）写进 PROGRESS.md 再动工。

## 任务1：job 存取层
新增函数（可放 agy-cli.mjs 或 job-store.mjs）：`resolveJobsDir()`（读 `CLAUDE_PLUGIN_DATA`，没有就用 `os.tmpdir()/quota-router-agy/jobs`，`fs.mkdirSync(recursive:true)`）、`writeJob(job)`、`readJob(id)`、`listJobs()`。job 文件字段：`{id, prompt, status:"running"|"done"|"error", pid, conversationId, startedAt, finishedAt, response, error}`，`status` 只这三个值。**每次 `writeJob` 之后必须立刻 `readJob` 读回来做一次内容核对（JSON 相等），核对不过要抛错**——这是 GOAL.md 3.4 节第5坑教训（3.4/5：agy 顶层 status 报错但产物其实写成功了，反过来同理要防"以为写成功了其实没写"）。
验收：写一个 job、读回来、字段完全一致；跑个不存在的 job id 读取，明确返回"not found"而不是抛异常炸整个进程。

## 任务2：`--background` 模式
`agy-cli.mjs research --background <topic>`：生成 job id → `writeJob` 写初始 `running` 记录 → 用 `spawn(process.execPath, [__filename, '--worker', jobId, prompt], {detached:true, stdio:'ignore'})` 拉起自身的 worker 模式 → `child.unref()` → 把 pid 写回 job 记录 → 打印 job id → 立刻退出（不等 worker 完成）。`--worker <jobId> <prompt>` 是内部模式（不写进 `/agy:research` 的用户文档，只在代码里用）：调用已有的 `runAgyResearch`，完成后 `writeJob` 终态。
验收：`node agy-cli.mjs research --background "一句话解释rebase"` 立刻返回（<2秒）且打印出 job id；等几秒后 `readJob(该id)` 看到 `status:"done"` 且 `response` 有内容。

## 任务3：`/agy:status` 命令
新建 `plugins/agy/commands/status.md`（frontmatter 格式照抄 `research.md`），调用 `agy-cli.mjs status [job-id]`：给 id 就打印那条 job 的详情；不给就列出 `listJobs()` 里最近的几条。**进程存活检测**：状态是 `running` 时用 `process.kill(pid, 0)`（不发信号只探测，Node 标准写法，抛 `ESRCH` 说明进程已死）判断进程是否还活着，死了但文件仍是 `running` 就在输出里明确标注"进程已消失，状态未知"，不自动纠正文件内容。
验收：正常跑完的 job 显示 `done`；手动 `kill` 一个 worker 进程后 `/agy:status` 能识别出"标记running但进程已死"并原样报告。

## 任务4：测试
扩展 `tests/agy-cli.test.mjs`（或新建 `tests/job-store.test.mjs`），复用 Sprint1 的 `fake-agy-bin.mjs`。覆盖：①background 立刻返回且不阻塞；②等待后 job 变 done；③status 对不存在的 id 报错而非崩溃；④进程假死场景（写一个 pid 不存在的 running 记录，status 能识别）。不许 `.skip`、不许 mock 被测的 job 读写逻辑本身、不许删测试。
验收：`node --test tests/*.test.mjs` pass ≥ 8（Sprint1 的4个 + Sprint2 新增至少4个），fail=0，skip=0。

## 反向验证
把 `writeJob` 后的读回校验故意删掉/注释掉，构造一次写入被静默截断的场景（比如故意在写之后立刻同步删除文件再读），应该原本会报错的地方现在不报错——贴出"删掉校验后测试仍然绿"的输出证明校验本来在起作用；然后恢复校验，贴全绿输出。

## 规矩
- 不装新 npm 依赖。同一条验收连败3次换下一项；结果比 Sprint1 基线差就回滚如实报告。

## 完成条件
- 硬指标1：`node --test tests/*.test.mjs` 至少8个测试全过、0 fail、0 skip。
- 硬指标2：`git diff b2a1579 -- GOAL.md` 为空，`../codex-plugin-cc/` 零改动，任务2验收的"<2秒返回"用 `time` 命令实测贴出来。
- 每条都要贴真实命令输出（含反向验证证据），只说"做完了"不算数。
- `BLOCKED.md` 随交付提交，没内容也写"无"。
- 止损：跑满 10 轮仍未达标就停，如实汇报卡在哪、还差什么。
