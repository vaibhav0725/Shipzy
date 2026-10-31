import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import { Construct } from 'constructs';

// CloudFront's managed "CachingOptimized" policy, the same one the main distribution uses.
const CACHING_OPTIMIZED = '658327ea-f89d-4fab-a63d-7e88639e58f6';

/**
 * One custom domain: a CloudFront distribution with its own certificate, in front of the main stack's sites
 * bucket. It reuses the main stack's router function (and through it the routing table) and Origin Access
 * Control, so the same `host -> deployment` entries that drive the default URL drive this one.
 *
 * The values it needs from the main stack are parameters, filled in by `shipzy domain add`.
 */
export class DomainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const domainName = new cdk.CfnParameter(this, 'DomainName', {
      type: 'String',
      description: 'The hostname to serve, e.g. blog.example.com or *.preview.example.com',
    });
    const certificateArn = new cdk.CfnParameter(this, 'CertificateArn', {
      type: 'String',
      description: 'ACM certificate (must be in us-east-1) covering the hostname',
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
        comment: cdk.Fn.sub('shipzy domain ${DomainName}'),
        aliases: [domainName.valueAsString],
        priceClass: 'PriceClass_100',
        httpVersion: 'http2',
        ipv6Enabled: true,
        viewerCertificate: {
          acmCertificateArn: certificateArn.valueAsString,
          sslSupportMethod: 'sni-only',
          minimumProtocolVersion: 'TLSv1.2_2021',
        },
        // A missing file is a 403 from the private bucket; show /404.html from the bucket root with a 404 status.
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
