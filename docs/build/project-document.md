# 1. Introduction

## 1.1 Purpose

This document describes the SSI Events platform: its features, system architecture, technology stack, interfaces, data model, build and deployment process, and operating procedures. It is the reference for developers working on the system and the record of its design as of version 1.0.

## 1.2 Scope

The platform at https://events.ssistudios.com: the attendee website, the administration console, the API, and the AWS infrastructure that hosts them. Source code: GitLab project `naveen-ssi/ssi-events`.

## 1.3 Audience

Frontend and backend developers, the system owner, and reviewers who need a technical description of the system.

## 1.4 Related documents

| Document | Location |
| --- | --- |
| API contract | `docs/api-contract.md` (reproduced in section 12) |
| Data model | `docs/data-model.md` (reproduced in section 11) |
| Frontend guide | `docs/frontend-developer-guide.md` |
| Repository overview | `README.md`, `frontend/README.md`, `backend/README.md` |
| SS Innovations design language | `SSi-Design-Language.md` (SS Innovations web team) |

## 1.5 Terms

| Term | Meaning |
| --- | --- |
| Event | A scheduled SS Innovations event: SMRSC (conference), SSi MantraM visit, or CME / workshop |
| Time-slot event | Attendees book a specific time slot; check-in follows the slot |
| Registration-only event | Attendees register without a time slot; one ticket is valid for the event dates |
| Booking | A confirmed booking or registration; identified by a reference `SSI-EV-<year>-<12 hex>` |
| Pending registration | Attendee details saved before a slot was chosen |
| Ticket grant | A signed cookie that lets a browser view and manage a specific booking |
| MR | GitLab merge request |

# 2. System overview

The platform publishes SS Innovations events, takes bookings, issues QR tickets, and records attendance at the venue. Attendees do not create accounts. Staff use an administration console with role-based access.

| User group | Uses |
| --- | --- |
| Attendees (surgeons, clinical staff, visitors) | Browse events, register, book a slot, receive a ticket, manage the booking |
| Event staff | Check attendees in by QR code or booking reference |
| Event administrators | Create and edit events, manage bookings, export reports |
| Superadministrators | All of the above, plus user and access management and the audit log |

The system is serverless and pay-per-request. Nothing runs between requests, so an idle site incurs no compute cost.

# 3. Features

## 3.1 Attendee website

| Feature | Description |
| --- | --- |
| Event catalogue | Home page (`/`) with three category cards (SMRSC, SSi MantraM, CME / workshop) and the published events, soonest first. Search and filters by status and type |
| Category pages | `/smrsc` (registration on the conference website; "coming soon" until its address is set), `/mantram`, `/cme`: introduction and events open for registration |
| Event page | Description, dates, venue, availability; "Book a slot" or "Register" |
| Registration forms | Conference registration (with Faculty / Delegate) and standard registration (without). Chosen per event; MantraM events default to the standard form |
| Slot booking | Live availability per day; full and ended slots cannot be chosen; overselling is prevented in the database |
| Registration-only events | No slot step; a confirmation screen, then the ticket. Optional limit on the number of registrations |
| Ticket | Shown immediately after booking: event, attendee, date and time (or dates), venue, booking reference, QR code. "Save ticket" downloads it as an image |
| Ticket email | Sent on booking, reschedule and cancellation, with the QR code inline. SS Innovations staff are copied |
| My Tickets | Tickets on this device by mobile number; on another device with the booking reference. Add to Google Calendar |
| Reschedule and cancel | Until the slot starts (time-slot events) or the event ends (registration-only); not after check-in |
| App feedback | 1-5 star rating with optional comment, one per browser |

## 3.2 Administration console

