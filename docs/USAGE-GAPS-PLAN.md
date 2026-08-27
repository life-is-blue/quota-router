# 使用期 Gap 方案 v2（Codex 评审 NO-GO 后重写，15 条发现全处置）

评审：Codex 两轮（发现 1-15），判 NO-GO，给出解锁条件。本版逐条处置。

## 范围裁决

- **G1（结果落盘）+ G2（会话延续）保留**——各有真实使用事件背书（调研结果丢失重跑成本、二次调研重复喂上下文 3 万 token）。
- **G3（契约 skill）降为触发式 backlog**（评审发现 12：痛点是预测不是事件）。触发条件：外部会话实际发生"找不到契约知识"的记录 ≥1 次。
- README 安装命令 backlog 条目**删除**（发现 13）：安装时已逐条实测跑通，事实源漂移顺手修正。

## G1 契约（吸收发现 1/2/3/6/7/8）

**目录**：`~/.claude/quota-router/results/`（用户级持久目录，评审发现 1 的正确解——跨插件长期共享不能用 CLAUDE_PLUGIN_DATA：三插件各自拿到的变量可能不同、其 fallback 走 tmpdir 违背"两周后还能看"的目标）。创建时目录 `0700`。环境变量 `QUOTA_ROUTER_RESULTS_DIR` 可覆盖（同时是测试注入点）。

**命名**：`<UTC-compact>-<uuid前8>.md`（发现 6），如 `20260824T093000Z-a1b2c3d4.md`。写入用独占创建（`wx` flag），冲突（EEXIST）不重试直接走保存失败分支。engine 从内部枚举来。

**保存语义（发现 2/7）**：best-effort 后处理——result **始终先输出**；保存成功 → stdout 尾部一行 `Saved: <path>`；保存失败（磁盘满/权限/冲突）→ stderr 明确 warning（含原因），**进程仍 exit 0**，绝不让落盘失败推翻已成功的调研。文件权限 `0600`（内容可能含私有代码）。只存成功结果。

**容器格式（发现 8）**：固定 frontmatter（engine/timestamp/session_id/prompt），result 原文放在明确的围栏边界内——用四反引号围栏包三反引号内容的通用做法；空 usage/空 id/Unicode/围栏碰撞都要有测试。提供 `QUOTA_ROUTER_NO_SAVE=1` 禁用开关（发现 3 的关闭方式）。

**测试隔离（发现 5 的根因）**：存储函数接收目录参数；环境变量只在 CLI 入口解析一次；测试全部注入 tmpdir，零真实目录写入。

## G2 契约（吸收发现 4/5/9 + 前置调研）

**安全 flags 不继承**（发现 4，最重要）：resume 只复用对话上下文，**不继承任何安全策略**——每次恢复调用仍显式附带该引擎 research 的全部只读参数（cursor `--mode ask`、codebuddy `dontAsk`+`--tools`）。测试必须断言"原生 resume flag 与安全 flags 同时在 argv 里"。

**参数解析层**（发现 5）：统一语法 `--resume <id>`，脚本内解析（`--resume=ID` 也认），`--` 之后的全部当 prompt；命令模板 `argument-hint` 更新为 `[--resume <id>] <topic>`；usage 文本同步。带空格/引号/字面量 `--resume` 的 prompt 都要有测试。

**会话归属**（发现 9）：文档写明"仅续接你自己在同一工作区刚创建的会话"；ID 由 `spawn` 的独立 argv 元素传递不拼 shell；不自动从最近结果选 ID；跨引擎 ID 拒绝（agy 的 conversation_id 传给 cursor → 引擎自己的报错原样透传，不做映射）。

**前置调研（流程判断被评审确认）**：写任务书前必须实测三家 resume 的**失败形态**（过期 id/不存在 id/跨引擎 id 各一次，记录 exit/stdout/stderr 形状），结论进 GOAL.md。同时记录成功调用后 session_id 是否轮换（agy 的 conversation_id 在 resume 后变不变——影响"连续 resume 链"的用法）。

## 执行安排

- 执行者：**agy**（管理者指定，替代 cursor——同时是新分工数据点）。
- 流程：G2 前置调研（管理者做）→ 任务书（G1+G2 合并一份）→ agy 执行 → 管理者沙箱外验收 → Codex 静态评审收尾。
- 版本：G1+G2 验收后发 1.2.0。
- 事实源同步（发现 14 顺手修）：README 测试数 40→当前真实数、GOAL.md 开头状态行 34→当前，**发版时统一刷新**。
