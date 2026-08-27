#!/usr/bin/env node

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 180000;
const SIGKILL_GRACE_MS = 2000;
const MAX_STDERR_TRUNCATE = 2000;

// codebuddy replies mostly in Chinese. Real observed refusal wording was
// Chinese ("被拒绝"/"禁止"/"无法完成"); English blocked|rejected|denied never
// appeared. Cover both so the adapter is not defenseless either way.
const SOFT_DENY_PATTERN = /被拒绝|禁止|无法完成|blocked|rejected|denied/i;

function saveResult(payload, resultsDir) {
  fs.mkdirSync(resultsDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(resultsDir, 0o700);
  } catch {
    // best-effort directory mode
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  // QUOTA_TEST_UUID: deterministic suffix for wx-collision tests (test-only).
  const suffix = process.env.QUOTA_TEST_UUID || crypto.randomUUID().slice(0, 8);
  const filePath = path.join(resultsDir, `${stamp}-${suffix}.md`);
  const text =
    `---\n` +
    `engine: ${payload.engine}\n` +
    `timestamp: ${payload.timestamp || new Date().toISOString()}\n` +
    `session_id: ${payload.session_id || ''}\n` +
    `prompt: ${JSON.stringify(payload.prompt || '')}\n` +
    `---\n\n` +
    '````\n' +
    `${payload.body ?? ''}\n` +
    '````\n';
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, text);
    try {
      fs.fchmodSync(fd, 0o600);
    } catch {
      // best-effort file mode
    }
  } finally {
    fs.closeSync(fd);
  }
  return filePath;
}

function persistResearchResult(payload, resultsDir) {
  if (!resultsDir) return;
  try {
    const saved = saveResult(payload, resultsDir);
    console.log(`Saved: ${saved}`);
  } catch (err) {
    console.error(`Warning: failed to save research result: ${err.message}`);
  }
}

function parseResearchCliArgs(argv) {
  let resumeId = null;
  // Structured resume channel for slash-command entry ($ARGUMENTS arrives
  // as ONE argv element; QUOTA_RESUME_ID avoids shell-parsing pitfalls).
  if (process.env.QUOTA_RESUME_ID) {
    resumeId = process.env.QUOTA_RESUME_ID;
  }
  const promptParts = [];
  let restIsPrompt = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (restIsPrompt) {
      promptParts.push(arg);
      continue;
    }
    if (arg === '--') {
      restIsPrompt = true;
      continue;
    }
    if (arg === '--resume') {
      const next = argv[i + 1];
      if (next === undefined || next === '--') {
        return { error: 'missing-resume-id' };
      }
      resumeId = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--resume=')) {
      resumeId = arg.slice('--resume='.length);
      continue;
    }
    restIsPrompt = true;
    promptParts.push(arg);
  }
  return {
    resumeId: resumeId || null,
    prompt: promptParts.join(' ').trim(),
  };
}

/**
 * Execute research prompt via codebuddy CLI headless mode.
 *
 * Success contract (differs from agy AND cursor):
 *  - stdout is a JSON *array* (whole transcript), not a single object.
 *  - exit code is NOT trustworthy: an API failure (unknown model) can exit 0
 *    with 0-byte stdout + plain-text stderr; only a flag typo exits 1.
 *  - The ONLY reliable success signal is: stdout parses to an array AND that
 *    array contains an element with type === 'result'. `is_error` and
 *    `permission_denials` are shells and must not be used.
 * There is no native --timeout; we wrap with setTimeout + SIGTERM -> SIGKILL.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.codebuddyBin]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: string, result?: string, session_id?: string, usage?: object, warnings?: string[], raw: any }>}
 */
