# Frontend developer guide

This guide is for the frontend developer working in this repository (GitLab `naveen-ssi/ssi-events`).

## What you own

| Folder | Owner | Notes |
| --- | --- | --- |
| `frontend/` | Frontend developer | Next.js pages, components, styles, public assets |
| `backend/` | SS Innovations | API, database, auth, bookings. Don't change it; raise an issue instead |
| `infra/`, `.gitlab-ci.yml` | SS Innovations | AWS setup and the release pipeline |
| `docs/api-contract.md` | Shared | The API you build against. Propose changes in an issue or MR |

The frontend talks to the backend **only** over HTTP at `/api/*`, as described in `docs/api-contract.md`.

**Don't add, in `frontend/`:**
- database clients (MongoDB, mongoose, Redis, DynamoDB)
- AWS SDKs
- secrets or `.env` values
- server-side API routes (`app/api/...`)

In production, CloudFront sends every `/api/*` request to the backend, so routes under `frontend/app/api` never run there.

> **Current state:** `frontend/` still contains the previous app's server code: `app/api/`, `models/`, `lib/db.ts`, `lib/s3.ts`, `lib/admin-server-auth.ts`, and the `mongoose`, `mongodb`, `redis`, `socket.io` and `@aws-sdk` dependencies. It is legacy and gets removed as the backend takes over each endpoint. Don't extend it.

## How to work

1. Clone: `git clone https://gitlab.com/naveen-ssi/ssi-events.git`
2. Create a branch from `main`, e.g. `feature/ticket-page`.
3. Develop in `frontend/`:
   ```bash
   cd frontend
   npm ci
   npm run dev          # http://localhost:3000
   ```
   To use the live backend while developing, proxy `/api` to `https://events.ssistudios.com` (Next.js `rewrites` in development only). Alternatively, mock responses using the shapes in the API contract.
4. Before pushing, run `npm test`, `npm run lint` and `npx next build`.
5. Push your branch and open a merge request into `main`. The MR pipeline builds and tests both frontend and backend; nothing is deployed.
6. The owner reviews and merges. Merging deploys to https://events.ssistudios.com automatically.

You can't push to `main` directly, and nothing reaches the live site without the owner's merge.

## Design language

The site follows the SS Innovations design language used on the new corporate website: `SSi-Design-Language.md`, available from the web team.

| Element | How it's set up | Rule |
| --- | --- | --- |
| Colour | `frontend/app/globals.css`: `primary` = indigo `#283F8F`, `secondary` = ink `#0F1729`, `gray-*` mapped to the SSi neutrals | Indigo is the only accent |
| Insignia gradient | `.btn-primary`, `.ssi-rule`, `.ssi-highlight`, `var(--ssi-gradient-90)` | Only on primary buttons, thin rules, one highlighted phrase per heading, and small markers. Never as a large fill |
| Type | Figtree (via `next/font`): 600 for headings, 500 for navigation and buttons, 400 for body. `font-bold` renders as 600 on purpose | Nothing smaller than 12px on attendee pages |
| Shape | Panels have 28px corners (22px on phones); small cards and images 18px | Buttons are pills; dark footer band (`#0B1120`) on every page |
| Icons | Phosphor (`@phosphor-icons/react`), regular weight, indigo | |
| Logo | `public/logos/ssii-logo.png` (light backgrounds), `ssii-logo-white.png` (dark) | The header reads "SSii logo │ Events" |
| Voice | Formal "we", sentence-case headings | No labels above headings, no slogans, no exclamation marks |
| Categories | `lib/event-categories.ts`: SMRSC (`conference`), MantraM (`mantram`), CME / Workshop (`event`) | Use these names everywhere |
| Phones first | Tap targets at least 44px, safe-area insets, bottom navigation | No horizontal scrolling down to a 360px-wide screen |

## Build and hosting notes

- **Hosting:** the frontend runs on AWS Lambda as a Next.js `output: 'standalone'` server. Keep `output: 'standalone'` in `next.config.ts`.
- **Node:** Node 24 (the CI image is `node:24-bookworm`). Use `npm`; `package-lock.json` must be committed.
- **Static files:** files in `public/` and `/_next/static/*` are served through CloudFront.
- **Caching:** pages can be cached by CloudFront if they send `Cache-Control: s-maxage=...`. Each deploy clears the cache.
- **Don't** rely on Vercel features (`@vercel/*`, Edge Config, Vercel image or analytics services) or on a custom Node server (`server.mjs`). Neither runs here.
- **Redirects:** in route handlers or middleware, build redirects from relative paths, not from `request.url`. Behind CloudFront and Lambda, `request.url` has the internal host.
- **Realtime:** poll `GET /api/realtime`. There are no WebSockets.

## Asking for backend changes

Open a GitLab issue labelled `backend` that describes:
- the screen or flow
- the data you need
- the proposed request/response

Once it's agreed, the backend team implements it and updates `docs/api-contract.md` in the same MR.
