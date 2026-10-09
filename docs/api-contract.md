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
| PUT | `/api/events/:id` | Edit event (keeps booked slots) | admin: events + create | **live** |
| DELETE | `/api/events/:id` | Delete empty event / cancel booked event | admin: events + delete | **live** |
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
| GET, POST | `/api/admin/users` | List / create admins | superadmin | **live** |
| PUT, DELETE | `/api/admin/users/:id` | Edit / remove admin | superadmin | **live** |
| GET | `/api/admin/bookings` | Search bookings (paginated) | admin: bookings | **live** |
| GET, PATCH, DELETE | `/api/admin/bookings/:id` | Booking detail / edit / delete | admin: bookings | **live** |
| DELETE | `/api/admin/bookings/pending/:id` | Discard a pending booking | admin: bookings + delete | **live** |
| GET, POST | `/api/admin/attendance` | Check-in lookup / QR or manual check-in | admin: check-in | **live** |
| GET | `/api/admin/dashboard` | Dashboard figures | admin: dashboard | planned |
| GET | `/api/admin/reports` | Report data for CSV/Excel/print | admin: reports | **live** |
| GET | `/api/admin/analytics` | Analytics summary | admin: dashboard | planned |
| GET | `/api/admin/analytics/live` | Live visitors | admin: dashboard | planned |
| GET | `/api/admin/activity` | Admin activity log | superadmin | **live** |

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

### `PUT /api/events/:id`

Requires `events` permission plus `canCreate`. Same multipart fields as `POST /api/events`; `thumbnail` is optional and replaces the image only when sent.

**Booked seats are never moved.** The edit is refused with `409` if:
- a slot that has bookings would disappear or change its date, start or end time
- a day with bookings would change its day number (days before it added or removed)
- a slot's new capacity is lower than its bookings
- the timezone changes while the event has any bookings
- the event is cancelled

Slots and days without bookings are rewritten freely.

**Concurrency:** the event is edit-locked (`editLock`, at most 60 s) while its schedule is rewritten. New bookings and reschedules on that event get `409` "being updated" during that window; cancellations still go through. A second edit at the same time gets `409`. If an edit fails partway, the lock is released and saving again completes it.

`200`:
```json
{ "success": true, "message": "Event updated successfully.", "eventId": "<ULID>",
  "bookingFormTemplate": "...", "imageUrl": "/api/events/<id>/image?v=<ms> or empty", "updatedAt": "ISO" }
```
Errors: `400` invalid input (with reason), `401`, `403`, `404`, `409` as above.

### `DELETE /api/events/:id`

Requires `events` permission plus `canDelete`.

- **No bookings:** the event, its days, slots and pending registrations are deleted. `200 { success, cancelled: false, message }`
- **Any booking (or already cancelled):** the event is cancelled instead. Bookings are kept for the record, tickets show `CANCELLED` and lose their QR code. `200 { success, cancelled: true, message }`

The delete is conditional on the event still having no bookings, so a booking that lands at the same moment turns the delete into a cancellation. `409` while an edit holds the lock.

Event images stay in S3 when an event is deleted or its image is replaced (the API role has no delete permission on the bucket).

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

### Ticket emails

The attendee is emailed after `POST /api/bookings` (confirmation, with the QR code as an inline image), `PATCH /api/bookings` (reschedule, with the QR code) and `DELETE /api/bookings` (cancellation, no QR code). A retried booking request that returns the existing booking sends nothing.

- **Sender:** `MAIL_FROM` (`SS Innovations Events <tickets@events.ssistudios.com>`), through Amazon SES in ap-south-1. The domain `events.ssistudios.com` is verified with DKIM (2048-bit), a custom MAIL FROM domain `bounce.events.ssistudios.com` (SPF), and DMARC `p=quarantine`. `MAIL_CC` (comma-separated) copies staff on every ticket email; it is set to naveen.kumar@, reena.bhatt@ and vilayat.ali@ssinnovations.org. `MAIL_REPLY_TO` is optional.
- **Never blocks a booking:** a failed send is logged and the booking still succeeds. The outcome is stored on the booking as `lastEmail` (`{ kind, at, messageId }` or `{ kind, at, error }`).
- **Content:** event, date, time with the event's timezone, venue and booking reference, plus how to manage the booking through My Tickets. Attendee-supplied text is HTML-escaped and the subject is MIME-encoded, so details can't alter the message headers.
- Without `MAIL_FROM` (tests, local runs) nothing is sent.

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

