---
description: Delegate a research topic to codebuddy CLI
argument-hint: '<topic>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/codebuddy-cli.mjs" research "$ARGUMENTS"`
