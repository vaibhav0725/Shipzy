import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';

// CloudFront's managed "CachingOptimized" policy, the same one the other distributions use.
const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';

/**
 * One project's own address: a CloudFront distribution with its default `dxxxx.cloudfront.net` name (no custom
 * domain, no certificate), in front of the main stack's sites bucket. Like a custom domain's distribution it reuses
 * the main stack's router function (and through it the routing table) and Origin Access Control, so a deploy only
 * has to point the distribution's own hostname at the new deployment.
 *
 * The values it needs from the main stack are parameters, filled in by the CLI the first time a project is deployed.
 */
export class SiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const projectName = new cdk.CfnParameter(this, 'ProjectName', {
      type: 'String',
      description: 'The project this address belongs to',
    });
    const originDomainName = new cdk.CfnParameter(this, 'OriginDomainName', {
      type: 'String',
      description: 'Regional domain name of the main stack\'s sites bucket',
    });
    const oacId = new cdk.CfnParameter(this, 'OacId', {
      type: 'String',
      description: 'Origin Access Control of the main stack',
    });
    const routerFunctionArn = new cdk.CfnParameter(this, 'RouterFunctionArn', {
      type: 'String',
      description: 'The main stack\'s router CloudFront Function',
    });

    const distribution = new cloudfront.CfnDistribution(this, 'Cdn', {
      distributionConfig: {
        enabled: true,
        comment: cdk.Fn.sub('shipzy project ${ProjectName}'),
        priceClass: 'PriceClass_100',
        httpVersion: 'http2',
        ipv6Enabled: true,
        viewerCertificate: { cloudFrontDefaultCertificate: true },
        // A missing file is a 403 from the private bucket. Show the site's own 404.html with a real 404 status.
        customErrorResponses: [403, 404].map((errorCode) => ({
          errorCode,
          responseCode: 404,
          responsePagePath: '/404.html',
          errorCachingMinTtl: 0,
        })),
        origins: [
          {
            id: 'sites',
            domainName: originDomainName.valueAsString,
            originAccessControlId: oacId.valueAsString,
            s3OriginConfig: { originAccessIdentity: '' },
          },
        ],
        defaultCacheBehavior: {
          targetOriginId: 'sites',
          viewerProtocolPolicy: 'redirect-to-https',
          cachePolicyId: CACHING_OPTIMIZED,
          compress: true,
          allowedMethods: ['GET', 'HEAD'],
          functionAssociations: [{ eventType: 'viewer-request', functionArn: routerFunctionArn.valueAsString }],
        },
      },
    });

    new cdk.CfnOutput(this, 'DistributionId', { value: distribution.ref });
    new cdk.CfnOutput(this, 'DistributionDomain', { value: distribution.attrDomainName });
  }
}
