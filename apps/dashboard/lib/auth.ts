import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Sign-in for the hosted dashboard: GitHub's OAuth web flow proves who the person is, and only the GitHub usernames
// the owner listed at deploy time get in. The session is a signed cookie; nothing about the person or their GitHub
// account is kept, and the GitHub access token is discarded as soon as the username has been read.

export const SESSION_COOKIE = 'shipzy_session';
export const STATE_COOKIE = 'shipzy_oauth_state';
const SESSION_HOURS = 12;

const secret = () => process.env.SHIPZY_SESSION_SECRET ?? '';

const sign = (payload: string) => createHmac('sha256', secret()).update(payload).digest('base64url');

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function allowedUsers(): string[] {
  return (process.env.SHIPZY_ALLOWED_USERS ?? '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
}

export const isAllowed = (login: string): boolean => allowedUsers().includes(login.toLowerCase());

export function makeSession(login: string): string {
  const payload = Buffer.from(JSON.stringify({ u: login, exp: Date.now() + SESSION_HOURS * 3600_000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

/** The signed-in username, or undefined for a missing, forged or expired session (or one for someone removed since). */
export function readSession(cookie: string | undefined): string | undefined {
  if (!cookie || !secret()) return undefined;
  const [payload, mac] = cookie.split('.');
  if (!payload || !mac || !same(mac, sign(payload))) return undefined;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: string; exp?: number };
    if (typeof u !== 'string' || typeof exp !== 'number' || exp < Date.now() || !isAllowed(u)) return undefined;
    return u;
  } catch {
    return undefined;
  }
}

export const newState = (): string => randomBytes(24).toString('base64url');
export const sameState = same;
export const sessionMaxAge = SESSION_HOURS * 3600;

/** Only the function's own address (or a custom domain the owner set) may be used as this site's origin. */
export function trustedHost(host: string | null): boolean {
  if (!host) return false;
  const custom = process.env.SHIPZY_PUBLIC_HOST;
  if (custom && host === custom) return true;
  return /^[a-z0-9]+\.lambda-url\.[a-z0-9-]+\.on\.aws$/.test(host);
}
