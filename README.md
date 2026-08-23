# quota-router

让 Opus 5 作为主控、把任务分流给本地已安装 CLI 的 Claude Code 插件集，省 Opus 调用额度。

**设计文档在 [GOAL.md](GOAL.md)** —— 四轮 CLI 契约实测（agy / Cursor / codebuddy 的 headless 模式各不相同，照抄任何一家都会错）、全部已验证的坑、以及"为什么不做共享抽象层"的实测结论都在那里。接手实现或排查问题先读它。

## 安装

```bash
claude plugin marketplace add <本仓库路径>
claude plugin install quota-router@agy quota-router@cursor quota-router@codebuddy
```

前提：本机已安装并登录对应 CLI（`agy`、`agent`（Cursor CLI）、`codebuddy`）。缺哪个对应命令就不可用，报错信息会直说。

## 命令与路由指引

所有命令都需手动调用（`disable-model-invocation: true`），不经模型自动触发。

| 命令 | 引擎 | 用途 | 实测参考耗时 |
|---|---|---|---|
| `/codebuddy:research <topic>` | codebuddy | **快速问答/概念查询** | **2–4s** |
| `/agy:research <topic>` | agy | **深度调研**，长任务可加 `--background` | ~110–130s |
| `/agy:research --background <topic>` + `/agy:status [id]` | agy | 后台跑长调研，不阻塞会话 | 立即返回 job id |
| `/cursor:research <topic>` | Cursor | **高质量调研**（但最慢） | ~235–320s |
| `/cursor:implement <instruction>` | Cursor | **单文件小改动**（唯一写能力） | ~235s |

怎么选（基于实测，不是拍脑袋）：

- **一句话能答的问题 → codebuddy**。默认模型（deepseek-v4-flash 级）快而轻，2-4 秒返回；但别指望它做深度分析。
- **要读代码库、要成体系的调研 → agy**。速度中等、输出量大（实测单次 16k–33k tokens），失败信号最干净（JSON 里 `status` 字段真实变化），长任务唯一有后台模式。
- **质量优先、不在乎等 → cursor**。本仓库所有 Sprint 的代码都是它自建的，能力最强；代价是单次 4–5 分钟。
- **要改文件 → 只有 `/cursor:implement`**，且仅限单文件小改动。**⚠️ 输出里任何"我已验证/测试通过"都不可信**——它可能在 shell 被权限挡下后把猜的结果写进文件（GOAL.md 9.5 节实测），warning 会提示这种情况，最终以你自己跑测试为准。

## 已知限制

- **codebuddy 无后台模式**：它自带的 `--bg` 在 2.137.1 上功能性损坏（GOAL.md 8.7 节），上游修复前只有同步模式。
- **`/cursor:implement` 不跑命令**：默认只传 `--trust`（目录信任），不自动批准 shell——这是故意的最小权限设计。任务里要求跑测试时会得到"部分成功"+warning。
- 三个适配器**刻意不做共享抽象**：实测三家契约 11 个维度里 9 个不同，可共用代码不到 10 行（GOAL.md 7.1 节）。

## 开发

```bash
node --test tests/*.test.mjs   # 34 个测试，全绿是唯一可接受状态
```

给新 CLI 加适配器的流程（不许跳步）：先做一轮 headless 契约调研（真实调用 + 官方文档交叉验证，结论写进 GOAL.md）→ 写任务书 → 自建 → 验收方独立复跑测试并核对保护文件。历史任务书在 `TASKBOOK-sprint*.md`，进度在 `PROGRESS.md`。