| Feature | Description |
| --- | --- |
| Sign-in | Login ID or email and password; 8-hour session; lockout after 5 failed attempts in 15 minutes |
| Dashboard | Events, events live today, bookings, today's check-ins, free seats; latest bookings; next events with fill level |
| Event management | Create, edit, cancel or delete events. Booking type (time slots or registration only), schedule per day (hours, lunch break, slot length, gap, capacity), registration form, image. Booked slots cannot be moved or removed; an event with bookings is cancelled rather than deleted |
| Bookings | Search and filter all bookings and pending registrations; edit attendee details; mark attendance manually; delete a booking (frees the seat) |
| Check-in | QR scanning by camera or manual entry for a live event. Admission opens 15 minutes before the booked slot. Early or late arrivals can be moved into a slot that is open now with free seats and checked in in one step |
| Reports | Summary figures, charts, per-event performance and the full booking ledger; export to CSV, Excel and print |
| Analytics | Page views, visitors, sessions, booking funnel, top pages and events, referrers, devices, API response times and errors; live view of visitors on the site; app feedback |
| User & access | Create, edit and remove admins; roles and module permissions; create and delete rights; optional email for sign-in |
| Activity log | Audit trail of sign-ins, failed sign-ins and every change, filterable by admin, action and date; kept for one year |

## 3.3 Notifications

| Notification | Recipients | Trigger |
| --- | --- | --- |
| Booking confirmed | Attendee; staff in copy | Booking created |
| Booking rescheduled | Attendee; staff in copy | Attendee moves to another slot |
| Booking cancelled | Attendee; staff in copy | Attendee cancels |
| Event cancelled | Each attendee of the event; one summary to staff | Admin cancels an event that has bookings |

# 4. System architecture

## 4.1 Components

```text
Browser
  |
  v
Amazon CloudFront (events.ssistudios.com, ACM certificate)
  |-- /api/*          --> Lambda ssi-events-api (backend, Node.js 24)
  |                         |--> DynamoDB ssi-events (single table)
  |                         |--> S3 (event images)
  |                         |--> SES (ticket email)
  |                         '--> Lambda, async (background jobs)
  |-- /_next/static/* --> S3 site bucket (private, OAC)
  '-- other paths     --> Lambda ssi-events-web (Next.js standalone)

GitLab CI (main) --OIDC--> IAM ssi-events-gitlab-deploy --> S3, Lambda, CloudFront
Secrets and config: SSM Parameter Store (/ssi-events/*)
Logs: CloudWatch Logs (30 days)    DNS: Route 53
```

| Component | Role |
| --- | --- |
| CloudFront | Single entry point; routes by path; caches the catalogue (5 s) and realtime counters (2 s) at the edge |
| Frontend Lambda (`ssi-events-web`) | Renders the Next.js site; no data access |
| Backend Lambda (`ssi-events-api`) | All business logic and data access; the only component with database, email and image permissions |
| DynamoDB (`ssi-events`) | Events, schedules, slots, bookings, admins, audit log, analytics, feedback. On-demand capacity, point-in-time recovery (35 days), TTL expiry, deletion protection |
| S3 | Event images (backend only) and the site's static assets and release packages |
| SES | Outbound email; DKIM-signed, DMARC policy, custom MAIL FROM domain |
| Parameter Store | Session and ticket signing keys, email settings |

## 4.2 Request flows

**Page request.** CloudFront forwards the request to the frontend Lambda, which renders the page. Static assets come from S3 through CloudFront. The browser then calls `/api/*` on the same origin; there is no cross-origin traffic.

**Booking.** `POST /api/bookings` runs one DynamoDB transaction that claims a seat in the slot (only while `bookedCount < capacity`), increments the event's booking count, stores the booking and stores its idempotency key. Either all four writes happen or none. A retried request with the same key returns the original booking. The response sets a signed ticket-grant cookie, and the confirmation email is sent through SES.

**Check-in.** Staff select a live event and scan a ticket. The backend checks that the ticket belongs to the event and that the slot admits people now, then records the attendance with a conditional update, so two scanners reading the same ticket record it once. Outside the window it returns the slots open now with free seats; moving into one is a single transaction.

