#!/usr/bin/env bash
# One-time (re-runnable) creation of the AWS stack for events.ssistudios.com.
# Account 051826716001, default CLI profile (IAM user naveen-ssi). Each step skips work already done.
#
#   viewer ─► CloudFront (events.ssistudios.com, ACM cert)
#               ├─ /api/*           ─► Lambda ssi-events-api (backend/) ─► DynamoDB ssi-events, S3 ssi-studio-events
#               ├─ /_next/static/*  ─► S3 ssi-events-site-051826716001 (OAC, private)
#               └─ everything else  ─► Lambda ssi-events-web (frontend/, Next.js standalone via Lambda Web Adapter)
#
# Nothing here runs unless a request arrives: Lambda and DynamoDB on-demand bill per request.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash on Windows: keep /ssi-events/... and /aws/lambda/... literal
aws() { command aws "$@" | tr -d "\r"; }   # Windows AWS CLI ends lines with CRLF
cd "$(dirname "$0")"

ACCOUNT=051826716001
REGION=ap-south-1
DOMAIN=events.ssistudios.com
ZONE_ID=Z07119773E1TU1SAAQGCF
BUCKET=ssi-events-site-$ACCOUNT
TABLE=ssi-events
WEB_FUNCTION=ssi-events-web
WEB_ROLE=ssi-events-lambda
API_FUNCTION=ssi-events-api
API_ROLE=ssi-events-api
DEPLOY_ROLE=ssi-events-gitlab-deploy
ADAPTER_LAYER=arn:aws:lambda:$REGION:753240598075:layer:LambdaAdapterLayerX86:30   # Lambda Web Adapter 1.1.0
RUNTIME=nodejs24.x
export AWS_DEFAULT_REGION=$REGION
log() { printf '\n== %s\n' "$*"; }
PYTHON=$(python3 -c 'print(1)' >/dev/null 2>&1 && echo python3 || echo python)

# zip_files <zip> <dir> <name:mode>... — Python zipfile so file modes survive on Windows.
zip_files() {
  "$PYTHON" - "$@" <<'PY'
import sys, zipfile
out, d, *entries = sys.argv[1:]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for entry in entries:
        name, mode = entry.split(":")
        info = zipfile.ZipInfo(name); info.external_attr = (0o100000 | int(mode, 8)) << 16
        z.writestr(info, open(f"{d}/{name}", "rb").read())
PY
}

# ensure_role <name> — Lambda execution role with CloudWatch Logs access.
ensure_role() {
  if ! aws iam get-role --role-name "$1" >/dev/null 2>&1; then
    aws iam create-role --role-name "$1" --assume-role-policy-document file://lambda-trust.json \
      --tags Key=Project,Value=ssi-events >/dev/null
    aws iam attach-role-policy --role-name "$1" \
      --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    sleep 10   # IAM propagation before Lambda can assume it
  fi
}

# ensure_url <function> — public function URL (CloudFront is the intended entry point); prints its host.
ensure_url() {
  local url
  url=$(aws lambda get-function-url-config --function-name "$1" --query FunctionUrl --output text 2>/dev/null \
    || aws lambda create-function-url-config --function-name "$1" --auth-type NONE --query FunctionUrl --output text)
  aws lambda add-permission --function-name "$1" --statement-id public-url \
    --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE >/dev/null 2>&1 || true
  aws lambda add-permission --function-name "$1" --statement-id public-url-invoke \
    --action lambda:InvokeFunction --principal '*' --invoked-via-function-url >/dev/null 2>&1 || true
  echo "$url" | sed -E 's#https://([^/]+)/?#\1#'
}

# ensure_logs <function> — 30-day log retention.
ensure_logs() {
  aws logs create-log-group --log-group-name "/aws/lambda/$1" 2>/dev/null || true
  aws logs put-retention-policy --log-group-name "/aws/lambda/$1" --retention-in-days 30
}

log "S3 bucket $BUCKET (private; static assets + Lambda release zips)"
if ! aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  aws s3api create-bucket --bucket "$BUCKET" --create-bucket-configuration LocationConstraint=$REGION >/dev/null
fi
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-lifecycle-configuration --bucket "$BUCKET" --lifecycle-configuration file://bucket-lifecycle.json

