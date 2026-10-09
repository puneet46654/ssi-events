# API contract — events.ssistudios.com

The backend (`backend/`, Lambda `ssi-events-api`) owns every URL under `/api/*`. CloudFront sends all `/api/*` traffic to it. Any `app/api` routes left in `frontend/` never receive production traffic.

This file is the agreement between frontend and backend. A change to an endpoint's URL, request or response is made here first, in the same MR as the backend change.

## Conventions

- **Base URL:** same origin as the site (`https://events.ssistudios.com/api/...`). Call it with relative URLs (`fetch('/api/events')`), so there's no CORS.
- **Format:** JSON request and response bodies, `content-type: application/json`. Image uploads use `multipart/form-data` and must be 4 MB or less, because Lambda caps request bodies at 6 MB.
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
| GET | `/api/events` | Public event catalogue (CDN-cached 5 s) | none | **live** |
| POST | `/api/events` | Create event (with schedule) | admin: events + create | **live** |
| GET | `/api/events/:id` | Event details + schedule | none | **live** |
| PUT | `/api/events/:id` | Edit event (keeps booked slots) | admin: events | planned |
| DELETE | `/api/events/:id` | Delete empty event / cancel booked event | admin: events | planned |
| GET | `/api/events/:id/slots` | Live slot availability, all days | none | **live** |
| GET | `/api/events/:id/image` | Event image (validated, re-encoded at upload) | none | **live** |
| POST | `/api/events/mytickets` | My Tickets: mobile number, plus booking reference on a new device | none | **live** |
| GET, POST, PATCH, DELETE | `/api/bookings` | Look up / create / reschedule / cancel own booking | booking grant | **live** |
| POST | `/api/bookings/pending` | Save attendee details before slot choice | none | **live** |
| POST, GET | `/api/feedback` | App rating | none / admin | planned |
| GET | `/api/realtime` | Revision counters for polling (CDN-cached 2 s) | none | **live** |
| GET | `/api/location/countries` | Country list (calling codes, flags) | none | **live** |
| GET | `/api/location/states` | States for a country | none | **live** |
| POST | `/api/analytics/collect` | Anonymous page analytics (always 204; storage planned) | none | **live** |
| POST | `/api/admin/login` | Sign in | none | **live** |
| POST | `/api/admin/logout` | Sign out | admin | **live** |
| GET | `/api/admin/session` | Current admin + permissions | admin | **live** |
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

## `GET /api/events`

The public catalogue, soonest first. `cache-control: public, s-maxage=5, stale-while-revalidate=30`.

`200`:
```json
{ "success": true, "events": [{
  "_id": "01JA...", "eventName": "...", "eventType": "conference | mantram | event",
  "bookingFormTemplate": "practitioner-institutional | template-2 | template-3",
  "venue": "...", "description": "...", "imageUrl": "/api/events/<id>/image?v=<ms> or empty",
  "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD", "timeZone": "Asia/Kolkata",
  "totalSlots": 40, "bookedSlots": 3, "status": "UPCOMING | LIVE | COMPLETED | CANCELLED",
  "createdAt": "ISO", "updatedAt": "ISO" }] }
```
`status` is computed from the event's dates in its own timezone at request time. `CANCELLED` always wins.

## `GET /api/realtime`

`200`: `{ "success": true, "versions": { "events": 0, "bookings": 0, "attendance": 0 } }`

Poll every few seconds while the tab is visible. Refetch a resource when its number changes.

## `POST /api/analytics/collect`

Body: `{ visitorId, sessionId, events: [{ kind: "pageview" | "api", path, ts, ... }], presence?: { path } }`

Always returns `204` with no body. Views aren't stored yet; storage comes with the admin analytics endpoints.

## Admin sign-in

**Who has access:**
- Admin accounts live in DynamoDB. The first superadmin is created with `backend/scripts/create-admin.ts`; nothing is hard-coded.
- **Roles:**
  - `superadmin` can do everything, including User & Access (`auth`).
  - `admin` and `staff` get the modules listed in `permissions` (`dashboard`, `events`, `bookings`, `check-in`, `reports`).
  - `canCreate` and `canDelete` gate changes within those modules.

