import { getRoute } from './kvs.js';
import { deletePrefix } from './objects.js';
import { SiteRefs } from './types.js';

export type DiscardOutcome = 'removed' | 'kept-live' | 'failed';

// A failed deploy must not leave its upload behind. The one exception: if the route already
// points at it (e.g. the promote call succeeded but its response was lost), deleting would take the site down.
export async function discardUpload(site: SiteRefs, host: string, target: string): Promise<DiscardOutcome> {
  try {
    if ((await getRoute(site.kvsArn, host)) === target) return 'kept-live';
    await deletePrefix(site.bucket, `${target}/`);
    return 'removed';
  } catch {
    return 'failed';
  }
}
