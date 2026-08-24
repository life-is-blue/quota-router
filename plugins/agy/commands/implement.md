---
description: Generate file changes with Antigravity CLI (agy) for confirmed application
argument-hint: '<instruction>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

这是 apply 模式：agy 只读相关文件并生成修改后的完整内容，不直接写入任何文件。这是最安全的执行路径。

运行：

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-cli.mjs" implement "$ARGUMENTS"`

拿到结果后，Claude 必须原样向用户展示 files 清单和完整 response。只有用户确认后，才能使用 Edit 工具落盘。落盘前必须先读取每个目标文件的当前内容；如果当前内容与 agy 读取时的上下文对不上（文件已被改过），立即停止并询问用户，不得覆盖。

如果命令以 CANCELED 报错，向用户完整转述两条处理指引：

1. 在交互模式运行一次 agy，将当前目录加入 `trustedWorkspaces`。
2. 在 `~/.gemini/antigravity-cli/settings.json` 的 `permissions.allow` 中添加所需规则。

agy 在输出里自称“已修改”或“已完成”并不可信：它无法写入用户文件，一切以展示出的文件内容为准。
