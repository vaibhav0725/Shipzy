import { json } from '@/lib/http';
import { bridge, hosted } from '@/lib/hosted';
import { getJob, readLines } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (hosted()) {
    const from = Number(new URL(req.url).searchParams.get('from') ?? 0) || 0;
    const [job, log] = await Promise.all([bridge().getJob(id), bridge().readLog(id, from)]);
    return job && log ? json({ ...job, ...log }) : json({ error: 'No such job (the dashboard keeps jobs for 14 days).' }, 404);
  }
  const job = getJob(id);
  if (!job) return json({ error: 'No such job (the dashboard keeps recent jobs in memory only).' }, 404);
  const from = Number(new URL(req.url).searchParams.get('from') ?? 0) || 0;
  return json({ ...job, ...readLines(id, from) });
}
