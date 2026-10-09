# SSI Maya Connect — events.ssistudios.com

Event registration, slot booking, QR tickets and admin check-in for events hosted by SS Innovations.

This GitLab project (`naveen-ssi/ssi-events`) is the single source of truth for frontend, backend and infrastructure. Nothing reaches production without the owner merging a merge request into `main`.

| Folder | What | Owner |
| --- | --- | --- |
| `backend/` | API (`/api/*`): TypeScript on AWS Lambda, data in DynamoDB | SS Innovations |
| `frontend/` | Next.js website (pages, components) | Frontend developer, see `docs/frontend-developer-guide.md` |
| `infra/` | AWS setup and deploy scripts | SS Innovations |
| `docs/` | API contract, data model, developer guide | Shared |

## Architecture (all AWS, pay-per-request, nothing always on)

```
viewer ─► CloudFront E2YO5MY27AOEY1  (events.ssistudios.com, ACM TLS cert)
            ├─ /api/*           ─► Lambda ssi-events-api  (backend/, Node 24, arm64)
            │                        ├─► DynamoDB ssi-events       (on-demand, PITR, TTL)
            │                        └─► S3 ssi-studio-events       (event images)
            ├─ /_next/static/*  ─► S3 ssi-events-site-051826716001  (private, OAC)
            └─ everything else  ─► Lambda ssi-events-web  (frontend/, Next.js standalone + Lambda Web Adapter)
```

The app is only used when SS Innovations runs an event. Lambda and DynamoDB on-demand charge per request, so an idle site costs nothing. Event-scale traffic stays within the AWS free tiers. The fixed costs are the existing Route 53 zone and pennies for S3 storage and DynamoDB backups.

| Resource | ID / setting |
| --- | --- |
| AWS account / region | 051826716001 / ap-south-1 (CloudFront cert in us-east-1) |
| DNS | Route 53 zone ssistudios.com `Z07119773E1TU1SAAQGCF`, A/AAAA alias `events` → CloudFront |
| TLS | ACM `531ab18e-fd0a-43cf-86b6-eb9ea13a75a4` |
| CloudFront | `E2YO5MY27AOEY1`; cache policy `ssi-events-next` (honours origin `Cache-Control`, default no caching); OAC `ssi-events-s3` |
| Backend Lambda | `ssi-events-api`: nodejs24.x arm64, 512 MB, 25 s, reserved concurrency 50; role `ssi-events-api` (table + index CRUD, event-image bucket) |
| Frontend Lambda | `ssi-events-web`: nodejs24.x x86_64, 1024 MB, 30 s, reserved concurrency 100, Lambda Web Adapter v30; role `ssi-events-lambda` (logs only, no data access) |
| Database | DynamoDB `ssi-events`; see `docs/data-model.md` |
| Secrets | SSM SecureString `/ssi-events/ADMIN_SESSION_SECRET`, `/ssi-events/BOOKING_ACCESS_SECRET`; backend only |
| CI deploy role | `ssi-events-gitlab-deploy`: GitLab OIDC, `naveen-ssi/ssi-events` `main` only; can update the two functions' code, write `/_next/static/*` and `releases/*` in the site bucket, and invalidate the distribution. It can't read secrets or data. |
| Logs | CloudWatch `/aws/lambda/ssi-events-api`, `/aws/lambda/ssi-events-web`, kept 30 days |

`infra/setup-aws.sh` creates or updates all of the above. It's idempotent and safe to re-run.

## Release flow

1. A developer pushes a branch to this project and opens an MR into `main`.
2. The MR pipeline runs in parallel:
   - **backend:** typecheck, unit tests, bundle
   - **frontend:** unit tests, Next.js build
   Nothing is deployed.
3. The owner reviews and merges.
4. The `main` pipeline rebuilds and runs `infra/deploy.sh`:
   1. uploads static assets
   2. updates the backend Lambda, then the frontend Lambda
   3. invalidates CloudFront
   4. checks that `/events` returns 200 and that `/api/health` reports the new commit with the database `ACTIVE`

## Admin tasks

```bash
bash infra/setup-aws.sh       # (re)apply AWS infrastructure
bash infra/set-secrets.sh     # copy /ssi-events/* secrets from SSM into the backend Lambda
curl https://events.ssistudios.com/api/health
```

To roll back, revert the merge commit in GitLab. The revert goes through the same pipeline. Each release's zips are kept for 30 days under `s3://ssi-events-site-051826716001/releases/`.

## GitLab settings (owner, one-time)

- **Protect `main`:** allowed to merge = Maintainers, allowed to push = No one.
- **Add the frontend developer** as a Developer: they can push branches and open MRs, but can't merge to `main`.
- **Merge settings:** turn on "Pipelines must succeed".

## Status

- **Done:**
  - AWS foundation: CloudFront routing, DynamoDB table, backend Lambda with `/api/health`, frontend Lambda
  - MR-gated pipeline for both frontend and backend
  - docs
- **Next:** implement the planned endpoints in `backend/` (see `docs/api-contract.md`), point the frontend at them, then delete the legacy server code from `frontend/` (`app/api`, `models`, MongoDB/Redis/Socket.IO dependencies).
- **Data:** the table starts empty. Migration of the old MongoDB data is deferred.
- **Until the backend endpoints exist,** the site's pages load but every data call (events, bookings, admin) returns `404` from the new backend.
