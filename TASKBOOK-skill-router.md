你是执行者，这份文档是你唯一的任务来源；中途没人可问，拿不准的写进 BLOCKED.md，跳过继续做别的，最后随交付提交。断线换新会话先读 PROGRESS.md 接着做，别重做；每做完一项立刻更新。这活为什么干：把 quota-router 项目的核心知识（多 CLI 路由决策 + 三家 headless 契约 + 防坑规则）做成一个 **agent skill**（`~/.agents/skills/quota-router/SKILL.md`），让任何 Claude/Codex/Cursor 会话按需加载——**没装插件的会话按契约裸调 CLI 也能安全干活**，装了插件的走命令享受落盘/resume/防降级。参照物：`~/.cursor/skills-cursor/loop/SKILL.md`（能力探测+降级阶梯的范本）。知识源：quota-router 仓库的 GOAL.md（第 6/7.1/8/8.8/9/11/13 节）与 README.md。**skill 是纯指令文档，零代码零脚本**。打架时让步顺序：契约数字准确 > 降级阶梯清晰 > 篇幅短。"不许"违反算失败；"建议"有更好的路就走，在 PROGRESS.md 记一句为什么。

## 我替领导拍的板
- skill 名 `quota-router`，放 `~/.agents/skills/quota-router/SKILL.md`（SSOT），建好后 symlink 到 `~/.claude/skills/` 和 `~/.codex/skills/`（若存在）与 `~/.cursor/skills-cursor/`（若该目录是本机约定；只建缺的，已有的不动）。
- 不做 quota-router 仓库内的改动（除了 PROGRESS.md/BLOCKED.md 记录）——skill 是独立交付物，不属于插件仓库。**但 skill 里引用插件命令时用斜杠命令名（/agy:research 等），不写死本机路径。**
- 背书层级写清：裸调路径的契约知识 100% 来自实测（GOAL.md 各节），skill 里每条关键契约标注来源节号。

## 界限
- 只能改/建：`~/.agents/skills/quota-router/**`、三个 symlink、quota-router 仓库的 `PROGRESS.md`、`BLOCKED.md`。
- 不许碰 quota-router 仓库其他任何文件（基线 `ab8590a`，交付时 `git status` 除 PROGRESS/BLOCKED 外零改动）。
- 不许在 skill 里编造未实测的 CLI 行为——每条契约必须能对应到 GOAL.md 的某节；GOAL.md 没有的行为不许写。
- 不许把 skill 写成插件说明书——它的主体是「怎么调 CLI」的通用知识，插件命令只是降级阶梯的增强档。

## 任务0
通读三份材料并记录理解（≤10 行进 PROGRESS）：①`~/.cursor/skills-cursor/loop/SKILL.md`（结构范本）；②quota-router 仓库 GOAL.md 第 6、7.1、8、8.8、9、11、13 节（契约源）；③README.md 的路由表。

## 任务1：SKILL.md
单文件 `~/.agents/skills/quota-router/SKILL.md`，frontmatter `name: quota-router` + description（触发场景写具体：用户想把调研/文档查阅/小改动分流给便宜的 CLI 时；提到 agy/Cursor CLI/codebuddy headless 调用时；想省 Opus 额度时）。正文结构**照 loop skill 的模式**：

1. **Parse**：识别用户要的活属于哪类——快问快答 / 深度调研 / 质量优先调研 / 单文件小改 / 就绪诊断。
2. **Capability detection（降级阶梯，核心）**：
   - 第一档：quota-router 插件命令可用（`/quota:setup` 能跑或已知装了）→ 用 `/agy:research` 等命令，白送落盘（`~/.claude/quota-router/results/`）、`--resume` 续接、防静默降级校验。
   - 第二档：插件没有但 CLI 在 PATH → 按契约矩阵裸调（Bash 直接 `agy -p ... --output-format json`）。
   - 第三档：都没有 → 如实告知用户缺什么，不猜。
3. **三 CLI 契约矩阵**（第二档的弹药，从 GOAL.md 8.8/13 节提炼）：每家的调用形式、成功判据、**失败形态**（agy 失败也给 JSON 看 status；Cursor 失败 exit≠0+空 stdout；codebuddy API 失败 **exit 0**+空 stdout——照抄实测结论，一字不差）、超时策略（agy 原生 `--print-timeout`，另两家 timeout 命令包）、只读边界（cursor `--mode ask`、codebuddy `dontAsk`+`--tools Read,Glob,Grep`、agy 需目录在 trustedWorkspaces）。
4. **防坑规则**（散文决策规则，loop skill 风格）：①任何 CLI 自称"已验证/已完成"不可信（9.5 部分成功陷阱：它会把猜的答案写进文件）；②codebuddy 绝不传 `--version` 之外的探测参数（会跑真 LLM 会话烧 token）；③resume 必须 校验返回 id==请求 id（13 节：cursor 静默降级无错误信号）；④agy 写不了用户文件（11 节），要改文件走"让 agy 出内容+Claude 落盘"或 cursor implement；⑤中英文拒绝关键词都要扫（agy/codebuddy 中文回复居多）。
5. **路由表**（README 提炼）：快问 codebuddy（2-4s）/ 深查 agy（~2min）/ 精修 cursor（~4-5min）/ 改文件 agy-implement（稳）或 cursor-implement（快但盯 diff）。

验收：skill 加载后一个没读过 GOAL.md 的会话能按它正确完成「裸调 agy 跑一次调研并判断成败」——这条由验收方实测。

## 任务2：symlink 分发
`ln -s` 到 `~/.claude/skills/quota-router`、`~/.codex/skills/quota-router`（若 ~/.codex/skills 存在）、`~/.cursor/skills-cursor/quota-router`（若存在）。已存在同名的不覆盖（记录进 PROGRESS）。

## 反向验证
把 skill 里的契约矩阵与 GOAL.md 8.8/13 节逐行 diff：每条契约在 GOAL.md 有出处、无一条 GOAL.md 没有背书的行为——把对照清单（契约条目 → GOAL 节号）写进 PROGRESS。

## 完成条件
- 硬指标1：SKILL.md 存在、frontmatter 合法（name/description）、≤ **500 行**（loop skill 才 100 行，我们是知识密集型可放宽，但每行都要有信息量）。
- 硬指标2：契约对照清单完整（任务"反向验证"的产物），零无出处契约。
- 硬指标3（验收方实测）：验收方起一个干净会话按 skill 裸调 agy 完成一次真实调研并正确判成败。
- 硬指标4：quota-router 仓库除 PROGRESS/BLOCKED 外零改动；symlink 建好且指向正确。
- 你交付：SKILL.md + symlink + PROGRESS/BLOCKED 更新 + 对照清单。不 git commit（SSOT 目录不是 git 仓库则无需；quota-router 仓库的 PROGRESS/BLOCKED 改动由验收方提交）。
- 不装新依赖。跑满 10 轮未达标停，如实汇报。
