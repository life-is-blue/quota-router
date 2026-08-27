你是执行者，这份文档是你唯一的任务来源；中途没人可问，拿不准的写进 BLOCKED.md，跳过继续做别的，最后随交付提交。断线换新会话先读 PROGRESS.md 接着做，别重做；每做完一项立刻更新。这活为什么干：v1.1.0 后首轮真实使用撞到两个疼点——调研结果只活在会话里（关掉即失，重跑再花 2 分钟+token）、连续追问重复喂上下文（实测多花 3 万 input token）。本任务补两个能力：G1 结果落盘、G2 会话延续。方案与全部契约在 docs/USAGE-GAPS-PLAN.md（v2）+ GOAL.md 第 13 节，先读完再动手。打架时让步顺序：落盘失败绝不推翻已成功的调研 > resume 静默降级必须被识破 > 代码好看。"不许"违反算失败；"建议"有更好的路就走，在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- G1+G2 合并一个 Sprint，验收后发 1.2.0。
- G3（契约 skill）不做（痛点是预测不是事件，降 backlog 了）。
- 只读安全参数在 resume 时**必须原样重带**，不继承自旧会话（G2 核心安全设计）。

## 界限
- 白名单（只能改/建）：`plugins/agy/**`、`plugins/cursor/**`、`plugins/codebuddy/**`、`tests/**`、`PROGRESS.md`、`BLOCKED.md`。
- 不许碰 `plugins/router/**`、`.claude-plugin/marketplace.json`、`package.json`、`GOAL.md`（基线 `0c53e08`，交付时 `git diff 0c53e08 -- GOAL.md` 为空）、本文件、`docs/**`、`../codex-plugin-cc/`。
- 测试约束：现有 51 个断言不删不弱化不 skip；扩展 fixture 允许。
- **不许让落盘失败把成功的调研判成失败**（G1 灵魂）。

## 必读契约
- **G1**（方案 v2）：目录 `~/.claude/quota-router/results/`（`0700`，`QUOTA_ROUTER_RESULTS_DIR` 可覆盖=测试注入点，`QUOTA_ROUTER_NO_SAVE=1` 禁用）；文件名 `<UTC紧凑时间戳>-<uuid8>.md`，独占创建（`wx`），EEXIST 不重试直接走保存失败分支；文件 `0600`；**先输出 result 再保存**，成功尾部打 `Saved: <path>`，失败 stderr warning + exit 0；内容格式：frontmatter（engine/timestamp/session_id/prompt）+ 四反引号围栏包 result（防三反引号碰撞）；只存成功结果。
- **G2**（GOAL.md 第 13 节）：统一语法 `--resume <id>`（`--resume=ID` 也认），`--` 后全当 prompt；**resume 后必须校验返回 id == 请求 id**（cursor 静默降级唯一检测法；agy 假成功=空 response+新 id+stderr "not found"，同样用 id 校验抓）；codebuddy 空 stdout 走现有判法但 stderr 加识别 "No conversation found"；安全 flags（cursor `--mode ask`、codebuddy `dontAsk`+`--tools`、agy 无需额外）每次 resume 调用原样重带；id 由 spawn 的独立 argv 传递。

## 任务0
静态数现有 `it(` 总数 = 51 记进 PROGRESS。你的沙箱跑不了本仓库测试（fake bin 与沙箱不兼容，历史实测），自检限于 `node --check` + 直接调 fixture（`FAKE_*_SCENARIO=... node tests/fixtures/fake-*.mjs`）+ 新写代码的纯函数单测（若可脱离 spawn 跑）。最终测试归验收方。