**The session cookie (`ssi_admin_session`):**
- `HttpOnly; Secure; SameSite=Lax`, valid for 8 hours.
- Its value is an HMAC-SHA256-signed token holding only the username, the sign-in time and a credential version.
- Access is re-read from the table on every request, so deactivating a user or changing their permissions applies immediately.
- Resetting a password ends all of that admin's earlier sessions.

**Protections:**
- **Lockout:** 5 failed sign-ins within 15 minutes lock the ID for 15 minutes (`429`).
- **Same error for every failure:** unknown IDs, inactive accounts and wrong passwords all return the same `401`, after the same password-hashing work.
- **Cross-site requests:** requests that change data are refused if they come from another website's `Origin` (`403`).
- **Audit log:** every sign-in, failed sign-in, sign-out and change is written to the admin activity log (kept for 1 year).

### `POST /api/admin/login`

Body: `{ "username": "...", "password": "..." }`

`200` (plus the `Set-Cookie` session):
```json
{ "success": true, "loggedInAt": 1791521749589,
  "user": { "username": "naveen", "name": "Naveen", "role": "superadmin",
            "permissions": ["dashboard","events","bookings","check-in","reports","auth"],
            "canCreate": true, "canDelete": true } }
```
Errors:
- `400` missing fields
- `401` invalid login ID or password
- `429` locked

### `POST /api/admin/logout`

`200 { "success": true }`. Clears the cookie.

### `GET /api/admin/session`

`200 { "success": true, "user": { ...as above, "loggedInAt": <ms> } }`, or `401` (clears the cookie).

## Events (admin)

### `POST /api/events`

Requires `events` permission plus `canCreate`. Body: `multipart/form-data` with these fields:

| Field | Value |
| --- | --- |
| `eventName` | max 200 characters |
| `eventType` | `conference`, `mantram` or `event` |
| `bookingFormTemplate` | `practitioner-institutional`, `template-2` or `template-3` |
| `venue` | max 300 characters |
| `description` | max 5000 characters |
| `timeZone` | IANA zone, e.g. `Asia/Kolkata` |
| `startDate`, `endDate` | `YYYY-MM-DD` |
| `numberOfDays` | 1-10 |
| `daySchedules` | JSON array, one entry per day: `{ date, startTime "HH:mm", endTime, lunchEnabled, lunchStart, lunchEnd, slotDuration (min), slotGap (min), capacity 1-20, sameAsDay1 }` |
| `thumbnail` | optional JPG/PNG/WebP, max 4 MB and 25 megapixels |

**Validation:**
- Schedule dates must be ascending and inside the event dates.
- Lunch must fall inside the day.
- Every day must produce at least one slot.
- Times that a clock change skips or repeats in the event's timezone are rejected.

**Image handling:** the image is decoded and re-encoded, which strips its metadata, before it's stored in S3.

`201`:
```json
{ "success": true, "message": "Event created successfully.", "eventId": "<ULID>",
  "bookingFormTemplate": "practitioner-institutional", "imageUrl": "/api/events/<id>/image?v=<ms>" }
```
Errors:
- `400` with the specific reason
- `401` not signed in
- `403` no permission

### `GET /api/events/:id`

`200 { "success": true, "event": { ...same fields as the catalogue, "numberOfDays", "daySchedules": [{ "_id", "dayNumber", "date" (ISO), "startTime", "endTime", "lunchEnabled", "lunchStart", "lunchEnd", "slotDuration", "slotGap", "capacity", "sameAsDay1" }] } }`

`slotDuration`, `slotGap` and `capacity` are strings, as the edit form expects.

Errors:
- `400` malformed ID
- `404` not found

### `GET /api/events/:id/image`

The image bytes, with `cache-control: public, max-age=31536000, immutable`; the URL carries a version. Returns `404` if the event has no image.

## Bookings (attendees)

### Attendee details

The `details` object holds string fields only. Field names must be letters, digits, `_` or `-`; at most 60 fields of up to 1000 characters each.

Required:
- `fullName`
- `email` (valid; stored lower-case)
- `mobile` (the full number with country code, or `mobile` plus `countryCode`)

