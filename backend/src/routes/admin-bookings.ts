import { DeleteCommand, GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { db, keys, TABLE_NAME } from '../db/table.js';
import { error, HttpError, json } from '../http.js';
import { bumpRealtime, logActivity } from '../lib/activity.js';
import {
  allEvents, eventBookings, eventPending, eventWaitlist, parsePendingRowId, waitlistPositions, pendingRowId, type AdminEvent, type PendingItem,
} from '../lib/admin-data.js';
import { requireAdmin } from '../lib/admins.js';
import { seatWaitlistEntry } from '../lib/waitlist.js';
import { assertSameOrigin, jsonBody } from '../lib/body.js';
import { getBooking, isBookingId, isOpenRegistration, phoneIdentity, readBookingDetails, type BookingItem } from '../lib/bookings.js';
import { eventStatus, eventTimeZone, isTimeZone, zonedDate } from '../lib/dates.js';
import { isId } from '../lib/ids.js';
import { isCalendarDate } from '../lib/schedule.js';
import { Temporal } from '@js-temporal/polyfill';
import type { Handler, Request } from '../router.js';

const DETAIL_FILTERS = ['specialty', 'designation', 'country', 'state', 'city'] as const;
const SEARCHED = ['fullName', 'email', 'mobile', 'hospitalName'] as const;

const isoDate = (date: string) => `${date}T00:00:00.000Z`;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

function eventSummary(e: AdminEvent | undefined, now: Date) {
  if (!e) return null;
  return {
    _id: e.eventId, eventName: e.eventName, venue: e.venue,
    status: eventStatus(e.startDate, e.endDate, now, e.timeZone, e.status), timeZone: eventTimeZone(e.timeZone),
  };
}

/** Today in the booking's event timezone decides upcoming vs past. */
function isPast(b: BookingItem, event: AdminEvent | undefined, now: Date) {
  return b.date < zonedDate(now, eventTimeZone(event?.timeZone));
}

/** Start of a calendar day in a timezone, as an ISO instant. */
function dayStart(date: string, timeZone: string) {
  return new Date(Temporal.PlainDate.from(date).toZonedDateTime(timeZone).epochMilliseconds).toISOString();
}

type Row = { pending: boolean; at: string; name: string; booking?: BookingItem; pendingItem?: PendingItem; event?: AdminEvent };

/**
 * GET /api/admin/bookings — confirmed bookings and pending registrations in one paginated list,
 * with the filters, dropdown options and summary figures the bookings screen shows.
 */
export const listBookings: Handler = async (req) => {
  await requireAdmin(req, 'bookings');
  const q = req.query;
  const page = Math.min(Math.max(Math.floor(Number(q.page)) || 1, 1), 100_000);
  const limit = Math.min(Math.max(Math.floor(Number(q.limit)) || 10, 1), 100);
  const search = (q.search || '').trim().toLowerCase();
  const eventId = isId(q.eventId) ? q.eventId : '';
  const dateFilter = q.dateFilter === 'upcoming' || q.dateFilter === 'past' ? q.dateFilter : 'all';
  const sort = q.sort === 'oldest' || q.sort === 'name' ? q.sort : 'newest';
  const zone = isTimeZone(q.timeZone) ? q.timeZone : 'Asia/Kolkata';
  const bookedFrom = isCalendarDate(q.bookedFrom) ? dayStart(q.bookedFrom, zone) : '';
  const bookedTo = isCalendarDate(q.bookedTo) ? dayStart(Temporal.PlainDate.from(q.bookedTo).add({ days: 1 }).toString(), zone) : '';
  const detailFilters = DETAIL_FILTERS.map((key) => [key, (q[key] || '').trim().toLowerCase()] as const).filter(([, v]) => v);

  const now = new Date();
  const events = await allEvents();
  const eventsById = new Map(events.map((e) => [e.eventId, e]));
  const loaded = await Promise.all(events.map(async (e) => ({
    e, bookings: await eventBookings(e.eventId), pending: await eventPending(e.eventId), waitlist: await eventWaitlist(e.eventId),
  })));
  const bookings = loaded.flatMap((l) => l.bookings);
  const pending = loaded.flatMap((l) => l.pending);
  const waitlist = loaded.flatMap((l) => l.waitlist);
  const positions = new Map(loaded.flatMap((l) => [...waitlistPositions(l.waitlist)]));

  // Slot, day and attendance exist only on confirmed bookings; pending ones belong to events not yet over.
  // Admins see only confirmed bookings and waitlist places; details saved without a slot are not listed.
  const excludePending = true;
  const excludeBookings = q.status === 'pending' || q.status === 'waitlisted';
  // Waitlist places hold no seat and have no attendance; they show only under All or Waitlisted.
  const excludeWaitlist = (!!q.status && q.status !== 'waitlisted') || !!q.attendance;
  const sharedMatch = (details: Record<string, unknown>, at: string, rowEventId: string, reference = '') =>
    (!eventId || rowEventId === eventId)
    && (!search || reference.toLowerCase().includes(search) || SEARCHED.some((f) => text(details[f]).toLowerCase().includes(search)))
    && detailFilters.every(([key, value]) => text(details[key]).trim().toLowerCase() === value)
    && (!bookedFrom || at >= bookedFrom) && (!bookedTo || at < bookedTo);

  const rows: Row[] = [];
  if (!excludeBookings) {
    for (const b of bookings) {
      const event = eventsById.get(b.eventId);
      if (!sharedMatch(b.details, b.createdAt, b.eventId, b.bookingId)) continue;
      if (dateFilter !== 'all' && isPast(b, event, now) !== (dateFilter === 'past')) continue;
      if (q.attendance === 'present' && b.attendanceStatus !== 'PRESENT') continue;
      if (q.attendance === 'not_present' && b.attendanceStatus === 'PRESENT') continue;
      if (q.dayScheduleId && b.dayId !== q.dayScheduleId) continue;
      if (q.slotId && b.slotId !== q.slotId) continue;
      rows.push({ pending: false, at: b.createdAt, name: b.details.fullName || '', booking: b, event });
    }
  }
  if (!excludeWaitlist) {
    for (const b of waitlist) {
      const event = eventsById.get(b.eventId);
      if (!sharedMatch(b.details, b.createdAt, b.eventId, b.bookingId)) continue;
      if (dateFilter !== 'all' && isPast(b, event, now) !== (dateFilter === 'past')) continue;
      if (q.dayScheduleId && b.dayId !== q.dayScheduleId) continue;
      if (q.slotId && b.slotId !== q.slotId) continue;
      rows.push({ pending: false, at: b.createdAt, name: b.details.fullName || '', booking: b, event });
    }
  }
  if (!excludePending) {
    for (const p of pending) {
      if (!sharedMatch(p.details, p.updatedAt, p.eventId)) continue;
      rows.push({ pending: true, at: p.updatedAt, name: p.details.fullName || '', pendingItem: p, event: eventsById.get(p.eventId) });
    }
  }
  rows.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'oldest' ? a.at.localeCompare(b.at) : b.at.localeCompare(a.at));

  const pageRows = rows.slice((page - 1) * limit, page * limit).map((r) => {
    const details = (r.booking?.details ?? r.pendingItem?.details ?? {}) as Record<string, unknown>;
    const b = r.booking;
    return {
      _id: b ? b.bookingId : pendingRowId(r.pendingItem!),
      bookingId: b?.bookingId ?? '',
      ...(r.pending ? { pending: true } : {}),
      ...(b?.waitlisted ? { waitlisted: true, waitlistPosition: positions.get(b.bookingId) ?? null } : {}),
      ...(b?.seatedFromWaitlist ? { seatedFromWaitlist: true } : {}),
      attendee: { fullName: text(details.fullName) || 'Unknown attendee', email: text(details.email), mobile: text(details.mobile) },
      event: eventSummary(r.event, now),
      daySchedule: b && !isOpenRegistration(b) ? { _id: b.dayId, date: isoDate(b.date) } : null,
      slot: b && !isOpenRegistration(b) ? { _id: b.slotId, startTime: b.startTime, endTime: b.endTime } : null,
      registrationOnly: b ? isOpenRegistration(b) : false,
      attendanceStatus: b?.attendanceStatus ?? 'NOT_PRESENT',
      createdAt: r.at,
    };
  });

  // Dropdown choices: values that actually occur, plus the selected event's days and slots.
  const filterOptions: Record<string, unknown> = Object.fromEntries(DETAIL_FILTERS.map((key) => {
    const unique = new Map<string, string>();
    for (const b of bookings) {
      const value = text((b.details as Record<string, unknown>)[key]).trim();
      if (value) unique.set(value.toLowerCase(), value);
    }
    return [key, [...unique.values()].sort((a, b) => a.localeCompare(b))];
  }));
  filterOptions.days = [];
  filterOptions.slots = [];
  if (eventId && eventsById.has(eventId)) {
    const { getSlots } = await import('../lib/bookings.js');
    const slots = (await getSlots(eventId)).sort((a, b) => a.dayNumber - b.dayNumber || a.startTime.localeCompare(b.startTime));
    const days = new Map<string, string>();
    for (const s of slots) days.set(s.dayId, s.date);
    filterOptions.days = [...days].map(([_id, date]) => ({ _id, label: date }));
    filterOptions.slots = slots.map((s) => ({ _id: s.slotId, dayScheduleId: s.dayId, label: `${s.startTime} – ${s.endTime}` }));
  }

  const past = bookings.filter((b) => isPast(b, eventsById.get(b.eventId), now)).length;
  return json(200, {
    success: true,
    bookings: pageRows,
    events: [...events].sort((a, b) => b.startDate.localeCompare(a.startDate)).map((e) => ({ _id: e.eventId, eventName: e.eventName })),
    filterOptions,
    stats: { total: bookings.length, upcoming: bookings.length - past, past, pending: 0, waitlisted: waitlist.length },
    pagination: { page, limit, total: rows.length, pages: Math.max(Math.ceil(rows.length / limit), 1) },
  });
};

