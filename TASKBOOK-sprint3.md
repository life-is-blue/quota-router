你是执行者，这份文档是你唯一的任务来源；中途没人可问，拿不准的写进 BLOCKED.md，跳过继续做别的，最后随交付提交。断线换新会话先读 PROGRESS.md 接着做，别重做；每做完一项立刻更新。这活为什么干：接入 Cursor CLI（命令是 `agent`），做一个只读调研命令 `/cursor:research`，和 agy 的 `/agy:research` 平级，但底层实现不能照抄——两个 CLI 的失败模式和超时机制完全相反。打架时让步顺序：超时兜底必须真的能杀死卡住的进程 > 成功/失败判断准确 > 代码好看。"只允许"/"不许"违反算失败；"建议"有更好的路就走，在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- 范围收窄为只读调研（`--mode ask`），不做 GOAL.md 提过的 `/cheap:implement`（写文件重构）（猜的，先最小风险打通适配层，写能力留到下个 Sprint）｜代价：以后要补一个 Sprint。
- 默认超时 → 180000ms（3分钟，对齐 agy Sprint1 的 `--print-timeout 3m`）（猜的）｜代价小。
- 目录 → `plugins/cursor/`，同级 `plugins/agy/`，注册进已有 `marketplace.json` 的 `plugins` 数组（不新建 marketplace 文件）｜无实质影响。

## 界限
- 白名单（只能改/建）：`plugins/cursor/**`、`.claude-plugin/marketplace.json`（只许往 `plugins` 数组里加一条，不许动 `agy` 那条）、`tests/**`、`PROGRESS.md`、`BLOCKED.md`。不许碰 `plugins/agy/**`、`package.json`。
- 不许碰 `GOAL.md`：基线 commit `980d9fc`，交付时 `git diff 980d9fc -- GOAL.md` 必须为空。不许碰 `TASKBOOK-sprint3.md` 本身（不需要 git 指纹，你此刻读到的就是唯一版本）。
- 不许碰 `../codex-plugin-cc/` 任何文件。
- 重要澄清（本机真装了 `agent 2026.08.11-e8db854` 并已登录、逐条实测的，不是抄文档）：
  1. **失败时 stdout 是空的，不给 JSON**——退出码非0、stdout 0字节、错误信息在 stderr 纯文本，即使传了 `--output-format json` 也一样，官方文档写明这是设计行为。判断成功用"exit code 0 且 stdout 非空"，不能假设失败也有 JSON。
  2. **没有任何 `--timeout` 参数**。**必须自己用 `setTimeout` 包超时并 `kill` 子进程**，agy 那种"依赖原生 flag"的做法这里行不通。超时先发 `SIGTERM`，2秒后还没退出再发 `SIGKILL`。
  3. JSON 字段和 agy 不同：响应文本是 `result`（不是 `response`），会话id是 `session_id`，`usage` 驼峰命名。`is_error` 出现时恒为 `false`（文档写的），**不能拿它判成败**。
  4. 不给 `--force` 时，shell/写文件被拒不会挂起，但拒绝信号混在 `result` 自然语言里（没有 agy 那种干净 stderr 关键字），只能启发式匹配 `blocked`/`rejected`/`denied`，标"可能不完整"。

## 现状与任务0（2026-08-23）
- `which agent` → `/data/home/bluejqhuang/.local/bin/agent`，`agent --version` → `2026.08.11-e8db854`，`agent status` 已登录。
- 真实跑过 `agent -p "一句话解释什么是 git bisect" --mode ask --output-format json`，返回单行 JSON：`{"type":"result","subtype":"success","is_error":false,"duration_ms":...,"result":"...","session_id":"...","usage":{"inputTokens":...}}`。
- 真实跑过坏模型名和坏 API key 两种失败场景：都是 exit 1、stdout 0字节、stderr 纯文本。
- Sprint1/2 基线：`node --test tests/*.test.mjs` 应为 15 pass 0 fail 0 skip（commit `980d9fc`）。

任务0：重跑 `node --test tests/*.test.mjs` 确认还是 15/0/0；对不上就停，写 BLOCKED.md；核对后把"理解的目标/顺序/最大风险"（≤10行）写进 PROGRESS.md 再动工。

## 任务1：骨架
仿照 `plugins/agy/`：建 `plugins/cursor/.claude-plugin/plugin.json`、`plugins/cursor/commands/research.md`（`/cursor:research <topic>`，frontmatter+`!`调用脚本，格式照抄 `plugins/agy/commands/research.md`）、往根 `.claude-plugin/marketplace.json` 的 `plugins` 数组追加 cursor 插件条目。
验收：两个 json 文件都能 `JSON.parse` 通过；`marketplace.json` 里 `plugins` 数组长度变成 2。

## 任务2：核心脚本（6.3/6.5/6.7 节契约，不是 agy 那套）
建 `plugins/cursor/scripts/cursor-cli.mjs`（单文件，不拆 lib，不 import agy-cli.mjs）：`spawn('agent', ['-p', prompt, '--mode', 'ask', '--output-format', 'json'], {stdio:['ignore','pipe','pipe']})`；用 `setTimeout` 包 180000ms 超时，超时先 `SIGTERM` 再等 2 秒 `SIGKILL`；`close` 事件后先判断"exit code === 0 且 stdout 非空"，不满足直接判失败、把 stderr 原样带出；满足才 `JSON.parse`，取 `result`/`session_id`/`usage`；对 `result` 文本做启发式关键字扫描（`blocked|rejected|denied`），命中就在返回值里带一条 warning，不吞掉。
验收：`node plugins/cursor/scripts/cursor-cli.mjs research "一句话解释什么是git rebase"` 能输出一段可读文字。

## 任务3：测试（fake agent 二进制）
建 `tests/fixtures/fake-cursor-bin.mjs` 和 `tests/cursor-cli.test.mjs`，覆盖：①正常成功（有 `result` 字段的 JSON）；②硬失败（exit 1，stdout 空，stderr 纯文本，验证走的是"空stdout"分支不是 JSON.parse 分支）；③假二进制故意 sleep 超过超时时间（比如设一个短测试超时如 500ms），验证我们的 `setTimeout+kill` 真的能在预期时间内终止进程，不会一直挂着；④`result` 文本里含"blocked"关键字时能提取出 warning。不许 `.skip`、不许 mock 被测的 `cursor-cli.mjs` 本身、不许删测试。
验收：`node --test tests/*.test.mjs` pass ≥ 19（基线15 + 新增至少4个），fail=0，skip=0。

## 反向验证
把超时逻辑里的 `kill` 调用注释掉，用测试③的场景跑一次，应该看到进程真的没被杀掉、测试变红或明显超时；贴出这个证据，再恢复 `kill` 调用，跑全绿证据。这一步不做，等于没验证过超时兜底真的有效。

## 规矩
不装新 npm 依赖。同一条验收连败3次换下一项；结果比基线差就回滚如实报告。

## 完成条件
- 硬指标1：`node --test tests/*.test.mjs` 至少19个测试全过、0 fail、0 skip。
- 硬指标2：`git diff 980d9fc -- GOAL.md` 为空，`../codex-plugin-cc/` 零改动，`plugins/agy/**` 零改动。
- 每条都要贴真实命令输出（含反向验证的挂起/杀死证据），只说"做完了"不算数。
- `BLOCKED.md` 随交付提交，没内容也写"无"。
- 止损：跑满 10 轮仍未达标就停，如实汇报卡在哪、还差什么。
