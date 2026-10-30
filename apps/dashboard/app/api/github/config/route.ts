import { saveClientId, sessionInfo } from '@/lib/github';
import { handle } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  handle(async () => {
    const body = (await req.json().catch(() => ({}))) as { clientId?: unknown };
    saveClientId(body.clientId);
    return sessionInfo();
  });
