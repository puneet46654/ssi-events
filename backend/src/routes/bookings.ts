import { DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { db, keys, TABLE_NAME } from '../db/table.js';
import { error, HttpError, json } from '../http.js';
import { bumpRealtime } from '../lib/activity.js';
import { assertSameOrigin, jsonBody } from '../lib/body.js';
import {
  bookingFingerprint, getBooking, getEventCore, getSlots, grantCookie, hasGrant, hasSlotEnded, isBookingId, newBookingId,
  phoneIdentity, publicBooking, readBookingDetails, sha256, slotStart, type BookingItem, type EventCore, type SlotItem,
} from '../lib/bookings.js';
import { calendarDate, eventStatus, eventTimeZone, zonedDate } from '../lib/dates.js';
import { EDIT_LOCKED_MESSAGE, NOT_EDIT_LOCKED } from '../lib/event-lock.js';
import { isId } from '../lib/ids.js';
import { isValidPhone, normalizePhone } from '../lib/phone.js';
import type { Handler, Request } from '../router.js';
import { Temporal } from '@js-temporal/polyfill';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_BODY_CHARS = 10_000;

/** Which parts of a TransactWrite failed their conditions. */
function cancelledParts(err: unknown): boolean[] | null {
  if (!(err instanceof TransactionCanceledException)) return null;
  return (err.CancellationReasons ?? []).map((r) => r.Code === 'ConditionalCheckFailed');
}

function bookableEvent(event: EventCore | undefined): EventCore {
  if (!event) throw new HttpError(404, 'Event not found.');
  if (event.status === 'CANCELLED') throw new HttpError(409, 'This event has been cancelled. Tickets are not valid for admission.');
  if (eventStatus(event.startDate, event.endDate, new Date(), event.timeZone, event.status) === 'COMPLETED') {
    throw new HttpError(409, 'This event is not currently accepting bookings.');
  }
  return event;
}

function findSlot(slots: SlotItem[], dayId: string, slotId: string): SlotItem {
  const slot = slots.find((s) => s.slotId === slotId && s.dayId === dayId);
  if (!slot) throw new HttpError(400, 'Selected schedule or slot is invalid.');
  return slot;
}

/* GET /api/events/:id/slots — live availability per day. Never cached: seats change by the second. */
export const eventSlots: Handler = async (req) => {
  const { id } = req.params;
  if (!isId(id)) return error(400, 'Invalid event ID.');
  const [event, slots, days] = await Promise.all([
    getEventCore(id),
    getSlots(id),
    db.send(new QueryCommand({
      TableName: TABLE_NAME, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :d)',
      ExpressionAttributeValues: { ':pk': keys.event(id).PK, ':d': 'DAY#' },
    })),
  ]);
  if (!event) return error(404, 'Event not found.');
  const timeZone = eventTimeZone(event.timeZone);
  const cancelled = event.status === 'CANCELLED';
  const dayItems = (days.Items ?? []) as { dayId: string; dayNumber: number; date: string; startTime: string; endTime: string }[];
  return json(200, {
    success: true,
    event: {
      timeZone, _id: event.eventId, eventName: event.eventName, venue: event.venue, description: event.description,
      startDate: `${event.startDate}T00:00:00.000Z`, endDate: `${event.endDate}T00:00:00.000Z`,
      status: eventStatus(event.startDate, event.endDate, new Date(), timeZone, event.status),
    },
    days: dayItems.map((d) => ({
      _id: d.dayId, dayNumber: d.dayNumber, date: `${d.date}T00:00:00.000Z`, startTime: d.startTime, endTime: d.endTime,
      slots: slots.filter((s) => s.dayId === d.dayId).sort((a, b) => a.startTime.localeCompare(b.startTime)).map((s) => {
        const remaining = Math.max(0, s.capacity - s.bookedCount);
        const ended = hasSlotEnded(s.date, s.endTime, timeZone);
        return {
          _id: s.slotId, startTime: s.startTime, endTime: s.endTime, capacity: s.capacity, bookedCount: s.bookedCount,
          remaining, ended, available: !cancelled && remaining > 0 && !ended,
        };
      }),
    })),
  }, { 'cache-control': 'no-store' });
};

