import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

/**
 * The dashboard, hosted in the owner's own AWS account (`shipzy dashboard --deploy`).
 *
 * Two functions share one code package (the dashboard server, the CLI and two small handlers):
 *  - web: answers browser requests through a Function URL. The page code itself checks the GitHub sign-in, and only
 *    the listed GitHub usernames get past it. It can read the account's shipzy state and start jobs; it cannot change anything.
 *  - worker: runs a job (a CLI command) in the background, which Lambda cannot do from the web function because that
 *    one is frozen once it has replied. This is the only function that can change things.
 *
 * Neither function can create IAM roles, users or keys, change the main stack, or reach anything outside shipzy's own
 * buckets, routing table, build project, secrets, and the per-project and per-domain stacks. This is deliberately
 * narrower than the CLI user's policy: a page on the internet should not hold `init`'s powers.
 *
 * The values it needs from the main stack are parameters, filled in by the CLI.
 */
export class DashboardStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const param = (name: string, description: string, def?: string) =>
      new cdk.CfnParameter(this, name, { type: 'String', description, ...(def === undefined ? {} : { default: def }) }).valueAsString;

    const mainStack = param('MainStackName', 'The main shipzy stack this dashboard manages');
    const codeBucket = param('CodeBucket', 'Bucket holding the code package');
    const codeKey = param('CodeKey', 'Key of the code package (uploaded by `shipzy dashboard --deploy`)');
    const sitesBucket = param('SitesBucket', 'The main stack\'s sites bucket');
    const buildsBucket = param('BuildsBucket', 'The main stack\'s builds bucket');
    const kvsArn = param('KvsArn', 'The routing table');
    const buildProject = param('BuildProject', 'The CodeBuild project');
    const engineFunction = param('EngineFunction', 'The engine function');
    const webhookSecretArn = param('WebhookSecretArn', 'The webhook secret');
    const githubTokenSecretArn = param('GithubTokenSecretArn', 'The stored GitHub token');
    const allowedUsers = param('AllowedUsers', 'Comma-separated GitHub usernames allowed to sign in');
    const publicHost = param('PublicHost', 'Custom domain the dashboard is reached at, if any', '');

    // Where jobs and their logs are kept. Short-lived on purpose.
    const jobs = new s3.Bucket(this, 'Jobs', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [{ id: 'expire-jobs', expiration: cdk.Duration.days(14), abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) }],
    });

    // Session signing key (generated here, never printed) and the GitHub OAuth App's id and secret (set by `--configure`).
    const secret = new secretsmanager.Secret(this, 'Auth', {
      secretName: cdk.Fn.sub('DeployerDashboardAuth-${AWS::StackName}'),
      generateSecretString: { secretStringTemplate: '{}', generateStringKey: 'sessionSecret', passwordLength: 48, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const lambdaTrust = new iam.ServicePrincipal('lambda.amazonaws.com');
    const webRole = new iam.Role(this, 'WebRole', { roleName: cdk.Fn.sub('${AWS::StackName}-web-role'), assumedBy: lambdaTrust });
    const workerRole = new iam.Role(this, 'WorkerRole', { roleName: cdk.Fn.sub('${AWS::StackName}-worker-role'), assumedBy: lambdaTrust });

    const acct = cdk.Aws.ACCOUNT_ID;
    const arn = (service: string, resource: string) => `arn:${cdk.Aws.PARTITION}:${service}:*:${acct}:${resource}`;
    const bucketArns = (bucket: string) => [`arn:${cdk.Aws.PARTITION}:s3:::${bucket}`, `arn:${cdk.Aws.PARTITION}:s3:::${bucket}/*`];
    const statement = (actions: string[], resources: string[]) => new iam.PolicyStatement({ actions, resources });

    // ---- What both functions may read ----
    const readStatements = [
      statement(['sts:GetCallerIdentity', 'cloudformation:ListStacks', 'cloudwatch:GetMetricData', 'logs:DescribeLogGroups'], ['*']),
      statement(['cloudformation:DescribeStacks'], [arn('cloudformation', 'stack/Deployer*/*')]),
      statement(['s3:ListBucket', 's3:GetObject', 's3:GetBucketLocation'], [...bucketArns(sitesBucket), ...bucketArns(buildsBucket)]),
      statement(['cloudfront-keyvaluestore:DescribeKeyValueStore', 'cloudfront-keyvaluestore:GetKey', 'cloudfront-keyvaluestore:ListKeys'], [kvsArn]),
      statement(['codebuild:ListBuildsForProject', 'codebuild:BatchGetBuilds'], [arn('codebuild', 'project/*')]),
      statement(['logs:GetLogEvents', 'logs:FilterLogEvents', 'logs:DescribeLogStreams'], [arn('logs', 'log-group:Deployer*'), arn('logs', 'log-group:Deployer*:*')]),
      statement(['ssm:GetParametersByPath', 'ssm:GetParameter', 'ssm:GetParameters'], [arn('ssm', 'parameter/deployer/*')]),
      statement(['acm:DescribeCertificate', 'acm:ListCertificates'], ['*']),
      statement(['route53:ListHostedZones', 'route53:GetChange', 'route53:ListResourceRecordSets'], ['*']),
      statement(['cloudfront:GetDistribution', 'cloudfront:ListDistributions'], ['*']),
    ];
    for (const s of readStatements) {
      webRole.addToPolicy(s);
      workerRole.addToPolicy(s);
    }

    // Neither function ever needs to read a project's variable values (the CLI lists names only), so make it impossible:
    // the values are encrypted, and this refuses to decrypt them (through Parameter Store) even if a function were taken over.
    for (const role of [webRole, workerRole]) {
      role.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.DENY,
          actions: ['kms:Decrypt'],
          resources: ['*'],
          // Only Parameter Store's decryptions: Secrets Manager (the sign-in secret, the GitHub token) must keep working.
          conditions: { StringLike: { 'kms:ViaService': 'ssm.*.amazonaws.com' } },
        }),
      );
    }

    // ---- Web: its jobs, the worker, and its own sign-in secret ----
    webRole.addToPolicy(statement(['s3:PutObject', 's3:GetObject', 's3:ListBucket'], [jobs.bucketArn, jobs.arnForObjects('*')]));
    webRole.addToPolicy(statement(['secretsmanager:GetSecretValue'], [secret.secretArn]));
    webRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [cdk.Fn.sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-*:*')],
      }),
    );

    // ---- Worker: the only function that changes things ----
    workerRole.addToPolicy(statement(['s3:PutObject', 's3:GetObject', 's3:ListBucket'], [jobs.bucketArn, jobs.arnForObjects('*')]));
    workerRole.addToPolicy(statement(['s3:PutObject', 's3:DeleteObject'], [`arn:${cdk.Aws.PARTITION}:s3:::${sitesBucket}/*`, `arn:${cdk.Aws.PARTITION}:s3:::${buildsBucket}/*`]));
    workerRole.addToPolicy(
      statement(['cloudfront-keyvaluestore:PutKey', 'cloudfront-keyvaluestore:DeleteKey', 'cloudfront-keyvaluestore:UpdateKeys'], [kvsArn]),
    );
    workerRole.addToPolicy(statement(['codebuild:StartBuild', 'codebuild:StopBuild'], [arn('codebuild', 'project/*')]));
    // Project and domain stacks only: the main stack (which owns the IAM roles) is out of reach.
    workerRole.addToPolicy(
      statement(
        ['cloudformation:CreateStack', 'cloudformation:UpdateStack', 'cloudformation:DeleteStack', 'cloudformation:DescribeStackEvents', 'cloudformation:DescribeStackResources', 'cloudformation:GetTemplate', 'cloudformation:TagResource', 'cloudformation:UntagResource'],
        [cdk.Fn.sub('arn:${AWS::Partition}:cloudformation:*:${AWS::AccountId}:stack/${Main}-site-*/*', { Main: mainStack }), cdk.Fn.sub('arn:${AWS::Partition}:cloudformation:*:${AWS::AccountId}:stack/${Main}-domain-*/*', { Main: mainStack })],
      ),
    );
    // What those stacks create and the CLI manages.
    workerRole.addToPolicy(
      statement(
        [
          'cloudfront:CreateDistribution', 'cloudfront:CreateDistributionWithTags', 'cloudfront:UpdateDistribution', 'cloudfront:DeleteDistribution',
          'cloudfront:GetDistributionConfig', 'cloudfront:TagResource', 'cloudfront:UntagResource', 'cloudfront:ListTagsForResource',
          'cloudfront:GetOriginAccessControl', 'cloudfront:GetFunction', 'cloudfront:DescribeFunction', 'cloudfront:DescribeKeyValueStore',
        ],
        ['*'],
      ),
    );
    workerRole.addToPolicy(statement(['acm:RequestCertificate', 'acm:DeleteCertificate', 'acm:AddTagsToCertificate'], ['*']));
    workerRole.addToPolicy(statement(['route53:ChangeResourceRecordSets'], ['arn:aws:route53:::hostedzone/*']));
    workerRole.addToPolicy(
      statement(['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue', 'secretsmanager:DescribeSecret'], [webhookSecretArn, githubTokenSecretArn]),
    );
    workerRole.addToPolicy(
      statement(['ssm:PutParameter', 'ssm:DeleteParameter', 'ssm:DeleteParameters', 'ssm:AddTagsToResource'], [arn('ssm', 'parameter/deployer/*')]),
    );
    workerRole.addToPolicy(statement(['lambda:InvokeFunction'], [cdk.Fn.sub('arn:${AWS::Partition}:lambda:*:${AWS::AccountId}:function:${Engine}', { Engine: engineFunction })]));
    workerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [cdk.Fn.sub('arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:/aws/lambda/${AWS::StackName}-*:*')],
      }),
    );

    const code = (key: string) => ({ s3Bucket: codeBucket, s3Key: key });
    const make = (name: string, suffix: string, handler: string, role: iam.Role, memory: number, timeout: number, env: Record<string, string>) => {
      const fn = new lambda.CfnFunction(this, name, {
        functionName: cdk.Fn.sub('${AWS::StackName}-' + suffix),
        runtime: 'nodejs22.x',
        handler,
        role: role.roleArn,
        memorySize: memory,
        timeout,
        ephemeralStorage: { size: 2048 },
        code: code(codeKey),
        environment: { variables: env },
      });
      const group = new logs.LogGroup(this, `${name}Logs`, {
        logGroupName: cdk.Fn.sub('/aws/lambda/${AWS::StackName}-' + suffix),
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
      fn.node.addDependency(group);
      return fn;
    };

    const shared = {
      SHIPZY_HOSTED: '1',
      SHIPZY_GLOBALS: cdk.Fn.sub('{"stackName":"${Main}"}', { Main: mainStack }),
      SHIPZY_JOBS_BUCKET: jobs.bucketName,
      SHIPZY_CLI: '/var/task/cli/shipzy.mjs',
      HOME: '/tmp',
    };

    const worker = make('Worker', 'worker', 'worker.handler', workerRole, 1024, 900, shared);
    // Lambda retries a failed asynchronous invocation; a retried job would run twice.
    new lambda.CfnEventInvokeConfig(this, 'WorkerNoRetry', {
      functionName: worker.ref,
      qualifier: '$LATEST',
      maximumRetryAttempts: 0,
    });

    const web = make('Web', 'web', 'web.handler', webRole, 1536, 60, {
      ...shared,
      SHIPZY_SECRET_ARN: secret.secretArn,
      SHIPZY_ALLOWED_USERS: allowedUsers,
      SHIPZY_PUBLIC_HOST: publicHost,
      SHIPZY_WORKER_FUNCTION: worker.ref,
    });
    webRole.addToPolicy(statement(['lambda:InvokeFunction'], [worker.attrArn]));

    // The page code is the access control: it only serves someone signed in with an allowed GitHub account.
    const url = new lambda.CfnUrl(this, 'Url', { targetFunctionArn: web.attrArn, authType: 'NONE' });
    new lambda.CfnPermission(this, 'UrlInvoke', {
      action: 'lambda:InvokeFunctionUrl',
      functionName: web.ref,
      principal: '*',
      functionUrlAuthType: 'NONE',
    });
    new lambda.CfnPermission(this, 'UrlInvokeFunction', {
      action: 'lambda:InvokeFunction',
      functionName: web.ref,
      principal: '*',
      invokedViaFunctionUrl: true,
    });

    new cdk.CfnOutput(this, 'DashboardUrl', { value: url.attrFunctionUrl });
    new cdk.CfnOutput(this, 'SecretArn', { value: secret.secretArn });
    new cdk.CfnOutput(this, 'JobsBucketName', { value: jobs.bucketName });
  }
}
