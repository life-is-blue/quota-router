#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Execute research prompt via agy headless CLI.
 *
 * @param {string} prompt
 * @param {object} [options]
 * @param {string} [options.agyBin]
 * @param {string} [options.timeout]
 * @returns {Promise<{ status: string, response?: string, error?: string, warnings?: string[], raw: any }>}
 */
export function runAgyResearch(prompt, options = {}) {
  const agyBin = options.agyBin || process.env.AGY_BIN || 'agy';
  const timeout = options.timeout || process.env.AGY_TIMEOUT || '3m';

  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--print-timeout',
    timeout,
  ];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(agyBin, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      return reject(err);
    }

    let stdoutData = '';
    let stderrData = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk;
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        const enoentErr = new Error(
          `Antigravity CLI ('${agyBin}') not found. Please verify that 'agy' is installed and in your PATH.`
        );
        enoentErr.code = 'ENOENT';
        return reject(enoentErr);
      }
      return reject(err);
    });

    child.on('close', (code) => {
      const trimmedStdout = stdoutData.trim();
      const trimmedStderr = stderrData.trim();

      if (!trimmedStdout) {
        return reject(
          new Error(
            `agy exited with code ${code} and produced no stdout. stderr: ${trimmedStderr || '(empty)'}`
          )
        );
      }

      let parsed;
      try {
        parsed = JSON.parse(trimmedStdout);
      } catch (parseErr) {
        return reject(
          new Error(
            `Failed to parse agy JSON output: ${parseErr.message}\nRaw output: ${trimmedStdout}\nstderr: ${trimmedStderr}`
          )
        );
      }

      const warnings = [];
      const softDenyPattern = /denied|not allowed/i;
      if (softDenyPattern.test(trimmedStderr)) {
        warnings.push(`Warning (soft-deny detected in stderr): ${trimmedStderr}`);
      }

      // Check status field as single source of truth for success/failure
      if (parsed.status !== 'SUCCESS') {
        const errorDetail =
          parsed.error ||
          trimmedStderr ||
          `agy run ended with status '${parsed.status}' (exit code ${code})`;
        const runErr = new Error(errorDetail);
        runErr.status = parsed.status;
        runErr.raw = parsed;
        runErr.warnings = warnings;
        return reject(runErr);
      }

      return resolve({
        status: parsed.status,
        response: parsed.response || '',
        conversation_id: parsed.conversation_id,
        duration_seconds: parsed.duration_seconds,
        num_turns: parsed.num_turns,
        usage: parsed.usage,
        warnings,
        raw: parsed,
      });
    });
  });
}

/**
 * CLI Entry point
 */
export async function main(argv = process.argv.slice(2)) {
  let args = [...argv];
  if (args[0] === 'research') {
    args.shift();
  }

  const prompt = args.join(' ').trim();
  if (!prompt) {
    console.error('Usage: agy-cli.mjs [research] <prompt>');
    process.exit(1);
  }

  try {
    const result = await runAgyResearch(prompt);
    if (result.warnings && result.warnings.length > 0) {
      for (const warning of result.warnings) {
        console.error(warning);
      }
    }
    if (result.response) {
      console.log(result.response);
    }
  } catch (err) {
    if (err.warnings && err.warnings.length > 0) {
      for (const warning of err.warnings) {
        console.error(warning);
      }
    }
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main();
}
