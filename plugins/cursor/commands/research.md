---
description: Delegate a research topic to Cursor CLI (agent)
argument-hint: '[--resume <id>] <topic>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

连续追问时：先看上次输出尾部或 `Saved:` 行对应结果文件里的 `session_id`，用 `--resume <id>` 续接同一会话。只应续接你自己在同一工作区刚创建的会话，不要跨引擎或跨工作区硬套 ID。

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-cli.mjs" research "$ARGUMENTS"`
