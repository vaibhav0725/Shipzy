import Link from 'next/link';
import { Icon } from '@/components/Icons';
import { formatBytes, ProjectSummary, timeAgo } from '@/lib/client';

/** One project at a glance: where it is live, where it deploys from, and when it last changed. */
export default function ProjectCard({ project: p }: { project: ProjectSummary }) {
  const live = p.live[0];
  const facts = [
    `${p.versions} version${p.versions === 1 ? '' : 's'}`,
    formatBytes(p.bytes),
    p.domains.length > 0 ? `${p.domains.length} domain${p.domains.length === 1 ? '' : 's'}` : undefined,
    p.source?.previews ? 'previews' : undefined,
    p.envVars > 0 ? `${p.envVars} var${p.envVars === 1 ? '' : 's'}` : undefined,
  ].filter(Boolean);
  return (
    <Link href={`/projects/${p.name}`} className="pcard">
      <div className="pcard-top">
        <span className="avatar" aria-hidden="true">{p.name.charAt(0)}</span>
        <div className="pcard-title">
          <strong>{p.name}</strong>
          <span className={`pcard-url ${live ? '' : 'off'}`}>{live ? live.host : 'Not live anywhere'}</span>
        </div>
        <span className="pcard-status" style={{ color: live ? 'var(--ok)' : 'var(--faint)' }}>
          <i />
          {live ? 'Live' : 'Offline'}
        </span>
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
      <div className="pcard-foot">{facts.join(' · ')}</div>
    </Link>
  );
}
