---
description: Delegate a research topic to Cursor CLI (agent)
argument-hint: '[--resume <id>] <topic>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

连续追问时：先看上次输出尾部或 `Saved:` 行对应结果文件里的 `session_id`，用 `--resume <id>` 续接同一会话。只应续接你自己在同一工作区刚创建的会话，不要跨引擎或跨工作区硬套 ID。

**从本命令续接时**：`$ARGUMENTS` 会作为单个参数传入，`--resume` 写进参数会被当成 prompt 的一部分。正确做法：拿到上次会话 id 后，改用下面的形式调用（环境变量是结构化通道）：

!`QUOTA_RESUME_ID="<上次会话id>" node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-cli.mjs" research "$ARGUMENTS"`