/* ---------- One booking ---------- */

async function getEvent(eventId: string): Promise<(AdminEvent & Record<string, unknown>) | undefined> {
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.event(eventId) }));
  return Item as (AdminEvent & Record<string, unknown>) | undefined;
}

async function getPending(id: string): Promise<PendingItem | undefined> {
  const ref = parsePendingRowId(id);
  if (!ref) return undefined;
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.pendingBooking(ref.eventId, ref.draftId) }));
  return Item as PendingItem | undefined;
}

function eventDetail(e: (AdminEvent & Record<string, unknown>) | undefined) {
  if (!e) return null;
  return {
    _id: e.eventId, eventName: e.eventName, eventType: e.eventType, venue: e.venue,
    startDate: isoDate(e.startDate), endDate: isoDate(e.endDate), timeZone: eventTimeZone(e.timeZone),
    status: eventStatus(e.startDate, e.endDate, new Date(), e.timeZone, e.status),
  };
}

/** The booking detail screen's shape: event, slot and day as nested objects. */
async function bookingDetail(b: BookingItem) {
  return {
    _id: b.bookingId, bookingId: b.bookingId, details: b.details,
    eventId: eventDetail(await getEvent(b.eventId)),
    slotId: isOpenRegistration(b) ? null : { _id: b.slotId, startTime: b.startTime, endTime: b.endTime },
    dayScheduleId: isOpenRegistration(b) ? null : { _id: b.dayId, dayNumber: b.dayNumber, date: isoDate(b.date) },
    registrationOnly: isOpenRegistration(b),
    attendanceStatus: b.attendanceStatus, checkedInAt: b.checkedInAt ?? null, checkedInBy: b.checkedInBy || '',
    checkInMethod: b.checkInMethod || '', createdAt: b.createdAt, updatedAt: b.updatedAt,
    waitlisted: !!b.waitlisted, seatedFromWaitlist: !!b.seatedFromWaitlist,
  };
}