## 任务1：G1 落盘（三个引擎的 research 同步路径）
- 新文件 `plugins/<engine>/scripts/result-store.mjs`？**不**——不许建共享层（GOAL.md 7.1）。三个引擎**各自**实现一个 `saveResult(result)` 内部函数（重复 ~30 行是实测结论换来的纪律）。
- 每个 `*-cli.mjs` 的 research 成功路径（同步模式）加 best-effort 保存；后台模式不动。
- CLI 入口解析 `QUOTA_ROUTER_RESULTS_DIR`/`QUOTA_ROUTER_NO_SAVE`（一次），库函数收目录参数。
验收：`node --check` 三文件过；`QUOTA_ROUTER_RESULTS_DIR=/tmp/x node plugins/agy/scripts/agy-cli.mjs research ...`（真机由验收方跑）。

## 任务2：G2 resume（三个引擎的 research）
- 每个 `*-cli.mjs`：`runXResearch(prompt, {resumeId})`——有 resumeId 时 args 加原生 flag（agy `--conversation <id>`、cursor/codebuddy `--resume <id>`）+ **全部只读安全参数照常拼上**。
- 成功后校验返回 id：agy `conversation_id`、cursor `session_id`、codebuddy result 元素 `session_id`。不等 → reject，错误信息含「上下文未延续（resume 失败）：引擎返回了新会话 <新id>，这可能是一次全新回答」。
- CLI 入口解析 `--resume <id>`/`--resume=<id>`，`--` 终止选项解析。usage 文本更新。
验收：`node --check` 过 + 三家的 flag 拼装静态自查（把 agy/cursor/codebuddy 各 resume 一次的完整 argv 写进 PROGRESS 供验收方比对）。

## 任务3：命令文档
三个 `commands/research.md` 的 `argument-hint` 改 `[--resume <id>] <topic>`，正文补一段：连续追问时先看上次输出尾部或 `Saved:` 行拿 id，用 `--resume` 续接；说明只应续接同一工作区自己创建的会话。

## 任务4：测试（验收方最终跑，你写好）
每引擎新增用例（fixture 加场景）：
1. G1 成功落盘：注入 tmpdir → 文件存在、frontmatter 齐、0600、四反引号围栏、`Saved:` 行在 stdout。
2. G1 保存失败（注入不存在/只读目录）→ result 照常输出 + stderr warning + exit 0。**最重要的一条。**
3. G1 禁用开关 `QUOTA_ROUTER_NO_SAVE=1` → 不写任何文件。
4. G1 围栏碰撞：result 含 ``` 代码块 → 文件仍可完整还原。
5. G2 argv 断言：resumeId 存在时 argv 同时含原生 resume flag 和该引擎全部只读安全 flags。
6. G2 id 校验：fake 吐**新** id → reject 且错误含「上下文未延续」。
7. G2 参数解析：`--resume=abc 好` 和 `--resume abc -- 带空格 的prompt` 都正确解析；prompt 里字面量 `--resume` 不被误解析。
8. codebuddy resume 失败（空 stdout + "No conversation found"）→ 走现有失败判法。
不许 skip/mock 被测函数。目标 ≥ 51+24=75 上下（三引擎×8 条上下浮动，最终数字验收方跑）。

## 反向验证（推演写进 PROGRESS，真跑归验收方）
①把「先输出后保存」倒过来（先保存）+ 注入只读目录，推演测试 2 会红——证明顺序契约在防真实失败模式。②把 id 校验删掉 + fake 吐新 id，推演测试 6 会红——证明 cursor 静默降级防线真的存在。

## 完成条件
- 硬指标1（验收方跑）：全量测试全过、0 fail、0 skip，且 ≥ 75。
- 硬指标2：`git diff 0c53e08 -- GOAL.md plugins/router .claude-plugin/marketplace.json package.json docs` 为空。
- 硬指标3（验收方跑）：真机 agy research → 拿 Saved 的 id → `--resume` 追问上一轮内容，回答正确引用上文；结果文件含完整对话感内容。
- 你交付：代码+测试+文档+PROGRESS/BLOCKED+每项自检证据。不 git commit。
- 不装新依赖；同条自检连败 3 次换下一项；10 轮未达标停，如实汇报。
