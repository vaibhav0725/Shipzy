import { colorStatus, ui, uiErr } from '../lib/ui.js';
import * as fs from 'node:fs';
import {
  assertProjectName,
  readManifest,
  readPreviewBases,
  routeTarget,
  setRoute,
  updatePreviewBases,
  updateManifest,
} from '@deployer/core';
import {
  describeCertificate,
  findCertificate,
  requestCertificate,
  type ValidationRecord,
  waitForValidationRecord,
  waitUntilIssued,
} from '../lib/acm.js';
import { assetPath } from '../lib/assets.js';
import { getOutputs, GlobalOptions } from '../lib/aws.js';
import { deployStack } from '../lib/cfn.js';
import {
  checkDns,
  diagnoseRecord,
  domainOwners,
  domainStackName,
  listDomainStacks,
  projectOfDomain,
  removeDomain,
  validateHost,
} from '../lib/domains.js';
import { table } from '../lib/format.js';
import { confirmByTyping } from '../lib/prompt.js';
import { findZone, upsertAlias, upsertCname } from '../lib/route53.js';
import { isPreviewHost } from '@deployer/core';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The name without the main domain, as providers that add the domain themselves want it (assumes a two-label domain). */
function relativeName(name: string): string | undefined {
  const labels = name.replace(/\.$/, '').split('.');
  return labels.length > 3 ? labels.slice(0, -2).join('.') : undefined;
}

function printRecord(intro: string, rec: { type: string; name: string; value: string }): void {
  console.log(`\n${ui.bold(intro)}\n  ${ui.dim('Type ')}  ${rec.type}\n  ${ui.dim('Name ')}  ${ui.accent(rec.name)}\n  ${ui.dim('Value')}  ${ui.accent(rec.value)}`);
  const short = relativeName(rec.name);
  if (short) {
    console.log(
      ui.dim(`\n  Providers like GoDaddy and Namecheap add your main domain to the Name themselves. If yours does, enter only:\n  ${short}\n  (that assumes your main domain is ${rec.name.replace(/\.$/, '').split('.').slice(-2).join('.')}).`),
    );
  }
  console.log('');
}

/** A failed destroy may already have deleted the stack's storage; recovery commands carry on without it. */
const storageGone = (err: unknown): undefined => {
  if ((err as { name?: string }).name === 'NoSuchBucket') return undefined;
  throw err;
};

const isApex = (host: string) => host.split('.').length === 2;

/** The deployment a newly added domain should start serving: the newest one that is live somewhere, else the newest. */
function deploymentToServe(manifest: { deployments: { id: string }[]; live: Record<string, string> }): string | undefined {
  const order = manifest.deployments.map((d) => d.id);
  const live = Object.values(manifest.live).sort((a, b) => order.indexOf(b) - order.indexOf(a));
  return live[0] ?? order.at(-1);
}

export interface DomainAddOptions {
  project?: string;
  /** a wildcard domain that serves pull request previews instead of belonging to one project */
  preview?: boolean;
  manual?: boolean;
  /** commander's --no-wait sets this to false */
  wait?: boolean;
}

