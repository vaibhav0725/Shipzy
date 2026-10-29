import { runJson } from '@/lib/cli';
import { handle } from '@/lib/http';
import * as v from '@/lib/validate';

export const dynamic = 'force-dynamic';

export const GET = (_req: Request, ctx: { params: Promise<{ name: string }> }) =>
  handle(async () => runJson(['list', '-p', v.project((await ctx.params).name), '--json']));