/** Pending registrations disappear at the start of the day after the event's last day. */
function eventEndsAt(endDate: string, timeZone: string): Date {
  const next = Temporal.PlainDate.from(calendarDate(endDate)).add({ days: 1 });
  return new Date(next.toZonedDateTime(eventTimeZone(timeZone)).epochMilliseconds);
}

/* POST /api/bookings/pending — attendee details saved before a slot is picked (shown to admins as Pending). */
export const savePending: Handler = async (req) => {
  assertSameOrigin(req);
  if (req.body.length > MAX_BODY_CHARS) throw new HttpError(413, 'Booking details are too large.');
  const body = jsonBody<{ eventId?: unknown; draftId?: unknown; details?: unknown }>(req);
  const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : '';
  const draftId = typeof body?.draftId === 'string' ? body.draftId.trim().toLowerCase() : '';
  if (!isId(eventId) || !UUID.test(draftId)) return error(400, 'Valid event and draft references are required.');
  const details = readBookingDetails(body?.details);
  const event = await getEventCore(eventId);
  if (!event) return error(404, 'Event not found.');
  const status = eventStatus(event.startDate, event.endDate, new Date(), event.timeZone, event.status);
  if (status === 'COMPLETED' || status === 'CANCELLED') return json(200, { success: true, saved: false, ended: true });

  const expiresAt = eventEndsAt(event.endDate, event.timeZone);
  const now = new Date().toISOString();
  await db.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      ...keys.pendingBooking(eventId, draftId), eventId, draftId, details,
      phone: phoneIdentity(details.mobile, details.countryCode), email: details.email,
      expiresAt: expiresAt.toISOString(), ttl: Math.floor(expiresAt.getTime() / 1000), updatedAt: now,
    },
  }));
  await bumpRealtime('bookings');
  return json(200, { success: true, saved: true, expiresAt: expiresAt.toISOString() });
};

/** A confirmed booking replaces any pending registration from the same email or phone. */
async function clearPending(eventId: string, booking: BookingItem): Promise<void> {
  const { Items = [] } = await db.send(new QueryCommand({
    TableName: TABLE_NAME, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :p)',
    ExpressionAttributeValues: { ':pk': keys.event(eventId).PK, ':p': 'PENDING#' },
  }));
  await Promise.all(Items.filter((i) => i.email === booking.email || i.phone === booking.phone)
    .map((i) => db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: i.PK, SK: i.SK } }))));
}

/** The booking a retry key already produced, if any. */
async function existingForKey(eventId: string, requestKeyHash: string, fingerprint: string): Promise<BookingItem | null> {
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.bookingRequest(eventId, requestKeyHash) }));
  if (!Item) return null;
  if (Item.fingerprint !== fingerprint) throw new HttpError(409, 'This retry key belongs to different booking details. Start a new booking.');
  return (await getBooking(Item.bookingId as string)) ?? null;
}

/*
 * POST /api/bookings — `{ eventId, dayScheduleId, slotId, details, idempotencyKey }`.
 * One transaction: claim a seat only while one is left, count it on the event, store the booking and
 * its retry key. Concurrent requests can't overbook; a retried request returns the original booking.
 */
