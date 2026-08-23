---
description: Delegate a research topic to Antigravity CLI (agy)
argument-hint: '<topic>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-cli.mjs" research "$ARGUMENTS"`
