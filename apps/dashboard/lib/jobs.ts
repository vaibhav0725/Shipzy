import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { childEnv, cliCommand, clearCache } from './cli';
import { settings } from './config';
import { demoEnabled, demoScript } from './demo';

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

/** One CLI invocation. A job is a list of these, run in order; the first failure stops the rest. */
export interface Step {
  args: string[];
  /** extra environment for this step only (secrets travel here, never in the arguments) */
  env?: Record<string, string>;
  /** written to the process's standard input (for example an env var value) */
  stdin?: string;
}

export interface JobInfo {
  id: string;
  label: string;
  project?: string;
  status: JobStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
}

interface Job extends JobInfo {
  lines: string[];
  /** lines dropped from the front when the log got long, so cursors stay valid */
  dropped: number;
  secrets: string[];
  child?: ChildProcess;
  listeners: Set<() => void>;
  cleanup?: () => void;
}

const MAX_LINES = 5000;
const MAX_JOBS = 60;

// Next.js may load this module more than once (route bundles, dev reloads); the jobs must be one shared set.
const g = globalThis as unknown as { __deployerJobs?: Map<string, Job>; __deployerExitHook?: boolean };
const jobs = (g.__deployerJobs ??= new Map<string, Job>());

if (!g.__deployerExitHook) {
  g.__deployerExitHook = true;
  const stop = () => {
    for (const job of jobs.values()) job.child?.kill('SIGTERM');
  };
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      stop();
      process.exit(0);
    });
  }
}

const notify = (job: Job) => job.listeners.forEach((fn) => fn());

function scrub(job: Job, text: string): string {
  let out = text;
  for (const secret of job.secrets) if (secret.length >= 4) out = out.split(secret).join('***');
  return out;
}

function append(job: Job, text: string) {
  for (const raw of text.split(/\r?\n/)) {
    job.lines.push(scrub(job, raw));
  }
  if (job.lines.length > MAX_LINES) {
    const extra = job.lines.length - MAX_LINES;
    job.lines.splice(0, extra);
    job.dropped += extra;
  }
  notify(job);
}

const info = (j: Job): JobInfo => ({
  id: j.id,
  label: j.label,
  project: j.project,
  status: j.status,
  startedAt: j.startedAt,
  endedAt: j.endedAt,
  exitCode: j.exitCode,
});

// Demo mode: play back a scripted log instead of running anything.
async function playDemo(job: Job, step: Step): Promise<number | null> {
  for (const [delay, line] of demoScript(step.args)) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (job.status === 'cancelled') return null;
    append(job, line);
  }
  return 0;
}

function runStep(job: Job, step: Step): Promise<number | null> {
  const { file, argv } = cliCommand(step.args);
  append(job, `$ shipzy ${step.args.join(' ')}`);
  if (demoEnabled()) return playDemo(job, step);
  return new Promise((resolve) => {
    const child = spawn(file, argv, {
      stdio: [step.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      env: childEnv(step.env),
      // Where `shipzy dashboard` was started, so relative paths in the output read as they would in a terminal.
      cwd: settings().cwd,
    });
    job.child = child;
    if (step.stdin !== undefined) child.stdin!.end(step.stdin);
    // Output arrives in arbitrary chunks; keep a partial last line until its newline arrives.
    const tails = { out: '', err: '' };
    const feed = (which: 'out' | 'err') => (chunk: Buffer) => {
      const text = tails[which] + chunk.toString('utf8');
      const cut = text.lastIndexOf('\n');
      if (cut < 0) {
        tails[which] = text;
        return;
      }
      tails[which] = text.slice(cut + 1);
      append(job, text.slice(0, cut));
    };
    child.stdout!.on('data', feed('out'));
    child.stderr!.on('data', feed('err'));
    child.on('error', (e) => {
      append(job, `Could not start the shipzy CLI: ${e.message}`);
      resolve(null);
    });
    child.on('close', (code) => {
      for (const rest of [tails.out, tails.err]) if (rest) append(job, rest);
      job.child = undefined;
      resolve(code);
    });
  });
}

export function startJob(opts: {
  label: string;
  project?: string;
  steps: Step[];
  secrets?: string[];
  cleanup?: () => void;
}): JobInfo {
  const job: Job = {
    id: randomUUID().slice(0, 8),
    label: opts.label,
    project: opts.project,
    status: 'running',
    startedAt: new Date().toISOString(),
    lines: [],
    dropped: 0,
    secrets: opts.secrets ?? [],
    listeners: new Set(),
    cleanup: opts.cleanup,
  };
  jobs.set(job.id, job);
  // Forget the oldest finished jobs.
  for (const [id, j] of jobs) {
    if (jobs.size <= MAX_JOBS) break;
    if (j.status !== 'running') jobs.delete(id);
  }

  void (async () => {
    let failed: number | null = 0;
    for (const step of opts.steps) {
      failed = await runStep(job, step);
      if (job.status === 'cancelled' || failed !== 0) break;
    }
    if (job.status !== 'cancelled') job.status = failed === 0 ? 'succeeded' : 'failed';
    job.exitCode = failed;
    job.endedAt = new Date().toISOString();
    job.cleanup?.();
    clearCache();
    append(job, job.status === 'succeeded' ? '' : job.status === 'cancelled' ? '[cancelled]' : `[failed${failed === null ? '' : `, exit ${failed}`}]`);
    notify(job);
  })();
  return info(job);
}

export const listJobs = (): JobInfo[] => [...jobs.values()].map(info).reverse();
export const getJob = (id: string): JobInfo | undefined => {
  const j = jobs.get(id);
  return j ? info(j) : undefined;
};

/** Lines from an absolute cursor onward. */
export function readLines(id: string, from: number): { lines: string[]; next: number; status: JobStatus } | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  const start = Math.max(0, from - job.dropped);
  return { lines: job.lines.slice(start), next: job.dropped + job.lines.length, status: job.status };
}

export function subscribe(id: string, fn: () => void): (() => void) | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  job.listeners.add(fn);
  return () => job.listeners.delete(fn);
}

export function cancelJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.status !== 'running') return false;
  job.status = 'cancelled';
  job.child?.kill('SIGTERM');
  return true;
}
