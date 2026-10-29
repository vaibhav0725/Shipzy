import * as dns from 'node:dns';
import { ListStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  deleteRoute,
  isPreviewHost,
  listManifestProjects,
  listRoutes,
  readManifest,
  readPreviewBases,
  removePreview,
  updateManifest,
  updatePreviewBases,
} from '@deployer/core';
import { deleteCertificate, describeCertificate, findCertificate } from './acm.js';
import { cloudFormation, errorMessage, findStack, GlobalOptions, StackOutputs } from './aws.js';
import { outputsOf, paramsOf, removeStack } from './cfn.js';
import { deleteAliases, deleteCnameIf, findZone } from './route53.js';

export const domainStackPrefix = (stackName: string) => `${stackName}-domain-`;

export const slug = (host: string) =>
  host.toLowerCase().replace(/^\*\./, 'wild-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export const domainStackName = (stackName: string, host: string) => `${domainStackPrefix(stackName)}${slug(host)}`;

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Normalizes and checks a hostname. A leading `*.` is only accepted when wildcards are allowed (previews). */
export function validateHost(raw: string, allowWildcard = false): string {
  const host = raw.trim().toLowerCase().replace(/\.$/, '');
  const wildcard = host.startsWith('*.');
  if (wildcard && !allowWildcard) throw new Error(`"${raw}": wildcard domains are only for previews (use: deployer domain add "${raw}" --preview).`);
  const labels = (wildcard ? host.slice(2) : host).split('.');
  if (
    labels.length < 2 ||
    host.length > 253 ||
    !labels.every((l) => LABEL.test(l)) ||
    /^\d+(\.\d+){3}$/.test(host) ||
    host.endsWith('.cloudfront.net')
  ) {
    throw new Error(`"${raw}" is not a valid hostname.`);
  }
  return host;
}

export interface DomainStackInfo {
  stackName: string;
  host: string;
  certificateArn: string;
  distributionId?: string;
  distributionDomain?: string;
  status: string;
}

const LIVE_STATUSES = [
  'CREATE_IN_PROGRESS', 'CREATE_COMPLETE', 'UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE',
  'ROLLBACK_COMPLETE', 'CREATE_FAILED', 'DELETE_FAILED', 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS',
] as const;

export async function listDomainStacks(stackName: string): Promise<DomainStackInfo[]> {
  const prefix = domainStackPrefix(stackName);
  const names: string[] = [];
  let token: string | undefined;
  do {
    const page = await cloudFormation().send(new ListStacksCommand({ StackStatusFilter: [...LIVE_STATUSES], NextToken: token }));
    for (const s of page.StackSummaries ?? []) if (s.StackName?.startsWith(prefix)) names.push(s.StackName);
    token = page.NextToken;
  } while (token);

  const infos: DomainStackInfo[] = [];
  for (const name of names) {
    const stack = await findStack(name);
    if (!stack) continue;
    const params = paramsOf(stack);
    const outputs = outputsOf(stack);
    infos.push({
      stackName: name,
      host: params['DomainName'] ?? name.slice(prefix.length),
      certificateArn: params['CertificateArn'] ?? '',
      distributionId: outputs['DistributionId'],
      distributionDomain: outputs['DistributionDomain'],
      status: stack.StackStatus ?? 'UNKNOWN',
    });
  }
  return infos.sort((a, b) => a.host.localeCompare(b.host));
}

export type DnsState = 'ok' | 'pending' | 'wrong';

// Ask a public resolver directly, so a stale local cache cannot hide (or fake) the record.
const resolver = new dns.promises.Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);

/** Does the host resolve to this CloudFront distribution? For a wildcard, a made-up label is probed. */
export async function checkDns(host: string, distributionDomain: string): Promise<DnsState> {
  const name = host.startsWith('*.') ? `deployer-check.${host.slice(2)}` : host;
  try {
    const cnames = await resolver.resolveCname(name);
    if (cnames.some((c) => c.replace(/\.$/, '').toLowerCase() === distributionDomain.toLowerCase())) return 'ok';
  } catch {
    // not a CNAME; an alias answers with plain addresses
  }
  try {
    const [mine, target] = await Promise.all([resolver.resolve4(name), resolver.resolve4(distributionDomain)]);
    return mine.some((ip) => target.includes(ip)) ? 'ok' : 'wrong';
  } catch {
    return 'pending';
  }
}