export const createBooking: Handler = async (req) => {
  assertSameOrigin(req);
  if (req.body.length > MAX_BODY_CHARS) throw new HttpError(413, 'Booking details are too large.');
  const body = jsonBody<Record<string, unknown>>(req);
  const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : '';
  const slotId = typeof body?.slotId === 'string' ? body.slotId.trim() : '';
  const dayId = typeof body?.dayScheduleId === 'string' ? body.dayScheduleId.trim() : '';
  if (![eventId, slotId, dayId].every(isId)) return error(400, 'Valid event, schedule and slot references are required.');
  if (typeof body?.idempotencyKey !== 'string' || !UUID.test(body.idempotencyKey)) {
    return error(400, 'A valid booking retry key is required. Reopen the booking form.');
  }
  const details = readBookingDetails(body.details);
  const requestKeyHash = sha256(body.idempotencyKey.toLowerCase());
  const fingerprint = bookingFingerprint(eventId, dayId, slotId, details);

  const replay = await existingForKey(eventId, requestKeyHash, fingerprint);
  if (replay) return bookingResponse(replay, true);

  const event = bookableEvent(await getEventCore(eventId));
  const slot = findSlot(await getSlots(eventId), dayId, slotId);
  if (hasSlotEnded(slot.date, slot.endTime, event.timeZone)) throw new HttpError(409, 'This time slot has already ended. Please choose another slot.');

  const now = new Date().toISOString();
  const booking: BookingItem = {
    bookingId: newBookingId(zonedDate(new Date(), eventTimeZone(event.timeZone)).slice(0, 4)),
    eventId, slotId, slotSK: slot.SK, dayId, dayNumber: slot.dayNumber, date: slot.date,
    startTime: slot.startTime, endTime: slot.endTime, details,
    phone: phoneIdentity(details.mobile, details.countryCode), email: details.email,
    requestKeyHash, requestFingerprint: fingerprint, attendanceStatus: 'NOT_PRESENT', checkedInAt: null,
    createdAt: now, updatedAt: now,
  };
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Update: {
          TableName: TABLE_NAME, Key: { PK: slot.PK, SK: slot.SK },
          UpdateExpression: 'SET bookedCount = bookedCount + :one',
          ConditionExpression: 'bookedCount < #cap', // `capacity` is a DynamoDB reserved word
          ExpressionAttributeNames: { '#cap': 'capacity' },
          ExpressionAttributeValues: { ':one': 1 },
        } },
        { Update: {
          TableName: TABLE_NAME, Key: keys.event(eventId),
          UpdateExpression: 'ADD bookedSlots :one',
          ConditionExpression: `attribute_exists(PK) AND #s <> :cancelled AND ${NOT_EDIT_LOCKED}`,
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':one': 1, ':cancelled': 'CANCELLED', ':now': Date.now() },
        } },
        { Put: {
          TableName: TABLE_NAME,
          Item: {
            ...keys.booking(booking.bookingId), ...booking,
            GSI1PK: `EVENT#${eventId}#BOOKINGS`, GSI1SK: `${String(slot.dayNumber).padStart(2, '0')}#${slot.startTime}#${booking.bookingId}`,
            GSI2PK: `PHONE#${booking.phone}`, GSI2SK: `${now}#${booking.bookingId}`,
          },
          ConditionExpression: 'attribute_not_exists(PK)',
        } },
        { Put: {
          TableName: TABLE_NAME,
          Item: { ...keys.bookingRequest(eventId, requestKeyHash), bookingId: booking.bookingId, fingerprint, createdAt: now },
          ConditionExpression: 'attribute_not_exists(PK)',
        } },
      ],
    }));
  } catch (err) {
    const failed = cancelledParts(err);
    if (!failed) throw err;
    if (failed[3]) { // the same request won a race against itself
      const original = await existingForKey(eventId, requestKeyHash, fingerprint);
      if (original) return bookingResponse(original, true);
    }
    if (failed[0]) throw new HttpError(409, 'This slot is no longer available.');
    if (failed[1]) {
      const current = await getEventCore(eventId);
      throw new HttpError(409, current && current.status !== 'CANCELLED' ? EDIT_LOCKED_MESSAGE : 'This event has been cancelled. Tickets are not valid for admission.');
    }
    throw new HttpError(409, 'The booking could not be completed. Please retry.');
  }

  try { await clearPending(eventId, booking); } catch (err) { console.error('Pending cleanup failed', err); }
  await bumpRealtime('bookings');
  return bookingResponse(booking, false, event);
};

async function bookingResponse(booking: BookingItem, existing: boolean, event?: EventCore) {
  const ev = event ?? await getEventCore(booking.eventId);
  return json(existing ? 200 : 201, { success: true, existing, booking: publicBooking(booking, ev) }, {}, [grantCookie(booking.bookingId)]);
}

/** Self-service is limited to the browser that holds the ticket's access grant. */
function managedBookingId(req: Request, value: unknown): string {
  const bookingId = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!isBookingId(bookingId)) throw new HttpError(400, 'Booking reference is required.');
  if (!hasGrant(req, bookingId)) {
    throw new HttpError(403, 'For your security, bookings can only be changed on a device that has opened this ticket. Use My Tickets with your booking reference, or contact event staff.');
  }
  return bookingId;
}

