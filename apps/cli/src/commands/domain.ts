import * as fs from 'node:fs';
import {
  assertProjectName,
  readManifest,
  routeTarget,
  setRoute,
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
  domainStackName,
  listDomainStacks,
  projectOfDomain,
  removeDomain,
  validateHost,
} from '../lib/domains.js';
import { table } from '../lib/format.js';
import { confirmByTyping } from '../lib/prompt.js';
import { findZone, upsertAlias, upsertCname } from '../lib/route53.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function printRecord(intro: string, rec: { type: string; name: string; value: string }): void {
  console.log(`\n${intro}\n  Type   ${rec.type}\n  Name   ${rec.name}\n  Value  ${rec.value}\n`);
}

const isApex = (host: string) => host.split('.').length === 2;

/** The deployment a newly added domain should start serving: the newest one that is live somewhere, else the newest. */
function deploymentToServe(manifest: { deployments: { id: string }[]; live: Record<string, string> }): string | undefined {
  const order = manifest.deployments.map((d) => d.id);
  const live = Object.values(manifest.live).sort((a, b) => order.indexOf(b) - order.indexOf(a));
  return live[0] ?? order.at(-1);
}

export interface DomainAddOptions {
  project: string;
  manual?: boolean;
  /** commander's --no-wait sets this to false */
  wait?: boolean;
}

export async function domainAdd(hostArg: string, opts: DomainAddOptions, global: GlobalOptions): Promise<void> {
  const host = validateHost(hostArg);
  assertProjectName(opts.project);
  const out = await getOutputs(global.stackName);
  if (!out.originDomain || !out.oacId || !out.routerFunctionArn) {
    throw new Error('This stack predates custom domains. Run `deployer init` to update it.');
  }
  const owner = await projectOfDomain(out.bucket, host);
  if (owner && owner !== opts.project) throw new Error(`${host} already belongs to project "${owner}". Remove it there first: deployer domain rm ${host}`);

  const zone = opts.manual ? undefined : await findZone(host);
  console.log(
    zone
      ? `DNS: using the Route 53 zone ${zone.name}; the records are created for you.`
      : 'DNS: no Route 53 zone for this domain in your account, so the records are printed for you to add.',
  );

  // 1. Certificate (CloudFront requires one in us-east-1)
  let certArn = await findCertificate(host);
  console.log(certArn ? 'Reusing the existing certificate.' : 'Requesting a certificate...');
  certArn ??= await requestCertificate(host);
  const cert = await waitForValidationRecord(certArn);

  if (cert.status !== 'ISSUED') {
    const rec: ValidationRecord = cert.validation!;
    if (zone) {
      await upsertCname(zone.id, rec.name, rec.value);
      console.log('Added the certificate validation record to Route 53.');
    } else {
      printRecord('Add this DNS record to prove you own the domain (keep it: the certificate renews through it):', rec);
      if (opts.wait === false) return console.log('Run the same command again once the record is in place.');
    }
    console.log('Waiting for the certificate (usually 1 to 10 minutes)...');
    const issued = await waitUntilIssued(certArn, 30 * 60_000, (secs) => {
      if (secs > 0 && secs % 60 < 15) console.log(`  still waiting (${Math.round(secs / 60)} min)`);
    });
    if (!issued) return console.log('The certificate is not issued yet. Run the same command again to continue.');
  }
  console.log('Certificate issued.');

  // 2. The distribution
  console.log(`Creating the distribution for ${host} (about 5 minutes)...`);
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
    tags: { 'deployer:stack': global.stackName, 'deployer:domain': host },
  });
  const distribution = outputs['DistributionDomain']!;

  // 3. Point the name at it
  if (zone) {
    await upsertAlias(zone.id, host, distribution);
    console.log(`Created the DNS alias ${host} -> ${distribution} in Route 53.`);
  } else {
    printRecord(`Point ${host} at CloudFront with this DNS record:`, { type: 'CNAME', name: host, value: `${distribution}.` });
    if (isApex(host)) {
      console.log('Note: many DNS providers (GoDaddy among them) cannot create a CNAME at the bare domain. Use a subdomain, or an ALIAS/ANAME record if yours offers one.');
    }
  }

  // 4. Claim it for the project and serve what is live now
  const manifest = await readManifest(out.bucket, opts.project);
  const id = deploymentToServe(manifest);
  if (id) await setRoute(out.kvsArn, host, routeTarget(opts.project, id));
  await updateManifest(out.bucket, opts.project, (m) => {
    m.domains = [...new Set([...(m.domains ?? []), host])];
    if (id) m.live[host] = id;
  });
  console.log(id ? `${host} now serves ${opts.project} (${id}).` : `${host} is ready; deploy ${opts.project} to put something on it.`);

  // 5. Wait for DNS to catch up
  if (opts.wait === false) return console.log(`Check later with: deployer domain verify ${host}`);
  console.log('Waiting for DNS to reach the distribution...');
  for (let waited = 0; waited <= 600; waited += 15) {
    if ((await checkDns(host, distribution)) === 'ok') return console.log(`\nLive: https://${host}`);
    await sleep(15_000);
  }
  console.log(`DNS has not reached the distribution yet (it can take a while). Check with: deployer domain verify ${host}`);
}

