import { hosted } from '@/lib/hosted';
import { getJob, readLines, subscribe } from '@/lib/jobs';

export const dynamic = 'force-dynamic';

/** Server-sent events: `line` events carry batches of log lines, `end` carries the final status. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (hosted()) return new Response('Live streaming is not available here; the page polls instead.', { status: 404 });
  const { id } = await ctx.params;
  if (!getJob(id)) return new Response('No such job', { status: 404 });
  let cursor = Number(new URL(req.url).searchParams.get('from') ?? 0) || 0;
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* the client went away */
        }
      };
      const flush = () => {
        const chunk = readLines(id, cursor);
        if (!chunk) return;
        if (chunk.lines.length > 0) send('lines', { from: cursor, lines: chunk.lines });
        cursor = chunk.next;
        if (chunk.status !== 'running') {
          send('end', { status: chunk.status, exitCode: getJob(id)?.exitCode ?? null });
          cleanup();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      const cleanup = () => {
        unsubscribe?.();
        if (ping) clearInterval(ping);
      };
      unsubscribe = subscribe(id, flush);
      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          cleanup();
        }
      }, 15000);
      req.signal.addEventListener('abort', cleanup);
      flush();
    },
    cancel() {
      unsubscribe?.();
      if (ping) clearInterval(ping);
    },
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive' },
  });
}
