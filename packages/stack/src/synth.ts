import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { DeployerStack } from './deployer-stack';
import { DomainStack } from './domain-stack';

// The stack has no file assets, so it needs no `cdk bootstrap`: we synthesize a
// plain CloudFormation template that the CLI deploys directly.
const app = new cdk.App({ analyticsReporting: false });
const stack = new DeployerStack(app, 'Deployer', {
  synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
});

const template = app.synth().getStackByName(stack.stackName).template;
const out = path.resolve(__dirname, '../../../apps/cli/assets/template.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(template) + '\n');
console.log(`Wrote ${path.relative(process.cwd(), out)}`);

// The build script is uploaded to the Builds bucket by `deployer init`, so it travels with the CLI.
fs.copyFileSync(path.resolve(__dirname, '../edge/build.sh'), path.resolve(path.dirname(out), 'build.sh'));

// One custom domain = one small stack of its own; the CLI fills in the parameters.
const domainApp = new cdk.App({ analyticsReporting: false });
const domainStack = new DomainStack(domainApp, 'DeployerDomain', {
  synthesizer: new cdk.DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
});
const domainTemplate = domainApp.synth().getStackByName(domainStack.stackName).template;
fs.writeFileSync(path.resolve(path.dirname(out), 'domain-template.json'), JSON.stringify(domainTemplate) + '\n');
