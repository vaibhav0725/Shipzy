import {
  ChangeResourceRecordSetsCommand,
  type ResourceRecordSet,
  ListHostedZonesCommand,
  ListResourceRecordSetsCommand,
  Route53Client,
} from '@aws-sdk/client-route-53';

// Route 53 is global; the CloudFront alias zone id below is the same everywhere.
const client = () => new Route53Client({ region: 'us-east-1' });
export const CLOUDFRONT_ALIAS_ZONE = 'Z2FDTNDATAQYW2';

export interface Zone {
  id: string;
  /** without the trailing dot */
  name: string;
}

const clean = (name: string) => name.replace(/\.$/, '').replace(/\\052/g, '*').toLowerCase();

/** The public hosted zone in this account that covers the host (the most specific one wins). */
export async function findZone(host: string): Promise<Zone | undefined> {
  const bare = host.replace(/^\*\./, '').toLowerCase();
  let best: Zone | undefined;
  let marker: string | undefined;
  do {
    const page = await client().send(new ListHostedZonesCommand({ Marker: marker }));
    for (const z of page.HostedZones ?? []) {
      if (z.Config?.PrivateZone || !z.Id || !z.Name) continue;
      const name = clean(z.Name);
      if ((bare === name || bare.endsWith(`.${name}`)) && (!best || name.length > best.name.length)) {
        best = { id: z.Id.replace('/hostedzone/', ''), name };
      }
    }
    marker = page.IsTruncated ? page.NextMarker : undefined;
  } while (marker);
  return best;
}

async function change(zoneId: string, action: 'UPSERT' | 'DELETE', set: ResourceRecordSet): Promise<void> {
  await client().send(
    new ChangeResourceRecordSetsCommand({ HostedZoneId: zoneId, ChangeBatch: { Changes: [{ Action: action, ResourceRecordSet: set }] } }),
  );
}

export const upsertCname = (zoneId: string, name: string, value: string, ttl = 300) =>
  change(zoneId, 'UPSERT', { Name: name, Type: 'CNAME', TTL: ttl, ResourceRecords: [{ Value: value }] });

/** A and AAAA aliases to a CloudFront distribution (the distribution has IPv6 enabled). */
export async function upsertAlias(zoneId: string, name: string, distributionDomain: string): Promise<void> {
  for (const type of ['A', 'AAAA'] as const) {
    await change(zoneId, 'UPSERT', {
      Name: name,
      Type: type,
      AliasTarget: { HostedZoneId: CLOUDFRONT_ALIAS_ZONE, DNSName: distributionDomain, EvaluateTargetHealth: false },
    });
  }
}

async function findRecord(zoneId: string, name: string, type: string): Promise<ResourceRecordSet | undefined> {
  const res = await client().send(
    new ListResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      StartRecordName: name,
      StartRecordType: type as ResourceRecordSet['Type'],
      MaxItems: 1,
    }),
  );
  const hit = res.ResourceRecordSets?.[0];
  return hit && clean(hit.Name ?? '') === clean(name) && hit.Type === type ? hit : undefined;
}

/** Deletes the CloudFront aliases for a host, but only those pointing at this distribution. Returns how many went. */
export async function deleteAliases(zoneId: string, name: string, distributionDomain: string): Promise<number> {
  let removed = 0;
  for (const type of ['A', 'AAAA']) {
    const rec = await findRecord(zoneId, name, type);
    if (rec?.AliasTarget && clean(rec.AliasTarget.DNSName ?? '') === clean(distributionDomain)) {
      await change(zoneId, 'DELETE', rec);
      removed++;
    }
  }
  return removed;
}

/** Deletes a CNAME only if it still has the value we created it with. */
export async function deleteCnameIf(zoneId: string, name: string, value: string): Promise<boolean> {
  const rec = await findRecord(zoneId, name, 'CNAME');
  if (rec?.ResourceRecords?.[0]?.Value && clean(rec.ResourceRecords[0].Value) === clean(value)) {
    await change(zoneId, 'DELETE', rec);
    return true;
  }
  return false;
}
