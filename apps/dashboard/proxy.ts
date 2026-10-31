import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

// The dashboard only ever listens on 127.0.0.1, and every request must prove it came from the browser tab that
// `shipzy dashboard` opened: a per-launch token (exchanged once for a cookie), a Host header that names this
// server (so a web page on another site cannot reach it through DNS rebinding), and same-origin writes.

export const COOKIE = 'deployer_dash';

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const refuse = (status: number, message: string) =>
  new NextResponse(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export function proxy(req: NextRequest) {
  const token = process.env.DEPLOYER_DASH_TOKEN;
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
