# API contract — events.ssistudios.com

The backend (`backend/`, Lambda `ssi-events-api`) owns every URL under `/api/*`. CloudFront sends all `/api/*` traffic to it. Any `app/api` routes left in `frontend/` never receive production traffic.

This file is the agreement between frontend and backend. A change to an endpoint's URL, request or response is made here first, in the same MR as the backend change.

## Conventions

- **Base URL:** same origin as the site (`https://events.ssistudios.com/api/...`). Call it with relative URLs (`fetch('/api/events')`), so there's no CORS.
- **Format:** JSON request and response bodies, `content-type: application/json`. Image uploads use `multipart/form-data` and must be under 4 MB, because Lambda caps request bodies at 6 MB.
- **Success:** `{ "success": true, ...data }`, with HTTP 200 or 201.
- **Failure:** `{ "success": false, "error": "<message safe to show the user>" }`, with:
  - `400` invalid input
  - `401` not signed in
  - `403` no permission
  - `404` not found
  - `405` wrong method
  - `409` conflict (e.g. slot full, stale edit)
  - `503` backend unavailable
  - `500` unexpected
- **Caching:** responses are `cache-control: no-store` unless the endpoint says otherwise.
- **Admin auth:** an `HttpOnly`, `Secure`, `SameSite=Lax` session cookie set by `POST /api/admin/login`. The frontend never reads or stores credentials or tokens itself.
- **Times:** ISO 8601 timestamps in UTC. Event calendar dates are `YYYY-MM-DD` in the event's own IANA `timeZone`.

## Endpoints

Status key: **live** = implemented in `backend/` and deployed; **planned** = to be built in `backend/`.

The planned list mirrors the endpoints the current frontend calls. Each one gets a full request/response section here when it's implemented.

| Method | Path | Purpose | Auth | Status |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | Liveness + database reachability | none | **live** |
| GET | `/api/events` | Public event catalogue | none | planned |
| POST | `/api/events` | Create event (with schedule) | admin: events | planned |
| GET | `/api/events/:id` | Event details + schedule | none | planned |
| PUT | `/api/events/:id` | Edit event (keeps booked slots) | admin: events | planned |
| DELETE | `/api/events/:id` | Delete empty event / cancel booked event | admin: events | planned |
| GET | `/api/events/:id/slots` | Slot availability for a day | none | planned |
| GET | `/api/events/:id/image` | Event image (validated, re-encoded) | none | planned |
| POST | `/api/events/mytickets` | Ticket recovery (reference + full mobile) | none | planned |
| GET, POST, PATCH, DELETE | `/api/bookings` | Look up / create / reschedule / cancel own booking | booking grant | planned |
| POST | `/api/bookings/pending` | Save attendee details before slot choice | none | planned |
| POST, GET | `/api/feedback` | App rating | none / admin | planned |
| GET | `/api/realtime` | Revision counters for polling (CDN-cached 2 s) | none | planned |
| GET | `/api/location/countries` | Country list | none | planned |
| GET | `/api/location/states` | States for a country | none | planned |
| POST | `/api/analytics/collect` | Anonymous page analytics | none | planned |
| POST | `/api/admin/login` | Sign in | none | planned |
| POST | `/api/admin/logout` | Sign out | admin | planned |
| GET | `/api/admin/session` | Current admin + permissions | admin | planned |
| GET, POST | `/api/admin/users` | List / create admins | admin: auth | planned |
| PUT, DELETE | `/api/admin/users/:id` | Edit / remove admin | admin: auth | planned |
| GET | `/api/admin/bookings` | Search bookings (paginated) | admin: bookings | planned |
| GET, PATCH, DELETE | `/api/admin/bookings/:id` | Booking detail / edit / cancel | admin: bookings | planned |
| DELETE | `/api/admin/bookings/pending/:id` | Discard a pending booking | admin: bookings | planned |
| GET, POST | `/api/admin/attendance` | Check-in lookup / QR or manual check-in | admin: check-in | planned |
| GET | `/api/admin/dashboard` | Dashboard figures | admin: dashboard | planned |
| GET | `/api/admin/reports` | Report data for CSV/Excel/print | admin: reports | planned |
| GET | `/api/admin/analytics` | Analytics summary | admin: dashboard | planned |
| GET | `/api/admin/analytics/live` | Live visitors | admin: dashboard | planned |
| GET | `/api/admin/activity` | Admin activity log | admin: auth | planned |

## `GET /api/health`

Used by the deploy pipeline and for monitoring.

`200`:
```json
{ "success": true, "service": "ssi-events-api", "release": "a1b2c3d",
  "database": { "table": "ssi-events", "status": "ACTIVE", "latencyMs": 42 } }
```
`503` if DynamoDB can't be reached: `database.status` is `"UNREACHABLE"`.
