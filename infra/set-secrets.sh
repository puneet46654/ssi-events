#!/usr/bin/env bash
# Copies the app secrets from SSM Parameter Store (/ssi-events/*) into the backend Lambda's environment.
# Run after changing a secret, e.g.:
#   aws ssm put-parameter --name /ssi-events/ADMIN_SESSION_SECRET --type SecureString --overwrite --value "$(openssl rand -hex 32)"
#   bash infra/set-secrets.sh
# The CI deploy role cannot read these; only an administrator runs this.
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash on Windows: keep /ssi-events/... and /aws/lambda/... literal
aws() { command aws "$@" | tr -d "\r"; }   # Windows AWS CLI ends lines with CRLF
export AWS_DEFAULT_REGION=ap-south-1
FUNCTION=ssi-events-api   # secrets belong to the backend only
PYTHON=$(python3 -c 'print(1)' >/dev/null 2>&1 && echo python3 || echo python)

current=$(aws lambda get-function-configuration --function-name "$FUNCTION" --query Environment.Variables --output json)
secrets=$(aws ssm get-parameters-by-path --path /ssi-events/ --with-decryption \
  --query 'Parameters[].[Name,Value]' --output json)

# Merge (secrets override) and write a request file, so values never appear on a command line.
"$PYTHON" - "$current" "$secrets" > .lambda-env.json <<'PY'
import json, sys
env = json.loads(sys.argv[1]) or {}
for name, value in json.loads(sys.argv[2]):
    env[name.rsplit('/', 1)[-1]] = value
print(json.dumps({"Variables": env}))
PY
trap 'rm -f .lambda-env.json' EXIT
aws lambda update-function-configuration --function-name "$FUNCTION" \
  --environment file://.lambda-env.json --query '[FunctionName,LastUpdateStatus]' --output text
aws lambda wait function-updated --function-name "$FUNCTION"
echo "Set: $("$PYTHON" -c 'import json,sys; print(", ".join(n.rsplit("/",1)[-1] for n,_ in json.loads(sys.argv[1])))' "$secrets")"
