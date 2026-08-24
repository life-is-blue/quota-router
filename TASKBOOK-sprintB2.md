你是执行者，这份文档是你唯一的任务来源；中途没人可问，拿不准的写进 BLOCKED.md，跳过继续做别的，最后随交付提交。断线换新会话先读 PROGRESS.md 接着做，别重做；每做完一项立刻更新。这活为什么干：给 quota-router 加 `/quota:setup`——纯诊断工具，逐个检查四个引擎（agy / cursor / codebuddy / codex）的就绪状态，输出一张就绪表，是新插件 `plugins/router/` 的第一个命令、也是用户装完插件的第一个入口。**诊断不是闸门：引擎不可用就如实标注，命令永远成功退出。**打架时让步顺序：不产生副作用（绝不烧 token）> 报告如实 > 代码好看。"不许"违反算失败；"建议"有更好的路就走，在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- 不做自动安装（三个 CLI 各有安装渠道，自动装是坑），未装引擎在表里给一行安装指引文案。
- 登录态：只有 cursor 探测（契约支持）；agy/codebuddy/codex 标 `unknown`，**宁可不猜也不烧 token**（GOAL.md 第 10 节实测：codebuddy 的 status/whoami/裸命令都会把参数当 prompt 跑真会话）。
- codex 引擎也纳入检查（`codex --version` 纯净已验证），虽然它的深度集成（review/rescue）属于官方 codex-plugin-cc，不在本仓库范围。

## 界限
- 白名单（只能改/建）：`plugins/router/**`、`.claude-plugin/marketplace.json`（只许往 `plugins` 数组追加一条）、`tests/**`、`PROGRESS.md`、`BLOCKED.md`。
- 不许碰 `plugins/agy/**`、`plugins/cursor/**`、`plugins/codebuddy/**`、`package.json`、`GOAL.md`（基线 `1a46427`，交付时 `git diff 1a46427 -- GOAL.md` 必须为空）、本文件、`../codex-plugin-cc/`。
- **绝对不许对 codebuddy 调用 `status`/`whoami`/任何非白名单带参命令**——实测会跑真 LLM 会话烧 token。对 codebuddy 只允许调用 `codebuddy --version`。

## 必读契约（GOAL.md 第 10 节，本机实测）
| 引擎 | 安装检查 | 登录检查 | 禁区 |
| --- | --- | --- | --- |
| agy | `agy --version` | 无探测手段 → `unknown` | `agy status` 不存在（报错且 exit 0） |
| cursor | `agent --version` | `agent status` 输出含 `Logged in` 即已登录 | `status` 无 `--json`；error 也 exit 0 |
| codebuddy | `codebuddy --version` | 无探测手段 → `unknown` | **只许 `--version`**，其余全烧 token |
| codex | `codex --version` | `codex login status`（如输出不可靠就标 unknown，在 PROGRESS 记录实测结果） | - |

判据原则：**exit code 不可作为唯一依据**（agy 报错 exit 0、agent error exit 0），判据 = 进程可 spawn（ENOENT 则未装）+ 输出内容匹配。所有探测并发跑（Promise.all），单引擎超时 10s（用 `setTimeout` + kill，复用项目里已有的模式）。

## 任务0
基线 `node --test tests/*.test.mjs` 应为 **34 pass 0 fail 0 skip**（commit `1a46427`）；对不上就停并写 BLOCKED.md。核对后把理解（≤10 行）写进 PROGRESS.md。

## 任务1：核心脚本
建 `plugins/router/scripts/setup.mjs`（单文件）：
- 导出 `runSetupCheck({bins})`：`bins` 可注入各引擎二进制路径（默认 `agy`/`agent`/`codebuddy`/`codex`），返回 `[{engine, installed, version, login: 'logged-in'|'logged-out'|'unknown', detail}]`。
- 每引擎：spawn `--version`（stdin ignore，超时 10s SIGTERM→2s→SIGKILL）；ENOENT → `installed:false`；有输出 → 解析版本号；cursor 额外跑 `agent status` 判登录。agy/codebuddy 的 login 恒 `unknown`。codex 登录探测先实测一次再定（结果写 PROGRESS）。
- **禁令**：探测命令白名单硬编码为上表，不许对任何引擎尝试表外命令。
- CLI 入口：无参运行打印 Markdown 就绪表（含安装指引列），exit 恒 0。
验收：`node plugins/router/scripts/setup.mjs` 在本机输出四引擎真实状态表（本机应全 installed，cursor logged-in）。

## 任务2：插件骨架
- `plugins/router/.claude-plugin/plugin.json`（version 1.0.0，格式照 `plugins/agy/` 那份）。
- `plugins/router/commands/setup.md`：`/quota:setup`，frontmatter 照 `plugins/agy/commands/research.md`（`disable-model-invocation: true` 不需要——这个命令**应该**可以模型触发；只设 `allowed-tools: Bash(node:*)`）。正文 `!` 调用脚本。
- marketplace.json `plugins` 数组追加 router 条目（version 1.0.0）。
验收：`claude plugin validate .` 通过；`plugins` 数组长度 = 4。

## 任务3：测试（fake bin，绝不依赖真实 CLI）
建 `tests/fixtures/fake-engines/`（每引擎一个假 `--version` 脚本 + cursor 假 `status`，记得 chmod +x）和 `tests/setup.test.mjs`：
1. 四引擎全装：注入 fake bins → 全 `installed:true`、版本解析正确、cursor `logged-in`。
2. 某引擎 ENOENT（注入不存在路径）→ `installed:false`，其余不受影响，整体 exit 0。
3. 版本探测超时（fake sleep 30s、超时压 500ms）→ 该引擎标记为探测失败但**不挂起**、不 crash，其余照常。
4. **白名单守护（最重要）**：给 codebuddy 的 fake bin 加"参数记录"功能，断言整个测试运行期间收到的 argv **只有 `--version`**——绝无 `status`/`whoami`/其他带参调用。这条防的是"哪天有人手痒加了登录探测"。
5. cursor 未登录场景（fake status 输出 `Not logged in`）→ login 如实反映。
不许 `.skip`、不许 mock 被测函数本身、不许删/改已有 34 个测试。
验收：`node --test tests/*.test.mjs` pass ≥ 39、fail 0、skip 0。

## 反向验证
把任务3-4 的断言临时删掉、给 codebuddy fake 塞一个会响应 `status` 的分支，手动调用一次带 `status` 的探测证明它"能跑通"（说明禁令真的在拦而不是命令碰巧不存在），贴输出；恢复后全绿。

## 完成条件
- 硬指标1：`node --test tests/*.test.mjs` ≥ 39 全过、0 fail、0 skip。
- 硬指标2：`git diff 1a46427 -- GOAL.md plugins/agy plugins/cursor plugins/codebuddy package.json` 为空；marketplace 只追加 router 一条。
- 硬指标3：真机跑 `node plugins/router/scripts/setup.mjs` 贴真实输出（四引擎表）。
- 每条贴真实命令输出（含反向验证证据）。`BLOCKED.md` 随交付提交，没内容也写"无"。
- 不装新 npm 依赖。同一条验收连败 3 次换下一项；结果比基线差就回滚如实报告。跑满 10 轮未达标就停，如实汇报卡在哪。