## User & Access (superadmin only)

The `auth` module is never granted to `admin` or `staff`, so these endpoints answer `403` to anyone but a superadmin. Users are addressed by login ID: `_id` is the username.

**User fields returned:** `_id`, `username`, `name`, `role`, `permissions`, `canCreate`, `canDelete`, `isActive`, `createdBy`, `lastLoginAt`, `createdAt`, `updatedAt`. Password hashes are never returned.

**Passwords:** at least 12 characters, with upper-case and lower-case letters and a number. Only the scrypt hash is stored, so the screen shows a new password once, at the moment it is set.

### `GET /api/admin/users`

`200 { success, users: [...] }`, newest first.

### `POST /api/admin/users`

Body: `{ username, name, password, role, permissions, canCreate, canDelete, isActive }`

- `username`: 3-40 characters, `a-z 0-9 . _ -` (stored lower-case)
- `name`: 2-100 characters
- `role`: `superadmin`, `admin` or `staff`; superadmins always get every module and both rights
- `permissions`: at least one of `dashboard`, `events`, `bookings`, `check-in`, `reports` (others are ignored)

`201 { success, user }`. Errors: `400` with the reason, `409` login ID taken.

### `PUT /api/admin/users/:id`

Body: any of the create fields. `password` only when resetting it.

- Access changes apply on the user's next request.
- A password reset or login ID change signs that user out everywhere.
- You cannot change your own login ID, role or active status.
- At least one active superadmin must remain (`400`).

`200 { success, user }`. Errors: `400`, `404`, `409` login ID taken.

### `DELETE /api/admin/users/:id`

Not your own account, and not the last active superadmin (`400`). `200 { success, message }`; `404` if not found.

### `GET /api/admin/activity?admin=&action=&from=&to=`

The admin audit trail, newest first, at most 200 entries.

- `from` / `to`: ISO timestamps; without them, the last year (the retention period) is searched.
- `admin`: login ID; `action`: `login`, `login_failed`, `logout`, `create`, `update`, `delete`, `role_change`.

`200 { success, logs: [{ _id, admin, action, resource, resourceId, details, createdAt }] }`

`resource` is `auth`, `event` or `admin_user`. User changes carry `details.changes` (`{ field: { from, to } }`) and `details.credentialReset`; event edits carry `details.fields` (the fields that changed).

## Bookings (admin)

**IDs:** a confirmed booking's `_id` is its reference (`SSI-EV-…`). A pending registration has no reference, so its `_id` is `<eventId>_<draftId>`.

**How lists are built:** each request reads every event's bookings and pending registrations and filters them in memory. That suits SSI's scale (occasional events, at most a few thousand bookings each); it should move to indexed queries if volumes grow far beyond that.

### `GET /api/admin/bookings`

Requires `bookings`. Query parameters, all optional:

