---
description: Check status of background agy research jobs
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-cli.mjs" status "$ARGUMENTS"`
