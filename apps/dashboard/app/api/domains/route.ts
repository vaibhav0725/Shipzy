import { runJson } from '@/lib/cli';
import { handle } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(() => runJson(['domain', 'ls', '--json'], 8000));
