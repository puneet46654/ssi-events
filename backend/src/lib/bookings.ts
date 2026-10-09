import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, keys, TABLE_NAME } from '../db/table.js';
import { HttpError } from '../http.js';
import type { Request } from '../router.js';
import { cookie, readCookie } from './cookies.js';
import { eventTimeZone } from './dates.js';
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone, phoneIdentity } from './phone.js';
import { slotInstant } from './schedule.js';

export type BookingDetails = { fullName: string; email: string; mobile: string; countryCode?: string; [key: string]: string | undefined };

/** Booking item (`BOOKING#<bookingId>` / `META`). */
export type BookingItem = {
  bookingId: string;
  eventId: string;
  slotId: string;
  slotSK: string;
  dayId: string;
  dayNumber: number;
  date: string;
  startTime: string;
  endTime: string;
  details: BookingDetails;
  phone: string;
  email: string;
  requestKeyHash: string;
  requestFingerprint: string;
  attendanceStatus: 'NOT_PRESENT' | 'PRESENT';
  checkedInAt?: string | null;
  checkedInBy?: string;
  checkInMethod?: 'QR' | 'MANUAL';
  createdAt: string;
  updatedAt: string;
};

export type SlotItem = {
  PK: string; SK: string; slotId: string; dayId: string; dayNumber: number; date: string;
  startTime: string; endTime: string; capacity: number; bookedCount: number;
};

export type EventCore = {
  eventId: string; eventName: string; venue: string; description: string; imageKey?: string;
  startDate: string; endDate: string; timeZone: string; status: string; updatedAt: string;
  /** `open`: registration only, no time slots (see routes/events.ts). */
  registrationMode?: string; capacity?: number; bookedSlots?: number;
};

/** A registration for an event without time slots: it has no slot. */
export const isOpenRegistration = (b: Pick<BookingItem, 'slotId'>) => !b.slotId;

