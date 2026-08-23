#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_IMPLEMENT_TIMEOUT_MS = 300000;
const SIGKILL_GRACE_MS = 2000;
const SOFT_DENY_PATTERN = /blocked|rejected|denied/i;
/** Partial-success trap (GOAL.md §9.5): agent may write guessed results after shell was blocked. */
const IMPLEMENT_PARTIAL_PATTERN =
  /被拒绝|无法执行|未能实际执行|跳过|blocked|rejected|denied|skipped/i;

/**
 * Execute research prompt via Cursor CLI (agent) in ask mode.
 *
 * Failure modes differ from agy: failed runs produce empty stdout and plain-text
 * stderr (even with --output-format json). Success is exit code 0 AND non-empty
 * stdout. There is no native --timeout; we wrap with setTimeout + kill.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.agentBin]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: string, result?: string, session_id?: string, usage?: object, warnings?: string[], raw: any }>}
 */
export function runCursorResearch(prompt, options = {}) {
  const agentBin = options.agentBin || process.env.CURSOR_AGENT_BIN || 'agent';
  const timeoutMs = Number(
    options.timeoutMs ?? process.env.CURSOR_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS
  );

  const args = ['-p', prompt, '--mode', 'ask', '--output-format', 'json'];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(agentBin, args, {
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
          `Cursor CLI ('${agentBin}') not found. Please verify that 'agent' is installed and in your PATH.`
        );
        enoentErr.code = 'ENOENT';
        return reject(enoentErr);
      }
      return reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      const trimmedStdout = stdoutData.trim();
      const trimmedStderr = stderrData.trim();

      if (timedOut) {
        return reject(
          new Error(
            `Cursor CLI timed out after ${timeoutMs}ms (process killed). stderr: ${trimmedStderr || '(empty)'}`
          )
        );
      }

      // Hard failure gate: exit 0 AND non-empty stdout. Do NOT assume failure has JSON.
      if (code !== 0 || !trimmedStdout) {
        return reject(
          new Error(
            `agent exited with code ${code} and produced ${trimmedStdout ? 'stdout but non-zero exit' : 'no stdout'}. stderr: ${trimmedStderr || '(empty)'}`
          )
        );
      }

      let parsed;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch (parseErr) {
        return reject(
          new Error(
            `Failed to parse agent JSON output: ${parseErr.message}\nRaw output: ${trimmedStdout}\nstderr: ${trimmedStderr}`
          )
        );
      }

      const resultText = parsed.result || '';
      const warnings = [];

      // Soft-deny signals are mixed into natural-language result text (no clean stderr keywords).
      if (SOFT_DENY_PATTERN.test(resultText)) {
        warnings.push(
          'Warning (possible incomplete research): result text matched blocked|rejected|denied — response may be incomplete.'
        );
      }

      return resolve({
        status: 'SUCCESS',
        result: resultText,
        session_id: parsed.session_id,
        usage: parsed.usage,
        warnings,
        raw: parsed,
      });
    });
  });
}

/**
 * Execute an implement (write) prompt via Cursor CLI (agent).
 *
 * Differs from research in two args only: no `--mode ask`, adds `--trust`.
 * Does NOT pass `--force` / `--yolo` / `-y` (minimal permission gate).
 *
 * Partial-success trap: when shell is blocked under `--trust`, agent may still
 * edit files with guessed content, exit 0, is_error:false. Keyword scan on
 * `result` surfaces warnings; does NOT reject — file may still be correct.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.agentBin]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: string, result?: string, session_id?: string, usage?: object, warnings?: string[], raw: any }>}
 */
export function runCursorImplement(prompt, options = {}) {
  const agentBin = options.agentBin || process.env.CURSOR_AGENT_BIN || 'agent';
  const timeoutMs = Number(
    options.timeoutMs ??
      process.env.CURSOR_TIMEOUT_MS ??
      DEFAULT_IMPLEMENT_TIMEOUT_MS
  );

  // Write path: drop --mode ask, add --trust only (no --force/--yolo/-y).
  const args = ['-p', prompt, '--trust', '--output-format', 'json'];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(agentBin, args, {
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
          `Cursor CLI ('${agentBin}') not found. Please verify that 'agent' is installed and in your PATH.`
        );
        enoentErr.code = 'ENOENT';
        return reject(enoentErr);
      }
      return reject(err);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);

      const trimmedStdout = stdoutData.trim();
      const trimmedStderr = stderrData.trim();

      if (timedOut) {
        return reject(
          new Error(
            `Cursor CLI timed out after ${timeoutMs}ms (process killed). stderr: ${trimmedStderr || '(empty)'}`
          )
        );
      }

      // Same hard-failure gate as research: exit 0 AND non-empty stdout.
      if (code !== 0 || !trimmedStdout) {
        return reject(
          new Error(
            `agent exited with code ${code} and produced ${trimmedStdout ? 'stdout but non-zero exit' : 'no stdout'}. stderr: ${trimmedStderr || '(empty)'}`
          )
        );
      }

      let parsed;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch (parseErr) {
        return reject(
          new Error(
            `Failed to parse agent JSON output: ${parseErr.message}\nRaw output: ${trimmedStdout}\nstderr: ${trimmedStderr}`
          )
        );
      }

      const resultText = parsed.result || '';
      const warnings = [];

      // Partial-success: do not reject — surface warning so user re-verifies.
      if (IMPLEMENT_PARTIAL_PATTERN.test(resultText)) {
        warnings.push(
          'Warning (possible partial success): result text matched 被拒绝|无法执行|未能实际执行|跳过|blocked|rejected|denied|skipped — agent may have written guessed content without running verification. Confirm with your own tests.'
        );
      }

      return resolve({
        status: 'SUCCESS',
        result: resultText,
        session_id: parsed.session_id,
        usage: parsed.usage,
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
  let command = 'research';

  if (args[0] === 'research' || args[0] === 'implement') {
    command = args.shift();
  }

  const prompt = args.join(' ').trim();
  if (!prompt) {
    console.error('Usage: cursor-cli.mjs research|implement <prompt>');
    process.exit(1);
  }

  try {
    const result =
      command === 'implement'
        ? await runCursorImplement(prompt)
        : await runCursorResearch(prompt);
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.error(warning);
      }
    }
    if (result.result) {
      console.log(result.result);
    }
    // Partial success still exits 0 — warnings already went to stderr.
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
