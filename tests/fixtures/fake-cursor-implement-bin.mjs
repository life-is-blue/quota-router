#!/usr/bin/env node

/**
 * Fake Cursor CLI (agent) binary for /cursor:implement tests.
 * Controlled by FAKE_CURSOR_IMPLEMENT_SCENARIO env var.
 * Writes argv to FAKE_CURSOR_ARGV_FILE (if set) for args assertions.
 */
import process from 'node:process';
import fs from 'node:fs';

const scenario = process.env.FAKE_CURSOR_IMPLEMENT_SCENARIO || 'SUCCESS';
const argvFile = process.env.FAKE_CURSOR_ARGV_FILE;

if (argvFile) {
  try {
    fs.writeFileSync(argvFile, JSON.stringify(process.argv.slice(2)), 'utf8');
  } catch {
    // ignore write failures in fixture
  }
}

switch (scenario) {
  case 'SUCCESS': {
    const output = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 1200,
      result: 'Updated add to accept three parameters: add(a, b, c = 0).',
      session_id: 'fake-implement-success-001',
      usage: {
        inputTokens: 200,
        outputTokens: 40,
        cacheReadTokens: 0,
      },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
    break;
  }

  case 'HARD_FAIL': {
    // Workspace Trust rejection: exit 1, empty stdout, plain-text stderr.
    process.stderr.write(
      '⚠ Workspace Trust Required\n' +
        '  Cursor Agent can execute code and access files in this directory.\n' +
        '  Do you trust the contents of this directory?\n' +
        '    /tmp/probe-noforce\n' +
        '  To proceed, you can either:\n' +
        "    • Run 'agent' interactively to decide\n" +
        '    • Pass --trust, --yolo, or -f if you trust this directory\n'
    );
    process.exit(1);
    break;
  }

  case 'PARTIAL_SUCCESS': {
    // Partial success trap (GOAL.md §9.5 probe B): exit 0 + clean envelope,
    // but result admits shell was not actually run — guessed answer written to file.
    const output = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 3500,
      result:
        'Shell 工具调用被拒绝，未能实际执行该命令；结果按该表达式的正确输出写入文件。',
      session_id: 'fake-implement-partial-003',
      usage: {
        inputTokens: 300,
        outputTokens: 60,
        cacheReadTokens: 0,
      },
    };
    process.stdout.write(JSON.stringify(output) + '\n');
    process.exit(0);
    break;
  }

  case 'SLEEP': {
    const sleepMs = Number(process.env.FAKE_CURSOR_SLEEP_MS || 60000);
    setTimeout(() => {
      process.stdout.write(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'should never appear',
          session_id: 'fake-implement-sleep',
          usage: {},
        }) + '\n'
      );
      process.exit(0);
    }, sleepMs);
    break;
  }

  default: {
    process.stderr.write(`Unknown fake scenario: ${scenario}\n`);
    process.exit(2);
  }
}
