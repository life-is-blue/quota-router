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
1. **删掉 id 校验**：若去掉 resume 后的 `returnedId !== resumeId` 判断，RESUME_NEW_ID（cursor 静默降级形态）会 resolve 成功——G2.2 会红。当前校验是 cursor 静默降级的唯一检测法。
2. **「先输出后保存」顺序的测试局限（评审更正）**：persistResearchResult 内部自吞异常，把保存挪到输出之前时 G1.2 的断言（result 在 stdout、warning 在 stderr、exit 0）**不会**变红——顺序契约由代码评审锁定（Codex ok-verified 三入口顺序正确），不硬造假顺序测试。
3. **评审后补测**：G2.4（QUOTA_RESUME_ID 结构化入口）、G2.5（background+resume 显式拒绝）、G1.6（wx 冲突不覆盖不失败）——均有真实断言，见各测试文件。

### [x] 硬指标自检
1. 测试：**75 pass / 0 fail / 0 skip**（本机已跑）。
2. `git diff 0c53e08 -- GOAL.md plugins/router .claude-plugin/marketplace.json package.json docs` → **空**。
3. 真机 agy research → Saved id → `--resume` 追问：归验收方。

### 建议偏离
- 无。落盘与 resume 均按契约实现；三引擎重复 `saveResult` ~30 行未抽共享层（GOAL 7.1）。

### BLOCKED
- 无（见 BLOCKED.md）。
