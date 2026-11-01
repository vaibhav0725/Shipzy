import { NextRequest, NextResponse } from 'next/server';
import { newState, STATE_COOKIE, trustedHost } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  const host = req.headers.get('host');
  const clientId = process.env.SHIPZY_OAUTH_CLIENT_ID;
  if (!trustedHost(host)) return new Response('Unexpected host.', { status: 403 });
  if (!clientId) {
    return new Response('Sign-in is not set up yet. Run: shipzy dashboard --configure', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  const state = newState();
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `https://${host}/auth/callback`);
  url.searchParams.set('state', state);
  // No scopes: this only asks who the person is.
  url.searchParams.set('allow_signup', 'false');
  const res = NextResponse.redirect(url);
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: 'lax', path: '/auth', maxAge: 600 });
  res.headers.set('cache-control', 'no-store');
  return res;
}
