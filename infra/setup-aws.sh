#!/usr/bin/env bash
# One-time (re-runnable) creation of the AWS stack for events.ssistudios.com.
# Account 051826716001, default CLI profile (IAM user naveen-ssi). Each step skips work already done.
#
#   viewer ─► CloudFront (events.ssistudios.com, ACM cert)
#               ├─ /_next/static/*  ─► S3 ssi-events-site-051826716001 (OAC, private)
#               └─ everything else  ─► Lambda function URL ─► ssi-events-web (Next.js standalone
#                                       via Lambda Web Adapter) ─► MongoDB Atlas, S3 ssi-studio-events
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash on Windows: keep /ssi-events/... and /aws/lambda/... literal
aws() { command aws "$@" | tr -d "\r"; }   # Windows AWS CLI ends lines with CRLF
cd "$(dirname "$0")"

ACCOUNT=051826716001
REGION=ap-south-1
DOMAIN=events.ssistudios.com
ZONE_ID=Z07119773E1TU1SAAQGCF
BUCKET=ssi-events-site-$ACCOUNT
FUNCTION=ssi-events-web
LAMBDA_ROLE=ssi-events-lambda
DEPLOY_ROLE=ssi-events-gitlab-deploy
ADAPTER_LAYER=arn:aws:lambda:$REGION:753240598075:layer:LambdaAdapterLayerX86:30   # Lambda Web Adapter 1.1.0
RUNTIME=nodejs24.x
export AWS_DEFAULT_REGION=$REGION
log() { printf '\n== %s\n' "$*"; }
PYTHON=$(python3 -c 'print(1)' >/dev/null 2>&1 && echo python3 || echo python)

log "S3 bucket $BUCKET (private; static assets + Lambda release zips)"
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint=$REGION >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file://bucket-lifecycle.json

log "Secrets in SSM Parameter Store (SecureString, free tier)"
for name in ADMIN_SESSION_SECRET BOOKING_ACCESS_SECRET; do
  if ! aws ssm get-parameter --name "/ssi-events/$name" >/dev/null 2>&1; then
    aws ssm put-parameter --name "/ssi-events/$name" --type SecureString \
      --value "$(openssl rand -hex 32)" >/dev/null
    echo "generated /ssi-events/$name"
  fi
done
aws ssm get-parameter --name /ssi-events/MONGODB_URI >/dev/null 2>&1 \
  || echo "NOTE: /ssi-events/MONGODB_URI not set yet; run infra/set-secrets.sh once Atlas is ready"

log "Lambda execution role $LAMBDA_ROLE"
if ! aws iam get-role --role-name "$LAMBDA_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$LAMBDA_ROLE" --assume-role-policy-document file://lambda-trust.json >/dev/null
  aws iam attach-role-policy --role-name "$LAMBDA_ROLE" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  sleep 10   # IAM propagation before Lambda can assume it
fi
aws iam put-role-policy --role-name "$LAMBDA_ROLE" --policy-name event-images \
  --policy-document file://lambda-role-policy.json

log "Lambda function $FUNCTION"
if ! aws lambda get-function --function-name "$FUNCTION" >/dev/null 2>&1; then
  # Placeholder code until the first pipeline deploy replaces it.
  tmp=.tmp-placeholder; rm -rf "$tmp"; mkdir "$tmp"
  printf '#!/bin/bash\nexec node placeholder.js\n' > "$tmp/run.sh"; chmod +x "$tmp/run.sh"
  cat > "$tmp/placeholder.js" <<'JS'
require('http').createServer((q, s) => { s.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); s.end('SSI Maya Connect is being set up.'); })
  .listen(process.env.PORT || 8080, '127.0.0.1');
JS
  # Python zipfile so run.sh keeps its executable bit even when run from Windows.
  "$PYTHON" - "$tmp" <<'PY'
