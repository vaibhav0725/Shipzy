import { CliError } from './cli';
import { InputError } from './validate';

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'cache-control': 'no-store' } });

/** Turns a thrown error into a response; input problems are the caller's fault (400), the rest are 502. */
export function failure(err: unknown): Response {
  if (err instanceof InputError) return json({ error: err.message }, 400);
  if (err instanceof CliError) return json({ error: err.message }, 502);
  return json({ error: err instanceof Error ? err.message : String(err) }, 500);
}

export async function handle(fn: () => Promise<unknown>): Promise<Response> {
  try {
    return json(await fn());
  } catch (err) {
    return failure(err);
  }
}
