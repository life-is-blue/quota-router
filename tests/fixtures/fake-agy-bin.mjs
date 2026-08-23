#!/usr/bin/env node

import process from 'node:process';

const scenario = process.env.FAKE_AGY_SCENARIO || 'SUCCESS';

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

  default: {
    process.stderr.write(`Unknown fake scenario: ${scenario}\n`);
    process.exit(2);
  }
}
