# PROGRESS.md

## 任务0（2026-08-23）基线核对 — stderr/Raw output 截断收尾
- 基线：`node --test tests/*.test.mjs` → **31 pass / 0 fail / 0 skip** ✓（GOAL.md 基线 commit `dbbbaaa`；`git diff dbbbaaa -- GOAL.md` 为空）
- HEAD 当时：`60fe703`

### 理解（≤10行）
1. **目标**：agy/cursor 把完整 stderr（及三适配器 parse 失败的 Raw output）嵌进 Error/warning，大 stderr 会灌爆主会话；统一嵌出上限 2000，对齐 codebuddy 已有常量。
2. **只截嵌出**：截断发生在 Error.message / warning 出口；soft-deny 等关键词扫描仍在完整 stderr 上（先扫后截）；成败 gate/超时不动。
3. **不许**：建 `lib/`、三适配器共享实现、改判断逻辑、碰 GOAL/marketplace/package.json/TASKBOOK/codex-plugin-cc。
4. **顺序**：任务1 各文件各加常量并改嵌出点 → 任务2 每适配器 1 测（fake ≥5000）→ 反向验证（去掉 slice 应变红）→ 硬指标核对。
5. **最大风险**：先截后扫 soft-deny（agy）或改到 gate；防线：扫用完整 `trimmedStderr`，嵌出才 `slice(0, 2000)`。
6. **建议**：截断处加 `…(truncated)`；采纳，因验收只看长度 <3000，标记不伤指标。

---

## 执行日志

### [x] 任务1：截断 — 自查清单（哪些行改了）
- **`plugins/agy/scripts/agy-cli.mjs`**
  - +`MAX_STDERR_TRUNCATE = 2000` + `truncateForEmbed`
  - close 回调：空 stdout Error、parse 失败 Raw output+stderr、soft-deny warning 嵌出、status≠SUCCESS 时 fallback `stderrForEmbed`
  - soft-deny：`softDenyPattern.test(trimmedStderr)` 仍扫完整串
- **`plugins/cursor/scripts/cursor-cli.mjs`**
  - +同名常量与 helper
  - `runCursorResearch`：timeout / hard-fail / parse-fail 三处嵌出
  - `runCursorImplement`：同上三处嵌出
- **`plugins/codebuddy/scripts/codebuddy-cli.mjs`**
  - stderr 原已 slice；仅补 parse 失败路径 `Raw output` → `slice(0, 2000)+…(truncated)`
- 建议偏离：采纳 `…(truncated)`（见任务0.6）。未建 `lib/`。

### [x] 任务2：测试
- fake：`HUGE_STDERR`（agy/cursor）、`HUGE_BAD_JSON`（codebuddy）；fixture 原已 +x
- 各 1 条：直接调 `run*Research`，断言 `err.message.length < 3000`
- 全量：`node --test tests/*.test.mjs` → **34 pass / 0 fail / 0 skip**

### [x] 反向验证（agy：`MAX_STDERR_TRUNCATE = Infinity`）
- 变红片段：
```
✖ 9. HUGE_STDERR: ≥5000-char stderr is truncated in Error.message (<3000)
  AssertionError [ERR_ASSERTION]: Error.message length 5055 must be < 3000
AGY_REV_EXIT=1
```
- 恢复后全绿片段：
```
ℹ tests 34
ℹ pass 34
ℹ fail 0
ℹ skipped 0
FULL_EXIT:0
```

### [x] 硬指标
1. 34 pass / 0 fail / 0 skip
2. `git diff dbbbaaa -- GOAL.md marketplace.json package.json` 为空；`../codex-plugin-cc/` 无改动
3. `BLOCKED.md`：无
