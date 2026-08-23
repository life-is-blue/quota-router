# Changelog

## 1.0.0 — 2026-08-24

首个正式版本。四个命令、34 个测试全绿、六轮独立验收。所有 CLI 契约结论均经真实调用实测（详见 [GOAL.md](GOAL.md)）。

### 命令

- `/agy:research <topic>` — agy 只读调研，长任务支持 `--background` + `/agy:status`（Sprint 1–2）
- `/cursor:research <topic>` — Cursor CLI 只读调研，`--mode ask` 模式，自管超时（SIGTERM→2s→SIGKILL）（Sprint 3）
- `/codebuddy:research <topic>` — codebuddy 只读调研，`dontAsk` + 工具白名单双层只读边界（Sprint 4）
- `/cursor:implement <instruction>` — 单文件写能力，`--trust` 最小权限，「部分成功」陷阱带 warning（Sprint A）

### 契约实测记录（对适配器开发者最有价值的部分）

- 三家 CLI headless 契约 11 个维度 9 个不同，失败模式各异：agy 失败给 JSON（`status` 真实变化）、Cursor 失败 exit≠0 + 空 stdout、codebuddy API 失败时 **exit 0**（GOAL.md 第 8 节）
- Cursor 写路径存在「部分成功」陷阱：shell 被权限挡下后会写入猜测值，exit 0 + `is_error:false` + 文件真改，唯一信号是 `result` 自然语言里的拒绝措辞（GOAL.md 第 9 节）
- codebuddy `--bg` 在 2.137.1 功能性损坏（回复不落盘、会话空转，两次复现），后台模式挂起待上游修复（GOAL.md 8.7 节）
- 三份适配器逐字节相同的实质逻辑不足 10 行，**刻意不建共享抽象层**（GOAL.md 7.1 节）

### 工程

- stderr / Raw output 统一 2000 字符截断，关键词扫描仍在完整文本上进行（Sprint C）
- 34 个测试全绿，全部走 fake binary fixture，CI 零 CLI 依赖
- 路由指引（何时用哪个引擎）见 [README.md](README.md)，基于实测耗时画像

### 开发方法

本版本全部六个 Sprint 由被接入的 CLI 依据任务书自建、管理者独立验收（复跑测试、核对保护文件、暗卷抽查）。任务书存档于 `TASKBOOK-sprint*.md`。
