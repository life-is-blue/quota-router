import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/**
 * Resolve the directory used to store background jobs.
 * Uses CLAUDE_PLUGIN_DATA if set, otherwise falls back to os.tmpdir()/quota-router-agy/jobs.
 *
 * @returns {string} Absolute path to jobs directory.
 */
export function resolveJobsDir() {
  const base = process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'quota-router-agy');
  const dir = path.join(base, 'jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Get the file path for a specific job id.
 *
 * @param {string} id
 * @returns {string}
 */
export function getJobFilePath(id) {
  const jobsDir = resolveJobsDir();
  return path.join(jobsDir, `${id}.json`);
}

/**
 * Read and parse a job record by ID.
 * Returns null if the job file does not exist or fails to parse.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function readJob(id) {
  if (!id || typeof id !== 'string') return null;
  const filePath = getJobFilePath(id);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/**
 * Write a job record to disk and immediately verify by reading back.
 *
 * @param {object} job
 * @returns {object} The verified job object.
 */
export function writeJob(job) {
  if (!job || !job.id) {
    throw new Error('Invalid job object: missing id');
  }
  const allowedStatuses = ['running', 'done', 'error'];
  if (!allowedStatuses.includes(job.status)) {
    throw new Error(`Invalid job status: '${job.status}'. Allowed: ${allowedStatuses.join(', ')}`);
  }

  const jobToSave = {
    id: job.id,
    prompt: typeof job.prompt === 'string' ? job.prompt : '',
    status: job.status,
    pid: typeof job.pid === 'number' ? job.pid : null,
    conversationId: typeof job.conversationId === 'string' ? job.conversationId : null,
    startedAt: job.startedAt || new Date().toISOString(),
    finishedAt: typeof job.finishedAt === 'string' ? job.finishedAt : null,
    response: typeof job.response === 'string' ? job.response : null,
    error: typeof job.error === 'string' ? job.error : null,
  };

  const filePath = getJobFilePath(job.id);
  const content = JSON.stringify(jobToSave, null, 2);
  fs.writeFileSync(filePath, content, 'utf8');

  // Immediately read back and verify JSON equality
  const readBack = readJob(job.id);
  if (!readBack || JSON.stringify(readBack) !== JSON.stringify(jobToSave)) {
    throw new Error(`writeJob verification failed for job ${job.id}: read back mismatch`);
  }

  return jobToSave;
}

/**
 * List all jobs sorted by startedAt (newest first).
 *
 * @returns {Array<object>}
 */
export function listJobs() {
  const jobsDir = resolveJobsDir();
  if (!fs.existsSync(jobsDir)) {
    return [];
  }
  const files = fs.readdirSync(jobsDir);
  const jobs = [];
  for (const file of files) {
    if (file.endsWith('.json')) {
      const id = file.slice(0, -5);
      const job = readJob(id);
      if (job) {
        jobs.push(job);
      }
    }
  }

  jobs.sort((a, b) => {
    const timeA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const timeB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return timeB - timeA;
  });

  return jobs;
}

/**
 * Check if a process with the given PID is currently alive.
 * Uses process.kill(pid, 0).
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') {
      return false;
    }
    return true;
  }
}

/**
 * Format status with liveness check for running jobs.
 *
 * @param {object} job
 * @returns {string}
 */
export function formatJobStatus(job) {
  let displayStatus = job.status;
  if (job.status === 'running') {
    if (job.pid && !isProcessAlive(job.pid)) {
      displayStatus = 'running (进程已消失，状态未知)';
    }
  }
  return displayStatus;
}
