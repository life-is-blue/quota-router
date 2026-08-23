import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLI_SCRIPT = path.resolve(__dirname, '../plugins/codebuddy/scripts/codebuddy-cli.mjs');
const FAKE_CODEBUDDY_BIN = path.resolve(__dirname, 'fixtures/fake-codebuddy-bin.mjs');

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_SCRIPT, ...args], {
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });

    child.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr,
        combined: `${stdout}\n${stderr}`,
      });
    });
  });
}

describe('codebuddy-cli adapter', () => {
  it('1. SUCCESS: result element NOT at array end is still found (not length-1)', async () => {
    const result = await runCli(['research', 'explain git rebase'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'SUCCESS_NOT_LAST',
    });

    assert.equal(result.code, 0, 'Exit code should be 0 on SUCCESS');
    assert.match(
      result.stdout,
      /Git rebase reapplies commits on top of another base branch/,
      'Stdout must contain result text even though result element is not last'
    );
  });

  it('2. EXIT0_EMPTY_STDOUT: API failure (exit 0 + empty stdout) must be judged as failure', async () => {
    const result = await runCli(['research', 'unknown model'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'EMPTY_STDOUT_EXIT0',
    });

    assert.notEqual(result.code, 0, 'Exit code must be non-zero on this failure');
    assert.match(
      result.combined,
      /不是合法 JSON|失败|400/i,
      'Must report failure, not green-light exit 0 with empty stdout'
    );
    assert.doesNotMatch(
      result.combined,
      /^SUCCESS$/m,
      'Must NOT report SUCCESS for exit 0 + empty stdout'
    );
  });

  it('3. OBJECT_NOT_ARRAY: valid JSON object must be judged as failure without crashing', async () => {
    const result = await runCli(['research', 'object shape'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'OBJECT_NOT_ARRAY',
    });

    assert.notEqual(result.code, 0, 'Exit code must be non-zero for non-array JSON');
    assert.match(
      result.combined,
      /不是 JSON 数组|数组|失败/i,
      'Must report that array contract was violated'
    );
    assert.doesNotMatch(
      result.combined,
      /TypeError|Cannot read properties of undefined/,
      'Must not crash on undefined result access'
    );
  });

  it('4. ARRAY_NO_RESULT: valid array without type:"result" must be judged as failure', async () => {
    const result = await runCli(['research', 'no result element'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'ARRAY_NO_RESULT',
    });

    assert.notEqual(result.code, 0, 'Exit code must be non-zero when no result element');
    assert.match(
      result.combined,
      /没有 type:"result"|失败/i,
      'Must report missing type:"result" element'
    );
    assert.doesNotMatch(
      result.combined,
      /TypeError|Cannot read properties of undefined/,
      'Must not crash on undefined result access'
    );
  });

  it('5. CHINESE_DENIED: Chinese refusal keyword in result extracts warning', async () => {
    const result = await runCli(['research', 'read a file'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'CHINESE_DENIED',
    });

    assert.equal(result.code, 0, 'Refusal-in-text style result still succeeds at process level');
    assert.match(result.stdout, /该权限被拒绝/, 'Stdout still contains result text');
    assert.match(
      result.combined,
      /Warning.*不完整|被拒绝/,
      'Must surface warning for Chinese refusal keywords in result'
    );
  });

  it('6. SLEEP: hung process is terminated by setTimeout+kill within expected time', async () => {
    const testTimeoutMs = 500;
    const start = Date.now();
    const result = await runCli(['research', 'hang forever'], {
      CODEBUDDY_BIN: FAKE_CODEBUDDY_BIN,
      FAKE_CODEBUDDY_SCENARIO: 'SLEEP',
      FAKE_CODEBUDDY_SLEEP_MS: '60000',
      CODEBUDDY_TIMEOUT_MS: String(testTimeoutMs),
    });
    const elapsed = Date.now() - start;

    assert.notEqual(result.code, 0, 'Timeout must fail with non-zero exit');
    assert.match(result.combined, /timed out/i, 'Must report timeout');
    // Allow generous margin for scheduling; must finish well under the fake sleep.
    assert.ok(
      elapsed < 10000,
      `setTimeout+kill must terminate hung process quickly, took ${elapsed}ms`
    );
    assert.ok(
      elapsed >= testTimeoutMs,
      `Should wait at least timeout (${testTimeoutMs}ms), took ${elapsed}ms`
    );
  });
});