async function pendingDetail(p: PendingItem) {
  return {
    _id: pendingRowId(p), bookingId: '', pending: true, details: p.details,
    eventId: eventDetail(await getEvent(p.eventId)), slotId: null, dayScheduleId: null,
    attendanceStatus: 'NOT_PRESENT', createdAt: p.updatedAt, updatedAt: p.updatedAt,
  };
}

const bookingRef = (id: string) => id.trim().toUpperCase();

/** GET /api/admin/bookings/:id — a booking (by reference) or a pending registration. */
export const getAdminBooking: Handler = async (req) => {
  await requireAdmin(req, 'bookings');
  const { id } = req.params as { id: string };
  if (isBookingId(bookingRef(id))) {
    const booking = await getBooking(bookingRef(id));
    if (booking) return json(200, { success: true, booking: await bookingDetail(booking) });
  } else {
    const pending = await getPending(id);
    if (pending) return json(200, { success: true, booking: await pendingDetail(pending) });
    if (!parsePendingRowId(id)) return error(400, 'Invalid booking ID.');
  }
  return error(404, 'Booking not found.');
};

/** Attendee fields from the edit form merged over the stored ones, then validated like a new booking. */
function mergedDetails(current: Record<string, unknown>, input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Valid booking details are required.');
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key)) continue;
    merged[key] = value === null || value === undefined ? '' : String(value);
  }
  return readBookingDetails(merged);
}