import sys, zipfile
d = sys.argv[1]
with zipfile.ZipFile(f"{d}/placeholder.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for name, mode in (("run.sh", 0o755), ("placeholder.js", 0o644)):
        info = zipfile.ZipInfo(name); info.external_attr = (0o100000 | mode) << 16
        z.writestr(info, open(f"{d}/{name}", "rb").read())
PY
  aws lambda create-function --function-name "$FUNCTION" --runtime $RUNTIME --architectures x86_64 \
    --role "arn:aws:iam::$ACCOUNT:role/$LAMBDA_ROLE" --handler run.sh \
    --memory-size 1024 --timeout 30 --layers "$ADAPTER_LAYER" \
    --zip-file "fileb://$tmp/placeholder.zip" \
    --environment 'Variables={AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap,PORT=8080,HOSTNAME=127.0.0.1,NODE_ENV=production,AWS_LWA_READINESS_CHECK_PATH=/events,AWS_S3_BUCKET_NAME=ssi-studio-events,NEXT_TELEMETRY_DISABLED=1}' \
    --query FunctionArn --output text
  aws lambda wait function-active-v2 --function-name "$FUNCTION"
  rm -rf "$tmp"
fi
# Caps cost and MongoDB connections if the site is flooded (event-day load test peaked at 30 in flight).
aws lambda put-function-concurrency --function-name "$FUNCTION" --reserved-concurrent-executions 100 >/dev/null
aws logs create-log-group --log-group-name "/aws/lambda/$FUNCTION" 2>/dev/null || true
aws logs put-retention-policy --log-group-name "/aws/lambda/$FUNCTION" --retention-in-days 30

log "Function URL (public; CloudFront is the intended entry point)"
FN_URL=$(aws lambda get-function-url-config --function-name "$FUNCTION" --query FunctionUrl --output text 2>/dev/null \
  || aws lambda create-function-url-config --function-name "$FUNCTION" --auth-type NONE --query FunctionUrl --output text)
aws lambda add-permission --function-name "$FUNCTION" --statement-id public-url \
  --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
aws lambda add-permission --function-name "$FUNCTION" --statement-id public-url-invoke \
  --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
FN_HOST=$(echo "$FN_URL" | sed -E 's#https://([^/]+)/?#\1#')
echo "$FN_URL"

log "ACM certificate for $DOMAIN (us-east-1, DNS-validated)"
CERT_ARN=$(aws acm list-certificates --region us-east-1 \
  --query "CertificateSummaryList[?DomainName=='$DOMAIN'].CertificateArn | [0]" --output text)
if [ "$CERT_ARN" = None ]; then
  CERT_ARN=$(aws acm request-certificate --region us-east-1 --domain-name "$DOMAIN" \
    --validation-method DNS --query CertificateArn --output text)
  sleep 10
fi
read -r VNAME VVALUE < <(aws acm describe-certificate --region us-east-1 --certificate-arn "$CERT_ARN" \
  --query 'Certificate.DomainValidationOptions[0].ResourceRecord.[Name,Value]' --output text)
aws route53 change-resource-record-sets --hosted-zone-id $ZONE_ID --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",
  \"ResourceRecordSet\":{\"Name\":\"$VNAME\",\"Type\":\"CNAME\",\"TTL\":300,\"ResourceRecords\":[{\"Value\":\"$VVALUE\"}]}}]}" >/dev/null
echo "waiting for certificate validation..."
aws acm wait certificate-validated --region us-east-1 --certificate-arn "$CERT_ARN"
echo "$CERT_ARN"

log "CloudFront cache policy, origin access control"
POLICY_ID=$(aws cloudfront list-cache-policies --type custom \
  --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='ssi-events-next'].CachePolicy.Id | [0]" --output text)
if [ "$POLICY_ID" = None ]; then
  POLICY_ID=$(aws cloudfront create-cache-policy --cache-policy-config file://cache-policy.json --query CachePolicy.Id --output text)
fi
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='ssi-events-s3'].Id | [0]" --output text)
if [ "$OAC_ID" = None ]; then
  OAC_ID=$(aws cloudfront create-origin-access-control --origin-access-control-config \
    Name=ssi-events-s3,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3 \
    --query OriginAccessControl.Id --output text)
fi

log "CloudFront distribution"
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items[0]=='$DOMAIN'].Id | [0]" --output text)
if [ "$DIST_ID" = None ]; then
  sed -e "s#__FN_HOST__#$FN_HOST#; s#__BUCKET__#$BUCKET#; s#__OAC_ID__#$OAC_ID#; s#__CERT_ARN__#$CERT_ARN#; s#__POLICY_ID__#$POLICY_ID#; s#__REF__#ssi-events-$(date +%s)#" \
    dist-config.json > .dist-config.generated.json
  DIST_ID=$(aws cloudfront create-distribution --distribution-config file://.dist-config.generated.json --query Distribution.Id --output text)
fi
DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query Distribution.DomainName --output text)
echo "$DIST_ID $DIST_DOMAIN"

log "Bucket policy: CloudFront (this distribution only) may read"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"CloudFrontRead\",
  \"Effect\":\"Allow\",\"Principal\":{\"Service\":\"cloudfront.amazonaws.com\"},\"Action\":\"s3:GetObject\",
  \"Resource\":\"arn:aws:s3:::$BUCKET/_next/static/*\",
  \"Condition\":{\"StringEquals\":{\"AWS:SourceArn\":\"arn:aws:cloudfront::$ACCOUNT:distribution/$DIST_ID\"}}}]}"

log "DNS $DOMAIN -> CloudFront"
for type in A AAAA; do
  aws route53 change-resource-record-sets --hosted-zone-id $ZONE_ID --change-batch "{\"Changes\":[{\"Action\":\"UPSERT\",
    \"ResourceRecordSet\":{\"Name\":\"$DOMAIN\",\"Type\":\"$type\",\"AliasTarget\":{\"HostedZoneId\":\"Z2FDTNDATAQYW2\",
    \"DNSName\":\"$DIST_DOMAIN\",\"EvaluateTargetHealth\":false}}}]}" --query ChangeInfo.Id --output text
done

log "GitLab deploy role $DEPLOY_ROLE (OIDC, naveen-ssi/ssi-events main only)"
if ! aws iam get-role --role-name "$DEPLOY_ROLE" >/dev/null 2>&1; then
  aws iam create-role --role-name "$DEPLOY_ROLE" --assume-role-policy-document file://deploy-role-trust.json \
    --max-session-duration 3600 >/dev/null
fi
aws iam put-role-policy --role-name "$DEPLOY_ROLE" --policy-name deploy \
  --policy-document "$(sed "s#DISTRIBUTION_ID#$DIST_ID#" deploy-role-policy.json)"

log "Done. Put DISTRIBUTION_ID=$DIST_ID in .gitlab-ci.yml."
