export const dynamic = 'force-dynamic';

// Answers the start-up check of the hosted function; carries no data.
export const GET = () => new Response('ok', { headers: { 'cache-control': 'no-store' } });
