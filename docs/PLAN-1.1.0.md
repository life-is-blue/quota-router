# 1.1.0 发布计划 v2（Codex 评审 NO-GO 后重写，16 条发现全部处置）

评审记录：Codex 对 v1 判 NO-GO（6 blocker 级 + 8 should-fix + nits）。v1 的核心缺陷：①tag 时序矛盾；②把 skip-permissions 路径上的 `ERROR+response` 形态当默认路径主成功分支（已由三次追加探针补全契约，见 GOAL.md 11.1）；③job 清理被低估成机械活。

## 重排后的执行顺序（解决发现 1：tag 移到最后）

```
批次 A：/agy:implement apply 模式（含契约已补全）
批次 B：/agy:status job 清理（按独立功能规格做，含完整测试矩阵）
批次 C：CHANGELOG + 版本 bump + tag v1.1.0（最后，范围=已验收的全部）
```

## 批次 A：/agy:implement apply 模式

契约依据 GOAL.md 11/11.1。发现 5/6 的处置：

- **成功路径 = 探针 E 形态**：trusted workspace + 默认权限 + prompt 模板（内置「不要修改任何文件，只在回复里给出修改后的完整文件内容」指令）。`SUCCESS + response 非空` 为成功。
- **`ERROR + response 非空`** = 防御性兼容分支：不判失败、response 照常返回、带 warning 说明「agy 报了内部错误但产物可能在 response 里，请人工核对」。**测试里它来自真实可达路径吗——是**：探针 B 实测过（skip flag 下），但我们的适配器不传 flag，所以它只作为防御分支测试，不作为功能主张。
- **`CANCELED + auto-denied`** = 权限不足：错误信息必须含可操作指引（两条路：交互模式跑一次 agy 把目录加进 trustedWorkspaces；或在 settings.json 加 permissions.allow 规则）。引用 GOAL.md 11.1 的原文。
- **产物格式契约（发现 6）**：插件**不解析** response；命令文档（implement.md）规定 Claude 侧行为：拿到 response 后**原样展示给用户**（含代码围栏），用户确认后由 Claude 用 Edit 工具落盘；落盘前必须读目标文件现状做比对。**不做自动落盘、不做 unified diff 强制格式**（v1 评审建议的 diff 格式化被否——理由：response 格式由 prompt 模板引导但 agy 不保证，强制格式是给上游行为当人质；「展示+确认」已经把错应用的风险关在用户眼前）。
- warnings 关键词：**修正 v1 错误**（发现 12）——agy 现有扫描只有英文 `denied|not allowed`；implement 路径新增中文关键词（权限不足/无法访问/被拒绝）+ `auto-denied`，中英分别测试。

## 批次 B：job 清理（发现 3/4/7/8/9 的处置——按功能规格重写）

- **时间基准（发现 4）**：只用**可解析的 `finishedAt`**，`finishedAt < now - 7d` 严格小于；缺失/非法 finishedAt → **保守不删**。
- **僵尸 running（发现 7）**：running 且 `isProcessAlive` 为假（死 PID）→ 转 `error` 终态（error 字段记 "abandoned: process dead, auto-finalized 2026-08-24"），之后按终态规则参与清理。PID 复用误判风险接受（7 天窗口足够小，且只发生在清理时机）。
- **计数语义（发现 8）**：unlink 成功后才计数；ENOENT 视为竞争跳过不计；其他失败单独计数并输出 warning；清理后重新列取。
- **损坏 JSON（发现 9）**：`readJob` 返回 null 的文件（解析失败）不删但**计数为 skipped-corrupt** 并在输出里报告（用户知道有脏文件，自己决定删）。
- **测试矩阵（发现 3）**：恰好 7 天（边界不删）、7天+1ms（删）、running 不删、死 PID running 转终态、非法 finishedAt 不删、损坏 JSON 报告不删、unlink 失败计数、幂等（二次调用 cleaned=0）、空目录。`now` 可注入。
- **触发点**：仅 `/agy:status` 无参列表模式，读出后清理，输出尾部一行 `cleaned N old job(s), M corrupt skipped`。

## 批次 C：发版（最后）

- CHANGELOG 1.1.0：/agy:implement（apply 模式）、job 清理、测试数（写最终真实数字）、/quota:setup 归属修正（发现 2：它是已交付的批次 2，不是本计划产物）。
- 版本 bump 全量 1.1.0（发现 13：理由改为「本仓库采用 lockstep versioning」——四插件+marketplace 同步走，官方 codex-plugin-cc 是单插件先例不构成多插件论据；10 个版本值/6 个文件，发现 14 的计数修正）。
- tag `v1.1.0` 在全部验收后打（发现 1）。
- 测试约束修正（发现 11）：「不删除、不弱化、不 skip 现有断言；扩展 fixture 允许；必要修改保持原覆盖意图」。

## 执行分工

- 批次 A/B：写 TASKBOOK（A、B 各一份或合并一份分两节）→ Codex 执行（workspace-write 沙箱跑不了本仓库测试套件——fake bin 注入与沙箱不兼容，三次实测确认——**所以 Codex 执行代码 + 我在沙箱外跑测试验收**，Codex 的交付自检限于静态断言）→ 我验收（复跑全量测试 + 暗卷）→ Codex 静态评审收尾。
- 批次 C：机械活，Codex 执行,我核。
