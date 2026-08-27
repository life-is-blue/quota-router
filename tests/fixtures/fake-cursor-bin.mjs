#!/usr/bin/env node

/**
 * Fake Cursor CLI (agent) binary for tests.
 * Controlled by FAKE_CURSOR_SCENARIO env var.
 */
import process from 'node:process';
import fs from 'node:fs';

const scenario = process.env.FAKE_CURSOR_SCENARIO || 'SUCCESS';

if (process.env.FAKE_CURSOR_ARGV_FILE) {
  fs.writeFileSync(process.env.FAKE_CURSOR_ARGV_FILE, JSON.stringify(process.argv.slice(2)));
}

function idFromArgv() {
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--resume') return a[i + 1];
    if (a[i].startsWith('--resume=')) return a[i].slice('--resume='.length);
  }
  return 'echo-without-resume-flag';
}

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

  case 'CODE_FENCE': {
    const output = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 500,
      result: 'Example with fence:\n```js\nconst x = 1;\n```\nend.',
      session_id: 'fake-session-fence-010',
      usage: { inputTokens: 10, outputTokens: 20 },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
    break;
  }

  case 'RESUME_ECHO_ID': {
    const resumeId = idFromArgv();
    const output = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 400,
      result: `Resumed session ${resumeId} successfully.`,
      session_id: resumeId,
      usage: { inputTokens: 10, outputTokens: 10 },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
    break;
  }

  case 'RESUME_NEW_ID': {
    const output = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 400,
      result: 'This looks like a fresh answer with no prior context.',
      session_id: 'silent-new-session-999',
      usage: { inputTokens: 10, outputTokens: 10 },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
    break;
  }

  default: {
    process.stderr.write(`Unknown fake scenario: ${scenario}\n`);
    process.exit(2);
  }
}
