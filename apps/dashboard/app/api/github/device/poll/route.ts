import { pollDevice } from '@/lib/github';
import { handle } from '@/lib/http';
import { InputError } from '@/lib/validate';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { id?: unknown };
    if (typeof body.id !== 'string' || body.id.length > 100) throw new InputError('Missing login id.');
    return pollDevice(body.id);
  });
