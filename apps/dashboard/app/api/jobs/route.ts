import { planAction } from '@/lib/actions';
import { clearCache } from '@/lib/cli';
import { failure, json } from '@/lib/http';
import { listJobs, startJob } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export const GET = () => json(listJobs());

/** Starts an action (deploy, rollback, ...) as a background job and returns it. Output is read from /api/jobs/:id/stream. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const plan = await planAction(body);
    clearCache();
    return json(startJob(plan), 202);
  } catch (err) {
    return failure(err);
  }
}
