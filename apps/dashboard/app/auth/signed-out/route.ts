export const dynamic = 'force-dynamic';

// Where "Sign out" lands. It must not redirect to the sign-in itself: GitHub has already approved this app, so it
// would send the person straight back in.
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signed out</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem}main{max-width:26rem}h1{font-size:1.4rem;margin:0 0 .5rem}a{color:#e8590c}</style></head>
<body><main><h1>You are signed out</h1><p>Your session on this dashboard has ended. You may still be signed in to GitHub itself; signing in here again uses that.</p><p><a href="/auth/login">Sign in with GitHub</a></p></main></body></html>`;

export const GET = () => new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
