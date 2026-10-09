import { Temporal } from '@js-temporal/polyfill';
import { isTimeZone } from './dates.js';

/** One event day as submitted by the admin form (numbers arrive as strings). */
export type ScheduleInput = {
  date: string;
  startTime: string;
  endTime: string;
  lunchEnabled: boolean;
  lunchStart?: string;
  lunchEnd?: string;
  slotDuration: string | number;
  slotGap: string | number;
  capacity: string | number;
  sameAsDay1?: boolean;
};

export type SlotTime = { startTime: string; endTime: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function timeToMinutes(value: unknown): number {
  if (typeof value !== 'string' || !TIME.test(value)) return NaN;
  const [h, m] = value.split(':').map(Number);
  return h! * 60 + m!;
}

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** Slots from start to end: fixed duration, a gap after each, skipping anything that overlaps lunch. */
export function generateSlotTimes(s: ScheduleInput): SlotTime[] {
  const start = timeToMinutes(s.startTime), end = timeToMinutes(s.endTime);
  const duration = Number(s.slotDuration), gap = Number(s.slotGap);
  const lunchStart = s.lunchEnabled ? timeToMinutes(s.lunchStart) : 0;
  const lunchEnd = s.lunchEnabled ? timeToMinutes(s.lunchEnd) : 0;
  const slots: SlotTime[] = [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start
    || !Number.isInteger(duration) || duration < 1 || duration > 1440
    || !Number.isInteger(gap) || gap < 0 || gap > 1440) return slots;
  if (s.lunchEnabled && (!Number.isFinite(lunchStart) || !Number.isFinite(lunchEnd)
    || lunchStart < start || lunchEnd > end || lunchEnd <= lunchStart)) return slots;
  let cursor = start;
  while (cursor + duration <= end) {
    const slotEnd = cursor + duration;
    if (s.lunchEnabled && cursor < lunchEnd && slotEnd > lunchStart) {
      cursor = lunchEnd;
      continue;
    }
    slots.push({ startTime: formatTime(cursor), endTime: formatTime(slotEnd) });
    cursor = slotEnd + gap;
  }
  return slots;
}

/** The instant a local date + time happens in a timezone; NaN if a clock change skips or repeats it. */
export function slotInstant(date: string, time: string, timeZone: string): number {
  if (!TIME.test(time)) return NaN;
  try {
    return Temporal.PlainDateTime.from(`${date}T${time}:00`)
      .toZonedDateTime(timeZone, { disambiguation: 'reject' }).epochMilliseconds;
  } catch {
    return NaN;
  }
}

function dayProblem(s: ScheduleInput, index: number): string {
  const day = `Day ${index + 1}`;
  if (!s || typeof s !== 'object') return `${day}: invalid schedule.`;
  const start = timeToMinutes(s.startTime), end = timeToMinutes(s.endTime);
  const capacity = Number(s.capacity), duration = Number(s.slotDuration), gap = Number(s.slotGap);
  if (!isCalendarDate(s.date) || !Number.isFinite(start) || !Number.isFinite(end)) return `${day}: schedule information is incomplete.`;
  if (end <= start) return `${day}: end time must be later than start time.`;
  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) return `${day}: slot duration is invalid.`;
  if (!Number.isInteger(gap) || gap < 0 || gap > 1440) return `${day}: slot gap is invalid.`;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) return `${day}: capacity must be between 1 and 20.`;
  if (typeof s.lunchEnabled !== 'boolean' || (s.sameAsDay1 !== undefined && typeof s.sameAsDay1 !== 'boolean')) return 'Invalid schedule options.';
  if (s.lunchEnabled) {
    const ls = timeToMinutes(s.lunchStart), le = timeToMinutes(s.lunchEnd);
    if (!Number.isFinite(ls) || !Number.isFinite(le) || ls < start || le > end || le <= ls) return `${day}: lunch must fall within the event schedule.`;
  }
  if (!generateSlotTimes(s).length) return `${day}: schedule does not generate any slots.`;
  return '';
}

/** Whole-event schedule check. Returns a message safe to show the admin, or '' when valid. */
export function scheduleProblem(start: string, end: string, numberOfDays: number, schedules: unknown, timeZone: string): string {
  if (!isTimeZone(timeZone)) return 'Select a valid event timezone.';
  if (!isCalendarDate(start) || !isCalendarDate(end) || end < start) return 'Enter valid event dates with the end on or after the start.';
  if (!Number.isInteger(numberOfDays) || numberOfDays < 1 || numberOfDays > 10) return 'Number of event days must be between 1 and 10.';
  if (!Array.isArray(schedules) || schedules.length !== numberOfDays) return 'Day schedule count does not match the number of event days.';
  let previous = '';
  for (let i = 0; i < schedules.length; i++) {
    const s = schedules[i] as ScheduleInput;
    const problem = dayProblem(s, i);
    if (problem) return problem;
    const times = [s.startTime, s.endTime, ...generateSlotTimes(s).flatMap((slot) => [slot.startTime, slot.endTime])];
    if (times.some((t) => !Number.isFinite(slotInstant(s.date, t, timeZone)))) {
      return `Day ${i + 1}: a time is skipped or repeated by a clock change in ${timeZone}. Choose times outside that transition.`;
    }
    if (s.date < start || s.date > end) return `Day ${i + 1}: date must fall within the event dates.`;
    if (s.date <= previous) return 'Schedule dates must be distinct and in ascending order.';
    previous = s.date;
  }
  return '';
}
