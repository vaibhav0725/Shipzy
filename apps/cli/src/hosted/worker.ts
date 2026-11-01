import { spawn } from 'node:child_process';
import { cancelRequested, readMeta, writeLog, writeMeta, type JobInfo, type WorkerPayload } from './store.js';
import { cliArgs, cliFile, cliEnv } from './run.js';

// Runs one job for the hosted dashboard: the same CLI commands as everywhere else, one after the other, with the
// output written to S3 as it arrives so the web function can show it live. This function must never throw: a failed
// asynchronous invocation is retried by Lambda, and a retry would run the job twice.

const MAX_LINES = 5000;
const FLUSH_MS = 1500;

export async function handler(payload: WorkerPayload): Promise<void> {
  try {
    await run(payload);
  } catch (err) {
    console.error('worker failed', err);
  }
}

async function run(job: WorkerPayload): Promise<void> {
  const existing = await readMeta(job.id);
  // A duplicate delivery of a job that is already running or finished.
  if (!existing || existing.status !== 'running') return;

  const lines: string[] = [];
  let dirty = false;
  const scrub = (text: string) => job.secrets.reduce((t, s) => (s.length >= 4 ? t.split(s).join('***') : t), text);
  const add = (text: string) => {
    for (const raw of text.split(/\r?\n/)) lines.push(scrub(raw));
    if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
    dirty = true;
  };

  let cancelled = false;
  let child: ReturnType<typeof spawn> | undefined;
  const timer = setInterval(async () => {
    try {
      if (dirty) {
        dirty = false;
        await writeLog(job.id, lines);
      }
      if (!cancelled && (await cancelRequested(job.id))) {
        cancelled = true;
        child?.kill('SIGTERM');
      }
    } catch (err) {
      console.error('could not save progress', err);
    }
  }, FLUSH_MS);

  let code: number | null = 0;
  for (const step of job.steps) {
    if (cancelled || code !== 0) break;
    add(`$ shipzy ${step.args.join(' ')}`);
    code = await new Promise<number | null>((resolve) => {
      child = spawn(process.execPath, [cliFile(), ...cliArgs(), ...step.args], {
        stdio: [step.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        env: cliEnv(step.env),
        cwd: '/tmp',
      });
      if (step.stdin !== undefined) child.stdin!.end(step.stdin);
      const tails = { out: '', err: '' };
      const feed = (which: 'out' | 'err') => (chunk: Buffer) => {
        const text = tails[which] + chunk.toString('utf8');
        const cut = text.lastIndexOf('\n');
        if (cut < 0) {
          tails[which] = text;
          return;
        }
        tails[which] = text.slice(cut + 1);
        add(text.slice(0, cut));
      };
      child.stdout!.on('data', feed('out'));
      child.stderr!.on('data', feed('err'));
      child.on('error', (e) => {
        add(`Could not start the shipzy CLI: ${e.message}`);
        resolve(null);
      });
      child.on('close', (c) => {
        for (const rest of [tails.out, tails.err]) if (rest) add(rest);
        resolve(c);
      });
    });
  }
  clearInterval(timer);

  const status: JobInfo['status'] = cancelled ? 'cancelled' : code === 0 ? 'succeeded' : 'failed';
  add(status === 'succeeded' ? '' : status === 'cancelled' ? '[cancelled]' : `[failed${code === null ? '' : `, exit ${code}`}]`);
  await writeLog(job.id, lines);
  await writeMeta({ ...existing, status, exitCode: code, endedAt: new Date().toISOString() });
}
