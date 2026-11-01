import { json } from '@/lib/http';
import { bridge, hosted } from '@/lib/hosted';
import { cancelJob } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const cancelled = hosted() ? await bridge().cancelJob(id) : cancelJob(id);
  return cancelled ? json({ ok: true }) : json({ error: 'That job is not running.' }, 409);
}