/** Attendees may change or cancel only before the slot starts, before check-in, and while the event stands. */
async function manageable(bookingId: string): Promise<{ booking: BookingItem; event: EventCore }> {
  const booking = await getBooking(bookingId);
  if (!booking) throw new HttpError(404, 'Booking not found.');
  const event = await getEventCore(booking.eventId);
  if (!event || event.status === 'CANCELLED') throw new HttpError(409, 'This event has been cancelled.');
  if (booking.attendanceStatus === 'PRESENT') throw new HttpError(409, 'You have already checked in for this booking.');
  if (!(slotStart(booking.date, booking.startTime, event.timeZone) > Date.now())) {
    throw new HttpError(409, 'This time slot has already started, so the booking can no longer be changed.');
  }
  return { booking, event };
}

/* GET /api/bookings?bookingId= — the ticket, for a browser holding its grant. */
export const getOwnBooking: Handler = async (req) => {
  const bookingId = (req.query.bookingId || '').trim().toUpperCase();
  if (!bookingId) return error(400, 'Booking reference is required.');
  if (!isBookingId(bookingId) || !hasGrant(req, bookingId)) {
    return error(403, 'Open My Tickets and enter your booking reference and full mobile number.');
  }
  const booking = await getBooking(bookingId);
  if (!booking) return error(404, 'Booking not found.');
  return json(200, { success: true, booking: publicBooking(booking, await getEventCore(booking.eventId)) }, {}, [grantCookie(bookingId)]);
};

/* PATCH /api/bookings — `{ bookingId, dayScheduleId, slotId }`: move to another slot of the same event. */
export const rescheduleBooking: Handler = async (req) => {
  assertSameOrigin(req);
  const body = jsonBody<Record<string, unknown>>(req);
  const bookingId = managedBookingId(req, body?.bookingId);
  const dayId = typeof body?.dayScheduleId === 'string' ? body.dayScheduleId : '';
  const slotId = typeof body?.slotId === 'string' ? body.slotId : '';
  if (!isId(dayId) || !isId(slotId)) throw new HttpError(400, 'Choose a valid time slot.');
  const { booking, event } = await manageable(bookingId);
  if (booking.slotId === slotId) throw new HttpError(409, 'You are already booked in this time slot.');
  const slot = findSlot(await getSlots(booking.eventId), dayId, slotId);
  if (hasSlotEnded(slot.date, slot.endTime, event.timeZone)) throw new HttpError(409, 'This time slot has already ended. Please choose another slot.');

  const now = new Date().toISOString();
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Update: { // claim the new seat first, exactly like a new booking
          TableName: TABLE_NAME, Key: { PK: slot.PK, SK: slot.SK },
          UpdateExpression: 'SET bookedCount = bookedCount + :one', ConditionExpression: 'bookedCount < #cap',
          ExpressionAttributeNames: { '#cap': 'capacity' }, ExpressionAttributeValues: { ':one': 1 },
        } },
        { Update: {
          TableName: TABLE_NAME, Key: { PK: slot.PK, SK: booking.slotSK },
          UpdateExpression: 'SET bookedCount = bookedCount - :one', ConditionExpression: 'bookedCount > :zero',
          ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
        } },
        { Update: {
          TableName: TABLE_NAME, Key: keys.booking(bookingId),
          UpdateExpression: 'SET slotId = :slot, slotSK = :sk, dayId = :day, dayNumber = :dn, #d = :date, startTime = :st, endTime = :et, GSI1SK = :g, updatedAt = :now',
          ConditionExpression: 'slotId = :old AND attendanceStatus <> :present',
          ExpressionAttributeNames: { '#d': 'date' },
          ExpressionAttributeValues: {
            ':slot': slot.slotId, ':sk': slot.SK, ':day': slot.dayId, ':dn': slot.dayNumber, ':date': slot.date,
            ':st': slot.startTime, ':et': slot.endTime, ':g': `${String(slot.dayNumber).padStart(2, '0')}#${slot.startTime}#${bookingId}`,
            ':now': now, ':old': booking.slotId, ':present': 'PRESENT',
          },
        } },
        { ConditionCheck: { // not while an admin is changing the schedule
          TableName: TABLE_NAME, Key: keys.event(booking.eventId),
          ConditionExpression: `#s <> :cancelled AND ${NOT_EDIT_LOCKED}`,
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':cancelled': 'CANCELLED', ':now': Date.now() },
        } },
      ],
    }));
  } catch (err) {
    const failed = cancelledParts(err);
    if (!failed) throw err;
    if (failed[0]) throw new HttpError(409, 'This slot is no longer available.');
    if (failed[3]) throw new HttpError(409, EDIT_LOCKED_MESSAGE);
    throw new HttpError(409, 'The booking changed while you were editing it. Reload My Tickets and try again.');
  }
  await bumpRealtime('bookings');
  const updated = await getBooking(bookingId);
  return json(200, { success: true, booking: updated ? publicBooking(updated, event) : null });
};