/**
 * PATCH /api/admin/bookings/:id — `{ details, attendanceStatus? }`. Corrects attendee details (needs
 * bookings + create). `attendanceStatus` also needs check-in access and, unlike scanning, is not
 * limited to the slot's time: it is the admin's manual correction.
 */
export const updateAdminBooking: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await requireAdmin(req, 'bookings', 'write');
  const { id } = req.params as { id: string };
  const body = jsonBody<{ details?: unknown; attendanceStatus?: unknown }>(req);
  const attendance = body?.attendanceStatus;
  if (attendance !== undefined && attendance !== 'PRESENT' && attendance !== 'NOT_PRESENT') return error(400, 'Invalid attendance status.');
  if (attendance !== undefined) await requireAdmin(req, 'check-in');
  const now = new Date().toISOString();

  if (!isBookingId(bookingRef(id))) {
    const pending = await getPending(id);
    if (!pending) return error(parsePendingRowId(id) ? 404 : 400, parsePendingRowId(id) ? 'Booking not found.' : 'Invalid booking ID.');
    const details = mergedDetails(pending.details, body?.details);
    await db.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: keys.pendingBooking(pending.eventId, pending.draftId),
      UpdateExpression: 'SET details = :d, phone = :p, email = :e, updatedAt = :now',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':d': details, ':p': phoneIdentity(details.mobile, details.countryCode), ':e': details.email, ':now': now },
    }));
    await Promise.all([
      bumpRealtime('bookings'),
      logActivity({ admin: admin.username, action: 'update', resource: 'booking', resourceId: pendingRowId(pending), details: { pending: true, fields: Object.keys(body?.details as object) } }),
    ]);
    const updated = await getPending(id);
    return json(200, { success: true, message: 'Pending booking updated successfully.', booking: updated && await pendingDetail(updated) });
  }

  const booking = await getBooking(bookingRef(id));
  if (!booking) return error(404, 'Booking not found.');
  if (booking.waitlisted && attendance === 'PRESENT') {
    // "Mark present" on a waitlisted doctor seats them: confirmed booking, checked in.
    await seatWaitlistEntry(booking, admin.username);
    await Promise.all([
      bumpRealtime('attendance'), bumpRealtime('bookings'),
      logActivity({ admin: admin.username, action: 'update', resource: 'booking', resourceId: booking.bookingId, details: { bookingId: booking.bookingId, seatedFromWaitlist: `${booking.date} ${booking.startTime}` } }),
    ]);
    const seated = await getBooking(booking.bookingId);
    return json(200, { success: true, message: 'Seated from the waitlist and marked present.', booking: seated && await bookingDetail(seated) });
  }
  const details = mergedDetails(booking.details, body?.details);
  const phone = phoneIdentity(details.mobile, details.countryCode);
  const changeAttendance = attendance !== undefined && attendance !== booking.attendanceStatus;

  const sets = ['details = :d', 'phone = :p', 'email = :e', 'GSI2PK = :g2', 'updatedAt = :now'];
  const values: Record<string, unknown> = { ':d': details, ':p': phone, ':e': details.email, ':g2': `PHONE#${phone}`, ':now': now };
  if (changeAttendance && attendance === 'PRESENT') {
    sets.push('attendanceStatus = :a', 'checkedInAt = :now', 'checkedInBy = :by', 'checkInMethod = :m');
    Object.assign(values, { ':a': 'PRESENT', ':by': admin.username, ':m': 'MANUAL' });
  } else if (changeAttendance) {
    sets.push('attendanceStatus = :a', 'checkedInAt = :null', 'checkedInBy = :blank');
    Object.assign(values, { ':a': 'NOT_PRESENT', ':null': null, ':blank': '' });
  }
  await db.send(new UpdateCommand({
    TableName: TABLE_NAME, Key: keys.booking(booking.bookingId),
    UpdateExpression: `SET ${sets.join(', ')}${changeAttendance && attendance === 'NOT_PRESENT' ? ' REMOVE checkInMethod' : ''}`,
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeValues: values,
  }));
  await Promise.all([
    bumpRealtime('bookings'),
    changeAttendance ? bumpRealtime('attendance') : Promise.resolve(),
    logActivity({
      admin: admin.username, action: 'update', resource: 'booking', resourceId: booking.bookingId,
      details: { bookingId: booking.bookingId, fields: Object.keys(body?.details as object), ...(changeAttendance ? { attendanceStatus: attendance } : {}) },
    }),
  ]);
  const updated = await getBooking(booking.bookingId);
  return json(200, { success: true, message: 'Booking updated successfully.', booking: updated && await bookingDetail(updated) });
};

