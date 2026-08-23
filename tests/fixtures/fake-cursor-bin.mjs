#!/usr/bin/env node

/**
 * Fake Cursor CLI (agent) binary for tests.
 * Controlled by FAKE_CURSOR_SCENARIO env var.
 */
import process from 'node:process';

const scenario = process.env.FAKE_CURSOR_SCENARIO || 'SUCCESS';

switch (scenario) {
  case 'SUCCESS': {
    const output = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1200,
      result: 'Git rebase reapplies commits on top of another base branch.',
      session_id: 'fake-session-success-001',
      usage: {
        inputTokens: 120,
        outputTokens: 25,
        cacheReadTokens: 0,
      },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
    break;
  }

  case 'HARD_FAIL': {
    // Real agent failure: exit 1, empty stdout, plain-text stderr (no JSON).
    process.stderr.write('Error: invalid model or authentication failed\n');
    process.exit(1);
    break;
  }

  case 'SLEEP': {
    // Sleep longer than typical test timeout so setTimeout+kill must terminate us.
    const sleepMs = Number(process.env.FAKE_CURSOR_SLEEP_MS || 60000);
    setTimeout(() => {
      process.stdout.write(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'should never appear',
          session_id: 'fake-sleep',
          usage: {},
        }) + '\n'
      );
      process.exit(0);
    }, sleepMs);
    break;
  }

  case 'BLOCKED_RESULT': {
    const output = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 800,
      result:
        'I attempted to run a shell command but it was blocked by permissions. Research may be incomplete.',
      session_id: 'fake-session-blocked-002',
      usage: {
        inputTokens: 90,
        outputTokens: 40,
        cacheReadTokens: 0,
      },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
    break;
  }

  case 'HUGE_STDERR': {
    // exit 1 + empty stdout + ≥5000-char stderr (research hard-fail path).
    process.stderr.write('Y'.repeat(5000) + '\n');
    process.exit(1);
    break;
  }

  default: {
    process.stderr.write(`Unknown fake scenario: ${scenario}\n`);
    process.exit(2);
  }
}