**Live updates.** Browsers poll `GET /api/realtime` every 4 seconds while visible. Each write that matters increments a revision counter; screens refetch when a counter changes. CloudFront caches the counters for 2 seconds, so polling cost does not grow with the number of open screens.

**Event cancellation emails.** The admin request marks the event cancelled and invokes the backend Lambda asynchronously. That job emails attendees at about 11 per second within an 18-second budget per run and hands any remainder to a new invocation. Bookings already notified are skipped, so retries do not duplicate emails.

**Release.** A merge to `main` triggers GitLab CI, which builds both applications, assumes the deploy role through OIDC, uploads packages, updates both Lambdas, invalidates CloudFront and checks the live health endpoint against the new commit.

## 4.3 Design decisions

| Decision | Reason |
| --- | --- |
| Serverless (Lambda, DynamoDB on-demand) | Usage is concentrated around events; no cost when idle |
| Single-table DynamoDB design | One query returns an event with all its days and slots; booking is one transaction |
| Seat counts on slot and event items | Overselling is prevented by conditional writes rather than application locks |
| Backend owns all `/api/*` routes | One place for authorisation and data access; the frontend has no credentials |
| No attendee accounts | Attendees book occasionally; tickets are delivered on screen and by email |
| Signed cookies for sessions and ticket access | No session store; access is re-checked against the table on every admin request |
| Polling for live updates | Works with CloudFront and Lambda without a socket service |
| Edit lock on events | Bookings are paused for at most 60 s while a schedule edit is written |

# 5. Technology stack

## 5.1 Frontend

| Area | Technology | Version |
| --- | --- | --- |
| Framework | Next.js (App Router, standalone output) | 16.3.5 |
| UI library | React | 19.2.8 |
| Language | TypeScript | 5.x |
| Styling | Tailwind CSS (PostCSS) | 4.3 |
| Animation | Framer Motion | 13.4 |
| Icons | Phosphor Icons, Lucide | 2.1.10, 1.47 |
| Charts | Recharts | 3.10 |
| QR code display | qrcode.react | 4.2 |
| QR code scanning | ZXing (`@zxing/browser`) | 0.2.1 |
| Ticket image export | html-to-image | 1.11 |
| Spreadsheet export | SheetJS (`xlsx`) | 0.18.5 |
| Dates and time zones | Temporal polyfill | 0.5.1 |
| Image optimisation | sharp | 0.35.4 |
| Font | Figtree (`next/font`) | |

## 5.2 Backend

| Area | Technology | Version |
| --- | --- | --- |
| Runtime | Node.js on AWS Lambda (arm64) | 24 |
| Language | TypeScript | 7.0 |
| Bundler | esbuild (ESM bundle) | 0.28 |
| AWS SDK | `@aws-sdk/client-dynamodb`, `lib-dynamodb`, `client-s3`, `client-sesv2`, `client-lambda` | 3.x |
| Image processing | sharp (re-encodes uploads, strips metadata) | 0.35.4 |
| QR code generation (email) | qrcode | 1.5.4 |
| Dates and time zones | Temporal polyfill | 0.5.1 |
| Password hashing | Node.js `crypto` scrypt | built in |
| Session signing | HMAC-SHA256, Node.js `crypto` | built in |

## 5.3 Infrastructure

| Service | Use |
| --- | --- |
| Amazon CloudFront | CDN, TLS termination, path routing |
| AWS Lambda | Frontend and backend compute; Lambda Web Adapter 1.1.0 for the Next.js server |
| Amazon DynamoDB | Database (single table, two global secondary indexes) |
| Amazon S3 | Event images; static assets; release packages |
| Amazon SES (v2) | Ticket and notification email |
| Amazon Route 53 | DNS and email authentication records |
| AWS Certificate Manager | TLS certificate |
| AWS Systems Manager Parameter Store | Secrets and configuration |
| AWS IAM | Least-privilege roles; GitLab OIDC federation for deployment |
| Amazon CloudWatch Logs | Function logs, 30-day retention |