export async function domainList(opts: { project?: string; json?: boolean }, global: GlobalOptions): Promise<void> {
  const out = await getOutputs(global.stackName);
  const stacks = await listDomainStacks(global.stackName);
  const rows = [];
  for (const s of stacks) {
    const project = await projectOfDomain(out.bucket, s.host);
    if (opts.project && project !== opts.project) continue;
    const cert = s.certificateArn ? await describeCertificate(s.certificateArn).catch(() => undefined) : undefined;
    rows.push({
      host: s.host,
      project: project ?? '-',
      stack: s.status,
      certificate: cert?.status ?? '-',
      dns: s.distributionDomain ? await checkDns(s.host, s.distributionDomain) : 'pending',
      distribution: s.distributionDomain,
    });
  }
  if (opts.json) return console.log(JSON.stringify(rows, null, 2));
  if (rows.length === 0) return console.log('No custom domains. Add one with: deployer domain add <host> -p <project>');
  console.log(table(['HOST', 'PROJECT', 'STACK', 'CERTIFICATE', 'DNS'], rows.map((r) => [r.host, r.project, r.stack, r.certificate, r.dns])));
}

export async function domainVerify(hostArg: string, global: GlobalOptions): Promise<void> {
  const host = validateHost(hostArg);
  const out = await getOutputs(global.stackName);
  const stack = (await listDomainStacks(global.stackName)).find((s) => s.host === host);
  const project = await projectOfDomain(out.bucket, host);
  const cert = stack?.certificateArn ? await describeCertificate(stack.certificateArn) : undefined;
  const dns = stack?.distributionDomain ? await checkDns(host, stack.distributionDomain) : 'pending';

  const mark = (ok: boolean) => (ok ? 'ok     ' : 'MISSING');
  console.log(`${mark(Boolean(stack))} distribution stack ${stack ? `(${stack.status})` : '- run: deployer domain add ' + host + ' -p <project>'}`);
  console.log(`${mark(cert?.status === 'ISSUED')} certificate ${cert ? `(${cert.status})` : ''}`);
  console.log(`${mark(Boolean(project))} claimed by a project ${project ? `(${project})` : ''}`);
  console.log(`${mark(dns === 'ok')} DNS ${dns === 'ok' ? 'reaches the distribution' : dns === 'wrong' ? 'resolves, but not to this distribution' : 'is not visible yet'}`);
  if (stack?.distributionDomain && dns !== 'ok') {
    console.log(`\nThe record to have: ${host} CNAME ${stack.distributionDomain} (or an alias to it).`);
  }
  if (cert?.status === 'PENDING_VALIDATION' && cert.validation) {
    printRecord('The certificate is still waiting for this DNS record:', cert.validation);
  }
  if (dns === 'ok' && cert?.status === 'ISSUED' && project) console.log(`\nhttps://${host} is ready.`);
}

export async function domainRemove(hostArg: string, opts: { yes?: boolean }, global: GlobalOptions): Promise<void> {
  const host = validateHost(hostArg);
  const out = await getOutputs(global.stackName);
  const project = await projectOfDomain(out.bucket, host);
  const known = (await listDomainStacks(global.stackName)).some((s) => s.host === host);
  if (!known && !project && !(await findCertificate(host))) throw new Error(`${host} is not a domain of this stack.`);

  if (!opts.yes && !(await confirmByTyping(`This removes ${host}${project ? ` (served by ${project})` : ''}: its distribution, certificate and DNS records made by this tool.`, host))) {
    return console.log('Aborted.');
  }
  for (const line of await removeDomain(out, global, host)) console.log(line);
}
