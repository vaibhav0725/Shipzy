import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL('/auth/signed-out', `https://${req.headers.get('host')}`), 303);
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax' });
  return res;
}
