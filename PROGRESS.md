# PROGRESS.md

## 任务0（2026-08-24）基线核对 — `/quota:setup` 就绪诊断
- 基线：`node --test tests/*.test.mjs` → **34 pass / 0 fail / 0 skip** ✓（GOAL.md 基线 commit `1a46427`）
- HEAD 起始：`a2da619`

### 理解（≤10行）
1. **目标**：新建 `plugins/router/`，提供 `/quota:setup`——纯诊断，并发检查 agy/cursor/codebuddy/codex 四引擎，输出 Markdown 就绪表；不可用只标注，**exit 恒 0**。
2. **探测白名单硬编码**：安装一律 `--version`；登录仅 cursor 用 `agent status`（含 `Logged in`）；agy/codebuddy 登录恒 `unknown`；**codebuddy 只许 `--version`**（其余烧 token）。
3. **codex**：纳入 `--version`；`codex login status` 先本机实测再定（结果见任务1）。
4. **判据**：不以 exit code 为唯一依据（ENOENT=未装；有输出再匹配内容）；超时 10s SIGTERM→2s→SIGKILL；`Promise.all` 并发。
5. **不做自动安装**；未装给安装指引文案。不烧 token > 如实报告 > 好看。
6. **白名单改动**：仅 `plugins/router/**`、marketplace 追加一条、`tests/**`、PROGRESS/BLOCKED；不动 agy/cursor/codebuddy/package.json/GOAL。
7. **验收**：真机四引擎表；`claude plugin validate .`；测试 ≥39 pass（含白名单守护）；反向验证证明禁令在拦。

---

## 执行日志

### [x] 任务1：`plugins/router/scripts/setup.mjs`
- 导出 `runSetupCheck({bins, timeoutMs})`；CLI 无参打印 Markdown 表，exit 恒 0。
- 白名单：agy/codebuddy 仅 `--version`；cursor `--version` + `status`；codex `--version` + `login status`。
- **codex 登录实测（2026-08-24）**：`codex login status` → `Logged in using ChatGPT`，exit 0，无副作用 → **采纳探测**（login=`logged-in`/`logged-out`/`unknown`）。
- 拍板写「codex→unknown」与契约表/任务1「实测再定」冲突：按任务1实测结果走，记于此。agy/codebuddy 仍恒 `unknown`。
- 建议偏离：`interpretLogin` 先判 logged-out（`Not logged in` 含 `logged in` 子串会误匹配）；plugin.json/`marketplace` name=`quota`（目录仍 `plugins/router/`）以得到 slash `/quota:setup`。

### [x] 任务2：插件骨架
- `plugins/router/.claude-plugin/plugin.json` v1.0.0（name=`quota`）
- `plugins/router/commands/setup.md`：`allowed-tools: Bash(node:*)`，无 `disable-model-invocation`
- marketplace `plugins` 追加 quota→`./plugins/router`；长度=4
- `claude plugin validate .` → ✔ Validation passed

### [x] 任务3：测试
- `tests/fixtures/fake-engines/{agy,agent,codebuddy,codex,sleep-bin}` +x
- `tests/setup.test.mjs`：5 条（全装 / ENOENT / 超时 / 白名单 argv / cursor logged-out）
- 全量：`node --test tests/*.test.mjs` → **39 pass / 0 fail / 0 skip**

### [x] 反向验证（codebuddy status 分支）
```
WITHOUT allow-status flag: {"code":0,"out":"fake-codebuddy: non-whitelist args received: status"}
WITH allow-status flag: {"code":0,"out":"fake-status-would-burn-tokens"}
REVERSE_OK: status branch works when explicitly enabled
```
恢复后全绿：39 pass / 0 fail / 0 skip

### [x] 硬指标
1. 39 pass / 0 fail / 0 skip
2. `git diff 1a46427 -- GOAL.md plugins/agy plugins/cursor plugins/codebuddy package.json` 为空；marketplace 只追加 quota 一条
3. 真机 `node plugins/router/scripts/setup.mjs`：四引擎全 installed；cursor/codex logged-in；agy/codebuddy unknown；exit 0
4. `BLOCKED.md`：无