Region: ap-south-1 (Mumbai). The CloudFront certificate is in us-east-1.

## 5.4 Tooling

| Area | Tool |
| --- | --- |
| Source control and CI/CD | GitLab, GitLab CI (`node:24-bookworm`, `amazon/aws-cli`) |
| Tests | `node:test` with tsx; in-memory DynamoDB stand-in for backend tests |
| Lint | ESLint 9 with `eslint-config-next` |
| Infrastructure scripts | Bash and AWS CLI v2 (`infra/`) |

# 6. Repository structure

| Path | Contents |
| --- | --- |
| `frontend/app/events/` | Catalogue (served at `/`), event page, booking flow, My Tickets |
| `frontend/app/mantram`, `cme`, `smrsc` | Category pages |
| `frontend/app/admin/` | Administration console |
| `frontend/app/components/admin/booking-templates/` | Registration forms; template and booking-type pickers |
| `frontend/components/` | Shared UI, realtime provider |
| `frontend/lib/` | Client utilities: dates, phone numbers, booking confirmation, categories, calendar links |
| `frontend/tests/unit/` | Frontend unit tests |
| `backend/src/handler.ts` | Lambda entry point and router; every endpoint is registered here |
| `backend/src/routes/` | Endpoint handlers |
| `backend/src/lib/` | Authentication, bookings, email, analytics, scheduling, images, background jobs |
| `backend/src/db/table.ts` | DynamoDB client and key builders |
| `backend/scripts/` | `create-admin.ts`, `dev-server.ts` |
| `backend/test/` | Backend tests and the in-memory table |
| `infra/` | `setup-aws.sh`, `deploy.sh`, packaging scripts, IAM policies, `set-secrets.sh` |
| `docs/` | API contract, data model, frontend guide |
| `.gitlab-ci.yml` | Build, test and deploy pipeline |

# 7. Development

## 7.1 Local environment

Requirements: Node.js 24 and npm. No AWS access is needed.

```bash
cd backend  && npm ci && npm run dev    # API on http://localhost:4000
cd frontend && npm ci && npm run dev    # site on http://localhost:3000
```

The backend dev server runs the production handler against an in-memory table seeded with a time-slot event, a registration-only event and an admin account (`admin` / `Dev-Password-1`). The frontend dev server proxies `/api/*` to it (`API_PROXY_TARGET` overrides the target). Data resets on restart and no email is sent.

## 7.2 Commands

| Location | Command | Purpose |
| --- | --- | --- |
| backend | `npm run typecheck` | TypeScript check |
| backend | `npm test` | Unit and integration tests |
| backend | `npm run build` | Production bundle (`dist/index.mjs`) |
| backend | `npm run smoke` | Loads the built bundle |
| frontend | `npm test` | Unit tests |
| frontend | `npm run lint` | ESLint |
| frontend | `npx next build` | Production build |

## 7.3 Conventions

- API changes are made in `docs/api-contract.md` in the same MR as the backend change.
- The frontend uses only `/api/*`; no database clients, AWS SDKs, secrets or `app/api` routes.
- Event dates are `YYYY-MM-DD` in the event's IANA time zone; timestamps are UTC ISO 8601.
- New DynamoDB condition and update expressions are run once against the real table on throwaway `TEST#` items before release.
- User-facing text follows the SS Innovations voice: formal "we", sentence case, no slogans. Minimum text size 12 px; admin body text 14 px or larger.

# 8. Build, release and deployment

## 8.1 Branching and approval

Developers push feature branches and open merge requests into `main`. `main` is protected: only maintainers merge, nobody pushes directly. Merging is the release approval.

## 8.2 Pipeline

