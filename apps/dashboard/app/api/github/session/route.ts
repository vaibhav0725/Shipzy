import { forgetSession, sessionInfo } from '@/lib/github';
import { handle } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = () => handle(async () => sessionInfo());

/** "Disconnect": forget the login held in this server's memory (it does not revoke the app on github.com). */
export const DELETE = () =>
  handle(async () => {
    forgetSession();
    return sessionInfo();
  });
