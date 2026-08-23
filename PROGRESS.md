# PROGRESS.md

## 任务0（2026-08-23）基线核对 — cursor `/cursor:implement` 写能力
- 基线：`node --test tests/*.test.mjs` → **25 pass / 0 fail / 0 skip** ✓（HEAD `0e80735`，契约基线 commit `9f8a427`）
- `git diff 9f8a427 -- GOAL.md` 为空 ✓
- `agent` → `/data/home/bluejqhuang/.local/bin/agent`，版本 `2026.08.11-e8db854`

### 理解的目标 / 顺序 / 最大风险（≤10行）
1. **目标**：给 cursor 插件加写文件能力 `/cursor:implement`，与 `/cursor:research` 平级；写路径与只读是两套契约（GOAL.md §9）。
2. **顺序**：implement.md 文档 → `runCursorImplement`（去 `--mode ask`、加 `--trust`）→ fake-bin 测试(6 用例) → 反向验证(关键词扫描 + 无 `--force`) → 隔离 fixture 真机验收。
3. **失败信号干净**：无 `--trust` → exit 1 + 空 stdout + stderr 纯文本；沿用 `exit===0 && stdout非空` 再 JSON.parse。
4. **部分成功陷阱（核心）**：shell 被 `--trust` 挡下时，文件真改、exit 0、`is_error:false`，唯一破绽在 `result` 自然语言（"被拒绝"/"未能实际执行"等）；扫中英文关键词加 warning，**不判失败**。
5. **权限最小开**：只传 `--trust`，不传 `--force`/`--yolo`/`-y`（少开"自动批准跑命令"那道门）。
6. **默认超时**：implement 300000ms；SIGTERM→2s→SIGKILL 沿用 research 模式。
7. **envelope**：与只读同构（无改动清单）；真改了哪些文件只能靠磁盘核实（md5）。
8. **白名单**：只改 `plugins/cursor/**`、`tests/**`、PROGRESS/BLOCKED；不动 marketplace/agy/codebuddy/package.json/GOAL.md。
9. **最大风险**：把"部分成功"当完全成功上报——文件里可能是猜的答案；防线靠 warning + 文档明示"验证话不可信"。

---

## 执行日志
- [x] **任务1：命令文档** — `plugins/cursor/commands/implement.md`：frontmatter 照 research.md；写明①默认只传 `--trust` 不自动批准跑命令；②"我已验证/测试通过"不可信，最终以用户自测为准。
- [x] **任务2：核心脚本** — `runCursorImplement`：args=`-p` + `--trust` + `--output-format json`（无 `--mode ask`、无 `--force`）；默认超时 300000ms；`IMPLEMENT_PARTIAL_PATTERN` 中英文关键词扫描 → `warnings`（不判失败）；CLI `implement` 子命令 warning→stderr、exit 0。
- [x] **任务3：测试** — `fake-cursor-implement-bin.mjs`（chmod +x）+ 6 用例；全量 **31 pass / 0 fail / 0 skip**。
- [x] **反向验证1（关键词扫描）** — 注释掉 `IMPLEMENT_PARTIAL_PATTERN` 扫描块，跑 PARTIAL_SUCCESS → fail：`warnings must be non-empty for partial success trap`；恢复后 31 全绿。
- [x] **反向验证2（权限门）** — args 临时加 `--force`，跑 ARGS → fail：`argv must not include --force: [...,"--trust","--force",...]`；去掉后 31 全绿。
- [x] **真机验收（隔离 fixture）** — `/tmp/cursor-implement-accept-QmsOYy/math.js`：
  - before md5 `602b4ba8c58618e9d5c8e719053df643` → `add(a, b)`
  - after  md5 `97578eb32141ae0c9f7337962ec2d855` → `add(a, b, c = 0)`；LIVE_EXIT=0；fixture 已删。
- 建议偏离：无。`BLOCKED.md`：无。