export async function domainAdd(hostArg: string, opts: DomainAddOptions, global: GlobalOptions): Promise<void> {
  const host = validateHost(hostArg, Boolean(opts.preview));
  if (opts.preview) {
    if (opts.project) throw new Error('A preview domain serves every project; drop -p.');
    if (!host.startsWith('*.')) throw new Error('A preview domain is a wildcard, e.g. "*.preview.example.com".');
  } else {
    if (!opts.project) throw new Error('Pass -p <project> (or --preview for a wildcard preview domain).');
    assertProjectName(opts.project);
  }
  const out = await getOutputs(global.stackName);
  if (!out.originDomain || !out.oacId || !out.routerFunctionArn) {
    throw new Error('This stack predates custom domains. Run `shipzy init` to update it.');
  }
  if (!opts.preview) {
    const owner = await projectOfDomain(out.bucket, host);
    if (owner && owner !== opts.project) throw new Error(`${host} already belongs to project "${owner}". Remove it there first: shipzy domain rm ${host}`);
    // Every name under a preview domain is made by the preview system.
    if (isPreviewHost(host, await readPreviewBases(out.bucket))) throw new Error(`${host} is under a preview domain, which is reserved for pull request previews.`);
  }

  const zone = opts.manual ? undefined : await findZone(host);
  console.log(
    zone
      ? `DNS: using the Route 53 zone ${zone.name}; the records are created for you.`
      : 'DNS: no Route 53 zone for this domain in your account, so the records are printed for you to add.',
  );

  // 1. Certificate (CloudFront requires one in us-east-1)
  let certArn = await findCertificate(host);
  console.log(certArn ? ui.ok('Reusing the existing certificate.') : ui.step('Requesting a certificate...'));
  certArn ??= await requestCertificate(host);
  const cert = await waitForValidationRecord(certArn);

  if (cert.status !== 'ISSUED') {
    const rec: ValidationRecord = cert.validation!;
    if (zone) {
      await upsertCname(zone.id, rec.name, rec.value);
      console.log(ui.ok('Added the certificate validation record to Route 53.'));
    } else {
      printRecord('Add this DNS record to prove you own the domain (keep it: the certificate renews through it):', rec);
      if (opts.wait === false) return console.log('Run the same command again once the record is in place.');
    }
    console.log(ui.step('Waiting for the certificate (usually 1 to 10 minutes)...'));
    let told = '';
    let checking = false;
    const issued = await waitUntilIssued(certArn, 30 * 60_000, (secs) => {
      if (!(secs > 0 && secs % 60 < 15)) return;
      console.log(ui.dim(`  still waiting (${Math.round(secs / 60)} min)`));
      // After a minute, look at public DNS: a record that is missing or stored under the wrong name is the usual cause.
      if (zone || secs < 60 || checking) return;
      checking = true;
      void diagnoseRecord(rec.name, rec.value)
        .then((d) => {
          if (d.state === 'extended' && told !== 'extended') {
            told = 'extended';
            console.warn(
              uiErr.yellow(
                `\n  The record exists, but at ${d.seenAt}: your DNS provider added "${d.extra}" to the name.\n` +
                  `  Edit the record so its Name is only: ${rec.name.replace(/\.$/, '').slice(0, rec.name.replace(/\.$/, '').length - d.extra.length - 1) }\n  The Value stays the same. This will continue by itself once it is fixed.\n`,
              ),
            );
          } else if (d.state === 'missing' && told === '' && secs >= 120) {
            told = 'missing';
            console.warn(uiErr.yellow(`\n  The validation record is not visible in public DNS yet. Check that you added it exactly as printed above (DNS can take a few minutes to appear).\n`));
          }
        })
        .finally(() => (checking = false));
    });
    if (!issued) return console.log('The certificate is not issued yet. Run the same command again to continue.');
  }
  console.log(ui.ok('Certificate issued.'));

  // 2. The distribution
  console.log(ui.step(`Creating the distribution for ${ui.name(host)} (about 5 minutes)...`));
  const { outputs } = await deployStack({
    name: domainStackName(global.stackName, host),
    templateBody: fs.readFileSync(assetPath('domain-template.json'), 'utf8'),
    parameters: {
      DomainName: host,
      CertificateArn: certArn,
      OriginDomainName: out.originDomain,
      OacId: out.oacId,
      RouterFunctionArn: out.routerFunctionArn,
    },
    // Tag values cannot contain "*".
    tags: { 'deployer:stack': global.stackName, 'deployer:domain': host.replace(/^\*\./, 'wildcard.') },
  });
  const distribution = outputs['DistributionDomain']!;

  // 3. Point the name at it
  if (zone) {
    await upsertAlias(zone.id, host, distribution);
    console.log(ui.ok(`Created the DNS alias ${ui.name(host)} -> ${distribution} in Route 53.`));
  } else {
    printRecord(`Point ${host} at CloudFront with this DNS record:`, { type: 'CNAME', name: host, value: `${distribution}.` });
    if (isApex(host)) {
      console.log('Note: many DNS providers (GoDaddy among them) cannot create a CNAME at the bare domain. Use a subdomain, or an ALIAS/ANAME record if yours offers one.');
    }
  }

  // 4. Claim it for the project and serve what is live now
  if (opts.preview) {
    await updatePreviewBases(out.bucket, (bases) => [...bases, host.slice(2)]);
    console.log(`${host} is ready for pull request previews. Turn them on for a project with: shipzy github connect -p <project> --repo <owner/name> --previews --reuse-token`);
    if (opts.wait === false) return console.log(`Check later with: shipzy domain verify ${host}`);
    return waitForDns(host, distribution);
  }
  const project = opts.project!;
  const manifest = await readManifest(out.bucket, project);
  const id = deploymentToServe(manifest);
  if (id) await setRoute(out.kvsArn, host, routeTarget(project, id));
  await updateManifest(out.bucket, project, (m) => {
    m.domains = [...new Set([...(m.domains ?? []), host])];
    if (id) m.live[host] = id;
  });
  console.log(id ? ui.ok(`${ui.name(host)} now serves ${ui.name(project!)} (${ui.dim(id)}).`) : ui.ok(`${ui.name(host)} is ready; deploy ${project} to put something on it.`));

  // 5. Wait for DNS to catch up
  if (opts.wait === false) return console.log(`Check later with: shipzy domain verify ${host}`);
  return waitForDns(host, distribution, true);
}

