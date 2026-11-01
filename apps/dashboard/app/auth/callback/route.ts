import { NextRequest, NextResponse } from 'next/server';
import { isAllowed, makeSession, sameState, SESSION_COOKIE, sessionMaxAge, STATE_COOKIE, trustedHost } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const text = (status: number, message: string) =>
  new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export async function GET(req: NextRequest) {
  const host = req.headers.get('host');
  if (!trustedHost(host)) return text(403, 'Unexpected host.');
  const code = req.nextUrl.searchParams.get('code');
  const state = req.nextUrl.searchParams.get('state');
  const expected = req.cookies.get(STATE_COOKIE)?.value;
  if (!code || !state || !expected || !sameState(state, expected)) return text(400, 'The sign-in did not start here, or took too long. Open the dashboard address again.');

  const clientId = process.env.SHIPZY_OAUTH_CLIENT_ID;
  const clientSecret = process.env.SHIPZY_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return text(503, 'Sign-in is not set up yet. Run: shipzy dashboard --configure');

  let login: string | undefined;
  try {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'shipzy-dashboard' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: `https://${host}/auth/callback` }),
      signal: AbortSignal.timeout(15_000),
    });
    const { access_token: token } = (await tokenRes.json()) as { access_token?: string };
    if (!token) return text(400, 'GitHub did not accept the sign-in. Try again.');
    const me = await fetch('https://api.github.com/user', {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'shipzy-dashboard', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(15_000),
    });
    login = ((await me.json()) as { login?: string }).login;
    // The token has done its one job; it is not stored anywhere.
  } catch {
    return text(502, 'Could not reach GitHub. Try again.');
  }
  if (!login) return text(502, 'GitHub did not say who you are. Try again.');
  if (!isAllowed(login)) return text(403, `The GitHub user "${login}" is not allowed to use this dashboard. Ask its owner to add you: shipzy dashboard --deploy --allow ${login}`);

  const res = NextResponse.redirect(`https://${host}/`);
  res.cookies.set(SESSION_COOKIE, makeSession(login), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: sessionMaxAge });
  res.cookies.set(STATE_COOKIE, '', { path: '/auth', maxAge: 0 });
  res.headers.set('cache-control', 'no-store');
  return res;
}
