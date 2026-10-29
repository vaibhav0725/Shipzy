import { settings } from '@/lib/config';
import { listFolder } from '@/lib/folders';
import { handle } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) =>
  handle(async () => listFolder(new URL(req.url).searchParams.get('path') ?? undefined, settings().cwd));
