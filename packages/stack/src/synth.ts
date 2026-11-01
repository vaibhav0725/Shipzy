import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { ShipzyStack } from './shipzy-stack';
import { DomainStack } from './domain-stack';
import { SiteStack } from './site-stack';
import { DashboardStack } from './dashboard-stack';

// The stack has no file assets, so it needs no `cdk bootstrap`: we synthesize a
// plain CloudFormation template that the CLI deploys directly.
const app = new cdk.App({ analyticsReporting: false });
const stack = new ShipzyStack(app, 'Deployer', {
  synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
});

const template = app.synth().getStackByName(stack.stackName).template;
const out = path.resolve(__dirname, '../../../apps/cli/assets/template.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(template) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), out)}`);

// The build script is uploaded to the Builds bucket by `shipzy init`, so it travels with the CLI. The framework
// detection (packages/core/src/framework.ts, bundled by the engine build) is embedded in it, so the script stays one file.
const detect = fs.readFileSync(path.resolve(path.dirname(out), 'detect.cjs'), 'utf8');
if (detect.split('\n').includes('DETECT_EOF')) throw new Error('detect.cjs contains the heredoc terminator.');
const buildScript = fs.readFileSync(path.resolve(__dirname, '../edge/build.sh'), 'utf8');
if (!buildScript.includes('# @@DETECT_JS@@')) throw new Error('build.sh has no # @@DETECT_JS@@ placeholder.');
fs.writeFileSync(
  path.resolve(path.dirname(out), 'build.sh'),
  buildScript.replace('# @@DETECT_JS@@', () => `cat > /tmp/detect.cjs <<'DETECT_EOF'\n${detect.trimEnd()}\nDETECT_EOF`),
);

// The fallback 404 page `shipzy init` puts at the root of the sites bucket.
fs.copyFileSync(path.resolve(__dirname, '../edge/not-found.html'), path.resolve(path.dirname(out), 'not-found.html'));

// One custom domain = one small stack of its own; the CLI fills in the parameters.
const domainApp = new cdk.App({ analyticsReporting: false });
const domainStack = new DomainStack(domainApp, 'DeployerDomain', {
  synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
});
const domainTemplate = domainApp.synth().getStackByName(domainStack.stackName).template;
fs.writeFileSync(path.resolve(path.dirname(out), 'domain-template.json'), JSON.stringify(domainTemplate) + '\n');

// One project address = one small stack of its own; the CLI fills in the parameters.
const siteApp = new cdk.App({ analyticsReporting: false });
const siteStack = new SiteStack(siteApp, 'DeployerSite', {
  synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
});
const siteTemplate = siteApp.synth().getStackByName(siteStack.stackName).template;
fs.writeFileSync(path.resolve(path.dirname(out), 'site-template.json'), JSON.stringify(siteTemplate) + '\n');

// The hosted dashboard (`shipzy dashboard --deploy`); the CLI fills in the parameters.
const dashboardApp = new cdk.App({ analyticsReporting: false });
const dashboardStack = new DashboardStack(dashboardApp, 'DeployerDashboard', {
  synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
});
const dashboardTemplate = dashboardApp.synth().getStackByName(dashboardStack.stackName).template;
fs.writeFileSync(path.resolve(path.dirname(out), 'dashboard-template.json'), JSON.stringify(dashboardTemplate) + '\n');
