import { paramsOf } from '../lib/cfn.js';
import { findStack, GlobalOptions, readOutputs } from '../lib/aws.js';
import { formatBytes, table } from '../lib/format.js';
import { listDomainStacks } from '../lib/domains.js';
import { priceUsage, projectUsage, type Usage } from '../lib/pricing.js';
import { listSiteStacks } from '../lib/sites.js';
import { ui } from '../lib/ui.js';
import { bucketBytes, buildMinutesSince, cloudfrontTraffic } from '../lib/usage.js';

const usd = (n: number) => (n < 0.005 ? '$0.00' : `$${n.toFixed(2)}`);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export async function cost(opts: { json?: boolean }, global: GlobalOptions): Promise<void> {
  const stack = await findStack(global.stackName);
  if (!stack) throw new Error(`Stack "${global.stackName}" not found. Run \`shipzy init\` first.`);
  const out = readOutputs(stack);

  // AWS bills in UTC calendar months.
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const day = now.getUTCDate();

  const [sites, domains] = await Promise.all([listSiteStacks(global.stackName), listDomainStacks(global.stackName)]);
  const addresses: { label: string; distributionId: string }[] = [
    { label: 'default address', distributionId: out.distributionId },
    ...sites.flatMap((s) => (s.distributionId ? [{ label: s.project, distributionId: s.distributionId }] : [])),
    ...domains.flatMap((d) => (d.distributionId ? [{ label: d.host, distributionId: d.distributionId }] : [])),
  ];

  const [perAddress, stored, buildMinutes] = await Promise.all([
    Promise.all(addresses.map(async (a) => ({ ...a, ...(await cloudfrontTraffic([a.distributionId], start, now)) }))),
    bucketBytes([out.bucket, ...(out.buildsBucket ? [out.buildsBucket] : [])]),
    buildMinutesSince(out.buildProject, start),
  ]);

  const usage: Usage = {
    requests: perAddress.reduce((n, a) => n + a.requests, 0),
    bytesOut: perAddress.reduce((n, a) => n + a.bytesOut, 0),
    bytesStored: stored,
    buildMinutes,
    secrets: [out.webhookSecretArn, out.githubTokenSecretArn].filter(Boolean).length,
  };
  const sofar = priceUsage(usage);
  const forecast = priceUsage(projectUsage(usage, day, daysInMonth));
  const sum = (lines: typeof sofar, pick: 'gross' | 'net') => lines.reduce((n, l) => n + l[pick], 0);

  if (opts.json) {
    return console.log(
      JSON.stringify(
        {
          month: `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`,
          currency: 'USD',
          usage,
          lines: sofar.map((l, i) => ({ ...l, projectedNet: forecast[i]!.net })),
          monthToDate: { gross: sum(sofar, 'gross'), net: sum(sofar, 'net') },
          projectedMonth: { gross: sum(forecast, 'gross'), net: sum(forecast, 'net') },
          addresses: perAddress,
          spendingAlert: paramsOf(stack)['BudgetEmail'] && Number(paramsOf(stack)['BudgetLimit'] ?? 0) > 0 ? { limit: Number(paramsOf(stack)['BudgetLimit']), email: paramsOf(stack)['BudgetEmail'] } : null,
          note: 'Estimate from CloudWatch metrics and list prices; free allowances are shared by the whole AWS account.',
        },
        null,
        2,
      ),
    );
  }

  console.log(ui.bold(`${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}, day ${day} of ${daysInMonth}`));
  console.log('');
  console.log(
    table(
      ['', 'Used so far', 'Cost so far', 'Whole month'],
      sofar.map((l, i) => [l.label, l.usage, usd(l.net), usd(forecast[i]!.net)]),
    ),
  );
  console.log('');
  console.log(`${ui.dim('Estimated so far'.padEnd(18))}${ui.bold(usd(sum(sofar, 'net')))}`);
  console.log(`${ui.dim('Estimated month'.padEnd(18))}${ui.bold(usd(sum(forecast, 'net')))}${ui.dim('   if the rest of the month looks like this one')}`);
  if (sum(sofar, 'gross') - sum(sofar, 'net') > 0.005) {
    console.log(ui.dim(`${''.padEnd(18)}${usd(sum(sofar, 'gross') - sum(sofar, 'net'))} so far is covered by the free allowances`));
  }

  const busy = perAddress.filter((a) => a.requests > 0).sort((a, b) => b.bytesOut - a.bytesOut);
  if (busy.length > 1) {
    console.log('');
    console.log(table(['Traffic by address', 'Requests', 'Sent'], busy.map((a) => [a.label, a.requests.toLocaleString('en-US'), formatBytes(a.bytesOut)])));
  }
  const alertLimit = Number(paramsOf(stack)['BudgetLimit'] ?? 0);
  console.log('');
  console.log(
    alertLimit > 0
      ? `${ui.dim('Spending alert')} $${alertLimit} a month, emailed to ${paramsOf(stack)['BudgetEmail']}`
      : `${ui.dim('Spending alert')} none from shipzy (a budget set in the AWS console works just as well). AWS has no spending cap; to add one: ${ui.accent('shipzy init --budget 25 --budget-email you@example.com')}`,
  );
  console.log('');
  console.log(ui.dim('An estimate from CloudWatch metrics and AWS list prices (US/Europe rates). CloudFront reports with a delay of'));
  console.log(ui.dim('a few minutes, the free allowances are shared by your whole AWS account, and Route 53 zones ($0.50 each) are not counted.'));
  console.log(ui.dim('Your AWS Billing page is the exact figure.'));
}
