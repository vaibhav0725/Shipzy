import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import { DeployerStack } from './deployer-stack';

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
