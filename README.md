# SSI Maya Connect — events.ssistudios.com

Event registration, slot booking, QR tickets and admin check-in for events hosted by SS Innovations.
App code is written by Puneet in https://github.com/puneet46654/ssimayaconnect and copied into `site/`.
This repository (GitLab `naveen-ssi/ssi-events`) is the repo of record: nothing reaches production until the owner merges.

## Release flow

1. Puneet pushes to GitHub `main`.
2. The GitHub webhook triggers this project's `sync` job (`infra/sync-frontend.sh`). It copies the code into `site/` on branch `frontend-sync` and opens or updates an MR into `main`.
3. The MR pipeline runs unit tests and a production build. It does not deploy.
4. The owner reviews and merges.
5. The `main` pipeline builds and deploys to https://events.ssistudios.com, then checks that `/events` returns 200.

## Hosting (pay-per-request, nothing always on)

```
viewer ─► CloudFront E2YO5MY27AOEY1 (events.ssistudios.com, ACM cert)
            ├─ /_next/static/*  ─► S3 ssi-events-site-051826716001 (private, OAC)
            └─ everything else  ─► Lambda ssi-events-web (Next.js standalone + Lambda Web Adapter)
                                     ├─► MongoDB Atlas (free M0, SS Innovations account)
                                     └─► S3 ssi-studio-events (event images, via the Lambda role)
```

Lambda only runs while requests come in, so an idle site costs nothing. Expected traffic falls within the AWS free tiers for Lambda, CloudFront and SSM. Fixed costs are the existing Route 53 zone and a few MB of S3.

| Resource | ID |
| --- | --- |
| AWS account | 051826716001 (ap-south-1) |
| Route 53 zone | ssistudios.com `Z07119773E1TU1SAAQGCF` |
| ACM certificate (us-east-1) | `531ab18e-fd0a-43cf-86b6-eb9ea13a75a4` |
| CloudFront | `E2YO5MY27AOEY1` (`d10w4er69834v0.cloudfront.net`), cache policy `ssi-events-next`, OAC `ssi-events-s3` |
| Lambda | `ssi-events-web`, nodejs24.x, 1024 MB, 30 s, reserved concurrency 100, Lambda Web Adapter layer v30 (1.1.0) |
| Lambda role | `ssi-events-lambda` (logs + get/put on `ssi-studio-events/*`) |
| Deploy role | `ssi-events-gitlab-deploy` (GitLab OIDC, `naveen-ssi/ssi-events` `main` only) |
| Secrets | SSM SecureString `/ssi-events/MONGODB_URI`, `/ssi-events/ADMIN_SESSION_SECRET`, `/ssi-events/BOOKING_ACCESS_SECRET` |

`infra/setup-aws.sh` created all of the above and can be re-run safely.

## Build adaptations

Puneet's app targets Vercel. Before `next build`, `infra/prepare-build.mjs` makes two changes:

- `next.config.ts`: `output: 'standalone'`, so Lambda gets a self-contained server.
- `lib/s3.ts`: removes the explicit access-key credentials, so the S3 client uses the Lambda role. Lambda's temporary credentials need a session token that the explicit form drops.

Each change is skipped once it exists upstream. If Puneet's code changes shape, the build fails rather than shipping unpatched. Ask Puneet to make both changes upstream.

The custom `server.mjs` (Socket.IO) isn't used. The app falls back to polling `/api/realtime`, which it already does on Vercel.

## Admin tasks

Set or rotate a secret, then push it to Lambda:

```bash
aws ssm put-parameter --name /ssi-events/MONGODB_URI --type SecureString --overwrite --value 'mongodb+srv://...'
bash infra/set-secrets.sh
```

GitLab CI setup (same as the Dr. Sudhir site):
- CI/CD variable `SYNC_PUSH_TOKEN`: a project access token with `write_repository`, role Developer or higher. Masked and protected.
- Pipeline trigger token, plus a GitHub webhook on `puneet46654/ssimayaconnect` (push events) pointing to
  `https://gitlab.com/api/v4/projects/<project-id>/ref/main/trigger/pipeline?token=<trigger-token>`.
- Protect `main`: only Maintainers can merge, and no one can push directly.

## Known limitations / open items

- **Database:** production needs a MongoDB Atlas cluster owned by SS Innovations (free M0, AWS Mumbai). Lambda has no fixed IP, so Atlas network access must allow `0.0.0.0/0`. Use a long random database password. Free M0 has throughput limits, so load-test before a large event.
- **Data migration** from Puneet's current database is pending. Keep his `BOOKING_ACCESS_SECRET` if existing ticket links must keep working.
- **Image uploads:** Lambda caps request bodies at 6 MB, so uploads close to the app's 5 MiB limit may fail. Images under about 4 MB are fine.
- `/admin/attendance` redirects to an absolute URL built from the server's internal host. It isn't linked anywhere in the app. Puneet should change it to a relative redirect.
- The root admin account (`puneet`) and its password hash are hard-coded in `lib/admin-server-auth.ts`. Rotate it or move it to configuration before go-live.
- The Lambda function URL is public as well as the CloudFront domain. CloudFront is the intended entry point.
- `@vercel/speed-insights` loads a Vercel-only script that returns 404 here. It's harmless; Puneet can remove it.
