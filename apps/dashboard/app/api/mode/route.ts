import { cookies } from 'next/headers';
import { readSession, SESSION_COOKIE } from '@/lib/auth';
import { hosted } from '@/lib/hosted';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Whether this is the hosted dashboard (and who is signed in), so the pages can leave out what only works locally. */
export async function GET() {
  if (!hosted()) return json({ hosted: false });
  return json({ hosted: true, user: readSession((await cookies()).get(SESSION_COOKIE)?.value) ?? null });
}