log "DynamoDB table $TABLE (on-demand, TTL, point-in-time recovery, deletion protection)"
if ! aws dynamodb describe-table --table-name "$TABLE" >/dev/null 2>&1; then
  aws dynamodb create-table --cli-input-json file://dynamodb-table.json --query TableDescription.TableArn --output text
  aws dynamodb wait table-exists --table-name "$TABLE"
fi
[ "$(aws dynamodb describe-time-to-live --table-name "$TABLE" --query TimeToLiveDescription.TimeToLiveStatus --output text)" = ENABLED ] \
  || aws dynamodb update-time-to-live --table-name "$TABLE" --time-to-live-specification Enabled=true,AttributeName=ttl >/dev/null
aws dynamodb update-continuous-backups --table-name "$TABLE" \
  --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true,RecoveryPeriodInDays=35 >/dev/null

log "Secrets in SSM Parameter Store (SecureString, free tier)"
for name in ADMIN_SESSION_SECRET BOOKING_ACCESS_SECRET; do
  if ! aws ssm get-parameter --name "/ssi-events/$name" >/dev/null 2>&1; then
    aws ssm put-parameter --name "/ssi-events/$name" --type SecureString \
      --value "$(openssl rand -hex 32)" >/dev/null
    echo "generated /ssi-events/$name"
  fi
done

log "Backend: role $API_ROLE, function $API_FUNCTION (arm64)"
ensure_role "$API_ROLE"
aws iam put-role-policy --role-name "$API_ROLE" --policy-name app --policy-document file://api-role-policy.json
if ! aws lambda get-function --function-name "$API_FUNCTION" >/dev/null 2>&1; then
  tmp=.tmp-placeholder; rm -rf "$tmp"; mkdir "$tmp"
  cat > "$tmp/index.mjs" <<'JS'
export const handler = async () => ({ statusCode: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify({ success: false, error: 'Backend is being set up.' }) });
JS
  zip_files "$tmp/placeholder.zip" "$tmp" index.mjs:644
  aws lambda create-function --function-name "$API_FUNCTION" --runtime $RUNTIME --architectures arm64 \
    --role "arn:aws:iam::$ACCOUNT:role/$API_ROLE" --handler index.handler \
    --memory-size 512 --timeout 25 --zip-file "fileb://$tmp/placeholder.zip" \
    --environment "Variables={TABLE_NAME=$TABLE,NODE_OPTIONS=--enable-source-maps}" \
    --tags Project=ssi-events --query FunctionArn --output text
  aws lambda wait function-active-v2 --function-name "$API_FUNCTION"
  rm -rf "$tmp"
fi
# Caps cost if the site is flooded; well above the 30 concurrent bookings of the event-day load test.
aws lambda put-function-concurrency --function-name "$API_FUNCTION" --reserved-concurrent-executions 50 >/dev/null
ensure_logs "$API_FUNCTION"
API_HOST=$(ensure_url "$API_FUNCTION"); echo "$API_HOST"

log "Frontend: role $WEB_ROLE, function $WEB_FUNCTION"
ensure_role "$WEB_ROLE"
# The frontend holds no data access: everything goes through /api/* (the backend).
aws iam delete-role-policy --role-name "$WEB_ROLE" --policy-name event-images 2>/dev/null || true
if ! aws lambda get-function --function-name "$WEB_FUNCTION" >/dev/null 2>&1; then
  tmp=.tmp-placeholder; rm -rf "$tmp"; mkdir "$tmp"
  printf '#!/bin/bash\nexec node placeholder.js\n' > "$tmp/run.sh"
  cat > "$tmp/placeholder.js" <<'JS'
require('http').createServer((q, s) => { s.writeHead(503, { 'content-type': 'text/plain', 'cache-control': 'no-store' }); s.end('SSInnovations Events is being set up.'); })
  .listen(process.env.PORT || 8080, '127.0.0.1');
