# Changelog

## 1.2.0 — 2026-08-27

首个由**真实使用反馈**驱动的版本：v1.1.0 后首轮 dogfood（调研 agy-cli-docs-mirror 架构）撞到的两个疼点——调研结果只活在会话里、连续追问重复喂上下文（实测多花 3 万 input token）。80 个测试全绿。

### 新能力

- **结果落盘**（G1）：三个 research 命令成功后自动把结果存到 `~/.claude/quota-router/results/`（目录 0700/文件 0600、四反引号围栏防代码块碰撞、独占创建不覆盖）。**保存是 best-effort：落盘失败绝不推翻已成功的调研**（result 先输出、失败仅 stderr warning、exit 0）。`QUOTA_ROUTER_RESULTS_DIR` 覆盖路径、`QUOTA_ROUTER_NO_SAVE=1` 禁用。
- **会话延续**（G2）：`--resume <id>` 续接上一轮调研，三引擎统一语法。**核心防线：resume 后校验返回 id == 请求 id**——cursor 的 resume 失败是静默降级成全新会话（无任何错误信号，GOAL.md 13 节实测），id 校验是唯一检测法。只读安全参数每次 resume 原样重带、绝不继承自旧会话。
- **结构化续接入口**：斜杠命令的 `$ARGUMENTS` 是整串传参，内联 `--resume` 会被吞进 prompt（Codex 评审抓到的 blocker）——命令模板提供 `QUOTA_RESUME_ID` 环境变量通道。

### 修复与加固

- Sprint E 经 Codex 对抗评审修复：命令入口 resume 失效 blocker、agy `--background + --resume` 静默丢 id 改显式拒绝、wx 冲突测试、PROGRESS 反向验证声明更正

### 契约实测记录

- **三 CLI resume 失败形态三家三样**（GOAL.md 13 节）：agy 假成功（exit 0 + 空 response + 新 id）、cursor **静默降级**（正常 JSON 报 success，实为全新会话——最险）、codebuddy 干净失败（空 stdout + stderr 明示）
- **agy 无法担任执行者**（角色路由数据点）：headless 默认权限连建文件都被 auto-denied，`--dangerously-skip-permissions` 也绕不过写工具锁死在 brain 目录（11 节）——能力面 = 只读调研 + apply 起草

## 1.1.0 — 2026-08-24

新增更安全的执行路径与就绪诊断。51 个测试全绿。

### 新命令

- `/agy:implement <instruction>` — **apply 模式执行**：agy 只读生成修改内容（`===FILE:===` 块尽力提取），从不直接写文件，落盘在 Claude 主会话侧经用户确认——天然免疫「部分成功」陷阱（CLI 写不了文件就无所谓假成功）。四分支契约基于 GOAL.md 第 11/11.1 节实测；工作目录需在 agy trustedWorkspaces（CANCELED 报错自带两条可操作指引）。(Sprint D)
- `/quota:setup` — 四引擎（agy/cursor/codebuddy/codex）就绪表：安装/版本/登录一表看清。诊断不是闸门（exit 恒 0）；探测命令白名单硬编码，codebuddy 只允许 `--version`（其余带参调用会跑真 LLM 会话）；登录态宁报 unknown 不烧 token 探测。(批次 2)

### 修复与加固

- `/agy:implement` 经 Codex 对抗评审修复：SUCCESS 空 response 判定收紧、分隔符碰撞检测（内容含 `===END===` 时标 contentSuspect 并警告）、CANCELED 指引改为任选其一、stderr 完整带出
- 批次 1 经 Codex 评审修复：CI 触发分支与本地分支不一致的 blocker（master→main）、Actions 改 commit-SHA 锁定、CHANGELOG fixture 覆盖措辞修正

### 工程

- CI（GitHub Actions，node 24，零 CLI 依赖——测试全部走 fake binary fixture，干净环境实测）
- 版本 1.1.0 全量同步（本仓库采用 lockstep versioning）
- 首次推送 GitHub：https://github.com/life-is-blue/quota-router

### 契约实测记录（对适配器开发者最有价值的部分）

- **agy headless 写不了用户文件**（11 节）：默认权限连读都被 auto-denied（CANCELED）；`--dangerously-skip-permissions` 下写工具也被锁死在 agy 自己的 brain 目录（ERROR 但 response 带完整产物）。apply 模式可行 = trusted workspace + 默认权限 + 只输出 prompt
- 三家 CLI headless 契约 11 个维度 9 个不同（第 8 节）；Cursor 写路径「部分成功」陷阱（第 9 节）；codebuddy `--bg` 上游损坏（8.7 节）
- 三份适配器逐字节相同的实质逻辑不足 10 行，**刻意不建共享抽象层**（7.1 节）

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
- 34 个测试全绿；CLI 测试使用 fake binary fixture，测试套件不依赖真实 CLI（CI 零 CLI 依赖）
- 路由指引（何时用哪个引擎）见 [README.md](README.md)，基于实测耗时画像

### 开发方法

本版本全部六个 Sprint 由被接入的 CLI 依据任务书自建、管理者独立验收（复跑测试、核对保护文件、暗卷抽查）。任务书存档于 `TASKBOOK-sprint*.md`。
