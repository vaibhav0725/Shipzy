'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import FolderPicker, { FolderListing } from '@/components/FolderPicker';
import { ErrorNotice } from '@/components/bits';
import { api, Manifest, startAction } from '@/lib/client';

type Source = 'folder' | 'github';
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Best-effort reading of a pasted link, for suggestions only (the server does the real check). */
function peek(input: string): { name?: string; branch?: string } {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:\/tree\/([^/\s#?]+))?(?:[/?#].*)?$/i.exec(input.trim()) ?? /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(input.trim());
  if (!m) return {};
  const name = m[2]!.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  return { name: name || undefined, branch: m[3] };
}

export default function NewDeployment() {
  const router = useRouter();
  const [source, setSource] = useState<Source>('folder');
  const [dir, setDir] = useState('');
  const [hint, setHint] = useState<FolderListing['project']>();
  const [project, setProject] = useState('');
  const [remote, setRemote] = useState(false);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [token, setToken] = useState('');
  const [reuse, setReuse] = useState(false);
  const [mode, setMode] = useState<'once' | 'auto'>('once');
  const [host, setHost] = useState('');
  const [install, setInstall] = useState('');
  const [build, setBuild] = useState('');
  const [accept, setAccept] = useState(false);
  const [picking, setPicking] = useState(false);
  const [existing, setExisting] = useState<Manifest>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Links such as /projects/new?project=demo&source=github prefill the form.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('project')) setProject(q.get('project')!);
    if (q.get('source') === 'github') setSource('github');
  }, []);

  // What the chosen folder looks like (a hint; the CLI does the real check when it deploys).
  useEffect(() => {
    if (!dir.startsWith('/')) return setHint(undefined);
    let cancelled = false;
    const t = setTimeout(() => {
      api<FolderListing>(`/api/fs?path=${encodeURIComponent(dir)}`)
        .then((l) => {
          if (cancelled) return;
          setHint(l.project);
          if (l.project && !project) setProject(l.project.suggestedProject);
        })
        .catch(() => !cancelled && setHint(undefined));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir]);

  // Does this project already have domains? Then those are where a deploy goes.
  useEffect(() => {
    setExisting(undefined);
    if (!NAME_RE.test(project)) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api<Manifest>(`/api/projects/${project}`).then((m) => !cancelled && setExisting(m)).catch(() => undefined);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [project]);

  const domains = existing?.domains ?? [];
  const needsAccept = !host.trim() && domains.length === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      const common = {
        project,
        host: host.trim() || undefined,
        installCommand: install.trim() || undefined,
        buildCommand: build.trim() || undefined,
        acceptSharedUrl: accept,
      };
      const job =
        source === 'folder'
          ? await startAction({ action: 'deploy-folder', dir: dir.trim(), remote, ...common })
          : mode === 'once'
            ? await startAction({ action: 'deploy-repo', repo: repo.trim(), branch: branch.trim() || undefined, ...common })
            : await startAction({ action: 'deploy-github', repo: repo.trim(), branch: branch.trim() || undefined, token: reuse ? undefined : token, reuseToken: reuse, ...common });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>New deployment</h1>
          <p className="muted">Deploy a React project from a folder on this computer, or from a GitHub repository.</p>
        </div>
      </div>

      <form onSubmit={submit}>
        <div className="card">
          <div className="tabs" role="tablist">
            <button type="button" className={source === 'folder' ? 'on' : ''} onClick={() => setSource('folder')}>Folder on this computer</button>
            <button type="button" className={source === 'github' ? 'on' : ''} onClick={() => setSource('github')}>GitHub repository</button>
          </div>

          {source === 'folder' ? (
            <>
              <label className="field">
                <span>Project folder</span>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <input type="text" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="/Users/you/projects/my-app" spellCheck={false} required />
                  <button type="button" onClick={() => setPicking(true)}>Browse</button>
                </div>
                {hint && (
                  <small>
                    {hint.framework}
                    {hint.supported ? '' : ' - this is not supported, the deploy will be refused'}
                    {hint.supported && !hint.hasBuildScript ? ' - no build script found' : ''}
                  </small>
                )}
              </label>
              <label className="field">
                <span>Where to build</span>
                <select value={remote ? 'aws' : 'local'} onChange={(e) => setRemote(e.target.value === 'aws')}>
                  <option value="local">On this computer (fast; uses your local .env)</option>
                  <option value="aws">In your AWS account (CodeBuild; uses the variables saved for the project)</option>
                </select>
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>Repository link</span>
                <input
                  type="text"
                  value={repo}
                  onChange={(e) => {
                    setRepo(e.target.value);
                    const p = peek(e.target.value);
                    if (p.name && (!project || project === peek(repo).name)) setProject(p.name);
                    if (p.branch) setBranch(p.branch);
                  }}
                  placeholder="https://github.com/owner/name  or  owner/name"
                  spellCheck={false}
                  required
                />
              </label>
              <label className="field">
                <span>Branch</span>
                <input type="text" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="the repository's default branch" spellCheck={false} />
              </label>
              <label className="field">
                <span>What should happen</span>
                <select value={mode} onChange={(e) => setMode(e.target.value as 'once' | 'auto')}>
                  <option value="once">Deploy it now (public repositories need no token)</option>
                  <option value="auto">Deploy it now and on every push (connects GitHub)</option>
                </select>
              </label>
              {mode === 'once' ? (
                <p className="muted small">
                  The build runs in your AWS account. Pushes do not redeploy; you can connect the repository later from the project&apos;s
                  GitHub tab. A private repository needs a token to be stored first: choose the second option once.
                </p>
              ) : (
                <>
                  <label className="check">
                    <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />
                    <span>Use the GitHub token already stored in my AWS account</span>
                  </label>
                  {!reuse && (
                    <label className="field">
                      <span>GitHub token</span>
                      <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" placeholder="github_pat_..." required />
                      <small>
                        Needs Contents: read and Webhooks: read and write on the repository. It is stored encrypted in your own AWS account
                        and never shown again or written to the log.
                      </small>
                    </label>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <div className="card">
          <label className="field">
            <span>Project name</span>
            <input type="text" value={project} onChange={(e) => setProject(e.target.value.toLowerCase())} placeholder="my-app" spellCheck={false} required />
            <small>Lowercase letters, digits and dashes. Deploying to an existing name adds a new version.</small>
          </label>

          <label className="field">
            <span>Serve at</span>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder={domains.length ? domains.join(', ') + ' (its domains)' : 'a hostname that already points at your stack'} spellCheck={false} />
            <small>
              {domains.length > 0
                ? 'Leave empty to update this project\'s domains.'
                : 'Leave empty to use the shared CloudFront address. Add a custom domain to the project afterwards from its Domains tab.'}
            </small>
          </label>

          {needsAccept && (
            <label className="check">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <span>
                <strong>Serve at the shared CloudFront address.</strong> It holds one project at a time, so this replaces whatever is live
                there now.
              </span>
            </label>
          )}

          <details>
            <summary className="muted">Advanced: install and build commands</summary>
            <div style={{ marginTop: 10 }}>
              <label className="field">
                <span>Install command</span>
                <input type="text" value={install} onChange={(e) => setInstall(e.target.value)} placeholder="npm ci --legacy-peer-deps" spellCheck={false} />
              </label>
              <label className="field">
                <span>Build command</span>
                <input type="text" value={build} onChange={(e) => setBuild(e.target.value)} placeholder="npm run build" spellCheck={false} />
              </label>
            </div>
          </details>
        </div>

        <ErrorNotice message={error} />
        <button className="primary" disabled={busy || !NAME_RE.test(project) || (needsAccept && !accept)}>
          {busy ? 'Starting...' : source === 'github' && mode === 'auto' ? 'Connect and deploy' : 'Deploy'}
        </button>
      </form>

      {picking && <FolderPicker start={dir.startsWith('/') ? dir : undefined} onClose={() => setPicking(false)} onPick={(p) => { setDir(p); setPicking(false); }} />}
    </>
  );
}
