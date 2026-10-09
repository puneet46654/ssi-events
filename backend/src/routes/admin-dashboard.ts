import { json } from '../http.js';
import { allEvents, eventBookings } from '../lib/admin-data.js';
import { requireAdmin } from '../lib/admins.js';
import { getSlots } from '../lib/bookings.js';
import { eventStatus, eventTimeZone, zonedDate } from '../lib/dates.js';
import type { Handler } from '../router.js';

const isoDate = (date: string | undefined) => (date ? `${date}T00:00:00.000Z` : null);

/**
 * GET /api/admin/dashboard — the admin landing page: headline figures, the five latest bookings
 * and the next three events that are live or upcoming. "Today" is each event's own calendar day.
 */
export const dashboard: Handler = async (req) => {
  await requireAdmin(req, 'dashboard');
  const now = new Date();
  const events = (await allEvents())
    .map((e) => ({ ...e, status: eventStatus(e.startDate, e.endDate, now, e.timeZone, e.status), today: zonedDate(now, eventTimeZone(e.timeZone)) }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const open = events.filter((e) => e.status === 'LIVE' || e.status === 'UPCOMING');

  const [bookingsByEvent, slotsByEvent] = await Promise.all([
    Promise.all(events.map((e) => eventBookings(e.eventId))),
    Promise.all(open.map((e) => getSlots(e.eventId))),
  ]);
  const bookings = bookingsByEvent.flat();
  const todayOf = new Map(events.map((e) => [e.eventId, e.today]));
  const eventName = new Map(events.map((e) => [e.eventId, e.eventName]));

  // Seats still free in slots from today onward, at events that can still be booked.
  const availableSlots = open.reduce((sum, e, i) => sum + slotsByEvent[i]!
    .filter((s) => s.date >= e.today)
    .reduce((seats, s) => seats + Math.max((s.capacity || 0) - (s.bookedCount || 0), 0), 0), 0);

  return json(200, {
    success: true,
    stats: {
      totalEvents: events.length,
      liveToday: events.filter((e) => e.status === 'LIVE').length,
      totalBookings: bookings.length,
      todayAttendance: bookings.filter((b) => b.attendanceStatus === 'PRESENT' && b.date === todayOf.get(b.eventId)).length,
      availableSlots,
    },
    recentBookings: [...bookings].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map((b) => ({
      id: b.bookingId, bookingId: b.bookingId, fullName: b.details.fullName || 'Unknown Attendee',
      eventName: eventName.get(b.eventId) || '—', date: isoDate(b.date), startTime: b.startTime, endTime: b.endTime,
      attendanceStatus: b.attendanceStatus || 'NOT_PRESENT',
    })),
    upcomingEvents: open.slice(0, 3).map((e) => ({
      id: e.eventId, eventName: e.eventName, venue: e.venue || '', startDate: isoDate(e.startDate), endDate: isoDate(e.endDate),
      status: e.status, booked: e.bookedSlots || 0, capacity: e.totalSlots || 0,
      percentage: e.totalSlots ? Math.min(Math.round(((e.bookedSlots || 0) / e.totalSlots) * 100), 100) : 0,
    })),
  });
};
