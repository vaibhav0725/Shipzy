import { getRoute } from './kvs.js';
import { SiteRefs } from './types.js';

const unique = (hosts: string[]) => [...new Set(hosts.map((h) => h.toLowerCase()))];

/**
 * The hosts a deploy of this project makes live.
 *
 * - An explicit list (`--host`, or a GitHub connection's host) wins.
 * - Otherwise the project's custom domains.
 * - A project with no domains is served on the CloudFront URL.
 *
 * A project that has custom domains still keeps the CloudFront URL up to date when it already owns it, so
 * adding a domain does not leave the original URL showing an old version.
 */
export async function resolveTargetHosts(
  site: SiteRefs,
  project: string,
  domains: string[] | undefined,
  defaultHost: string,
  explicit?: string[],
): Promise<string[]> {
  if (explicit && explicit.length > 0) return unique(explicit);
  if (!domains || domains.length === 0) return [defaultHost.toLowerCase()];
  const owner = await getRoute(site.kvsArn, defaultHost);
  return unique(owner?.startsWith(`${project}/`) ? [...domains, defaultHost] : domains);
}
