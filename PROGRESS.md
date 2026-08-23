# PROGRESS.md

## 任务0（2026-08-24）基线核对
- 基线：`node --test tests/*.test.mjs` → **19 pass / 0 fail / 0 skip** ✓
- `codebuddy` → `/data/home/bluejqhuang/.local/bin/codebuddy`，版本 `2.137.1`
- `git diff f807db1 -- GOAL.md` 为空 ✓

### 理解的目标 / 顺序 / 最大风险（≤10行）
1. **目标**：接入 codebuddy CLI，做只读调研 `/codebuddy:research`，与 `/agy:research`、`/cursor:research` 平级；codebuddy 是 Claude Code fork，JSON 形状与退出码语义全不同，不能照抄 cursor。
2. **顺序**：骨架(plugin.json/research.md/marketplace) → codebuddy-cli.mjs → fake-bin 测试(5 用例) → 反向验证(超时 kill + 契约2判法) → 全量验收。
3. **成败判定(契约2)**：stdout 是 JSON 数组，先 parse → `Array.isArray()` 校验 → `find(x=>x.type==='result')`，三步任一失败即判失败；**不看 exit code、不看 is_error**（模型名不存在时 exit 0 + 空 stdout）。
4. **超时**：无原生 `--timeout`，`setTimeout` 180000ms + SIGTERM → 2s → SIGKILL，**kill 必须真能杀**（失败判断准确 > 超时真杀 > 代码好看）。
5. **只读边界**：`--permission-mode dontAsk` + `--tools Read,Glob,Grep` 两层；**不许用 plan 模式**（会往 `~/.codebuddy/plans/` 落盘）、**不许传 -y/--dangerously-skip-permissions**。
6. **拒绝信号**：`permission_denials`/`is_error` 是空壳，拒绝原因在 `result` 中文自然语言里（"被拒绝"/"禁止"/"无法完成"），中英文关键词都要扫。
7. **字段**：`result`/`session_id`/`usage`（下划线）；不写死 `j[j.length-1]`，按 type 找 result。
8. **白名单**：只改 `plugins/codebuddy/**`、marketplace 追加一条、`tests/**`、PROGRESS/BLOCKED；不动 agy/cursor/package.json/GOAL.md/codex-plugin-cc，不建 lib/。
9. **最大风险**：照抄 cursor 判法会把"exit0+空stdout"的 API 失败误判成成功——本 Sprint 核心是契约2判法 + 测试2兜住。

---

## 执行日志
- [x] **任务1：骨架** — `plugins/codebuddy/.claude-plugin/plugin.json`、`commands/research.md`（格式照 cursor）；marketplace `plugins` 长度=3（agy,cursor,codebuddy）；两 json JSON.parse 通过；diff vs f807db1 只增 codebuddy 一条，agy/cursor 两行无改动。
- [x] **任务2：codebuddy-cli.mjs** — spawn `-p --permission-mode dontAsk --tools Read,Glob,Grep --output-format json`；setTimeout 180000 + SIGTERM→2s→SIGKILL；契约2判成败（parse→Array.isArray→find type:"result"，三步任一失败即失败，不看 exit code/is_error）；中英文拒绝关键词扫描（被拒绝/禁止/无法完成/blocked|rejected|denied）；ENOENT 报"没装/不在 PATH"。真机验收：`node plugins/codebuddy/scripts/codebuddy-cli.mjs research "一句话解释什么是 git rebase"` → 输出可读中文，exit 0。
- [x] **任务3：测试** — fake-codebuddy-bin.mjs（已 chmod +x）+ 6 用例（把"对象非数组"和"数组无 result"拆成两条，pass 数从 24 提到 25）；全量 **25 pass / 0 fail / 0 skip**。
- [x] **反向验证1（kill）** — 注释超时里的 kill，`timeout 8 node --test --test-name-pattern='SLEEP'` → OUTER_TIMEOUT_EXIT=124、duration 7970ms、测试 cancelled（进程未杀挂起）；恢复 kill 后全绿。
- [x] **反向验证2（契约2）** — 把成败判断临时改成 cursor 式"exit 0 即成功"，跑 EXIT0_EMPTY_STDOUT 用例 → CLI 误判成功、exit 0（actual: 0），断言 notStrictEqual(0) 变红；改回契约2判法全绿。**注：按字面"exit 0 且 stdout 非空"实现时空 stdout 会被 cursor 的 gate 拦下不会变红；能让测试2变红的 cursor 判法是"exit 0 即成功"（对 cursor 而言 exit 0 + JSON envelope 就是成功，移植到 codebuddy 就误判）——这正是 GOAL.md 8.3 警告的照抄陷阱。**
- 建议偏离：无。新建 fixture 记得 chmod +x（Sprint 3 的 EACCES 教训）。
