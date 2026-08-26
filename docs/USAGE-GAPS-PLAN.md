# 使用期 Gap 方案（待评审）

来源：v1.1.0 发布后首轮真实使用（agy 调研 agy-cli-docs-mirror 架构，两次调用）中亲历的痛点 + 与官方 codex-plugin-cc 的结构差分。原则：**疼了才做，每条 gap 都有真实使用事件背书**；不做的同样要写明理由。

## 拟做（按 痛感×实现小 排序）

### G1 · 同步调研结果落盘（gap 2）
- **痛点事件**：`/agy:research` 的架构速览产出只活在会话里，关掉即失；两周后想看只能重跑（再花 2 分钟 + token）。
- **方案**：三个 research 命令（agy/cursor/codebuddy）成功后自动把 result 存 `~/.claude/quota-router/results/<engine>-<timestamp>.md`（含 prompt、result、usage、session_id），stdout 尾部打印保存路径。agy 后台模式已有 job 文件，不动；只补同步路径。
- **边界**：不做检索/管理命令（`/quota:result` 等历史查询是 gap 7，等落盘积累出使用形态再做）；文件名用时间戳不搞索引。
- **待评审点**：路径放 `~/.claude/...` 还是遵循 CLAUDE_PLUGIN_DATA 约定（job-store 用的就是后者）？倾向后者保持一致。

### G2 · 会话延续（gap 8）
- **痛点事件**：连续两次 agy 调研（先架构、后追问细节），第二次全新会话——目录结构、仓库上下文全部重新喂，多花约 3 万 input token 且更慢。
- **方案**：三个 research 适配器加可选 `--resume`：成功调用后 stdout 尾部打印 session/conversation id（agy=conversation_id、cursor/codebuddy=session_id，契约已实测）；`/agy:research --resume <id> <prompt>` 透传各家原生的 `--conversation`/`--resume` flag。落地为新参数,不改默认行为。
- **边界**：不做跨引擎会话映射、不做会话记忆（Claude 主会话自己就是记忆）；usage 里 cache_read 若因 resume 上升,是收益不是问题。
- **待评审点**：resume 失败（id 过期/不存在）各家的失败形态没实测过,执行前需小调研补契约。

### G3 · CLI 契约速查 skill（gap 5）
- **痛点事件**：本项目最有实测含金量的知识（三 CLI 失败形状矩阵、关键词表、超时策略、部分成功陷阱）躺在 GOAL.md 400 行里，外部 Claude 会话无法按需加载；每个想接 CLI 的人都得重踩一遍。
- **方案**：新建 `plugins/quota/skills/cli-contracts/SKILL.md`（quota 插件加 skills 目录），内容从 GOAL.md 7.1/8.8/9/11 节提炼：三家对照表、判成败规则、关键词表、超时策略、"哪些字段是空壳"。触发场景写进 skill 描述（"当用户要接入/调试 agy、Cursor CLI、codebuddy 的 headless 调用时"）。
- **边界**：skill 是文档不是代码——不含适配器实现建议（那会诱导抄代码,契约差异恰恰说明不能抄）；不进 router 插件（router 是诊断,知识放 quota 更合适？**待评审点**：放 quota 还是独立第四插件还是每个引擎插件各带自己那份？倾向 quota 单点维护避免三份漂移）。
- **不做**：hooks（Stop 审查门违反"用户点头"哲学,SessionStart 提示价值低）、schema（批次 3 已挂）、结果历史查询（等 G1 落盘积累）、README 安装命令修复（已记 backlog,发版时顺手）。

## 统一边界
- 测试：新增行为全部 fake bin 覆盖；现有 51 测试不删不弱化。
- 契约补充调研（G2 的 resume 失败形态）由管理者先做,结论进 GOAL.md 后才写任务书——流程不许跳。
- 执行分工沿用实测结论：cursor 执行（或 Codex workspace-write 写代码）、测试归验收方沙箱外跑、Codex 静态评审收尾。
