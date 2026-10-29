import { json } from '@/lib/http';
import { cancelJob } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return cancelJob(id) ? json({ ok: true }) : json({ error: 'That job is not running.' }, 409);
}
