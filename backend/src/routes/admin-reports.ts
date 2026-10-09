import { Temporal } from '@js-temporal/polyfill';
import { error, json } from '../http.js';
import { allEvents, eventBookings, type AdminEvent } from '../lib/admin-data.js';
import { requireAdmin } from '../lib/admins.js';
import type { BookingItem } from '../lib/bookings.js';
import { eventStatus, eventTimeZone, isTimeZone, zonedDate } from '../lib/dates.js';
import { isId } from '../lib/ids.js';
import { isCalendarDate } from '../lib/schedule.js';
import type { Handler } from '../router.js';

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const round = (value: number) => Math.round(value * 100) / 100;
const percent = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100) : 0);
const shorten = (value: string, max = 28) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);
const isoDate = (date: string | undefined) => (date ? `${date}T00:00:00.000Z` : null);

/** Start of a calendar day in a timezone, as an ISO instant. */
function dayStart(date: string, timeZone: string) {
  return new Date(Temporal.PlainDate.from(date).toZonedDateTime(timeZone).epochMilliseconds).toISOString();
}

/**
 * Registrations per day (per month once the range passes 62 days), in the reporting timezone.
 * Without a range it spans the first to the last registration, or the last week.
 */
export function registrationTrend(rows: { createdAt: string; attendanceStatus: string }[], from: string, to: string, now: Date, timeZone: string) {
  const keys = rows.map((r) => zonedDate(new Date(r.createdAt), timeZone)).sort();
  const endKey = to || keys.at(-1) || zonedDate(now, timeZone);
  const startKey = from || keys[0] || Temporal.PlainDate.from(endKey).subtract({ days: 6 }).toString();
  const start = Temporal.PlainDate.from(startKey), end = Temporal.PlainDate.from(endKey);
  const monthly = start.until(end).days + 1 > 62;
  const label = new Intl.DateTimeFormat('en-GB', monthly ? { month: 'short', year: 'numeric', timeZone: 'UTC' } : { day: '2-digit', month: 'short', timeZone: 'UTC' });
  const buckets = new Map<string, { period: string; registered: number; present: number }>();
  for (let d = monthly ? start.with({ day: 1 }) : start; Temporal.PlainDate.compare(d, end) <= 0; d = monthly ? d.add({ months: 1 }) : d.add({ days: 1 })) {
    const key = d.toString().slice(0, monthly ? 7 : 10);
    buckets.set(key, { period: label.format(new Date(`${d.toString()}T00:00:00Z`)), registered: 0, present: 0 });
  }
  for (const r of rows) {
    const bucket = buckets.get(zonedDate(new Date(r.createdAt), timeZone).slice(0, monthly ? 7 : 10));
    if (!bucket) continue;
    bucket.registered++;
    if (r.attendanceStatus === 'PRESENT') bucket.present++;
  }
  return [...buckets.values()];
}

/**
 * GET /api/admin/reports?eventId=&from=&to=&attendance=&timeZone= — the reports screen: summary
 * figures, charts, per-event performance and the full booking ledger the screen exports to
 * CSV/Excel. `from` / `to` are registration dates (YYYY-MM-DD) in `timeZone`.
 */
