#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 180000;
const SIGKILL_GRACE_MS = 2000;
const MAX_STDERR_TRUNCATE = 2000;

// codebuddy replies mostly in Chinese. Real observed refusal wording was
// Chinese ("被拒绝"/"禁止"/"无法完成"); English blocked|rejected|denied never
// appeared. Cover both so the adapter is not defenseless either way.
const SOFT_DENY_PATTERN = /被拒绝|禁止|无法完成|blocked|rejected|denied/i;

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

      // Contract 2 gate: parse -> must be an array -> must contain type:"result".
      // Any of the three failing means failure, even on exit 0.
      let parsed;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch (parseErr) {
        return reject(
          new Error(
            `codebuddy 输出不是合法 JSON（可能失败）。parse 失败: ${parseErr.message}\nRaw output: ${trimmedStdout}\nstderr: ${trimmedStderr || '(empty)'}`
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

  const prompt = args.join(' ').trim();
  if (!prompt) {
    console.error('Usage: codebuddy-cli.mjs research <prompt>');
    process.exit(1);
  }

  try {
    const result = await runCodebuddyResearch(prompt);
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.error(warning);
      }
    }
    if (result.result) {
      console.log(result.result);
    }
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
