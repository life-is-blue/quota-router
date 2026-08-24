import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runAgyImplement } from '../plugins/agy/scripts/agy-cli.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_AGY_BIN = path.resolve(__dirname, 'fixtures/fake-agy-bin.mjs');

async function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('agy implement adapter', () => {
  it('1. SUCCESS with two FILE blocks extracts paths and contents without warnings', async () => {
    await withEnv({ FAKE_AGY_SCENARIO: 'IMPLEMENT_SUCCESS' }, async () => {
      const result = await runAgyImplement('update math', { agyBin: FAKE_AGY_BIN });
      assert.equal(result.status, 'SUCCESS');
      assert.equal(result.files.length, 2);
      assert.deepEqual(result.files.map((file) => file.path), ['src/math.js', 'tests/math.test.js']);
      assert.equal(result.files[0].content, 'export const add = (a, b, c = 0) => a + b + c;\n');
      assert.equal(result.files[1].content, 'assert.equal(add(1, 2, 3), 6);\n');
      assert.deepEqual(result.warnings, []);
    });
  });

  it('2. SUCCESS without FILE blocks keeps response and adds extraction warning', async () => {
    await withEnv({ FAKE_AGY_SCENARIO: 'IMPLEMENT_NO_BLOCKS' }, async () => {
      const result = await runAgyImplement('update math', { agyBin: FAKE_AGY_BIN });
      assert.equal(result.files, null);
      assert.match(result.warnings.join('\n'), /未找到/);
      assert.equal(result.response, 'I reviewed the request, but no file block was produced.');
    });
  });

  it('3. ERROR with response defensively resolves, extracts FILE block, and warns', async () => {
    await withEnv({ FAKE_AGY_SCENARIO: 'IMPLEMENT_ERROR_WITH_RESPONSE' }, async () => {
      const result = await runAgyImplement('recover output', { agyBin: FAKE_AGY_BIN });
      assert.equal(result.status, 'ERROR');
      assert.equal(result.files.length, 1);
      assert.equal(result.files[0].path, 'src/recovered.js');
      assert.equal(result.files[0].content, 'export const recovered = true;\n');
      assert.match(result.warnings.join('\n'), /内部错误/);
    });
  });

  it('4. CANCELED auto-denied rejects with both actionable permission hints', async () => {
    await withEnv({ FAKE_AGY_SCENARIO: 'IMPLEMENT_CANCELED' }, async () => {
      await assert.rejects(
        () => runAgyImplement('update denied file', { agyBin: FAKE_AGY_BIN }),
        (err) => {
          assert.match(err.message, /trustedWorkspaces/);
          assert.match(err.message, /permissions\.allow/);
          return true;
        }
      );
    });
  });

  it('5. prompt template is prepended and no permission flag is passed', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-implement-argv-'));
    const argvFile = path.join(tmpDir, 'argv.json');
    try {
      await withEnv({
        FAKE_AGY_SCENARIO: 'IMPLEMENT_SUCCESS',
        FAKE_AGY_ARGV_FILE: argvFile,
      }, () => runAgyImplement('change add', { agyBin: FAKE_AGY_BIN }));
      const argv = JSON.parse(fs.readFileSync(argvFile, 'utf8'));
      const prompt = argv[argv.indexOf('-p') + 1];
      assert.match(prompt, /不要修改任何文件/);
      assert.match(prompt, /===FILE:/);
      assert.ok(!argv.includes('--dangerously-skip-permissions'));
      assert.deepEqual(argv.slice(-4), ['--output-format', 'json', '--print-timeout', '3m']);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('6. ENOENT reports the missing agy executable', async () => {
    const missingBin = path.resolve(__dirname, 'fixtures/non-existent-agy-implement-bin');
    await assert.rejects(
      () => runAgyImplement('update file', { agyBin: missingBin }),
      /not found/i
    );
  });

  it('7. native print timeout error rejects and preserves timeout detail', async () => {
    await withEnv({ FAKE_AGY_SCENARIO: 'IMPLEMENT_TIMEOUT' }, async () => {
      await assert.rejects(
        () => runAgyImplement('slow request', { agyBin: FAKE_AGY_BIN, timeout: '500ms' }),
        /print timeout exceeded/i
      );
    });
  });

  it('8. SUCCESS with empty response is rejected (contract: SUCCESS requires non-empty response)', async () => {
    await withEnv({ FAKE_AGY_SCENARIO: 'IMPLEMENT_EMPTY_RESPONSE' }, async () => {
      await assert.rejects(
        () => runAgyImplement('empty output', { agyBin: FAKE_AGY_BIN }),
        (err) => {
          assert.equal(err.status, 'SUCCESS'); // status field records the raw status
          return true;
        }
      );
    });
  });

  it('9. delimiter collision inside content → contentSuspect flag + warning, response intact', async () => {
    await withEnv({ FAKE_AGY_SCENARIO: 'IMPLEMENT_DELIMITER_COLLISION' }, async () => {
      const result = await runAgyImplement('collision demo', { agyBin: FAKE_AGY_BIN });
      assert.equal(result.files.length, 1);
      assert.equal(result.files[0].contentSuspect, true);
      assert.match(result.warnings.join('\n'), /截断/);
      // Full response is still available for manual inspection
      assert.match(result.response, /后续残片/);
    });
  });

  it('10. CRLF header and path with inner spaces are handled', async () => {
    await withEnv({ FAKE_AGY_SCENARIO: 'IMPLEMENT_CRLF_AND_SPACES' }, async () => {
      const result = await runAgyImplement('crlf demo', { agyBin: FAKE_AGY_BIN });
      assert.equal(result.files.length, 1);
      assert.equal(result.files[0].path, 'src/has space.js');
      assert.equal(result.files[0].content, 'const x = 1;\r\n');
    });
  });

  it('11. empty content block extracts as empty string, no suspect flag', async () => {
    await withEnv({ FAKE_AGY_SCENARIO: 'IMPLEMENT_EMPTY_BLOCK' }, async () => {
      const result = await runAgyImplement('empty block', { agyBin: FAKE_AGY_BIN });
      assert.equal(result.files.length, 1);
      assert.equal(result.files[0].content, '');
      assert.equal(result.files[0].contentSuspect, undefined);
    });
  });
});
