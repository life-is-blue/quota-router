#!/usr/bin/env node

/**
 * Fake codebuddy CLI binary for tests.
 * Controlled by FAKE_CODEBUDDY_SCENARIO env var.
 *
 * IMPORTANT: real codebuddy --output-format json emits a JSON *array* (whole
 * transcript), not a single object, and can exit 0 even on API failure.
 * Scenarios below mimic those exact quirks.
 */
import process from 'node:process';

const scenario = process.env.FAKE_CODEBUDDY_SCENARIO || 'SUCCESS_NOT_LAST';

function emitArray(items) {
  process.stdout.write(JSON.stringify(items) + '\n');
  process.exit(0);
}

switch (scenario) {
  case 'SUCCESS_NOT_LAST': {
    // Transcript array where the result element is NOT the last element.
    // Proves the adapter cannot rely on j[j.length-1].
    const items = [
      {
        type: 'message',
        role: 'assistant',
        content: 'I will help with this research request.',
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Git rebase reapplies commits on top of another base branch.',
        session_id: 'fake-session-success-001',
        usage: {
          input_tokens: 120,
          output_tokens: 25,
          cache_read_input_tokens: 0,
        },
      },
      {
        type: 'function_call',
        name: 'Glob',
        input: { pattern: '**/*' },
      },
    ];
    emitArray(items);
    break;
  }

  case 'EMPTY_STDOUT_EXIT0': {
    // Real codebuddy API failure look: exit 0, 0-byte stdout, plain-text stderr.
    // This is what an unknown model name produces.
    process.stderr.write('400 model [fake-unknown-model] service info not found\n');
    process.exit(0);
    break;
  }

  case 'OBJECT_NOT_ARRAY': {
    // Valid JSON but an object, not an array. Must be judged as failure and
    // must not crash on undefined.
    process.stdout.write(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'this is an object, not the required array',
        session_id: 'fake-session-object-003',
        usage: {},
      }) + '\n'
    );
    process.exit(0);
    break;
  }

  case 'ARRAY_NO_RESULT': {
    // Valid JSON array but no element with type:"result". Must be judged as
    // failure, not resolved with an empty result.
    emitArray([
      { type: 'message', role: 'assistant', content: 'partial transcript without result' },
      { type: 'function_call', name: 'Grep', input: { pattern: 'foo' } },
    ]);
    break;
  }

  case 'CHINESE_DENIED': {
    // Refusal signal lives in Chinese natural-language result text.
    // permission_denials stays [] and is_error stays false (empty shells).
    const items = [
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '我需要读取该文件，但该权限被拒绝，无法完成这个操作。',
        session_id: 'fake-session-denied-004',
        permission_denials: [],
        usage: { input_tokens: 90, output_tokens: 40 },
      },
    ];
    emitArray(items);
    break;
  }

  case 'SLEEP': {
    // Sleep far beyond test timeout so setTimeout+kill must terminate us.
    const sleepMs = Number(process.env.FAKE_CODEBUDDY_SLEEP_MS || 60000);
    setTimeout(() => {
      emitArray([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'should never appear',
          session_id: 'fake-sleep',
          usage: {},
        },
      ]);
    }, sleepMs);
    break;
  }

  case 'HUGE_BAD_JSON': {
    // exit 0 + ≥5000 bytes of invalid JSON → parse-fail Error.message must truncate Raw output.
    process.stdout.write('{' + 'z'.repeat(5000));
    process.exit(0);
    break;
  }

  default: {
    process.stderr.write(`Unknown fake scenario: ${scenario}\n`);
    process.exit(2);
  }
}
