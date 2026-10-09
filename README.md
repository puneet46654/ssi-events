# ssi-events

Event registration, slot booking, QR tickets and check-in for SS Innovations events.
Production: https://events.ssistudios.com

| Path | Contents |
| --- | --- |
| `frontend/` | Next.js 16 site (attendee pages and admin) |
| `backend/` | API for `/api/*`: TypeScript, AWS Lambda, DynamoDB |
| `infra/` | AWS setup, packaging and deploy scripts |
| `docs/` | API contract, data model, frontend guide, project documentation (PDF/DOCX, source in `docs/build/`) |

## Local development

Requires Node 24.

```bash
cd backend && npm ci && npm run dev      # API on :4000, in-memory data
cd frontend && npm ci && npm run dev     # site on :3000, /api proxied to :4000
```

Admin: http://localhost:3000/admin/login, `admin` / `Dev-Password-1`. The local API uses an
in-memory table seeded with two sample events; no AWS access is needed.

Checks run in CI:

```bash
cd backend && npm run typecheck && npm test && npm run build && npm run smoke
cd frontend && npm test && npm run lint && npx next build
```

## Architecture

```
CloudFront (events.ssistudios.com)
 ├─ /api/*           → Lambda ssi-events-api   (backend/)  → DynamoDB ssi-events, S3 event images, SES
 ├─ /_next/static/*  → S3 site bucket
 └─ everything else  → Lambda ssi-events-web   (frontend/, Next.js standalone + Lambda Web Adapter)
```

Everything is on-demand; there are no always-on servers.

| Resource | Setting |
| --- | --- |
| Region | ap-south-1 (CloudFront certificate in us-east-1) |
| Backend Lambda | `ssi-events-api`, nodejs24.x arm64, 512 MB, 25 s |
| Frontend Lambda | `ssi-events-web`, nodejs24.x, 1024 MB, 30 s |
| Database | DynamoDB `ssi-events`, on-demand, PITR, TTL. See `docs/data-model.md` |
| Email | SES, sender `tickets@events.ssistudios.com` (DKIM, DMARC, custom MAIL FROM) |
| Secrets/config | SSM `/ssi-events/*`, copied to the backend Lambda by `infra/set-secrets.sh` |
| Deploy role | `ssi-events-gitlab-deploy`, GitLab OIDC, `main` of this project only |
| Logs | CloudWatch, 30 days |

`infra/setup-aws.sh` creates or updates the infrastructure; it is idempotent.

## Release

1. Push a branch and open an MR into `main`. The MR pipeline builds and tests both apps; nothing is deployed.
2. A maintainer merges. The `main` pipeline packages both apps and runs `infra/deploy.sh`: static assets to S3, both Lambdas updated, CloudFront invalidated, then `/` and `/api/health` checked against the new commit.

Rollback: revert the merge commit in GitLab. Release packages are kept under `releases/` in the site bucket.

## Operations

```bash
bash infra/setup-aws.sh                                             # apply infrastructure
bash infra/set-secrets.sh                                           # push SSM values to the backend Lambda
cd backend && npx tsx scripts/create-admin.ts --username <id> --name "<name>" [--email <email>]   # create superadmin
cd backend && npx tsx scripts/create-admin.ts --username <id> --reset                             # reset password
curl https://events.ssistudios.com/api/health
```

`create-admin.ts` needs AWS credentials, prints the generated password once and stores only its scrypt hash.
There are no built-in admin accounts.

## Repository settings

- `main` protected: merge by Maintainers, push by no one; pipelines must succeed.
- Frontend developers: Developer role (push branches, open MRs).
