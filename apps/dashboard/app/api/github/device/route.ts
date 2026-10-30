import { startDevice } from '@/lib/github';
import { handle } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = () => handle(() => startDevice());