export function runCodebuddyResearch(prompt, options = {}) {
  const codebuddyBin = options.codebuddyBin || process.env.CODEBUDDY_BIN || 'codebuddy';
  const timeoutMs = Number(
    options.timeoutMs ?? process.env.CODEBUDDY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS
  );

  const args = [
    '-p',
    prompt,
    '--permission-mode',
    'dontAsk',
    '--tools',
    'Read,Glob,Grep',
    '--output-format',
    'json',
  ];
  if (options.resumeId) {
    args.push('--resume', options.resumeId);
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(codebuddyBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return reject(err);
    }

    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;
    let killTimer = null;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk;
    });

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        // process may already be gone
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // process may already be gone
        }
      }, SIGKILL_GRACE_MS);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (err.code === 'ENOENT') {
        const enoentErr = new Error(
          `codebuddy CLI ('${codebuddyBin}') 没装/不在 PATH。请确认 codebuddy 已安装且加入 PATH。`
        );
        enoentErr.code = 'ENOENT';
        return reject(enoentErr);
      }
      return reject(err);
    });

    child.on('close', () => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      const trimmedStdout = stdoutData.trim();
      const trimmedStderr = stderrData.trim().slice(0, MAX_STDERR_TRUNCATE);

      if (timedOut) {
        return reject(
          new Error(
            `codebuddy CLI timed out after ${timeoutMs}ms (process killed). stderr: ${trimmedStderr || '(empty)'}`
          )
        );
      }

      if (/No conversation found/i.test(trimmedStderr)) {
        return reject(
          new Error(
            `codebuddy 输出不是合法 JSON（可能失败）。No conversation found\nstderr: ${trimmedStderr || '(empty)'}`
          )
        );
      }
      // Any of the three failing means failure, even on exit 0.
      let parsed;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch (parseErr) {
        const rawForEmbed =
          trimmedStdout.length > MAX_STDERR_TRUNCATE
            ? trimmedStdout.slice(0, MAX_STDERR_TRUNCATE) + '…(truncated)'
            : trimmedStdout;
        return reject(
          new Error(
            `codebuddy 输出不是合法 JSON（可能失败）。parse 失败: ${parseErr.message}\nRaw output: ${rawForEmbed}\nstderr: ${trimmedStderr || '(empty)'}`
          )
        );
      }

      if (!Array.isArray(parsed)) {
        return reject(
          new Error(
            `codebuddy 输出不是 JSON 数组（契约要求数组）。stderr: ${trimmedStderr || '(empty)'}`
          )
        );
      }

      const resultItem = parsed.find((x) => x && x.type === 'result');
      if (!resultItem) {
        return reject(
          new Error(
            `codebuddy 输出数组里没有 type:"result" 元素（可能失败）。stderr: ${trimmedStderr || '(empty)'}`
          )
        );
      }

      const resultText = typeof resultItem.result === 'string' ? resultItem.result : '';
      const warnings = [];

      // Refusal/permission-denial signals live in natural-language result text.
      if (SOFT_DENY_PATTERN.test(resultText)) {
        warnings.push(
          'Warning (possible incomplete research): result 文本命中 被拒绝/禁止/无法完成/blocked|rejected|denied — 结果可能不完整。'
        );
      }

      if (options.resumeId) {
        const returnedId = resultItem.session_id;
        if (returnedId !== options.resumeId) {
          return reject(
            new Error(
              `上下文未延续（resume 失败）：引擎返回了新会话 ${returnedId}，这可能是一次全新回答`
            )
          );
        }
      }

      return resolve({
        status: 'SUCCESS',
        result: resultText,
        session_id: resultItem.session_id,
        usage: resultItem.usage,
        warnings,
        raw: parsed,
      });
    });
  });
}

/**
 * CLI entry point
 */
export async function main(argv = process.argv.slice(2)) {
  const args = [...argv];

  if (args[0] === 'research') {
    args.shift();
  }

  const parsedArgs = parseResearchCliArgs(args);
  if (parsedArgs.error === 'missing-resume-id') {
    console.error('Usage: codebuddy-cli.mjs research [--resume <id>] <prompt>');
    process.exit(1);
  }
  const { resumeId } = parsedArgs;
  const prompt = parsedArgs.prompt;
  if (!prompt) {
    console.error('Usage: codebuddy-cli.mjs research [--resume <id>] <prompt>');
    process.exit(1);
  }

  const resultsDir =
    process.env.QUOTA_ROUTER_NO_SAVE === '1'
      ? null
      : process.env.QUOTA_ROUTER_RESULTS_DIR ||
        path.join(os.homedir(), '.claude', 'quota-router', 'results');

  try {
    const result = await runCodebuddyResearch(prompt, { resumeId: resumeId || undefined });
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.error(warning);
      }
    }
    if (result.result) {
      console.log(result.result);
    }
    persistResearchResult(
      {
        engine: 'codebuddy',
        session_id: result.session_id,
        prompt,
        body: result.result || '',
      },
      resultsDir
    );
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main();
}