/* DELETE /api/bookings?bookingId= — attendee cancels; the seat is released. */
export const cancelBooking: Handler = async (req) => {
  assertSameOrigin(req);
  const bookingId = managedBookingId(req, req.query.bookingId);
  const { booking } = await manageable(bookingId);
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Delete: {
          TableName: TABLE_NAME, Key: keys.booking(bookingId),
          ConditionExpression: 'attribute_exists(PK) AND attendanceStatus <> :present',
          ExpressionAttributeValues: { ':present': 'PRESENT' },
        } },
        { Update: {
          TableName: TABLE_NAME, Key: { PK: keys.event(booking.eventId).PK, SK: booking.slotSK },
          UpdateExpression: 'SET bookedCount = bookedCount - :one', ConditionExpression: 'bookedCount > :zero',
          ExpressionAttributeValues: { ':one': 1, ':zero': 0 },
        } },
        { Update: {
          TableName: TABLE_NAME, Key: keys.event(booking.eventId),
          UpdateExpression: 'ADD bookedSlots :minus', ExpressionAttributeValues: { ':minus': -1 },
        } },
        { Delete: { TableName: TABLE_NAME, Key: keys.bookingRequest(booking.eventId, booking.requestKeyHash) } },
      ],
    }));
  } catch (err) {
    if (!cancelledParts(err)) throw err;
    throw new HttpError(409, 'This booking was already changed or checked in. Reload My Tickets.');
  }
  await bumpRealtime('bookings');
  return json(200, { success: true });
};

/*
 * POST /api/events/mytickets — `{ mobile, bookingId? }`.
 * Returns the tickets registered to that full mobile number that this browser may see: those it
 * already holds an access grant for (it booked or opened them before), plus the one matching
 * `bookingId` if given, which then receives a grant. A phone number alone is not proof of
 * ownership, so it never reveals tickets, or whether any exist, by itself.
 */
export const myTickets: Handler = async (req) => {
  assertSameOrigin(req);
  const body = jsonBody<{ mobile?: unknown; bookingId?: unknown }>(req);
  const mobile = typeof body?.mobile === 'string' ? body.mobile.trim() : '';
  if (!isValidPhone(mobile)) return json(400, { success: false, message: 'Enter the mobile number you registered with.' });
  const reference = typeof body?.bookingId === 'string' ? body.bookingId.trim().toUpperCase() : '';
  if (reference && !isBookingId(reference)) return json(400, { success: false, message: 'Check the booking reference. It looks like SSI-EV-2026-1A2B3C4D5E6F.' });

  const phone = normalizePhone(mobile);
  const { Items = [] } = await db.send(new QueryCommand({
    TableName: TABLE_NAME, IndexName: 'GSI2',
    KeyConditionExpression: 'GSI2PK = :p', ExpressionAttributeValues: { ':p': `PHONE#${phone}` },
  }));
  const bookings = Items as BookingItem[];
  const visible = bookings.filter((b) => b.bookingId === reference || hasGrant(req, b.bookingId));
  if (reference && !visible.some((b) => b.bookingId === reference)) {
    return json(404, { success: false, message: 'No ticket matches that booking reference and mobile number.' });
  }

  const events = new Map<string, EventCore | undefined>();
  await Promise.all([...new Set(visible.map((b) => b.eventId))].map(async (id) => events.set(id, await getEventCore(id))));
  const tickets = visible.map((b) => {
    const ticket = publicBooking(b, events.get(b.eventId));
    return { ...ticket, canManage: ticket.status === 'ACTIVE' && slotStart(b.date, b.startTime, ticket.timeZone) > Date.now() };
  });
  // `referenceNeeded` depends only on what this browser can see, never on whether the number has
  // other bookings, so the response can't be used to test which phone numbers are registered.
  return json(200, { success: true, tickets, referenceNeeded: tickets.length === 0 }, {}, visible.map((b) => grantCookie(b.bookingId)));
};
