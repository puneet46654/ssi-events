import { TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { db, keys, TABLE_NAME } from '../db/table.js';
import { error, json } from '../http.js';
import { bumpRealtime, logActivity } from '../lib/activity.js';
import { allEvents, eventBookings } from '../lib/admin-data.js';
import { requireAdmin } from '../lib/admins.js';
import { assertSameOrigin, jsonBody } from '../lib/body.js';
import { getBooking, getSlots, isBookingId, isOpenRegistration, slotStart, type BookingItem, type SlotItem } from '../lib/bookings.js';
import { eventStatus, eventTimeZone, zonedDate } from '../lib/dates.js';
import { NOT_EDIT_LOCKED } from '../lib/event-lock.js';
import { isId } from '../lib/ids.js';
import type { Handler } from '../router.js';

const isLive = (e: { startDate: string; endDate: string; timeZone: string; status: string }) =>
  eventStatus(e.startDate, e.endDate, new Date(), e.timeZone, e.status) === 'LIVE';

/** QR check-in opens this long before a slot starts and stays open until it ends. */
export const EARLY_CHECK_IN_MS = 15 * 60 * 1000;

const minutesBefore = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  const total = (h! * 60 + m! - EARLY_CHECK_IN_MS / 60000 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

/** Whether a slot admits people now: from 15 minutes before its start until its end, in the event's timezone. */
function slotOpen(slot: Pick<SlotItem, 'date' | 'startTime' | 'endTime'>, timeZone: string, now = Date.now()) {
  const start = slotStart(slot.date, slot.startTime, timeZone), end = slotStart(slot.date, slot.endTime, timeZone);
  return Number.isFinite(start) && Number.isFinite(end) && end > start && now >= start - EARLY_CHECK_IN_MS && now < end;
}

function checkInWindow(b: BookingItem, timeZone: string, now = Date.now()) {
  const zone = eventTimeZone(timeZone);
  const start = slotStart(b.date, b.startTime, zone), end = slotStart(b.date, b.endTime, zone);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { allowed: false, message: 'This ticket has an invalid appointment time. Ask event staff for assistance.' };
  }
  return {
    allowed: slotOpen(b, zone, now),
    message: `This ticket is for ${b.date}, ${b.startTime}–${b.endTime} (${zone}). Check-in opens at ${minutesBefore(b.startTime)}.`,
  };
}

/** Other slots of the event that admit people right now and still have seats: where an early or late arrival can go. */
async function openSlotsNow(b: BookingItem, timeZone: string) {
  const zone = eventTimeZone(timeZone);
  const today = zonedDate(new Date(), zone);
  return (await getSlots(b.eventId))
    .filter((s) => s.slotId !== b.slotId && s.date === today && s.bookedCount < s.capacity && slotOpen(s, zone))
    .sort((a, b2) => a.startTime.localeCompare(b2.startTime))
    .map((s) => ({ slotId: s.slotId, dayScheduleId: s.dayId, date: s.date, startTime: s.startTime, endTime: s.endTime, remaining: s.capacity - s.bookedCount }));
}

/**
 * GET /api/admin/attendance?eventId= — the events that are live today and, for the chosen one,
 * attendance figures and the ten latest check-ins.
 */
export const attendanceSummary: Handler = async (req) => {
  await requireAdmin(req, 'check-in');
  // Information-only events issue no tickets, so there is nothing to check in.
  const live = (await allEvents()).filter((e) => isLive(e) && e.registrationMode !== 'info').sort((a, b) => a.startDate.localeCompare(b.startDate));
  const events = live.map((e) => ({
    id: e.eventId, eventName: e.eventName, venue: e.venue,
    startDate: `${e.startDate}T00:00:00.000Z`, endDate: `${e.endDate}T00:00:00.000Z`, timeZone: eventTimeZone(e.timeZone),
  }));
  const eventId = (req.query.eventId || '').trim();
  if (!eventId) return json(200, { success: true, events, stats: { total: 0, present: 0, remaining: 0, percentage: 0 }, recent: [] });
  if (!isId(eventId)) return error(400, 'Invalid event.');
  if (!live.some((e) => e.eventId === eventId)) return error(400, 'Selected event is not currently live.');

  const bookings = await eventBookings(eventId);
  const present = bookings.filter((b) => b.attendanceStatus === 'PRESENT');
  const total = bookings.length;
  return json(200, {
    success: true, events,
    stats: { total, present: present.length, remaining: total - present.length, percentage: total ? Math.round((present.length / total) * 100) : 0 },
    recent: present
      .sort((a, b) => String(b.checkedInAt).localeCompare(String(a.checkedInAt)))
      .slice(0, 10)
      .map((b) => ({
        id: b.bookingId, bookingId: b.bookingId, fullName: b.details.fullName || 'Attendee',
        checkedInAt: b.checkedInAt ?? null, checkedInBy: b.checkedInBy || '', method: b.checkInMethod || 'QR',
      })),
  });
};

/** The booking reference in a scanned code: the ticket's JSON QR, or a bare reference. */
function referenceFrom(code: string, eventId: string): { reference: string } | { problem: [number, string] } {
  let qr: { type?: unknown; bookingId?: unknown; doctorId?: unknown; eventId?: unknown } | null = null;
  try { qr = JSON.parse(code); } catch { /* not JSON: a bare booking reference */ }
  if (!qr || typeof qr !== 'object') return { reference: code };
  if (qr.type !== 'SSI_EVENTS_ATTENDANCE') return { problem: [400, 'This is not an SS Innovations event ticket.'] };
  if (qr.eventId !== eventId) return { problem: [409, 'This ticket belongs to another event.'] };
  return { reference: String(qr.bookingId || qr.doctorId || '') };
}

/**
 * POST /api/admin/attendance — `{ eventId, method: "QR" | "MANUAL", code?, bookingId?, moveToSlotId? }`.
 * Records the attendee as present. Scanning the same ticket again is harmless: it reports
 * `alreadyPresent`. Outside the ticket's own slot the answer is 409 with `openSlots`: the slots open
 * now with free seats. Sending `moveToSlotId` moves the booking into one of them and checks in, in
 * one transaction.
 */
export const checkIn: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await requireAdmin(req, 'check-in');
  const body = jsonBody<{ eventId?: unknown; code?: unknown; bookingId?: unknown; method?: unknown; moveToSlotId?: unknown }>(req);
  const eventId = typeof body?.eventId === 'string' ? body.eventId.trim() : '';
  const method = body?.method === 'MANUAL' ? 'MANUAL' : 'QR';
  if (!isId(eventId)) return error(400, 'Select a valid live event first.');

  let reference: string;
  if (method === 'QR') {
    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    if (!code) return error(400, 'The QR code is empty.');
    const parsed = referenceFrom(code, eventId);
    if ('problem' in parsed) return error(...parsed.problem);
    reference = parsed.reference;
  } else {
    reference = typeof body?.bookingId === 'string' ? body.bookingId : '';
  }
  reference = reference.trim().toUpperCase();
  if (!reference) return error(400, 'Enter the booking reference.');

  const event = (await allEvents()).find((e) => e.eventId === eventId);
  if (!event || !isLive(event)) return error(409, 'This event is cancelled or is not live. Admission is unavailable.');
  const booking = isBookingId(reference) ? await getBooking(reference) : undefined;
  if (!booking || booking.eventId !== eventId) return error(404, 'Ticket not found for the selected event.');

  const respond = (b: BookingItem, alreadyPresent: boolean) => json(200, {
    success: true, alreadyPresent,
    message: alreadyPresent ? 'Attendance was already recorded.' : 'Attendance recorded successfully.',
    booking: {
      id: b.bookingId, bookingId: b.bookingId, fullName: b.details.fullName || 'Attendee', email: b.details.email || '',
      attendanceStatus: 'PRESENT', checkedInAt: b.checkedInAt ?? null,
    },
  });
  if (booking.attendanceStatus === 'PRESENT') return respond(booking, true);
  // A registration without a time slot is admitted at any time while the event is live (checked above).
  const window = isOpenRegistration(booking) ? { allowed: true, message: '' } : checkInWindow(booking, event.timeZone);
  const moveTo = typeof body?.moveToSlotId === 'string' && !isOpenRegistration(booking) ? body.moveToSlotId : '';
  if (moveTo) return moveAndCheckIn(booking, moveTo, event.timeZone, admin.username, method, respond);
  if (!window.allowed) {
    const openSlots = await openSlotsNow(booking, event.timeZone);
    return json(409, {
      success: false, error: window.message, message: window.message,
      booking: { bookingId: booking.bookingId, fullName: booking.details.fullName || 'Attendee', date: booking.date, startTime: booking.startTime, endTime: booking.endTime },
      openSlots,
    });
  }

  const checkedInAt = new Date().toISOString();
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: keys.booking(booking.bookingId),
      UpdateExpression: 'SET attendanceStatus = :present, checkedInAt = :at, checkedInBy = :by, checkInMethod = :m, updatedAt = :at',
      ConditionExpression: 'attribute_exists(PK) AND attendanceStatus <> :present',
      ExpressionAttributeValues: { ':present': 'PRESENT', ':at': checkedInAt, ':by': admin.username, ':m': method },
    }));
  } catch (err) {
    if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
    // Two scanners read the same ticket at once, or the booking was just removed.
    const current = await getBooking(booking.bookingId);
    if (current?.attendanceStatus === 'PRESENT') return respond(current, true);
    return error(404, 'Ticket not found for the selected event.');
  }
  await bumpRealtime('attendance');
  return respond({ ...booking, checkedInAt }, false);
};