/** Which project, if any, has claimed this host as a domain. */
export async function projectOfDomain(bucket: string, host: string): Promise<string | undefined> {
  for (const project of await listManifestProjects(bucket)) {
    if ((await readManifest(bucket, project)).domains?.includes(host)) return project;
  }
  return undefined;
}

/**
 * Takes a custom domain apart: its route, its claim on a project, the DNS records this tool created, the
 * distribution stack and the certificate. Returns lines describing what happened, including any DNS records the
 * user must remove by hand (records in someone else's DNS are never touched).
 */
export async function removeDomain(out: StackOutputs, global: GlobalOptions, host: string): Promise<string[]> {
  const notes: string[] = [];
  const stackName = domainStackName(global.stackName, host);
  const stack = await findStack(stackName);
  const distributionDomain = stack ? outputsOf(stack)['DistributionDomain'] : undefined;
  const certArn = (stack && paramsOf(stack)['CertificateArn']) || (await findCertificate(host));

  if (host.startsWith('*.')) {
    // A preview domain: every preview served on it goes first, then its place in the list of preview domains.
    const base = host.slice(2);
    for (const project of await listManifestProjects(out.bucket)) {
      const { previews } = await readManifest(out.bucket, project);
      for (const [pr, info] of Object.entries(previews ?? {})) {
        if (isPreviewHost(info.host, [base]) && (await removePreview(out, project, Number(pr)))) {
          notes.push(`Removed the preview of ${project} #${pr}.`);
        }
      }
    }
    for (const r of await listRoutes(out.kvsArn)) if (isPreviewHost(r.host, [base])) await deleteRoute(out.kvsArn, r.host);
    if ((await readPreviewBases(out.bucket)).includes(base)) {
      await updatePreviewBases(out.bucket, (bases) => bases.filter((b) => b !== base));
      notes.push(`${host} is no longer a preview domain.`);
    }
  } else {
    try {
      await deleteRoute(out.kvsArn, host);
      notes.push(`Removed the route for ${host}.`);
    } catch {
      // no route was set
    }
  }

  for (const project of await listManifestProjects(out.bucket)) {
    if ((await readManifest(out.bucket, project)).domains?.includes(host)) {
      await updateManifest(out.bucket, project, (m) => {
        m.domains = (m.domains ?? []).filter((d) => d !== host);
        delete m.live[host];
      });
      notes.push(`Removed ${host} from project ${project}.`);
    }
  }

  const zone = await findZone(host).catch(() => undefined);
  const manual: string[] = [];
  if (zone && distributionDomain) {
    const n = await deleteAliases(zone.id, host.replace(/^\*\./, '*.'), distributionDomain);
    if (n > 0) notes.push(`Removed ${n} DNS alias record${n === 1 ? '' : 's'} for ${host} from Route 53.`);
  } else if (distributionDomain) {
    manual.push(`${host}  ->  ${distributionDomain}`);
  }

  if (stack) {
    await removeStack(stackName);
    notes.push(`Deleted the distribution stack ${stackName}.`);
  }

  if (certArn) {
    const info = await describeCertificate(certArn).catch(() => undefined);
    if (info?.validation && zone) {
      if (await deleteCnameIf(zone.id, info.validation.name, info.validation.value)) notes.push('Removed the certificate validation record from Route 53.');
    } else if (info?.validation) {
      manual.push(`${info.validation.name}  (certificate validation record)`);
    }
    try {
      await deleteCertificate(certArn);
      notes.push('Deleted the certificate.');
    } catch (err) {
      notes.push(`Could not delete the certificate (${errorMessage(err)}); delete it in ACM (us-east-1).`);
    }
  }

  if (manual.length > 0) {
    notes.push('Remove these DNS records where your domain is managed (they are no longer used):', ...manual.map((m) => `  ${m}`));
  }
  return notes;
}
