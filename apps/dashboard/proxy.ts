import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { readSession, SESSION_COOKIE, trustedHost } from './lib/auth';

// The dashboard only ever listens on 127.0.0.1, and every request must prove it came from the browser tab that
// `shipzy dashboard` opened: a per-launch token (exchanged once for a cookie), a Host header that names this
// server (so a web page on another site cannot reach it through DNS rebinding), and same-origin writes.

export const COOKIE = 'shipzy_dash';

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const refuse = (status: number, message: string) =>
  new NextResponse(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

// In a hosted dashboard (running in the owner's AWS account) the person signs in with GitHub instead, and only the
// usernames the owner listed get in. See lib/auth.ts.
function hostedProxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // The function's own start-up check, from inside the function.
  if (path === '/auth/ping') return NextResponse.next();

  const host = req.headers.get('host');
  if (!trustedHost(host)) return refuse(403, 'Unexpected host.');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    let originHost = '';
    try {
      originHost = new URL(req.headers.get('origin') ?? '').host;
    } catch {
      /* treated as a mismatch below */
    }
    if (originHost !== host) return refuse(403, 'Cross-origin requests are not allowed.');
  }

  // The sign-in routes check for themselves; the built files of the page carry no data.
  if (path === '/auth/login' || path === '/auth/callback' || path === '/auth/signed-out' || path.startsWith('/_next/static/')) return NextResponse.next();

  // Folders of the machine the server runs on, and the local GitHub login, make no sense here.
  if (path.startsWith('/api/fs') || path.startsWith('/api/github/')) return refuse(404, 'Not available in the hosted dashboard.');

  if (readSession(req.cookies.get(SESSION_COOKIE)?.value)) {
    const res = NextResponse.next();
    res.headers.set('cache-control', 'no-store');
    res.headers.set('x-frame-options', 'DENY');
    res.headers.set('x-content-type-options', 'nosniff');
    res.headers.set('referrer-policy', 'same-origin');
    return res;
  }
  if (req.method === 'GET' && !path.startsWith('/api/')) return NextResponse.redirect(new URL('/auth/login', `https://${host}`));
  return refuse(401, 'Not signed in.');
}

export function proxy(req: NextRequest) {
  if (process.env.SHIPZY_HOSTED === '1') return hostedProxy(req);
  const token = process.env.SHIPZY_DASH_TOKEN;
  if (!token) return refuse(503, 'The dashboard is not configured. Start it with: shipzy dashboard');

  const port = process.env.PORT ?? '4173';
  const host = req.headers.get('host') ?? '';
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return refuse(403, 'Unexpected host.');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.get('origin');
    let originHost = '';
    try {
      originHost = origin ? new URL(origin).host : '';
    } catch {
      /* treated as a mismatch below */
    }
    if (originHost !== host) return refuse(403, 'Cross-origin requests are not allowed.');
  }

  const supplied = req.nextUrl.searchParams.get('token');
  if (supplied && same(supplied, token)) {
    const clean = new URL(req.nextUrl.pathname, `http://${host}`);
    for (const [k, v] of req.nextUrl.searchParams) if (k !== 'token') clean.searchParams.append(k, v);
    const res = NextResponse.redirect(clean);
    res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/' });
    return res;
  }

  const cookie = req.cookies.get(COOKIE)?.value;
  if (cookie && same(cookie, token)) {
    const res = NextResponse.next();
    res.headers.set('cache-control', 'no-store');
    return res;
  }
  return refuse(401, 'Not signed in. Open the address that `shipzy dashboard` printed.');
}