| Stage | Merge request pipeline | `main` pipeline |
| --- | --- | --- |
| backend | typecheck, tests, build, bundle smoke test | same, then package `api.zip` |
| frontend | unit tests, Next.js build | same, then package `web.zip` and static assets |
| deploy | not run | upload static assets to S3; update `ssi-events-api` then `ssi-events-web`; invalidate CloudFront; verify `/` returns 200 and `/api/health` reports the new commit with the database `ACTIVE` |

Deployment uses short-lived credentials from GitLab OIDC. The deploy role can update the two functions, write static assets and release packages, and invalidate the distribution. It cannot read data or secrets. Artifacts are kept for one day.

## 8.3 Rollback

Revert the merge commit in GitLab; the revert deploys through the same pipeline. For an immediate rollback an administrator can point a function at a previous package under `releases/` in the site bucket (`aws lambda update-function-code`) and invalidate CloudFront.

# 9. Configuration

Backend Lambda environment (values from Parameter Store `/ssi-events/*`, applied with `infra/set-secrets.sh`):

| Variable | Purpose |
| --- | --- |
| `ADMIN_SESSION_SECRET` | HMAC key for admin session cookies (min. 32 characters) |
| `BOOKING_ACCESS_SECRET` | HMAC key for ticket-grant cookies (min. 32 characters) |
| `MAIL_FROM` | Sender, `SS Innovations Events <tickets@events.ssistudios.com>`; email is disabled when unset |
| `MAIL_CC` | Comma-separated staff addresses copied on ticket emails |
| `MAIL_REPLY_TO` | Optional reply-to address |
| `SITE_URL` | Public site address used in emails and referrer analysis |
| `ALLOWED_ORIGINS` | Origins allowed to make state-changing requests |
| `TABLE_NAME`, `IMAGE_BUCKET` | DynamoDB table and image bucket (defaults `ssi-events`, `ssi-studio-events`) |
| `RELEASE` | Commit identifier, set at build time, reported by `/api/health` |

Frontend: `API_PROXY_TARGET` (development only). The frontend has no secrets.

# 10. Security

## 10.1 Authentication and sessions

| Control | Implementation |
| --- | --- |
| Admin passwords | scrypt (N=16384, r=8, p=1), 16-byte random salt, 64-byte key. Minimum 12 characters with upper case, lower case and a digit |
| Admin sessions | `HttpOnly; Secure; SameSite=Lax` cookie, HMAC-SHA256 signed, 8 hours. Holds only the login ID, sign-in time and a credential version; access is re-read from the table on every request. A password reset or login ID change ends all existing sessions |
| Brute-force protection | 5 failed sign-ins in 15 minutes lock the account for 15 minutes, counted per account whichever identifier was typed |
| Uniform failures | Unknown IDs, inactive accounts and wrong passwords return the same response after the same hashing work |
| Cross-site requests | State-changing requests from other origins are rejected (403), in addition to SameSite cookies |
| Attendee access | No accounts. A signed ticket-grant cookie per booking (30 days) authorises viewing and changing it; a mobile number alone never reveals tickets |

## 10.2 Roles and permissions

| Role | Access |
| --- | --- |
| Superadmin | Every module, including User & Access and the activity log; create and delete rights |
| Admin | Modules granted individually; create and delete rights granted individually |
| Staff | Modules granted individually; typically check-in only |

| Module | Screens |
| --- | --- |
| `dashboard` | Dashboard |
| `events` | Event management (create/edit need create rights; cancel/delete need delete rights) |
| `bookings` | Bookings (edit needs create rights; delete needs delete rights) |
| `check-in` | Check-in; manual attendance changes |
| `reports` | Reports and analytics |
| `auth` | User & Access, activity log (superadmin only) |

At least one active superadmin must always remain, and admins cannot change their own role, status or login ID.

## 10.3 Infrastructure

