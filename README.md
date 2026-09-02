# quota-router

让 Claude Code（Opus）当大脑做决策，把调研、编码这些执行类任务自动分流给你本地已装的其他 CLI —— **贵的模型只做判断，便宜的额度干活**。

> Claude Code 当大脑，agy / Cursor / codebuddy 当手脚。一条命令，不切终端，不烧 Opus 额度。

**这个项目诞生的那个下午**：我开发一个很小的工具，Opus 15 分钟就把当日额度打满，一下午没法干别的——而我的 agy / Cursor / codebuddy 订阅额度几乎没动过。就是那个下午的 frustration 变成了这个仓库。如果你也有过「贵模型被便宜问题吃掉额度」的经历，这就是为你做的。

```
你说     /agy:research "Rust async trait 最佳实践"
不再需要  切终端 → 登录 agy → 粘贴 → 等待 → 复制结果 → 切回来
```

**为什么值得看这个仓库**：它不只是六个能用的命令，更是一套**被完整实测验证过的工作方法**——四个 CLI 的 headless 契约全部真实调用实测（同名 flag 三家三种语义；失败形态四样，其中两样是「exit 0 的假成功」）；六个 Sprint 全部由被接入的 CLI 自己照任务书建造、管理者独立验收 + 对抗评审。想给项目加新引擎的人，照着 [GOAL.md](GOAL.md) 走就不会踩我们已经踩过的坑。

## 安装

```bash
claude plugin marketplace add life-is-blue/quota-router
claude plugin install agy@quota-router
claude plugin install cursor@quota-router
claude plugin install codebuddy@quota-router
claude plugin install quota@quota-router
```