export const reports: Handler = async (req) => {
  await requireAdmin(req, 'reports');
  const q = req.query;
  const eventId = (q.eventId || '').trim();
  if (eventId && !isId(eventId)) return error(400, 'Invalid event filter.');
  if (q.timeZone && !isTimeZone(q.timeZone)) return error(400, 'Invalid reporting timezone.');
  const from = (q.from || '').trim(), to = (q.to || '').trim();
  if ((from && !isCalendarDate(from)) || (to && !isCalendarDate(to)) || (from && to && from > to)) {
    return error(400, 'Enter a valid report date range.');
  }
  const attendance = q.attendance === 'present' || q.attendance === 'not_present' ? q.attendance : 'all';

  const now = new Date();
  const everyEvent = await allEvents();
  const withStatus = (e: AdminEvent) => ({ ...e, status: eventStatus(e.startDate, e.endDate, now, e.timeZone, e.status) });
  const selected = eventId ? everyEvent.find((e) => e.eventId === eventId) : undefined;
  const timeZone = q.timeZone || eventTimeZone(selected?.timeZone);
  const events = (eventId ? everyEvent.filter((e) => e.eventId === eventId) : everyEvent)
    .map(withStatus).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const eventsById = new Map(events.map((e) => [e.eventId, e]));

  const fromAt = from ? dayStart(from, timeZone) : '';
  const toAt = to ? dayStart(Temporal.PlainDate.from(to).add({ days: 1 }).toString(), timeZone) : '';
  const bookings: BookingItem[] = (await Promise.all(events.map((e) => eventBookings(e.eventId)))).flat()
    .filter((b) => (!fromAt || b.createdAt >= fromAt) && (!toAt || b.createdAt < toAt))
    .filter((b) => attendance === 'all' || (attendance === 'present') === (b.attendanceStatus === 'PRESENT'));

  const ledger = bookings.map((b) => {
    const d = b.details as Record<string, unknown>;
    const e = eventsById.get(b.eventId);
    return {
      reportingTimeZone: timeZone, eventTimeZone: eventTimeZone(e?.timeZone),
      id: b.bookingId, bookingId: b.bookingId,
      fullName: text(d.fullName) || 'Unknown attendee', email: text(d.email), mobile: text(d.mobile),
      designation: text(d.designation), specialty: text(d.specialty),
      hospital: text(d.hospitalName) || text(d.hospital) || text(d.institution) || text(d.institutionName),
      city: text(d.city), state: text(d.state), country: text(d.country),
      eventId: b.eventId, eventName: e?.eventName || 'Unknown event', eventType: e?.eventType || '',
      venue: e?.venue || '', eventStatus: e?.status || '',
      scheduledDate: isoDate(b.date), dayNumber: b.dayNumber ?? null, startTime: b.startTime, endTime: b.endTime,
      attendanceStatus: b.attendanceStatus === 'PRESENT' ? 'PRESENT' as const : 'NOT_PRESENT' as const,
      checkInMethod: b.checkInMethod || '', checkedInAt: b.checkedInAt ?? null, checkedInBy: b.checkedInBy || '',
      createdAt: b.createdAt,
    };
  });

  const present = ledger.filter((r) => r.attendanceStatus === 'PRESENT').length;
  const qrCheckIns = ledger.filter((r) => r.checkInMethod === 'QR').length;
  const manualCheckIns = ledger.filter((r) => r.checkInMethod === 'MANUAL').length;
  // Capacity is the scheduled seats of the events in scope; booked seats come from the live counters.
  const totalCapacity = events.reduce((sum, e) => sum + (e.totalSlots || 0), 0);
  const reservedCapacity = events.reduce((sum, e) => sum + (e.bookedSlots || 0), 0);

  const eventPerformance = events.map((e) => {
    const rows = ledger.filter((r) => r.eventId === e.eventId);
    const attended = rows.filter((r) => r.attendanceStatus === 'PRESENT').length;
    return {
      id: e.eventId, eventName: e.eventName, eventType: e.eventType, venue: e.venue, status: e.status,
      startDate: isoDate(e.startDate), endDate: isoDate(e.endDate),
      registrations: rows.length, present: attended, notPresent: rows.length - attended,
      attendanceRate: percent(attended, rows.length),
      capacity: e.totalSlots || 0, bookedCapacity: e.bookedSlots || 0, utilization: percent(e.bookedSlots || 0, e.totalSlots || 0),
    };
  });

  return json(200, {
    success: true, generatedAt: now.toISOString(), timeZone,
    filters: { timeZone, eventId, from, to, attendance },
    eventOptions: [...everyEvent].map(withStatus).sort((a, b) => b.startDate.localeCompare(a.startDate))
      .map((e) => ({ id: e.eventId, timeZone: eventTimeZone(e.timeZone), eventName: e.eventName, status: e.status })),
    summary: {
      totalBookings: ledger.length, present, notPresent: ledger.length - present,
      attendanceRate: percent(present, ledger.length), qrCheckIns, manualCheckIns,
      totalCapacity, reservedCapacity, remainingCapacity: Math.max(totalCapacity - reservedCapacity, 0),
      slotUtilization: percent(reservedCapacity, totalCapacity),
      events: events.length, liveEvents: events.filter((e) => e.status === 'LIVE').length,
    },
    charts: {
      registrationTrend: registrationTrend(ledger, from, to, now, timeZone),
      attendanceByEvent: eventPerformance.filter((e) => e.registrations > 0).sort((a, b) => b.registrations - a.registrations).slice(0, 10)
        .map((e) => ({ event: shorten(e.eventName), fullEventName: e.eventName, present: e.present, notPresent: e.notPresent })),
      utilizationByEvent: eventPerformance.filter((e) => e.capacity > 0).sort((a, b) => b.utilization - a.utilization).slice(0, 10)
        .map((e) => ({ event: shorten(e.eventName), fullEventName: e.eventName, utilization: e.utilization, booked: e.bookedCapacity, capacity: e.capacity })),
      attendanceStatus: [{ name: 'Present', value: present }, { name: 'Not Present', value: ledger.length - present }],
      checkInMethods: [{ name: 'QR', value: qrCheckIns }, { name: 'Manual', value: manualCheckIns }],
    },
    eventPerformance,
    bookings: [...ledger].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  });
};
