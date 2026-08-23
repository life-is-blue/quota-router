---
description: Delegate a research topic to Cursor CLI (agent)
argument-hint: '<topic>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-cli.mjs" research "$ARGUMENTS"`