Template fields such as `title`, `specialty`, `hospitalName`, `designation`, `city`, `state` and `country` are stored as sent.

### Ticket access grants

**How a browser gets one:** booking a ticket, or unlocking it in My Tickets with its booking reference, gives that browser a ticket grant:
- one `HttpOnly; Secure; SameSite=Lax` cookie per booking
- signed with HMAC-SHA256
- valid for 30 days and renewed on use

**What it allows:** reading the ticket (`GET /api/bookings`), rescheduling and cancelling. A mobile number alone never grants access.

### `GET /api/events/:id/slots`

`200 { success, event: { _id, eventName, venue, description, startDate, endDate, timeZone, status }, days: [{ _id, dayNumber, date, startTime, endTime, slots: [{ _id, startTime, endTime, capacity, bookedCount, remaining, ended, available }] }] }`

Never cached.

### `POST /api/bookings/pending`

Body: `{ eventId, draftId (UUID v4), details }`

`200 { success, saved: true, expiresAt }`, or `{ success, saved: false, ended: true }` if the event is over or cancelled.

The saved details are deleted automatically at the start of the day after the event, or as soon as the same email or mobile confirms a booking.

### `POST /api/bookings`

Body: `{ eventId, dayScheduleId, slotId, details, idempotencyKey (UUID v4) }`

**Success:**
- `201 { success, existing: false, booking }` plus a ticket grant cookie.
- Retrying with the same `idempotencyKey` and identical details returns `200 { existing: true, booking }` with the original booking, never a second one.

**Errors:**
- `400` invalid input (with reason)
- `404` event not found
- `409` for any of:
  - the slot is full
  - the slot has ended
  - the event is cancelled or completed
  - the retry key was reused with different details

**Overselling:** one DynamoDB transaction claims the seat (`bookedCount < capacity`), counts it on the event, and stores the booking and its retry key. Tested live: 30 concurrent attendees for 5 seats, plus 10 retries, produced exactly 5 bookings.

**`booking` fields:**
- `id`, `bookingId` (`SSI-EV-<year>-<12 hex>`), `eventId`, `eventName`, `venue`, `timeZone`, `imageUrl`
- `details`
- `slotId`, `dayScheduleId`, `date` (ISO), `startTime`, `endTime`
- `attendanceStatus`, `checkedInAt`, `checkedInBy`, `checkInMethod`
- `status`: `ACTIVE`, `EXPIRED`, `ATTENDED` or `CANCELLED`
- `qrData`: a JSON string `{ type: "SSI_EVENTS_ATTENDANCE", doctorId, bookingId, eventId }`, empty if the event is cancelled

### `GET /api/bookings?bookingId=`

Needs the ticket grant. `200 { success, booking }`; `403` without the grant; `404` if not found.

### `PATCH /api/bookings`

Body: `{ bookingId, dayScheduleId, slotId }`. Needs the grant.

Moves the booking to another slot of the same event. The new seat is claimed in the same transaction that releases the old one.

Allowed only before the current slot starts, before check-in, and while the event isn't cancelled.

### `DELETE /api/bookings?bookingId=`

Needs the grant. Same time rules as rescheduling.

Releases the seat, uncounts it on the event, and removes the retry key.

### `POST /api/events/mytickets`

Body: `{ mobile (full international number), bookingId? }`

**What it returns:**
- tickets registered to that number that this browser already holds a grant for, plus the ticket matching `bookingId` if given
- grant cookies for every ticket returned
- `200 { success, tickets: [booking + canManage], referenceNeeded }`

**Privacy:**
- `referenceNeeded` is `true` whenever nothing can be shown, so the response is the same whether or not the number has bookings.
- A `bookingId` that doesn't match the number returns `404`.

### `GET /api/location/countries`, `GET /api/location/states?country=`

**Source:** proxied from countriesnow.space.

**Caching:** browsers keep the lists for an hour; CloudFront keeps them for a day.

**Responses:**
- countries: `{ success, countries: [{ name, iso2, callingCode, flag }] }`
- states: `{ success, states: [{ name, code }] }`

`502` if the source is down.
