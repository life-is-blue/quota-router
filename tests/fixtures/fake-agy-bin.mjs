#!/usr/bin/env node

import process from 'node:process';
import fs from 'node:fs';

const scenario = process.env.FAKE_AGY_SCENARIO || 'SUCCESS';

if (process.env.FAKE_AGY_ARGV_FILE) {
  fs.writeFileSync(process.env.FAKE_AGY_ARGV_FILE, JSON.stringify(process.argv.slice(2)));
}

switch (scenario) {
  case 'SUCCESS': {
    const output = {
      conversation_id: 'fake-conv-success-001',
      status: 'SUCCESS',
      response: 'Git rebase reapplies commits on top of another base branch.',
      duration_seconds: 1.25,
      num_turns: 1,
      usage: {
        input_tokens: 120,
        output_tokens: 25,
        thinking_tokens: 10,
        cache_read_tokens: 0,
        total_tokens: 145,
      },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
    break;
  }

  case 'ERROR': {
    const output = {
      conversation_id: '',
      status: 'ERROR',
      response: '',
      error: 'invalid model selection (--model "does-not-exist-model"): model is not recognized',
      duration_seconds: 0.1,
      num_turns: 0,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        thinking_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 0,
      },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.stderr.write('Error: model selection failed\n');
    process.exit(1);
    break;
  }

  case 'SOFT_DENY': {
    const output = {
      conversation_id: 'fake-conv-soft-deny-002',
      status: 'SUCCESS',
      response: 'Research completed with read-only fallback.',
      duration_seconds: 2.1,
      num_turns: 1,
      usage: {
        input_tokens: 200,
        output_tokens: 35,
        thinking_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 235,
      },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.stderr.write('Warning: tool write_file was denied; permission not allowed in headless mode\n');
    process.exit(0);
    break;
  }

  case 'HUGE_STDERR': {
    // Empty stdout + ≥5000-char stderr → adapter must truncate Error.message embed.
    process.stderr.write('X'.repeat(5000) + '\n');
    process.exit(1);
    break;
  }

  case 'IMPLEMENT_SUCCESS': {
    const output = {
      session_id: 'fake-session-implement-001',
      status: 'SUCCESS',
      response: '准备了两个文件。\n===FILE: src/math.js===\nexport const add = (a, b, c = 0) => a + b + c;\n===END===\n===FILE: tests/math.test.js===\nassert.equal(add(1, 2, 3), 6);\n===END===',
      usage: { input_tokens: 80, output_tokens: 60, total_tokens: 140 },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
    break;
  }

  case 'IMPLEMENT_NO_BLOCKS': {
    const output = {
      session_id: 'fake-session-implement-002',
      status: 'SUCCESS',
      response: 'I reviewed the request, but no file block was produced.',
      usage: { input_tokens: 50, output_tokens: 12, total_tokens: 62 },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
    break;
  }

  case 'IMPLEMENT_ERROR_WITH_RESPONSE': {
    const output = {
      session_id: 'fake-session-implement-003',
      status: 'ERROR',
      response: '===FILE: src/recovered.js===\nexport const recovered = true;\n===END===',
      error: 'internal execution error after response generation',
      usage: { input_tokens: 70, output_tokens: 20, total_tokens: 90 },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.stderr.write('agy internal error\n');
    process.exit(1);
    break;
  }

  case 'IMPLEMENT_CANCELED': {
    const output = {
      session_id: 'fake-session-implement-004',
      status: 'CANCELED',
      response: '',
      error: 'permission request canceled',
      usage: { input_tokens: 20, output_tokens: 0, total_tokens: 20 },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.stderr.write('tool invocation auto-denied\n');
    process.exit(1);
    break;
  }

  case 'IMPLEMENT_TIMEOUT': {
    const output = {
      session_id: 'fake-session-implement-005',
      status: 'ERROR',
      response: '',
      error: 'print timeout exceeded',
      usage: { input_tokens: 10, output_tokens: 0, total_tokens: 10 },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.stderr.write('print timeout exceeded\n');
    process.exit(1);
    break;
  }

  default: {
    process.stderr.write(`Unknown fake scenario: ${scenario}\n`);
    process.exit(2);
  }
}