/**
 * Moves an early or late arrival into a slot that is open now and checks them in. One transaction:
 * claim the new seat (only while one is free), release the old one, update the booking (only if it
 * is unchanged and not yet checked in), and only while the event is not being edited or cancelled.
 */
async function moveAndCheckIn(
  booking: BookingItem, slotId: string, timeZone: string, adminName: string, method: 'QR' | 'MANUAL',
  respond: (b: BookingItem, alreadyPresent: boolean) => ReturnType<typeof json>,
) {
  if (!isId(slotId)) return error(400, 'Choose a valid slot.');
  const target = (await openSlotsNow(booking, timeZone)).find((s) => s.slotId === slotId);
  if (!target) return error(409, 'That slot is no longer open or has no free seats. Scan the ticket again to see the current options.');
  const slot = (await getSlots(booking.eventId)).find((s) => s.slotId === slotId)!;
  const at = new Date().toISOString();
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Update: {
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
          TableName: TABLE_NAME, Key: keys.booking(booking.bookingId),
          UpdateExpression: 'SET slotId = :slot, slotSK = :sk, dayId = :day, dayNumber = :dn, #d = :date, startTime = :st, endTime = :et, GSI1SK = :g, '
            + 'attendanceStatus = :present, checkedInAt = :at, checkedInBy = :by, checkInMethod = :m, updatedAt = :at',
          ConditionExpression: 'slotId = :old AND attendanceStatus <> :present',
          ExpressionAttributeNames: { '#d': 'date' },
          ExpressionAttributeValues: {
            ':slot': slot.slotId, ':sk': slot.SK, ':day': slot.dayId, ':dn': slot.dayNumber, ':date': slot.date,
            ':st': slot.startTime, ':et': slot.endTime, ':g': `${String(slot.dayNumber).padStart(2, '0')}#${slot.startTime}#${booking.bookingId}`,
            ':present': 'PRESENT', ':at': at, ':by': adminName, ':m': method, ':old': booking.slotId,
          },
        } },
        { ConditionCheck: {
          TableName: TABLE_NAME, Key: keys.event(booking.eventId),
          ConditionExpression: `#s <> :cancelled AND ${NOT_EDIT_LOCKED}`,
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':cancelled': 'CANCELLED', ':now': Date.now() },
        } },
      ],
    }));
  } catch (err) {
    if (!(err instanceof TransactionCanceledException)) throw err;
    const current = await getBooking(booking.bookingId);
    if (current?.attendanceStatus === 'PRESENT') return respond(current, true);
    return error(409, 'The slot or the booking changed at the same moment. Scan the ticket again.');
  }
  await Promise.all([
    bumpRealtime('attendance'), bumpRealtime('bookings'),
    logActivity({
      admin: adminName, action: 'update', resource: 'booking', resourceId: booking.bookingId,
      details: { bookingId: booking.bookingId, movedAtCheckIn: { from: `${booking.date} ${booking.startTime}`, to: `${slot.date} ${slot.startTime}` } },
    }),
  ]);
  const moved = { ...booking, slotId: slot.slotId, date: slot.date, startTime: slot.startTime, endTime: slot.endTime, checkedInAt: at };
  const response = respond(moved, false);
  const body = JSON.parse(String(response.body));
  body.message = `Moved to ${slot.startTime}–${slot.endTime} and checked in.`;
  body.booking = { ...body.booking, startTime: slot.startTime, endTime: slot.endTime };
  return json(200, body);
}
