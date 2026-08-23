# PROGRESS.md

## 任务0（2026-08-23）基线核对
- 基线：`node --test tests/*.test.mjs` → **15 pass / 0 fail / 0 skip** ✓
- `agent` → `/data/home/bluejqhuang/.local/bin/agent`，版本 `2026.08.11-e8db854`
- `git diff 980d9fc -- GOAL.md` 为空 ✓

### 理解的目标 / 顺序 / 最大风险（≤10行）
1. **目标**：接入 Cursor CLI（`agent`），做只读调研 `/cursor:research`，与 `/agy:research` 平级，不照抄 agy。
2. **顺序**：骨架(plugin.json/research.md/marketplace) → cursor-cli.mjs（自管超时+kill）→ fake-bin 测试 → 反向验证 kill。
3. **成败判定**：exit===0 且 stdout 非空才 JSON.parse；失败无 JSON（stderr 纯文本）。
4. **超时**：无原生 `--timeout`，必须 `setTimeout` + SIGTERM → 2s → SIGKILL。
5. **字段**：`result`/`session_id`/`usage`（驼峰）；`is_error` 不可用来判成败。
6. **软拒绝**：对 `result` 启发式匹配 blocked|rejected|denied，带 warning。
7. **白名单**：只改 `plugins/cursor/**`、marketplace 追加一条、`tests/**`、PROGRESS/BLOCKED；不动 agy/package.json/GOAL.md/codex-plugin-cc。
8. **最大风险**：超时兜底若 kill 无效，卡住进程会拖死；打架时优先保证 kill 真能杀。

---

## 执行日志
- [x] **任务1：骨架** — `plugins/cursor/.claude-plugin/plugin.json`、`commands/research.md`；marketplace `plugins` 长度=2；JSON.parse 通过。
- [x] **任务2：cursor-cli.mjs** — spawn agent ask+json；setTimeout 180000 + SIGTERM/SIGKILL；exit0∧stdout非空才 parse；result 关键字 warning。真机验收：`node plugins/cursor/scripts/cursor-cli.mjs research "一句话解释什么是git rebase"` 输出可读中文解释。
- [x] **任务3：测试** — fake-cursor-bin + 4 用例；全量 **19 pass / 0 fail / 0 skip**。
- [x] **反向验证 kill** — 注释 kill 后 `timeout 8` 跑 SLEEP 用例 → exit 124、cancelled（进程未杀挂起）；恢复 kill 后 19/0/0 全绿。
- 建议偏离：无。首次假 bin 缺 +x 导致 EACCES，chmod +x 后通过（记：新建 fixture 需可执行）。
