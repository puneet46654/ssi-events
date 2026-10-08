#!/usr/bin/env bash
# Copies the latest frontend from GitHub into site/ on branch frontend-sync
# and opens a merge request into main. Nothing is deployed until the MR is merged.
set -euo pipefail

: "${FRONTEND_REPO:?}" "${FRONTEND_REF:?}" "${SYNC_PUSH_TOKEN:?set SYNC_PUSH_TOKEN (masked CI variable)}"
SYNC_BRANCH=frontend-sync
UPSTREAM_DIR=$(mktemp -d)

git clone --depth 1 --branch "$FRONTEND_REF" "$FRONTEND_REPO" "$UPSTREAM_DIR"
UPSTREAM_SHA=$(git -C "$UPSTREAM_DIR" rev-parse HEAD)
UPSTREAM_SUMMARY=$(git -C "$UPSTREAM_DIR" log -1 --format='%an, %ad: %s' --date=iso)

git config user.name "Frontend sync"
git config user.email "noreply@gitlab.com"
git fetch origin main
git checkout -B "$SYNC_BRANCH" origin/main

rm -rf site
mkdir site
git -C "$UPSTREAM_DIR" archive HEAD | tar -x -C site

git add -A site
if git diff --cached --quiet; then
  echo "site/ already matches $FRONTEND_REPO@$UPSTREAM_SHA — nothing to review."
  exit 0
fi

git commit -m "Frontend update from GitHub @ ${UPSTREAM_SHA:0:7}" \
  -m "Source: $FRONTEND_REPO@$UPSTREAM_SHA" -m "$UPSTREAM_SUMMARY"

# Push options open the MR (or update the existing one) without needing API access.
git push --force "https://oauth2:${SYNC_PUSH_TOKEN}@gitlab.com/${CI_PROJECT_PATH}.git" "HEAD:refs/heads/$SYNC_BRANCH" \
  -o merge_request.create \
  -o merge_request.target=main \
  -o merge_request.remove_source_branch \
  -o "merge_request.title=Frontend update from GitHub (review before it goes live)" \
  -o "merge_request.description=Latest: $FRONTEND_REPO/commit/$UPSTREAM_SHA — $UPSTREAM_SUMMARY. Merging deploys to $SITE_URL."
