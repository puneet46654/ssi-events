# Frontend guide

## Scope

| Path | Owner |
| --- | --- |
| `frontend/` | Frontend developer |
| `backend/`, `infra/`, `.gitlab-ci.yml` | SS Innovations (request changes through an issue) |
| `docs/api-contract.md` | Shared; API changes are agreed there first |

The frontend calls the backend only through `/api/*` (`docs/api-contract.md`). It has no server-side
data access. Do not add database clients, AWS SDKs, secrets, `.env` files or `app/api` routes; in
production CloudFront sends `/api/*` to the backend Lambda, so frontend API routes never run.

## Setup

Node 24, npm.

```bash
git clone https://gitlab.com/naveen-ssi/ssi-events.git
cd ssi-events/backend && npm ci && npm run dev     # local API, :4000
cd ../frontend && npm ci && npm run dev            # http://localhost:3000
```

`next dev` proxies `/api/*` to `http://localhost:4000` (set `API_PROXY_TARGET` to change it). The
local API runs the real backend code against an in-memory table with sample data; it resets on
restart. Admin login: `admin` / `Dev-Password-1` (or `admin@example.com`). Emails are not sent locally.

## Workflow

1. Branch from `main` (`feature/<name>`).
2. Before pushing: `npm test`, `npm run lint`, `npx next build`.
3. Open an MR into `main`. CI builds and tests; nothing deploys.
4. A maintainer merges; the merge deploys to production.

## Structure

| Path | Purpose |
| --- | --- |
| `app/events/` | Catalogue (served at `/`), event page, booking flow, My Tickets |
| `app/mantram`, `app/cme`, `app/smrsc` | Category pages (`components/user/CategoryPage.tsx`) |
| `app/admin/` | Admin: dashboard, events, bookings, check-in, reports, analytics, users |
| `app/components/admin/booking-templates/` | Registration forms, template and booking-type pickers |
| `components/user/` | Shared attendee UI (header, cards, event grid) |
| `components/realtime/RealtimeProvider.tsx` | Polls `GET /api/realtime` every 4 s and notifies `useRealtimeRefresh` subscribers |
| `lib/event-categories.ts` | Category names, copy and images |
| `lib/bookings/confirm-booking.ts` | Creates a booking (idempotency key per request) |
| `tests/unit/` | Unit tests (`node:test`, run with `npm test`) |

## Conventions

- `output: 'standalone'` in `next.config.ts` is required for the Lambda deployment. `agentRules: false` stops Next from writing `AGENTS.md`/`CLAUDE.md`.
- No Vercel-specific features and no custom Node server.
- Build redirects from relative paths; behind CloudFront `request.url` carries the internal host.
- Realtime updates are polling only (`/api/realtime`), no WebSockets.
- Pages may set `Cache-Control: s-maxage=…`; each deploy invalidates CloudFront.
- Times: event dates are `YYYY-MM-DD` in the event's IANA timezone; timestamps are UTC ISO strings.

## Design

Follows the SS Innovations design language (`SSi-Design-Language.md`, from the web team).

| Item | Rule |
| --- | --- |
| Colour | `primary` indigo `#283F8F`, `secondary` ink `#0F1729` (`app/globals.css`). Indigo is the only accent |
| Gradient | `.btn-primary`, `.ssi-rule`, `.ssi-highlight` only; never a large fill |
| Type | Figtree via `next/font`; 600 headings, 500 buttons, 400 body. Minimum 12 px; admin body 14 px+ |
| Shape | Panels 28 px radius (22 px on phones), cards and images 18 px, pill buttons |
| Icons | `@phosphor-icons/react`, regular weight |
| Copy | Formal "we", sentence case; no eyebrow labels, slogans or exclamation marks |
| Layout | Phone first: 44 px tap targets, safe-area insets, no horizontal scroll at 360 px |

## Backend changes

Open an issue labelled `backend` with the screen, the data needed and a proposed request/response.
The backend change and the `docs/api-contract.md` update land in the same MR.
