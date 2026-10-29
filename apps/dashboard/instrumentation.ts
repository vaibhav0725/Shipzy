// Runs once when the server starts: read the pages' data ahead of the first visit.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') (await import('./lib/cli')).warm();
}
