import { calendarDate, eventTimeZone } from '@/lib/events/dates';

type CalendarTicket = {
  bookingId: string; eventName: string; venue: string;
  date: string; startTime: string; endTime: string; timeZone?: string;
  /** Registration without a time slot: an all-day entry until this date (inclusive). */
  eventEndDate?: string | null;
};

/** Google Calendar "add event" link; times stay in the event's own time zone via ctz. */
export function googleCalendarUrl(ticket: CalendarTicket) {
  const day = calendarDate(ticket.date).replace(/-/g, '');
  const at = (time: string) => `${day}T${time.replace(':', '')}00`;
  const allDay = !ticket.startTime;
  const endExclusive = allDay
    ? calendarDate(new Date(Date.parse(ticket.eventEndDate || ticket.date) + 86_400_000).toISOString()).replace(/-/g, '')
    : '';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: ticket.eventName,
    dates: allDay ? `${day}/${endExclusive}` : `${at(ticket.startTime)}/${at(ticket.endTime)}`,
    ctz: eventTimeZone(ticket.timeZone),
    location: ticket.venue,
    details: `SSInnovations Events booking reference: ${ticket.bookingId}\nShow your QR ticket from My Tickets at the venue.`,
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}