async function deletePending(req: Request, id: string, adminName: string) {
  const ref = parsePendingRowId(id);
  if (!ref) return error(400, 'Invalid pending booking ID.');
  try {
    await db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: keys.pendingBooking(ref.eventId, ref.draftId), ConditionExpression: 'attribute_exists(PK)' }));
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return error(404, 'Pending booking not found.');
    throw err;
  }
  await Promise.all([
    bumpRealtime('bookings'),
    logActivity({ admin: adminName, action: 'delete', resource: 'booking', resourceId: id, details: { pending: true } }),
  ]);
  return json(200, { success: true, message: 'Pending booking deleted.' });
}

/**
 * DELETE /api/admin/bookings/:id — removes a booking and frees its seat, at any time and even after
 * check-in (the attendee's own cancel is stricter). Pending IDs are accepted too.
 */
export const deleteAdminBooking: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await requireAdmin(req, 'bookings', 'delete');
  const { id } = req.params as { id: string };
  if (!isBookingId(bookingRef(id))) return deletePending(req, id, admin.username);
  const booking = await getBooking(bookingRef(id));
  if (!booking) return error(404, 'Booking not found.');
  const seatHeld = !booking.waitlisted;
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE_NAME, Key: keys.booking(booking.bookingId), ConditionExpression: 'attribute_exists(PK)' } },
        ...(isOpenRegistration(booking) || !seatHeld ? [] : [{ Update: {
          TableName: TABLE_NAME, Key: { PK: keys.event(booking.eventId).PK, SK: booking.slotSK },
          UpdateExpression: 'SET bookedCount = bookedCount - :one', ConditionExpression: 'bookedCount > :zero',
          ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
        } }]),
        ...(seatHeld ? [{ Update: { TableName: TABLE_NAME, Key: keys.event(booking.eventId), UpdateExpression: 'ADD bookedSlots :minus', ExpressionAttributeValues: { ':minus': -1 } } }] : []),
        { Delete: { TableName: TABLE_NAME, Key: keys.bookingRequest(booking.eventId, booking.requestKeyHash) } },
      ],
    }));
  } catch (err) {
    if (!(err instanceof TransactionCanceledException)) throw err;
    throw new HttpError(409, 'This booking was changed at the same time. Reload and try again.');
  }
  await Promise.all([
    bumpRealtime('bookings'), bumpRealtime('attendance'),
    logActivity({ admin: admin.username, action: 'delete', resource: 'booking', resourceId: booking.bookingId, details: { bookingId: booking.bookingId, eventId: booking.eventId } }),
  ]);
  return json(200, { success: true, message: seatHeld ? 'Booking deleted successfully.' : 'Removed from the waitlist.' });
};

/** DELETE /api/admin/bookings/pending/:id — discards a pending registration. */
export const deletePendingBooking: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await requireAdmin(req, 'bookings', 'delete');
  return deletePending(req, (req.params as { id: string }).id, admin.username);
};
