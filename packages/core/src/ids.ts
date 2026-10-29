import { randomBytes } from 'node:crypto';

export function newDeploymentId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
  return `d-${stamp}-${randomBytes(3).toString('hex')}`;
}

// Ids look like d-20261028T212416-f8ca7f; the timestamp is UTC.
export function idTimestamp(id: string): number | undefined {
  const m = /^d-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})-[0-9a-f]+$/.exec(id);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi, s);
}
