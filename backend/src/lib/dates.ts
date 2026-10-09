export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || /^[+-]/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Events without a valid stored timezone are treated as India time. */
export function eventTimeZone(value?: string): string {
  return isTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}

/** Calendar dates are stored as `YYYY-MM-DD` (or ISO strings at UTC midnight). */
export function calendarDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** Today's calendar date (`YYYY-MM-DD`) in the given timezone. */
export function zonedDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export type EventStatus = 'CANCELLED' | 'COMPLETED' | 'LIVE' | 'UPCOMING';

/** Status from the event's own calendar, in its own timezone; a cancellation always wins. */
export function eventStatus(startDate: string, endDate: string, now: Date, timeZone: string, stored?: string): EventStatus {
  if (stored === 'CANCELLED') return 'CANCELLED';
  const today = zonedDate(now, eventTimeZone(timeZone));
  if (today > calendarDate(endDate)) return 'COMPLETED';
  if (today >= calendarDate(startDate)) return 'LIVE';
  return 'UPCOMING';
}
