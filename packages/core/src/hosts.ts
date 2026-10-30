import { getRoute } from './kvs.js';
import { SiteRefs } from './types.js';

const unique = (hosts: string[]) => [...new Set(hosts.map((h) => h.toLowerCase()))];

/** The parts of a project's history that decide where its deploys go. */
export interface HostSources {
  domains?: string[];
  siteHost?: string;
}

/** Does this project already own the stack's shared CloudFront address (from before projects had their own)? */
async function ownsDefault(site: SiteRefs, project: string, defaultHost: string): Promise<boolean> {
  return Boolean((await getRoute(site.kvsArn, defaultHost))?.startsWith(`${project}/`));
}

/**
 * The hosts a deploy of this project makes live.
 *
 * - An explicit list (`--host`, or a GitHub connection's host) wins.
 * - Otherwise the project's custom domains, plus its own CloudFront address if it has one.
 * - Otherwise the project's own CloudFront address.
 * - A project with neither that already owns the shared CloudFront address keeps using it.
 * - Anything else falls back to the shared address; the CLI creates the project's own address before it gets here
 *   (see `needsOwnSite`), so this only happens for builds that no CLI started.
 *
 * A project that has custom domains still keeps the shared address up to date when it already owns it, so adding a
 * domain does not leave the original URL showing an old version.
 */
export async function resolveTargetHosts(
  site: SiteRefs,
  project: string,
  sources: HostSources,
  defaultHost: string,
  explicit?: string[],
): Promise<string[]> {
  if (explicit && explicit.length > 0) return unique(explicit);
  const own = sources.siteHost ? [sources.siteHost] : [];
  if (sources.domains && sources.domains.length > 0) {
    return unique((await ownsDefault(site, project, defaultHost)) ? [...sources.domains, ...own, defaultHost] : [...sources.domains, ...own]);
  }
  if (own.length > 0) return unique(own);
  return [defaultHost.toLowerCase()];
}

/**
 * True when a deploy of this project needs its own CloudFront address created first: nothing says where it goes
 * (no explicit host, no custom domain, no address yet) and it does not already hold the shared address.
 */
export async function needsOwnSite(
  site: SiteRefs,
  project: string,
  sources: HostSources,
  defaultHost: string,
  explicit?: string[],
): Promise<boolean> {
  if (explicit && explicit.length > 0) return false;
  if (sources.siteHost || (sources.domains && sources.domains.length > 0)) return false;
  return !(await ownsDefault(site, project, defaultHost));
}
