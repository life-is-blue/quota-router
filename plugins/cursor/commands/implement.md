---
description: Delegate a small single-file change to Cursor CLI (agent) with write access
argument-hint: '<instruction>'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Delegate a **small single-file** edit to Cursor CLI (`agent`). Do not use this for bulk refactors — the write-path JSON has no change list, so large scopes cannot be verified.

**Permissions (default):** only `--trust` is passed (directory Workspace Trust). Shell / command auto-approve is **not** enabled — do not expect the agent to run tests or shell commands successfully under this default.

**Do not trust self-reported verification:** phrases like "I've verified" / "tests passed" in the output are **not reliable**. When a shell call is blocked under `--trust`, the agent may still edit the file with a **guessed** result, exit 0, and claim success. Always run your own tests to confirm.

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/cursor-cli.mjs" implement "$ARGUMENTS"`
