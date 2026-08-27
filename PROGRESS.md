# PROGRESS.md

## 本 Sprint：G1 结果落盘 + G2 会话延续（目标发版 1.2.0）

基线：GOAL.md `0c53e08`。不碰 `plugins/router`、marketplace、package.json、GOAL.md、docs。

### [x] 任务0：静态数 `it(`
- `rg -o '\bit\(' tests --glob '*.mjs' | wc -l` → **51**（动手前基线）。
- 交付时 → **75**（51 + 24）。

### 理解
1. G1：三引擎各自 `saveResult`（不共享层）；同步 research 成功后先 stdout 再落盘；失败 warning + exit 0。
2. 目录默认 `~/.claude/quota-router/results/`（0700），`QUOTA_ROUTER_RESULTS_DIR` / `QUOTA_ROUTER_NO_SAVE=1`；`wx`+0600；四反引号围栏。
3. G2：CLI `--resume`/`--resume=`，`--` 后全是 prompt；agy→`--conversation`，cursor/codebuddy→`--resume`；安全 flags 每次重带。
4. resume 后校验返回 id；不等则 reject「上下文未延续…」。
5. 后台 research 不落盘；implement 不动。

---

## 执行日志

### [x] 任务1：G1 落盘
- 三文件各自实现 `saveResult` / `persistResearchResult`（无共享模块）。
- 同步 research 成功路径：先 `console.log(result)`，再 best-effort 保存；`Saved: <path>` 或 stderr warning。
- CLI 入口一次解析 `QUOTA_ROUTER_RESULTS_DIR` / `QUOTA_ROUTER_NO_SAVE`。
- 自检：`node --check` 三 CLI → OK。

### [x] 任务2：G2 resume
- `runXResearch(prompt, { resumeId })` 拼原生 flag + 全部只读安全参数。
- 成功后 id 校验（agy `conversation_id` / cursor&codebuddy `session_id`）。
- codebuddy stderr 识别 `No conversation found`。
- CLI 解析 `--resume` / `--resume=` / `--`；usage 已更新。
- **完整 resume argv（验收比对）**：
  - agy: `["-p","follow up","--output-format","json","--print-timeout","3m","--conversation","conv-abc"]`
  - cursor: `["-p","follow up","--mode","ask","--output-format","json","--resume","sess-abc"]`
  - codebuddy: `["-p","follow up","--permission-mode","dontAsk","--tools","Read,Glob,Grep","--output-format","json","--resume","sess-abc"]`

### [x] 任务3：命令文档
- 三家 `commands/research.md`：`argument-hint: '[--resume <id>] <topic>'`；正文说明从 Saved/结果文件取 id、`--resume` 续接、只续接本工作区自己创建的会话。

### [x] 任务4：测试
- fixture 新增：`CODE_FENCE` / `RESUME_ECHO_ID` / `RESUME_NEW_ID`；（codebuddy）`NO_CONVERSATION`；cursor/codebuddy 支持 `FAKE_*_ARGV_FILE`。
- 每引擎 8 条（codebuddy 第 8 条为 No conversation found；agy/cursor 第 8 条为 unicode frontmatter）。
- 现有 `runCli` 默认 `QUOTA_ROUTER_NO_SAVE=1`，避免旧用例写家目录（不弱化断言）。
- 自检：`node --test tests/*.test.mjs` → **75 pass / 0 fail / 0 skip**。

### [x] 反向验证（推演；真跑归验收方）
1. **先保存后输出**：若把 `persistResearchResult` 挪到 `console.log(result)` 之前，且 RESULTS_DIR 注入为普通文件（不可 mkdir），则保存抛错会在输出之前打断主路径——G1.2「result 照常出现在 stdout + exit 0」会红。当前「先输出后保存」保证调研成功不被落盘失败吞掉。
2. **删掉 id 校验**：若去掉 resume 后的 `returnedId !== resumeId` 判断，RESUME_NEW_ID（cursor 静默降级形态）会 resolve 成功——G2.2 会红。当前校验是 cursor 静默降级的唯一检测法。

### [x] 硬指标自检
1. 测试：**75 pass / 0 fail / 0 skip**（本机已跑）。
2. `git diff 0c53e08 -- GOAL.md plugins/router .claude-plugin/marketplace.json package.json docs` → **空**。
3. 真机 agy research → Saved id → `--resume` 追问：归验收方。

### 建议偏离
- 无。落盘与 resume 均按契约实现；三引擎重复 `saveResult` ~30 行未抽共享层（GOAL 7.1）。

### BLOCKED
- 无（见 BLOCKED.md）。
