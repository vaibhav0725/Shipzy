import { listRepos } from '@/lib/github';
import { handle } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(async () => ({ repos: await listRepos() }));
