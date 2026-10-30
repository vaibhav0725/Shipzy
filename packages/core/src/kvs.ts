// SigV4a signing, required by the KeyValueStore data plane. The pure-JavaScript implementation is used so
// nothing native has to be installed or shipped to Lambda.
import '@aws-sdk/signature-v4a';
import {
  CloudFrontKeyValueStoreClient,
  DeleteKeyCommand,
  DescribeKeyValueStoreCommand,
  GetKeyCommand,
  ListKeysCommand,
  PutKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';

let kvsClient: CloudFrontKeyValueStoreClient | undefined;
// This endpoint occasionally drops a connection, and the SDK has no timeout by default, so a call could hang for
// minutes. Time out quickly instead: the SDK then retries on a fresh connection.
const kvs = () =>
  (kvsClient ??= new CloudFrontKeyValueStoreClient({ requestHandler: { connectionTimeout: 5000, requestTimeout: 10000 } }));

// Every write must quote the store's current ETag, and any other write in between invalidates it
// (reported as a ValidationException "Pre-Condition failed"). With concurrent deploys that is
// routine, so re-read the ETag and try again.
function isEtagConflict(err: unknown): boolean {
  const e = err as { name?: string; message?: string };
  return e.name === 'ValidationException' && /pre-?condition/i.test(e.message ?? '');
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeWithEtag(
  kvsArn: string,
  write: (client: CloudFrontKeyValueStoreClient, etag: string) => Promise<unknown>,
  attempts = 15,
): Promise<void> {
  const client = kvs();
  for (let attempt = 1; ; attempt++) {
    const store = await client.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));
    try {
      await write(client, store.ETag!);
      return;
    } catch (err) {
      if (!isEtagConflict(err) || attempt >= attempts) throw err;
      await sleep(30 * attempt + Math.random() * 120);
    }
  }
}

// Points a host at a deployment prefix; the edge router reads this on every request,
// so promote and rollback take effect without touching the distribution.
export async function setRoute(kvsArn: string, host: string, target: string): Promise<void> {
  await writeWithEtag(kvsArn, (client, etag) =>
    client.send(
      new PutKeyCommand({ KvsARN: kvsArn, Key: `host:${host.toLowerCase()}`, Value: target, IfMatch: etag }),
    ),
  );
}

export async function getRoute(kvsArn: string, host: string): Promise<string | undefined> {
  try {
    const res = await kvs().send(
      new GetKeyCommand({ KvsARN: kvsArn, Key: `host:${host.toLowerCase()}` }),
    );
    return res.Value;
  } catch (err) {
    if ((err as { name?: string }).name === 'ResourceNotFoundException') return undefined;
    throw err;
  }
}

export interface Route {
  host: string;
  /** "<project>/<deploymentId>" */
  target: string;
}

export async function listRoutes(kvsArn: string): Promise<Route[]> {
  const client = kvs();
  const routes: Route[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(new ListKeysCommand({ KvsARN: kvsArn, NextToken: token }));
    for (const item of page.Items ?? []) {
      if (item.Key?.startsWith('host:') && item.Value) {
        routes.push({ host: item.Key.slice('host:'.length), target: item.Value });
      }
    }
    token = page.NextToken;
  } while (token);
  return routes;
}

/** Every "<project>/<deploymentId>" some host is currently routed to. */
export async function listRouteTargets(kvsArn: string): Promise<Set<string>> {
  return new Set((await listRoutes(kvsArn)).map((r) => r.target));
}

export async function deleteRoute(kvsArn: string, host: string): Promise<void> {
  await writeWithEtag(kvsArn, (client, etag) =>
    client.send(new DeleteKeyCommand({ KvsARN: kvsArn, Key: `host:${host.toLowerCase()}`, IfMatch: etag })),
  );
}