| Parameter | Meaning |
| --- | --- |
| `page`, `limit` | 1-based page; `limit` 1-100 (default 10) |
| `search` | booking reference, name, email, mobile or hospital (contains, any case) |
| `eventId` | one event |
| `dateFilter` | `upcoming` or `past` (slot date against today in the event's timezone) |
| `status` | `pending` or `confirmed` |
| `attendance` | `present` or `not_present` |
| `dayScheduleId`, `slotId` | one day or slot |
| `specialty`, `designation`, `country`, `state`, `city` | exact value, any case |
| `bookedFrom`, `bookedTo`, `timeZone` | `YYYY-MM-DD` booked-on range, as calendar days in `timeZone` |
| `sort` | `newest` (default), `oldest` or `name` |

Pending registrations are left out whenever a filter only confirmed bookings can match (`confirmed`, `past`, attendance, day or slot).

`200`:
```json
{ "success": true,
  "bookings": [{ "_id", "bookingId", "pending"?, "attendee": { "fullName", "email", "mobile" },
                 "event": { "_id", "eventName", "venue", "status", "timeZone" },
                 "daySchedule": { "_id", "date" } | null, "slot": { "_id", "startTime", "endTime" } | null,
                 "attendanceStatus", "createdAt" }],
  "events": [{ "_id", "eventName" }],
  "filterOptions": { "specialty": [], "designation": [], "country": [], "state": [], "city": [], "days": [], "slots": [] },
  "stats": { "total", "upcoming", "past", "pending" },
  "pagination": { "page", "limit", "total", "pages" } }
```
`days` and `slots` are filled only when `eventId` is set.

### `GET /api/admin/bookings/:id`

Requires `bookings`. `200 { success, booking: { _id, bookingId, pending?, details, eventId: {event}, slotId: {_id, startTime, endTime}, dayScheduleId: {_id, dayNumber, date}, attendanceStatus, checkedInAt, checkedInBy, checkInMethod, createdAt, updatedAt } }`. Pending registrations have `slotId` and `dayScheduleId` `null`. `400` malformed ID, `404` not found.

### `PATCH /api/admin/bookings/:id`

Requires `bookings` + create. Body: `{ details, attendanceStatus? }`.

- `details` is merged over the stored details and validated like a new booking (name, valid email, full mobile). A changed mobile number moves the ticket to that number in My Tickets.
- `attendanceStatus` (`PRESENT` / `NOT_PRESENT`) also needs `check-in`. It is the admin's manual correction, so unlike scanning it isn't limited to the slot's time. `PRESENT` records the admin and method `MANUAL`.

`200 { success, message, booking }` (same shape as GET). `400` invalid details, `404`.

### `DELETE /api/admin/bookings/:id`

Requires `bookings` + delete. Deletes the booking and frees its seat in one transaction (slot count, event count, retry key), at any time, even after check-in. A pending ID deletes the pending registration. `200 { success, message }`, `404`, `409` if the booking changed at the same moment.

### `DELETE /api/admin/bookings/pending/:id`

Requires `bookings` + delete. `200 { success }`, `400` malformed ID, `404`.

## Check-in

### `GET /api/admin/attendance?eventId=`

Requires `check-in`.

- Without `eventId`: `200 { success, events, stats: zeros, recent: [] }`, where `events` lists the events that are live today (`{ id, eventName, venue, startDate, endDate, timeZone }`).
- With `eventId`: also `stats: { total, present, remaining, percentage }` and `recent`, the ten latest check-ins (`{ id, bookingId, fullName, checkedInAt, checkedInBy, method }`). `400` if the event isn't live today.

### `POST /api/admin/attendance`

Requires `check-in`. Body: `{ eventId, method: "QR" | "MANUAL", code?, bookingId? }`

- `QR`: `code` is the scanned text. The ticket QR is JSON `{ type: "SSI_EVENTS_ATTENDANCE", bookingId, eventId }`; a bare booking reference is accepted too.
- `MANUAL`: `bookingId` is the reference typed by staff (any case).

**Rules:**
- The event must be live today and not cancelled (`409`).
- The ticket must belong to that event (`409` for another event's QR, `404` otherwise).
- Admission is open during the booked slot only, from its start until its end, in the event's timezone (`409` with the slot's times). Staff can still mark someone present at any time from the booking's page.
- Scanning a ticket that is already checked in is not an error: `alreadyPresent: true`. Two scanners reading the same ticket at once record it once.

`200 { success, alreadyPresent, message, booking: { id, bookingId, fullName, email, attendanceStatus, checkedInAt } }`

## Reports

### `GET /api/admin/reports?eventId=&from=&to=&attendance=&timeZone=`

Requires `reports`. Everything the reports screen shows and exports (CSV, Excel, print).

| Parameter | Meaning |
| --- | --- |
| `eventId` | one event (default: all) |
| `from`, `to` | registration dates `YYYY-MM-DD`, inclusive, as calendar days in `timeZone` |
| `attendance` | `present` or `not_present` (default: all) |
| `timeZone` | IANA zone for dates and the trend chart; default the selected event's zone, else Asia/Kolkata |

`400` for an invalid event ID, date range or timezone.

`200`:
- `summary`: `totalBookings`, `present`, `notPresent`, `attendanceRate` (%), `qrCheckIns`, `manualCheckIns`, `totalCapacity` / `reservedCapacity` / `remainingCapacity` / `slotUtilization` (%) across the events in scope, `events`, `liveEvents`
- `charts`: `registrationTrend` (per day, per month past 62 days), `attendanceByEvent` and `utilizationByEvent` (top 10), `attendanceStatus`, `checkInMethods`
- `eventPerformance`: per event: registrations, present, not present, attendance rate, capacity, booked seats, utilization
- `bookings`: the ledger, newest first: attendee (name, email, mobile, designation, specialty, hospital, city, state, country), event, slot (date, day, times), attendance (status, method, time, staff member) and registration time
- `eventOptions` (every event, for the filter), `filters`, `timeZone`, `generatedAt`

Capacity comes from each event's seat counters; attendance figures count the bookings that match the filters. Cancelled bookings are deleted, so they are not in reports.
