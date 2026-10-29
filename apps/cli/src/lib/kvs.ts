// SigV4a signing, required by the KeyValueStore data plane.
import '@aws-sdk/signature-v4-crt';
import {
  CloudFrontKeyValueStoreClient,
  DeleteKeyCommand,
  DescribeKeyValueStoreCommand,
  GetKeyCommand,
  ListKeysCommand,
  PutKeyCommand,
} from '@aws-sdk/client-cloudfront-keyvaluestore';

// Points a host at a deployment prefix; the edge router reads this on every request,
// so promote and rollback take effect without touching the distribution.
export async function setRoute(kvsArn: string, host: string, target: string): Promise<void> {
  const client = new CloudFrontKeyValueStoreClient({});
  const store = await client.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));
  await client.send(
    new PutKeyCommand({
      KvsARN: kvsArn,
      Key: `host:${host.toLowerCase()}`,
      Value: target,
      IfMatch: store.ETag,
    }),
  );
}

export async function getRoute(kvsArn: string, host: string): Promise<string | undefined> {
  try {
    const res = await new CloudFrontKeyValueStoreClient({}).send(
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
  const client = new CloudFrontKeyValueStoreClient({});
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
  const client = new CloudFrontKeyValueStoreClient({});
  const store = await client.send(new DescribeKeyValueStoreCommand({ KvsARN: kvsArn }));
  await client.send(
    new DeleteKeyCommand({ KvsARN: kvsArn, Key: `host:${host.toLowerCase()}`, IfMatch: store.ETag }),
  );
}