async function waitForDns(host: string, distribution: string, serving = false): Promise<void> {
  console.log(ui.step('Waiting for DNS to reach the distribution...'));
  for (let waited = 0; waited <= 600; waited += 15) {
    if ((await checkDns(host, distribution)) === 'ok') return console.log(serving ? `\n${ui.ok(ui.bold(ui.green('Live:')))} ${ui.url(`https://${host}`)}` : `\n${ui.ok(`DNS for ${host} is in place.`)}`);
    await sleep(15_000);
  }
  console.log(`DNS has not reached the distribution yet (it can take a while). Check with: shipzy domain verify ${host}`);
}

export async function domainList(opts: { project?: string; json?: boolean }, global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);
  const [stacks, bases, owners] = await Promise.all([listDomainStacks(global.stackName), readPreviewBases(out.bucket), domainOwners(out.bucket)]);
  const all = await Promise.all(
    stacks.map(async (s) => {
      const isBase = bases.includes(s.host.replace(/^\*\./, ''));
      const project = isBase ? undefined : owners.get(s.host);
      if (opts.project && project !== opts.project) return undefined;
      const [cert, dns] = await Promise.all([
        s.certificateArn ? describeCertificate(s.certificateArn).catch(() => undefined) : undefined,
        s.distributionDomain ? checkDns(s.host, s.distributionDomain) : 'pending',
      ]);
      return {
        host: s.host,
        project: project ?? (isBase ? '(previews)' : '-'),
        stack: s.status,
        certificate: cert?.status ?? '-',
        dns,
        distribution: s.distributionDomain,
      };
    }),
  );
  const rows = all.filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (opts.json) return console.log(JSON.stringify(rows, null, 2));
  if (rows.length === 0) return console.log('No custom domains. Add one with: shipzy domain add <host> -p <project>');
  console.log(table(['HOST', 'PROJECT', 'STACK', 'CERTIFICATE', 'DNS'], rows.map((r) => [ui.url(r.host), ui.name(r.project), colorStatus(r.stack), colorStatus(r.certificate), colorStatus(r.dns)])));
}

export async function domainVerify(hostArg: string, global: GlobalOptions): Promise<void> {
  const host = validateHost(hostArg, true);
  const out = await getOutputs(global.stackName);
  const stack = (await listDomainStacks(global.stackName)).find((s) => s.host === host);
  const isBase = host.startsWith('*.') && (await readPreviewBases(out.bucket)).includes(host.slice(2));
  const project = isBase ? '(previews)' : await projectOfDomain(out.bucket, host);
  const cert = stack?.certificateArn ? await describeCertificate(stack.certificateArn) : undefined;
  const dns = stack?.distributionDomain ? await checkDns(host, stack.distributionDomain) : 'pending';

  const mark = (ok: boolean) => (ok ? ui.green('ok     ') : ui.red('MISSING'));
  console.log(`${mark(Boolean(stack))} distribution stack ${stack ? `(${stack.status})` : '- run: shipzy domain add ' + host + ' -p <project>'}`);
  console.log(`${mark(cert?.status === 'ISSUED')} certificate ${cert ? `(${cert.status})` : ''}`);
  console.log(`${mark(Boolean(project))} ${isBase ? 'registered as a preview domain' : 'claimed by a project'} ${project && !isBase ? `(${project})` : ''}`);
  console.log(`${mark(dns === 'ok')} DNS ${dns === 'ok' ? 'reaches the distribution' : dns === 'wrong' ? 'resolves, but not to this distribution' : 'is not visible yet'}`);
  if (stack?.distributionDomain && dns !== 'ok') {
    console.log(`\nThe record to have: ${host} CNAME ${stack.distributionDomain} (or an alias to it).`);
  }
  if (cert?.status === 'PENDING_VALIDATION' && cert.validation) {
    printRecord('The certificate is still waiting for this DNS record:', cert.validation);
  }
  if (dns === 'ok' && cert?.status === 'ISSUED' && project) console.log(`\n${ui.ok(`${ui.url(`https://${host}`)} is ready.`)}`);
}

export async function domainRemove(hostArg: string, opts: { yes?: boolean }, global: GlobalOptions): Promise<void> {
  const host = validateHost(hostArg, true);
  // Also usable when a failed `destroy` left the stack in DELETE_FAILED, which is when leftovers must be removed.
  const out = await getOutputs(global.stackName, ['DELETE_FAILED']);
  const project = host.startsWith('*.') ? undefined : await projectOfDomain(out.bucket, host).catch(storageGone);
  const known = (await listDomainStacks(global.stackName)).some((s) => s.host === host);
  if (!known && !project && !(await findCertificate(host))) throw new Error(`${host} is not a domain of this stack.`);

  if (!opts.yes && !(await confirmByTyping(`This removes ${host}${project ? ` (served by ${project})` : host.startsWith('*.') ? ' and every pull request preview served on it' : ''}: its distribution, certificate and DNS records made by this tool.`, host))) {
    return console.log('Aborted.');
  }
  for (const line of await removeDomain(out, global, host)) console.log(line);
}