JS
  zip_files "$tmp/placeholder.zip" "$tmp" run.sh:755 placeholder.js:644
  aws lambda create-function --function-name "$WEB_FUNCTION" --runtime $RUNTIME --architectures x86_64 \
    --role "arn:aws:iam::$ACCOUNT:role/$WEB_ROLE" --handler run.sh \
    --memory-size 1024 --timeout 30 --layers "$ADAPTER_LAYER" \
    --zip-file "fileb://$tmp/placeholder.zip" \
    --environment 'Variables={AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap,PORT=8080,HOSTNAME=127.0.0.1,NODE_ENV=production,AWS_LWA_READINESS_CHECK_PATH=/events,NEXT_TELEMETRY_DISABLED=1}' \
    --tags Project=ssi-events --query FunctionArn --output text
  aws lambda wait function-active-v2 --function-name "$WEB_FUNCTION"
  rm -rf "$tmp"
fi
aws lambda put-function-concurrency --function-name "$WEB_FUNCTION" --reserved-concurrent-executions 100 >/dev/null
ensure_logs "$WEB_FUNCTION"
WEB_HOST=$(ensure_url "$WEB_FUNCTION"); echo "$WEB_HOST"

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
sed -e "s#__FN_HOST__#$WEB_HOST#; s#__API_HOST__#$API_HOST#; s#__BUCKET__#$BUCKET#; s#__OAC_ID__#$OAC_ID#; s#__CERT_ARN__#$CERT_ARN#; s#__POLICY_ID__#$POLICY_ID#g; s#__REF__#ssi-events-$(date +%s)#" \
  dist-config.json > .dist-config.generated.json
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items[0]=='$DOMAIN'].Id | [0]" --output text)
if [ "$DIST_ID" = None ]; then
  DIST_ID=$(aws cloudfront create-distribution --distribution-config file://.dist-config.generated.json --query Distribution.Id --output text)
else
  # Add any origins/behaviours from dist-config.json that the live distribution lacks (e.g. /api/*).
  aws cloudfront get-distribution-config --id "$DIST_ID" --output json > .dist-live.json
  if "$PYTHON" - <<'PY'
import json, sys
live = json.load(open('.dist-live.json'))
want = json.load(open('.dist-config.generated.json'))
cfg = live['DistributionConfig']
changed = False
# Add missing origins / behaviours; fields the template omits are copied from a live sibling.
origins = {o['Id']: o for o in cfg['Origins']['Items']}
for o in want['Origins']['Items']:
    if o['Id'] in origins:
        if origins[o['Id']]['DomainName'] != o['DomainName']:
            origins[o['Id']]['DomainName'] = o['DomainName']; changed = True
        continue
    sibling = next(x for x in cfg['Origins']['Items'] if ('CustomOriginConfig' in x) == ('CustomOriginConfig' in o))
    cfg['Origins']['Items'].append({**{k: v for k, v in sibling.items() if k not in ('Id', 'DomainName')}, **o})
    changed = True
cfg['Origins']['Quantity'] = len(cfg['Origins']['Items'])
behaviours = cfg.setdefault('CacheBehaviors', {'Quantity': 0, 'Items': []})
behaviours.setdefault('Items', [])
present = {b['PathPattern'] for b in behaviours['Items']}
for b in want['CacheBehaviors']['Items']:
    if b['PathPattern'] in present:
        continue
    base = {k: v for k, v in cfg['DefaultCacheBehavior'].items() if k not in ('TargetOriginId', 'CachePolicyId', 'OriginRequestPolicyId')}
    behaviours['Items'].append({**base, **b}); changed = True
behaviours['Quantity'] = len(behaviours['Items'])
json.dump(cfg, open('.dist-update.json', 'w'))
sys.exit(0 if changed else 1)
PY
  then
    ETAG=$("$PYTHON" -c "import json; print(json.load(open('.dist-live.json'))['ETag'])")
    aws cloudfront update-distribution --id "$DIST_ID" --if-match "$ETAG" \
      --distribution-config file://.dist-update.json --query Distribution.Status --output text
  else
    echo "distribution already up to date"
  fi
  rm -f .dist-live.json .dist-update.json
fi
rm -f .dist-config.generated.json
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

log "Done. DISTRIBUTION_ID=$DIST_ID (in .gitlab-ci.yml). Secrets: bash infra/set-secrets.sh"
