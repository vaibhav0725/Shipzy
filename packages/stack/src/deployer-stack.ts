import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

// Stands in for the engine code until `deployer init` has uploaded the real zip (see EngineKey).
const ENGINE_PLACEHOLDER =
  "exports.promote = exports.webhook = async () => { throw new Error('Engine code is not installed yet. Run: deployer init'); };";

export class DeployerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'Sites', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const routes = new cloudfront.KeyValueStore(this, 'Routes', {
      comment: 'host -> deployment prefix',
    });

    const router = new cloudfront.Function(this, 'Router', {
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.resolve(__dirname, '../edge/router.js'),
      }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      keyValueStore: routes,
    });

    // CDK derives these two physical names from the construct path, so they are identical in every stack and a
    // second stack (`--stack-name`) in the same account would collide. A stack called "Deployer" keeps its
    // original names, because changing them would replace the routing table and wipe its routes.
    const isDefaultStack = new cdk.CfnCondition(this, 'IsDefaultStackName', {
      expression: cdk.Fn.conditionEquals(cdk.Aws.STACK_NAME, 'Deployer'),
    });
    (routes.node.defaultChild as cloudfront.CfnKeyValueStore).addPropertyOverride('Name', {
      'Fn::If': [isDefaultStack.logicalId, 'DeployerRoutesDF7DC447', { 'Fn::Sub': '${AWS::StackName}-routes' }],
    });
    (router.node.defaultChild as cloudfront.CfnFunction).addPropertyOverride('Name', {
      'Fn::If': [
        isDefaultStack.logicalId,
        { 'Fn::Join': ['', [{ Ref: 'AWS::Region' }, 'DeployerRouterD968BC17']] },
        { 'Fn::Sub': '${AWS::StackName}-router' },
      ],
    });

    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'deployer static sites',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          { function: router, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
    });

    // The distribution's Origin Access Control is account-global by name as well (see above).
    const oac = this.node.findAll().find((c): c is cloudfront.CfnOriginAccessControl => c instanceof cloudfront.CfnOriginAccessControl);
    oac?.addPropertyOverride('OriginAccessControlConfig.Name', {
      'Fn::If': [
        isDefaultStack.logicalId,
        'DeployerCdnOrigin1S3OriginAccessControl657ACE9E',
        { 'Fn::Sub': '${AWS::StackName}-oac' },
      ],
    });

    // ---- Builds: remote builds, GitHub webhook, and the engine that promotes a finished build ----

    // The Lambda code is a zip in the Builds bucket, uploaded by `deployer init` after the bucket
    // exists, so the stack needs no `cdk bootstrap` and no asset publishing.
    const engineKey = new cdk.CfnParameter(this, 'EngineKey', {
      type: 'String',
      default: '',
      description: 'S3 key (in the Builds bucket) of the engine zip; set by `deployer init`',
    });
    const hasEngine = new cdk.CfnCondition(this, 'HasEngine', {
      expression: cdk.Fn.conditionNot(cdk.Fn.conditionEquals(engineKey.valueAsString, '')),
    });

    const builds = new s3.Bucket(this, 'Builds', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      lifecycleRules: [
        // Uploaded sources are only needed while a build runs. `engine/` is deliberately not expired.
        {
          id: 'expire-sources',
          prefix: 'src/',
          expiration: cdk.Duration.days(7),
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(1),
        },
      ],
    });

    const webhookSecret = new secretsmanager.Secret(this, 'WebhookSecret', {
      description: 'Shared secret GitHub signs push webhooks with',
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    // Created with a throwaway value; `deployer github connect` replaces it with the user's token.
    const githubToken = new secretsmanager.Secret(this, 'GithubToken', {
      description: 'GitHub token used to clone private repositories',
      generateSecretString: { passwordLength: 16, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const lambdaCode = (key: string) =>
      ({
        'Fn::If': [
          hasEngine.logicalId,
          { S3Bucket: builds.bucketName, S3Key: key },
          { ZipFile: ENGINE_PLACEHOLDER },
        ],
      }) as unknown;

    const makeFunction = (id: string, suffix: string, handler: string, memory: number, timeout: number, env: Record<string, string>) => {
      const name = cdk.Fn.sub('${AWS::StackName}-' + suffix);
      const fn = new lambda.Function(this, id, {
        functionName: name,
        runtime: lambda.Runtime.NODEJS_22_X,
        handler,
        code: lambda.Code.fromInline(ENGINE_PLACEHOLDER),
        memorySize: memory,
        timeout: cdk.Duration.seconds(timeout),
        environment: env,
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          logGroupName: cdk.Fn.sub('/aws/lambda/${AWS::StackName}-' + suffix),
          retention: logs.RetentionDays.TWO_WEEKS,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
        }),
      });
      (fn.node.defaultChild as lambda.CfnFunction).addPropertyOverride('Code', lambdaCode(engineKey.valueAsString));
      return fn;
    };

    // Promotes a finished build: points the host at it, records it, prunes old deployments.
    const engine = makeFunction('Engine', 'engine', 'index.promote', 512, 300, {
      SITES_BUCKET: bucket.bucketName,
      KVS_ARN: routes.keyValueStoreArn,
      DEFAULT_HOST: distribution.distributionDomainName,
    });
    bucket.grantReadWrite(engine);
    engine.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'cloudfront-keyvaluestore:DescribeKeyValueStore',
          'cloudfront-keyvaluestore:GetKey',
          'cloudfront-keyvaluestore:ListKeys',
          'cloudfront-keyvaluestore:PutKey',
          'cloudfront-keyvaluestore:DeleteKey',
        ],
        resources: [routes.keyValueStoreArn],
      }),
    );

    const buildSpec = codebuild.BuildSpec.fromObject({
      version: '0.2',
      env: { shell: 'bash' },
      phases: {
        install: { 'runtime-versions': { nodejs: 22 } },
        // The script lives in the Builds bucket (uploaded by `deployer init`) so CodeBuild never echoes
        // it into build logs or failure messages.
        build: {
          commands: ['aws s3 cp "s3://$BUILDS_BUCKET/scripts/build.sh" /tmp/build.sh --only-show-errors', 'bash /tmp/build.sh'],
        },
      },
    });
    const project = new codebuild.Project(this, 'Build', {
      description: 'Builds a React project and uploads it as a new deployment',
      buildSpec,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      timeout: cdk.Duration.minutes(15),
      logging: {
        cloudWatch: {
          logGroup: new logs.LogGroup(this, 'BuildLogs', {
            retention: logs.RetentionDays.TWO_WEEKS,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          }),
        },
      },
      environmentVariables: {
        SITES_BUCKET: { value: bucket.bucketName },
        BUILDS_BUCKET: { value: builds.bucketName },
        ENGINE_FUNCTION: { value: engine.functionName },
        GITHUB_TOKEN_SECRET: { value: githubToken.secretArn },
        DEFAULT_HOST: { value: distribution.distributionDomainName },
      },
    });
    bucket.grantReadWrite(project);
    builds.grantRead(project, 'src/*');
    builds.grantRead(project, 'scripts/*');
    // Project environment variables are injected by CodeBuild from SSM Parameter Store (see `deployer env`).
    project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameters'],
        resources: [cdk.Stack.of(this).formatArn({ service: 'ssm', resource: 'parameter', resourceName: 'deployer/' + cdk.Aws.STACK_NAME + '/*' })],
      }),
    );
    engine.grantInvoke(project);
    githubToken.grantRead(project);

    // Receives GitHub push events. The URL is public; the HMAC signature is the access control.
    const webhook = makeFunction('Webhook', 'webhook', 'index.webhook', 256, 30, {
      SITES_BUCKET: bucket.bucketName,
      BUILD_PROJECT: project.projectName,
      WEBHOOK_SECRET_ARN: webhookSecret.secretArn,
      STACK_NAME: cdk.Aws.STACK_NAME,
    });
    bucket.grantRead(webhook, '.deployer/*');
    webhookSecret.grantRead(webhook);
    webhook.addToRolePolicy(new iam.PolicyStatement({ actions: ['codebuild:StartBuild'], resources: [project.projectArn] }));
    const webhookUrl = webhook.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.NONE });

    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
    new cdk.CfnOutput(this, 'KeyValueStoreArn', { value: routes.keyValueStoreArn });
    new cdk.CfnOutput(this, 'BuildsBucketName', { value: builds.bucketName });
    new cdk.CfnOutput(this, 'BuildProjectName', { value: project.projectName });
    new cdk.CfnOutput(this, 'EngineFunctionName', { value: engine.functionName });
    new cdk.CfnOutput(this, 'WebhookUrl', { value: webhookUrl.url });
    new cdk.CfnOutput(this, 'WebhookSecretArn', { value: webhookSecret.secretArn });
    new cdk.CfnOutput(this, 'GithubTokenSecretArn', { value: githubToken.secretArn });  }
}