- IAM roles are least privilege: the frontend Lambda can only write logs; the backend role can use the table and its indexes, read and write event images, send email only from `@events.ssistudios.com`, and invoke only its own function.
- Secrets are held in Parameter Store and never in the repository.
- DynamoDB is encrypted at rest, has point-in-time recovery (35 days) and deletion protection.
- Uploaded images are decoded and re-encoded (metadata removed; 4 MB and 25 megapixel limits) and served with `Content-Security-Policy: default-src 'none'; sandbox`.
- Email is DKIM-signed (2048-bit) with SPF on a custom MAIL FROM domain and a DMARC `quarantine` policy.
- Admin pages are not tracked by analytics; analytics store no names, contact details or IP addresses.

## 10.4 Data retention

| Data | Retention |
| --- | --- |
| Bookings | Until deleted by an admin or cancelled by the attendee |
| Pending registrations | Until the day after the event, or until the attendee books |
| Admin activity log | 1 year |
| Analytics events | 90 days |
| Live presence | 2 minutes |
| Failed sign-in records | 15 minutes |
| Backups (point-in-time recovery) | 35 days |
| Application logs | 30 days |

# 11. Data model

{{DATA_MODEL}}

# 12. API reference

{{API_CONTRACT}}

# 13. Operations

## 13.1 Administration tasks

```bash
bash infra/setup-aws.sh                                         # create or update infrastructure (idempotent)
bash infra/set-secrets.sh                                       # copy /ssi-events/* to the backend Lambda
cd backend && npx tsx scripts/create-admin.ts --username <id> --name "<name>" [--email <email>]
cd backend && npx tsx scripts/create-admin.ts --username <id> --reset
curl https://events.ssistudios.com/api/health
```

`create-admin.ts` requires AWS administrator credentials, prints the generated password once and stores only its hash. There are no built-in admin accounts.

## 13.2 Monitoring

- `GET /api/health` reports the release and the database status; the deploy job checks it after each release.
- CloudWatch Logs: `/aws/lambda/ssi-events-api`, `/aws/lambda/ssi-events-web`.
- SES sending statistics and the account suppression list in the SES console.
- The admin Analytics screen shows API response times and error rates as experienced by visitors.

## 13.3 Backup and recovery

DynamoDB point-in-time recovery restores the table to any second in the last 35 days, into a new table. Event images remain in S3. Release packages under `releases/` allow any recent version to be redeployed.

## 13.4 Cost

All services are billed per use. An idle month costs well under USD 1 (mainly the DNS zone); an event month with several thousand visitors and around a thousand bookings is expected to stay within a few US dollars.

# 14. Testing and verification

| Suite | Scope | Count |
| --- | --- | --- |
| Backend | Endpoints, transactions, permissions, schedules, email content, analytics, background jobs, registration-only events, against an in-memory DynamoDB stand-in | 90 tests |
| Frontend | Dates and time zones, phone numbers, CSV escaping, calendar links, country defaults | 9 tests |
| Bundle smoke test | The production backend bundle loads | CI |
| Deployment check | `/` and `/api/health` after each release | CI |

Concurrency of the booking transaction was tested against the live table: 30 concurrent attendees for 5 seats, plus 10 retries, produced exactly 5 bookings. New database expressions are verified against the live table on throwaway items before release.

# 15. Known limitations

| Item | Status |
| --- | --- |
| Visitor country and city in analytics | Not available: CloudFront does not forward viewer location headers to the API |
| Staff copies of ticket emails | Delivered by SES; the recipient mail system (Microsoft 365) may filter them until `events.ssistudios.com` is allow-listed |
| Reply-to address for ticket emails | Not configured |
| Replaced or deleted event images | Remain in S3 (the API role has no delete permission) |
| Booking data retention | No automatic expiry; bookings are kept until deleted |
| Staging environment | None; changes are verified in CI, locally and on the live table with throwaway items |
| Data from the previous MongoDB system | Not migrated |
| SMRSC registration | Hosted on the conference website; the address is to be added when available |

# 16. Change history

{{CHANGES}}