/** When a registration-only event is over: the start of the day after its last day, in its timezone. */
export function registrationEndsAt(event: Pick<EventCore, 'endDate' | 'timeZone'>): number {
  const next = new Date(Date.parse(`${event.endDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return slotInstant(next, '00:00', eventTimeZone(event.timeZone));
}

/** Whether the booking's time is over: its slot's end, or the event's last day for a registration. */
export function bookingEnded(b: BookingItem, event: EventCore | undefined, now = Date.now()): boolean {
  if (!event) return true;
  if (isOpenRegistration(b)) return !(now < registrationEndsAt(event));
  return hasSlotEnded(b.date, b.endTime, event.timeZone, now);
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Attendee details: string fields only, trimmed; name, email and full mobile number required. */
export function readBookingDetails(input: unknown): BookingDetails {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Valid attendee details are required.');
  const details: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || typeof value !== 'string') continue;
    details[key] = value.trim().slice(0, 1000);
  }
  if (Object.keys(details).length > 60) throw new HttpError(400, 'Too many attendee fields.');
  if (!details.fullName) throw new HttpError(400, 'Full name is required.');
  if (!isValidEmail(details.email)) throw new HttpError(400, 'Enter a valid email address.');
  if (!isValidPhone(details.mobile, details.countryCode)) throw new HttpError(400, 'Enter a valid full mobile number.');
  details.email = normalizeEmail(details.email);
  details.mobile = (details.mobile!.startsWith('+') ? '+' : '') + normalizePhone(details.mobile);
  return details as BookingDetails;
}

/** Same request = same event, slot and details (key order ignored). */
export function bookingFingerprint(eventId: string, dayId: string, slotId: string, details: BookingDetails): string {
  return sha256(JSON.stringify([eventId, dayId, slotId, Object.entries(details).sort(([a], [b]) => a.localeCompare(b))]));
}

/** `SSI-EV-<year>-<12 hex>`: 48 random bits, so references can't be guessed. */
export function newBookingId(year: string): string {
  return `SSI-EV-${year}-${randomBytes(6).toString('hex').toUpperCase()}`;
}

export function isBookingId(value: unknown): value is string {
  return typeof value === 'string' && /^SSI-[A-Z]{2}-\d{4}-[0-9A-F]{12}$/.test(value);
}

/* Ticket access grants: one signed cookie per booking, held by the browser that booked or recovered it. */

const GRANT_PREFIX = 'ssievents_ticket_';
const GRANT_SECONDS = 30 * 24 * 60 * 60;

function grantSecret(): string {
  const value = process.env.BOOKING_ACCESS_SECRET;
  if (!value || value.length < 32) throw new Error('BOOKING_ACCESS_SECRET is missing or shorter than 32 characters.');
  return value;
}
const grantSign = (value: string) => createHmac('sha256', grantSecret()).update(value).digest('hex');
const grantName = (bookingId: string) => GRANT_PREFIX + sha256(bookingId).slice(0, 24);

export function hasGrant(req: Request, bookingId: string): boolean {
  const [expires, signature] = (readCookie(req, grantName(bookingId)) || '').split('.');
  if (!/^\d+$/.test(expires || '') || Number(expires) <= Date.now() || !signature) return false;
  const expected = Buffer.from(grantSign(`${bookingId}:${expires}`));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function grantCookie(bookingId: string): string {
  const expires = Date.now() + GRANT_SECONDS * 1000;
  return cookie(grantName(bookingId), `${expires}.${grantSign(`${bookingId}:${expires}`)}`, GRANT_SECONDS);
}

/* Loading */

export async function getBooking(bookingId: string): Promise<BookingItem | undefined> {
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.booking(bookingId) }));
  return Item as BookingItem | undefined;
}

export async function getEventCore(eventId: string): Promise<EventCore | undefined> {
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.event(eventId) }));
  return Item as EventCore | undefined;
}

export async function getSlots(eventId: string): Promise<SlotItem[]> {
  const items: SlotItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :slot)',
      ExpressionAttributeValues: { ':pk': keys.event(eventId).PK, ':slot': 'SLOT#' },
      ExclusiveStartKey,
    }));
    items.push(...(page.Items ?? []) as SlotItem[]);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export const slotStart = (date: string, time: string, timeZone: string) => slotInstant(date, time, eventTimeZone(timeZone));

/** A slot has ended once its end time has passed in the event's timezone (or its time is invalid). */
export function hasSlotEnded(date: string, endTime: string, timeZone: string, now = Date.now()): boolean {
  const end = slotStart(date, endTime, timeZone);
  return !Number.isFinite(end) || now >= end;
}

/** The ticket as the attendee screens receive it. */
export function publicBooking(b: BookingItem, event: EventCore | undefined) {
  const timeZone = eventTimeZone(event?.timeZone);
  const cancelled = event?.status === 'CANCELLED';
  return {
    id: b.bookingId,
    bookingId: b.bookingId,
    eventId: b.eventId,
    eventName: event?.eventName || 'Event unavailable',
    venue: event?.venue || '',
    timeZone,
    imageUrl: event?.imageKey ? `/api/events/${b.eventId}/image?v=${Date.parse(event.updatedAt) || 0}` : '',
    details: { ...b.details, eventId: b.eventId, eventName: event?.eventName || 'Event unavailable' },
    slotId: b.slotId,
    dayScheduleId: b.dayId,
    date: `${b.date}T00:00:00.000Z`,
    startTime: b.startTime,
    endTime: b.endTime,
    registrationOnly: isOpenRegistration(b),
    eventStartDate: event ? `${event.startDate}T00:00:00.000Z` : null,
    eventEndDate: event ? `${event.endDate}T00:00:00.000Z` : null,
    attendanceStatus: b.attendanceStatus,
    checkedInAt: b.checkedInAt ?? null,
    checkedInBy: b.checkedInBy || '',
    checkInMethod: b.checkInMethod || '',
    status: cancelled ? 'CANCELLED' as const
      : b.attendanceStatus === 'PRESENT' ? 'ATTENDED' as const
      : bookingEnded(b, event) ? 'EXPIRED' as const
      : 'ACTIVE' as const,
    qrData: cancelled ? '' : JSON.stringify({ type: 'SSI_EVENTS_ATTENDANCE', doctorId: b.bookingId, bookingId: b.bookingId, eventId: b.eventId }),
  };
}

export { phoneIdentity };