前提：本机已安装并登录对应 CLI（`agy`、`agent`（Cursor CLI）、`codebuddy`）。缺哪个对应命令就不可用，报错信息会直说。审查场景继续用官方 [codex-plugin-cc](https://github.com/openai/codex-plugin-cc)——我们是它的补充而非替代。

装完先跑 `/quota:setup`，一张表看清四个引擎（含 codex）装没装、登没登录。

## 命令与路由

所有路由命令手动触发（`disable-model-invocation: true`），不经模型自动决策——**隐式调用外部 CLI 烧别人的额度，必须用户点头**。例外是 `/quota:setup`：纯诊断、零副作用（探测命令白名单硬编码，绝不对 codebuddy 传 `--version` 之外的参数——实测任何带参调用都会跑真 LLM 会话），允许模型按需调用。

| 命令 | 引擎 | 什么时候用 | 实测耗时 |
|---|---|---|---|
| `/quota:setup` | - | 装完第一步：四引擎就绪表（安装/版本/登录） | ~2s |

| 命令 | 引擎 | 什么时候用 | 实测耗时 |
|---|---|---|---|
| `/codebuddy:research <topic>` | codebuddy | 快问快答、概念查询 | **2–4s** |
| `/agy:research <topic>` | agy | 深度调研、读代码库 | ~110–130s |
| `/agy:research --background` + `/agy:status` | agy | 长调研不阻塞会话 | 立即返回 job id |
| `/cursor:research <topic>` | Cursor | 质量优先的调研 | ~235–320s |
| `/agy:implement <instruction>` | agy | **改文件（最安全）**：agy 只出内容、你确认后落盘 | ~2 分钟 |
| `/cursor:implement <instruction>` | Cursor | 改文件（直接写，快） | ~235s |

**路由口诀**（完整决策依据见 [GOAL.md](GOAL.md)）：快问 codebuddy、深查 agy、精修 cursor、改文件首选 agy（确认后落盘）或 cursor（直接写）。**⚠️ 两个 implement 的输出里任何"我已验证"都不可信**——CLI 可能在权限被挡后把猜的结果写进文件（实测过，warning 会提示），最终以你自己跑测试为准。

## 这个项目验证过什么（开源贡献者请从这里读起）

[GOAL.md](GOAL.md) 是全项目的单一事实源，所有结论都标了"实测"或"官方文档"。最有价值的不是功能，是这些**可以复用的判断**：

**1. 三个 CLI 的 headless 契约，11 个维度 9 个不同。** 同名 flag 不同语义（`--output-format json` 三家吐三种形状）；失败模式三家三样（agy 失败也给 JSON、Cursor 失败给空 stdout、codebuddy API 失败时 **exit 0**）。任何"统一引擎抽象层"在这样的地基上都是过度设计——我们量过，三份适配器逐字节相同的部分不到 10 行，其余是语法噪音。**照抄任何一家的解析代码都是错的**，每家的契约差异都单独实测过并记录在案。

**2. 文档可以是错的，实测才是裁判。** 官方文档说 codebuddy 失败会给 JSON——实测不会；说 `--bg` 可用——实测功能性损坏（模型回复不落盘、会话空转，两次复现）；说 `is_error` 是成功标志——实测它出现时恒为 false。项目里所有"文档说的"最终都被真实调用验证过一遍。

**3. 写能力有独特的"部分成功"陷阱。** 让 CLI 跑命令并写结果，它被权限挡住后会**自己猜一个答案写进文件**——exit 0、JSON 报 success、文件确实改了，三个检测点全绿，唯一破绽是自然语言里的拒绝措辞。这个坑的完整解剖和防护设计在 GOAL.md 第 9 节，任何接 CLI 写能力的项目都会遇到。

**4. 自举式开发流程。** 本仓库的六个 Sprint 全部由**被接入的 CLI 自己**完成：管理者写任务书（含白名单、基线 commit、反向验证）→ CLI 拿任务书自建 → 管理者独立验收（复跑测试、查磁盘、暗卷抽查，不信自述）。任务书全在 `TASKBOOK-sprint*.md`，这个模式本身被验证过有效——包括一次执行者发现任务书逻辑错误并订正的实录。

## 已知限制（诚实清单）

- **codebuddy 无后台模式**：`--bg` 在 2.137.1 上游损坏（GOAL.md 8.7 节含重测探针），修复前只有同步模式。
- **`/cursor:implement` 默认不跑命令**：只传 `--trust` 最小权限，任务要求跑测试会得到"部分成功"+warning。这是设计而非缺陷。
- **刻意不做共享抽象层**：理由见上，这是实测结论不是懒。

## 参与建设

**先读 [docs/METHODOLOGY.md](docs/METHODOLOGY.md)** —— 本项目的核心可复用资产是一套工作方法：任务书驱动让 CLI 自建、管理者独立验收、第三方 CLI 对抗评审。它不依赖本仓库代码，任何"主控 AI + 本地 CLI"组合都能用。插件本身只是道具：简单稳定的管道。

**开发**：`node --test tests/*.test.mjs`，80 个测试全绿是唯一可接受状态。仓库结构一个引擎一个目录（`plugins/<engine>/`），互不依赖。

**接新引擎**（我们最欢迎的贡献，流程不许跳步）：

1. **契约调研**——真实调用 + 官方文档交叉验证，结论写进 GOAL.md 新章节。重点测：成功 envelope 形状、**失败时的形状**（exit code / stdout / stderr 各自什么表现）、超时机制、权限边界、拒绝信号在哪。调研不完不许写代码。
2. **写任务书**——参考 `TASKBOOK-sprint*.md`：白名单（哪些文件能碰）、基线 commit（保护文件零 diff）、反向验证（故意弄坏证明防线会响）、止损线。
3. **自建 + 独立验收**——交付者贴输出不算数，验收方必复跑测试、核对保护文件、做执行者看不见的暗卷抽查。

**重测挂起项**：codebuddy 升级后跑 GOAL.md 8.7 节的两条探针，`--bg` 修复即可解锁后台模式任务书。

**当前路线图**：批量重构写能力（多文件场景需要先解决"JSON 无改动清单如何核实"）、codebuddy 后台（等上游）、可选的路由自动化。详见 GOAL.md 第 7 节。

## 致谢

项目结构参考 [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc)（Apache-2.0）——它的命令分层、Job 生命周期、测试脚手架模式被本仓库沿用，但它约 3,400 行与 Codex App Server 强绑定的协议栈被刻意不用（理由：别把"单引擎桥接"当"多引擎底座"）。初期立项讨论中对"应该 fork 官方插件还是独立建仓"的评估，结论是后者，六个 Sprint 下来验证了这个选择。
