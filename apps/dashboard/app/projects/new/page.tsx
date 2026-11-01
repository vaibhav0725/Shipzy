'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import FolderPicker, { FolderListing } from '@/components/FolderPicker';
import GithubConnect, { RepoRow } from '@/components/GithubConnect';
import { useMode } from '@/lib/client';
import { ErrorNotice } from '@/components/bits';
import { Icon } from '@/components/Icons';
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
  const hostedMode = useMode()?.hosted === true;
  const [source, setSource] = useState<Source>('folder');
  const [dir, setDir] = useState('');
  const [hint, setHint] = useState<FolderListing['project']>();
  const [project, setProject] = useState('');
  const [remote, setRemote] = useState(false);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [token, setToken] = useState('');
  const [reuse, setReuse] = useState(false);
  // In a dashboard hosted in your own AWS account there is no local folder, and builds use the stored GitHub token.
  useEffect(() => {
    if (hostedMode) {
      setSource('github');
      setReuse(true);
    }
  }, [hostedMode]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [picked, setPicked] = useState<RepoRow>();
  const [mode, setMode] = useState<'once' | 'auto'>('once');
  const [host, setHost] = useState('');
  const [install, setInstall] = useState('');
  const [build, setBuild] = useState('');
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

  const onSession = useCallback((connected: boolean) => setLoggedIn(connected), []);

  function pickRepo(r: RepoRow) {
    const previous = peek(repo).name;
    setPicked(r);
    setRepo(r.repo);
    setBranch('');
    const name = peek(r.repo).name;
    if (name && (!project || project === previous)) setProject(name);
    // Picking from your own list is almost always "deploy it and keep it deployed".
    setMode('auto');
  }

  // With a GitHub login the token comes from that login, unless the stored one is chosen.
  const useLogin = loggedIn && !reuse;
  const domains = existing?.domains ?? [];

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
      };
      const job =
        source === 'folder'
          ? await startAction({ action: 'deploy-folder', dir: dir.trim(), remote, ...common })
          : mode === 'once'
            ? await startAction({ action: 'deploy-repo', repo: repo.trim(), branch: branch.trim() || undefined, ...common })
            : await startAction({ action: 'deploy-github', repo: repo.trim(), branch: branch.trim() || undefined, token: reuse || useLogin ? undefined : token, useLogin, reuseToken: reuse, ...common });
      router.push(`/jobs/${job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const summary =
    source === 'folder'
      ? `Deploy ${project || 'your project'} from ${dir.trim() ? dir.trim().split('/').filter(Boolean).slice(-1)[0] : 'a folder'}${remote ? ', built in AWS' : ''}`
      : mode === 'auto'
        ? `Connect ${repo.trim() || 'a repository'} and deploy on every push`
        : `Deploy ${repo.trim() || 'a repository'} once`;

  // The command this form runs, shown beside it: the dashboard does exactly what you would type.
  const arg = (value: string, fallback: string) => (value.trim() === '' ? fallback : value.trim());
  const typed =
    source === 'folder'
      ? ['shipzy deploy', arg(dir, '<folder>'), `--project ${arg(project, '<name>')}`, ...(remote ? ['--remote'] : []), ...(host.trim() ? [`--host ${host.trim()}`] : [])]
      : mode === 'auto'
        ? [`shipzy github connect -p ${arg(project, '<name>')}`, `--repo ${arg(repo, '<owner/name>')}`, ...(branch.trim() ? [`--branch ${branch.trim()}`] : []), ...(host.trim() ? [`--host ${host.trim()}`] : [])]
        : ['shipzy deploy', `--repo ${arg(repo, '<owner/name>')}`, `--project ${arg(project, '<name>')}`, ...(branch.trim() ? [`--branch ${branch.trim()}`] : []), ...(host.trim() ? [`--host ${host.trim()}`] : [])];

  return (
    <div className="newgrid">
      <div>
      <div className="head">
        <div>
          <h1>New deployment</h1>
          <p className="sub">Put a React project live on its own address in your AWS account.</p>
        </div>
      </div>

      <form onSubmit={submit}>
        <div className="step"><b>01</b><h2>Choose a source</h2></div>
        <div className="sources" role="tablist">
          {!hostedMode && <button type="button" role="tab" aria-selected={source === 'folder'} className={`source ${source === 'folder' ? 'on' : ''}`} onClick={() => setSource('folder')}>
            <span className="ic"><Icon name="folder" /></span>
            <span>
              <strong>Folder on this computer</strong>
              <span className="d">Build here or in AWS, then upload</span>
            </span>
          </button>}
          <button type="button" role="tab" aria-selected={source === 'github'} className={`source ${source === 'github' ? 'on' : ''}`} onClick={() => setSource('github')}>
            <span className="ic"><Icon name="github" /></span>
            <span>
              <strong>GitHub repository</strong>
              <span className="d">Pick one of yours or paste a link</span>
            </span>
          </button>
        </div>

        <div className="formcard">
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
              <div className="field" style={{ marginBottom: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: '0.84rem', marginBottom: '0.375rem' }}>Where to build</span>
                <div className="seg" role="radiogroup" aria-label="Where to build">
                  <label className={!remote ? 'on' : ''}>
                    <input type="radio" name="where" checked={!remote} onChange={() => setRemote(false)} />
                    <div className="t"><i />On this computer</div>
                    <div className="d">Fast; uses your local .env</div>
                  </label>
                  <label className={remote ? 'on' : ''}>
                    <input type="radio" name="where" checked={remote} onChange={() => setRemote(true)} />
                    <div className="t"><i />In your AWS account</div>
                    <div className="d">CodeBuild; uses saved variables</div>
                  </label>
                </div>
              </div>
            </>
          ) : (
            <>
              {!hostedMode && <GithubConnect selected={repo} onSession={onSession} onPick={pickRepo} />}
              <label className="field">
                <span>Repository link</span>
                <input
                  type="text"
                  value={repo}
                  onChange={(e) => {
                    setRepo(e.target.value);
                    setPicked(undefined);
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
                <p className="muted small" style={{ marginBottom: 0 }}>
                  {picked?.private && <strong>This repository is private, so deploying it once will fail without a token. Choose the second option. </strong>}
                  The build runs in your AWS account. Pushes do not redeploy; you can connect the repository later from the project&apos;s
                  GitHub tab. A private repository needs a token to be stored first: choose the second option once.
                </p>
              ) : (
                <>
                  {hostedMode ? (
                    <p className="muted small">Builds use the GitHub token stored in your AWS account. Store it once from your machine with <code>shipzy github connect</code>.</p>
                  ) : (
                    <label className="check">
                      <input type="checkbox" checked={reuse} onChange={(e) => setReuse(e.target.checked)} />
                      <span>Use the GitHub token already stored in my AWS account</span>
                    </label>
                  )}
                  {useLogin && (
                    <p className="muted small">
                      Using your GitHub login. The token is stored encrypted in your own AWS account so builds can fetch the code, and is
                      never shown or written to the log.
                    </p>
                  )}
                  {picked && !picked.admin && (
                    <div className="notice warn">
                      You are not an admin of {picked.repo}, so GitHub will not let the webhook be created: the first deploy works, but
                      pushes will not redeploy until an admin adds it.
                    </div>
                  )}
                  {!reuse && !useLogin && (
                    <label className="field" style={{ marginBottom: 0 }}>
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

        <div className="step" style={{ marginTop: '1.75rem' }}><b>02</b><h2>Name and address</h2></div>
        <div className="formcard">
          <label className="field">
            <span>Project name</span>
            <input type="text" value={project} onChange={(e) => setProject(e.target.value.toLowerCase())} placeholder="my-app" spellCheck={false} required />
            <small>Lowercase letters, digits and dashes. Deploying to an existing name adds a new version.</small>
          </label>

          <label className="field">
            <span>Serve at <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></span>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder={domains.length ? domains.join(', ') + ' (its domains)' : 'a hostname that already points at your stack'} spellCheck={false} />
            <small>
              {domains.length > 0
                ? 'Leave empty to update this project\'s domains.'
                : existing?.siteHost
                  ? `Leave empty to update this project's own address, ${existing.siteHost}.`
                  : 'Leave empty and the project gets an address of its own (a CloudFront link, created on its first deploy; that takes about 5 minutes once). Add a custom domain afterwards from its Domains tab.'}
            </small>
          </label>

          <details>
            <summary className="muted">Advanced: install and build commands</summary>
            <div style={{ marginTop: 10 }}>
              <label className="field">
                <span>Install command</span>
                <input type="text" value={install} onChange={(e) => setInstall(e.target.value)} placeholder="npm ci --legacy-peer-deps" spellCheck={false} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>Build command</span>
                <input type="text" value={build} onChange={(e) => setBuild(e.target.value)} placeholder="npm run build" spellCheck={false} />
              </label>
            </div>
          </details>
        </div>

        <ErrorNotice message={error} />
        <div className="actionbar">
          <button className="primary lg" disabled={busy || !NAME_RE.test(project)}>
            <Icon name="rocket" />
            {busy ? 'Starting...' : source === 'github' && mode === 'auto' ? 'Connect and deploy' : 'Deploy'}
          </button>
          <span className="muted small">{summary}</span>
        </div>
      </form>

      {picking && <FolderPicker start={dir.startsWith('/') ? dir : undefined} onClose={() => setPicking(false)} onPick={(p) => { setDir(p); setPicking(false); }} />}
      </div>

      <aside className="runcli" aria-label="The command this runs">
        <div className="t label">Runs the CLI</div>
        <pre><b>$</b> {typed.join(' \\\n    ')}</pre>
        <p>The dashboard runs exactly what you would type. You can follow the log live on the next screen.</p>
      </aside>
    </div>
  );
}
