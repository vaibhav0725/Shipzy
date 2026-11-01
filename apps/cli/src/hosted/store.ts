import { randomBytes } from 'node:crypto';
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

// The hosted dashboard keeps its jobs in S3, because the function that answers a request is frozen the moment it
// replies: a long job has to run in the worker function, and the web function reads its progress from here.

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface Step {
  args: string[];
  env?: Record<string, string>;
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

export interface WorkerPayload {
  id: string;
  label: string;
  project?: string;
  startedAt: string;
  steps: Step[];
  secrets: string[];
}

const MAX_LISTED = 40;
const JOB_ID = /^[a-z0-9]{8}-[a-f0-9]{6}$/;
export const isJobId = (id: string) => JOB_ID.test(id);

let s3: S3Client | undefined;
let fn: LambdaClient | undefined;
const client = () => (s3 ??= new S3Client({}));
const bucket = () => {
  const name = process.env.SHIPZY_JOBS_BUCKET;
  if (!name) throw new Error('SHIPZY_JOBS_BUCKET is not set.');
  return name;
};
const key = (id: string, file: string) => `jobs/${id}/${file}`;

/** Newest first when sorted by name: a base-36 timestamp, then a random suffix. */
export const newJobId = () => `${Date.now().toString(36).padStart(8, '0')}-${randomBytes(3).toString('hex')}`;

async function getText(k: string): Promise<string | undefined> {
  try {
    const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: k }));
    return await res.Body!.transformToString();
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return undefined;
    throw err;
  }
}

const putText = (k: string, body: string) =>
  client().send(new PutObjectCommand({ Bucket: bucket(), Key: k, Body: body, ContentType: 'application/json', ServerSideEncryption: 'AES256' }));

export const writeMeta = (info: JobInfo) => putText(key(info.id, 'meta.json'), JSON.stringify(info));
export const writeLog = (id: string, lines: string[]) => putText(key(id, 'log.json'), JSON.stringify(lines));

export async function readMeta(id: string): Promise<JobInfo | undefined> {
  if (!isJobId(id)) return undefined;
  const text = await getText(key(id, 'meta.json'));
  return text ? (JSON.parse(text) as JobInfo) : undefined;
}

export async function readLog(id: string, from: number): Promise<{ lines: string[]; next: number; status: JobStatus; exitCode?: number | null } | undefined> {
  const meta = await readMeta(id);
  if (!meta) return undefined;
  const text = await getText(key(id, 'log.json'));
  const lines = text ? (JSON.parse(text) as string[]) : [];
  return { lines: lines.slice(Math.max(0, from)), next: lines.length, status: meta.status, exitCode: meta.exitCode };
}

export async function listJobs(): Promise<JobInfo[]> {
  const res = await client().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: 'jobs/', Delimiter: '/' }));
  const ids = (res.CommonPrefixes ?? []).map((p) => p.Prefix!.slice('jobs/'.length, -1)).filter(isJobId).sort().reverse().slice(0, MAX_LISTED);
  const metas = await Promise.all(ids.map((id) => readMeta(id).catch(() => undefined)));
  return metas.filter((m): m is JobInfo => Boolean(m));
}

export const requestCancel = (id: string) => putText(key(id, 'cancel'), '1');
export async function cancelRequested(id: string): Promise<boolean> {
  return (await getText(key(id, 'cancel'))) !== undefined;
}

/** Records the job and hands it to the worker function, which runs it in the background. */
export async function startJob(opts: { label: string; project?: string; steps: Step[]; secrets?: string[] }): Promise<JobInfo> {
  const worker = process.env.SHIPZY_WORKER_FUNCTION;
  if (!worker) throw new Error('SHIPZY_WORKER_FUNCTION is not set.');
  const info: JobInfo = { id: newJobId(), label: opts.label, project: opts.project, status: 'running', startedAt: new Date().toISOString() };
  await writeMeta(info);
  await writeLog(info.id, []);
  const payload: WorkerPayload = { id: info.id, label: info.label, project: info.project, startedAt: info.startedAt, steps: opts.steps, secrets: opts.secrets ?? [] };
  fn ??= new LambdaClient({});
  await fn.send(new InvokeCommand({ FunctionName: worker, InvocationType: 'Event', Payload: Buffer.from(JSON.stringify(payload)) }));
  return info;
}
