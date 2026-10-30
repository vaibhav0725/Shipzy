import Link from 'next/link';
import { Avatar, Badge } from '@/components/bits';
import { Icon } from '@/components/Icons';
import { formatBytes, ProjectSummary, timeAgo } from '@/lib/client';

/** One project at a glance: where it is live, where it deploys from, and when it last changed. */
export default function ProjectCard({ project: p }: { project: ProjectSummary }) {
  const live = p.live[0];
  return (
    <Link href={`/projects/${p.name}`} className="pcard">
      <div className="pcard-top">
        <Avatar name={p.name} />
        <div className="pcard-title">
          <strong>{p.name}</strong>
          <span className="pcard-url">{live ? live.host : 'Not live anywhere'}</span>
        </div>
        <Badge kind={live ? 'ok' : undefined} dot>{live ? 'Live' : 'Offline'}</Badge>
      </div>
      <div className="pcard-meta">
        <div>
          <Icon name={p.source ? 'github' : 'folder'} />
          <span>{p.source ? `${p.source.repo} · ${p.source.branch}` : 'Deployed from a folder'}</span>
        </div>
        <div>
          <Icon name="clock" />
          <span>{p.live[0]?.deployedAt || p.lastDeployedAt ? `Deployed ${timeAgo(live?.deployedAt ?? p.lastDeployedAt)}` : 'Never deployed'}</span>
        </div>
      </div>
      <div className="pcard-foot">
        <Badge>{p.versions} version{p.versions === 1 ? '' : 's'}</Badge>
        <Badge>{formatBytes(p.bytes)}</Badge>
        {p.domains.length > 0 && <Badge>{p.domains.length} domain{p.domains.length === 1 ? '' : 's'}</Badge>}
        {p.source?.previews && <Badge>previews</Badge>}
        {p.envVars > 0 && <Badge>{p.envVars} var{p.envVars === 1 ? '' : 's'}</Badge>}
      </div>
    </Link>
  );
}
