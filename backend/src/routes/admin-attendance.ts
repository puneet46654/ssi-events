import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, keys, TABLE_NAME } from '../db/table.js';
import { error, json } from '../http.js';
import { bumpRealtime } from '../lib/activity.js';
import { allEvents, eventBookings } from '../lib/admin-data.js';
import { requireAdmin } from '../lib/admins.js';
import { assertSameOrigin, jsonBody } from '../lib/body.js';
import { getBooking, isBookingId, slotStart, type BookingItem } from '../lib/bookings.js';
import { eventStatus, eventTimeZone } from '../lib/dates.js';
import { isId } from '../lib/ids.js';
import type { Handler } from '../router.js';

const isLive = (e: { startDate: string; endDate: string; timeZone: string; status: string }) =>
  eventStatus(e.startDate, e.endDate, new Date(), e.timeZone, e.status) === 'LIVE';

/**
 * Admission is open for the booked slot itself: from its start, until its end, in the event's
 * timezone.
 */
function checkInWindow(b: BookingItem, timeZone: string, now = Date.now()) {
  const zone = eventTimeZone(timeZone);
  const start = slotStart(b.date, b.startTime, zone), end = slotStart(b.date, b.endTime, zone);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return { allowed: false, message: 'This ticket has an invalid appointment time. Ask event staff for assistance.' };
  }
  return {
    allowed: now >= start && now < end,
    message: `Check-in for this ticket is open on ${b.date} from ${b.startTime} to ${b.endTime} (${zone}).`,
  };
}

/**
 * GET /api/admin/attendance?eventId= — the events that are live today and, for the chosen one,
 * attendance figures and the ten latest check-ins.
 */
export const attendanceSummary: Handler = async (req) => {
  await requireAdmin(req, 'check-in');
  const live = (await allEvents()).filter(isLive).sort((a, b) => a.startDate.localeCompare(b.startDate));
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
 * POST /api/admin/attendance — `{ eventId, method: "QR" | "MANUAL", code? , bookingId? }`. Records the
 * attendee as present. Scanning the same ticket again is harmless: it reports `alreadyPresent`.
 */
export const checkIn: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await requireAdmin(req, 'check-in');
  const body = jsonBody<{ eventId?: unknown; code?: unknown; bookingId?: unknown; method?: unknown }>(req);
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
  const window = checkInWindow(booking, event.timeZone);
  if (!window.allowed) return error(409, window.message);

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
