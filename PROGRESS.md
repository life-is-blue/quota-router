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

---

## Skill Router 交付进度

### [x] 任务0：材料通读与理解（2026-09-01）
1. loop 范本先 Parse，再按能力探测选择唯一执行路径，并把无能力作为诚实终点。
2. 三家 CLI 不共享契约：agy 看 `status`，Cursor 看 exit/stdout，codebuddy 必须从 transcript 数组找 `type:"result"`。
3. agy 用原生 `--print-timeout`；Cursor/codebuddy 无原生超时，需由外层 timeout 包裹。
4. 只读边界分别是 trusted workspace、Cursor `--mode ask`、codebuddy `dontAsk` + `Read,Glob,Grep`。
5. resume 后必须校验返回 id 等于请求 id，尤其防 Cursor 无报错地退化成新会话。
6. 写路径必须核实磁盘与拒绝措辞；agy 不直写用户文件，采用“产出内容 + 主会话落盘”。
7. README 路由依据：快问 codebuddy、深查 agy、质量优先 cursor；文件修改需盯 diff/自行验证。

### [x] 任务1：`SKILL.md`
- 已创建 SSOT：`~/.agents/skills/quota-router/SKILL.md`，单文件纯指令文档，无代码、脚本或附属文件。
- 结构：frontmatter → Parse → Capability detection 三档降级 → 三 CLI 契约矩阵 → agy 裸调判定 → Resume → 防坑规则 → 路由表。
- `skill-creator` 的 `quick_validate.py`：`Skill is valid!`；总计 **85 行**（≤500）。

### [x] 任务2：symlink 分发
- `~/.claude/skills/quota-router` → `~/.agents/skills/quota-router`
- `~/.codex/skills/quota-router` → `~/.agents/skills/quota-router`
- `~/.cursor/skills-cursor/quota-router` → `~/.agents/skills/quota-router`
- 三个父目录均存在、三个同名项原先均不存在；未覆盖任何已有文件或链接。

### [x] 反向验证：契约对照清单

逐行核对 `SKILL.md` 契约矩阵与 GOAL，条目 → 出处如下：

1. stdout 形状：agy/Cursor 单对象、codebuddy transcript 数组 → §8.8；codebuddy 按 `type:"result"` 查找而非固定末项 → §8.2。
2. 响应字段：agy `response`、Cursor/codebuddy `result` → §8.8。
3. 会话字段：agy `conversation_id`、Cursor/codebuddy `session_id` → §8.8。
4. usage 命名差异（skill 只说明不可共用解析器，未新增字段行为）→ §8.8、§7.1。
5. 成功判据：agy 看 `status`；Cursor exit 0 + stdout 非空；codebuddy 找到 result 元素 → §8.8；agy resume 另要求 response 非空 → §13。
6. 失败退出码：agy 失败仍可 exit 0；Cursor 非 0；codebuddy API 失败 0、参数失败 1 → §8.3、§8.8。
7. 失败 JSON：agy 给 JSON；Cursor/codebuddy 不给 → §6.3、§8.3、§8.8。
8. 超时：agy 原生 `--print-timeout`；Cursor/codebuddy 外层 timeout → §6.5、§8.6、§8.8。
9. 只读边界：agy trustedWorkspaces；Cursor `--mode ask`；codebuddy `dontAsk` + `Read,Glob,Grep` → §6.7、§8.4、§8.8、§11.1。
10. 拒绝信号：agy stderr；Cursor 英文自然语言；codebuddy 中文自然语言且 `permission_denials` 不可信 → §6.4、§8.5、§8.8。
11. 后台差异：矩阵未宣称裸调后台能力；避免把 codebuddy 已知损坏的 `--bg` 写成可用路径 → §8.7、§8.8。
12. 基本调用：Cursor `agent -p ... --output-format json` → §6.1；codebuddy 完整只读 argv → §8.1、§8.4；agy 的 `-p`/JSON/原生超时组合 → §8.8（TASKBOOK 明定展示形式）。
13. resume flags：agy `--conversation`，Cursor/codebuddy `--resume`；成功 id 稳定 → §6.6、§8.7、§13。
14. agy 坏 id：exit 0 + SUCCESS + 空 response + 新 id + stderr warning → §13；因此校验 response 与返回 id。
15. Cursor 坏 id：exit 0 正常 JSON、静默新会话 → §13；因此返回 `session_id` 必须等于请求 id。
16. codebuddy 坏 id：exit 0 + 空 stdout + `No conversation found` → §13。
17. codebuddy 探测只允许 `--version`，未知参数会跑真会话 → §10。
18. CLI “已验证/已完成”不可信、须核 diff/测试并扫中英文拒绝词 → §6.4、§8.5、§9.3、§9.5。
19. agy 不直写用户文件，trusted workspace 下产出完整内容/diff 后由主会话落盘 → §11、§11.1。
20. Cursor implement 用最小 `--trust`、盯磁盘 diff、主会话复跑命令/测试 → §9.2、§9.3、§9.5。
21. 路由耗时与角色：快问 codebuddy、深查 agy、质量优先 Cursor → README 路由表、§7.2.D；agy apply / Cursor 写路径 → §11 / §9。

核对结论：矩阵 11 个维度及 resume/防坑/写路径扩展均有明确出处；未加入 GOAL 无背书的 CLI flag、输出字段或失败行为。插件档的落盘目录与命令名按 TASKBOOK 明定内容呈现，不作为裸 CLI 行为扩写。

### [x] 完成条件自检
- `SKILL.md` 校验合法，**85 行**；SSOT 下仅该文件。
- 三个 symlink 均解析到 `~/.agents/skills/quota-router`。
- `git status --short` 仅 `M PROGRESS.md`、`M BLOCKED.md`；禁写仓库文件变更清单为空。
- 未安装依赖、未执行 git commit；真机干净会话 agy 调研按 TASKBOOK 留给验收方。
