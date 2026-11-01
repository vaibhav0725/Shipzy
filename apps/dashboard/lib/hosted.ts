import type { JobInfo, JobStatus, Step } from './jobs';

// "Hosted" is the dashboard running in the user's own AWS account (`shipzy dashboard --deploy`) rather than on their
// laptop. The function that starts this server hands it the jobs through `globalThis.__shipzyHosted`, which keeps
// them in S3 and runs them in a second function, so this package needs no AWS SDK of its own.

export interface HostedBridge {
  startJob(opts: { label: string; project?: string; steps: Step[]; secrets?: string[] }): Promise<JobInfo>;
  listJobs(): Promise<JobInfo[]>;
  getJob(id: string): Promise<JobInfo | undefined>;
  readLog(id: string, from: number): Promise<{ lines: string[]; next: number; status: JobStatus; exitCode?: number | null } | undefined>;
  cancelJob(id: string): Promise<boolean>;
}

export const hosted = (): boolean => process.env.SHIPZY_HOSTED === '1';

export function bridge(): HostedBridge {
  const b = (globalThis as unknown as { __shipzyHosted?: HostedBridge }).__shipzyHosted;
  if (!b) throw new Error('The hosted dashboard is not connected to its job store.');
  return b;
}
