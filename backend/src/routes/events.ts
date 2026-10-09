import { BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, keys, lists, pad, TABLE_NAME } from '../db/table.js';
import { error, HttpError, json } from '../http.js';
import { bumpRealtime, logActivity } from '../lib/activity.js';
import { requireAdmin } from '../lib/admins.js';
import { assertSameOrigin, formBody } from '../lib/body.js';
import { eventStatus, eventTimeZone, isTimeZone } from '../lib/dates.js';
import { startCancelNotices } from '../lib/cancel-notices.js';
import { EDIT_LOCK_MS, NOT_EDIT_LOCKED } from '../lib/event-lock.js';
import { isId, newId } from '../lib/ids.js';
import { loadImage, sanitizeImage, storeImage } from '../lib/images.js';
import { generateSlotTimes, isCalendarDate, scheduleProblem, type ScheduleInput } from '../lib/schedule.js';
import type { SlotItem } from '../lib/bookings.js';
import type { Handler } from '../router.js';

const EVENT_TYPES = ['conference', 'mantram', 'event', 'participation'];
const FORM_TEMPLATES = ['practitioner-institutional', 'template-2', 'template-3'];

/** Event item (`EVENT#<id>` / `META`); see docs/data-model.md. Dates are `YYYY-MM-DD`. */
export type EventItem = {
  eventId: string;
  eventName: string;
  eventType: string;
  bookingFormTemplate: string;
  venue: string;
  description: string;
  imageKey?: string;
  numberOfDays: number;
  startDate: string;
  endDate: string;
  timeZone: string;
  status: string;
  totalSlots: number;
  bookedSlots: number;
  /** `slots` (default): attendees book a time slot. `open`: registration only, no time slots. */
  registrationMode?: RegistrationMode;
  /** Open events only: the most registrations accepted; absent means unlimited. */
  capacity?: number;
  /** Info events only: where to find us at the venue, e.g. "Hall 8, Stand C12". */
  stand?: string;
  /** Info events only: labelled links (conference website, LinkedIn post, press release). */
  links?: EventLink[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

/** `slots`: book a time slot. `open`: registration only, no slots. `info`: listed for information, no booking. */
export type RegistrationMode = 'slots' | 'open' | 'info';
export type EventLink = { label: string; url: string };
export const registrationModeOf = (e: Pick<EventItem, 'registrationMode'> | undefined): RegistrationMode =>
  e?.registrationMode === 'open' || e?.registrationMode === 'info' ? e.registrationMode : 'slots';
const MAX_OPEN_DAYS = 31;
const MAX_CAPACITY = 100_000;
const MAX_LINKS = 4;

/** Links on an info event: at most four, each with a label and an http(s) address. */
function readLinks(raw: string): EventLink[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw || '[]'); } catch { throw new HttpError(400, 'Invalid links data.'); }
  if (!Array.isArray(parsed)) throw new HttpError(400, 'Invalid links data.');
  const links = parsed
    .map((l) => ({ label: String(l?.label ?? '').trim(), url: String(l?.url ?? '').trim() }))
    .filter((l) => l.label || l.url);
  if (links.length > MAX_LINKS) throw new HttpError(400, `Add at most ${MAX_LINKS} links.`);
  for (const l of links) {
    if (!l.label || l.label.length > 60) throw new HttpError(400, 'Each link needs a label of up to 60 characters.');
    let url: URL;
    try { url = new URL(l.url); } catch { throw new HttpError(400, `Enter a full web address for "${l.label}", starting with https://.`); }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || l.url.length > 500) {
      throw new HttpError(400, `Enter a full web address for "${l.label}", starting with https://.`);
    }
    l.url = url.href;
  }
  return links;
}

/** Day item (`EVENT#<id>` / `DAY#<nn>`). */
export type DayItem = {
  dayId: string;
  dayNumber: number;
  date: string;
  startTime: string;
  endTime: string;
  lunchEnabled: boolean;
  lunchStart: string;
  lunchEnd: string;
  slotDuration: number;
  slotGap: number;
  capacity: number;
  sameAsDay1: boolean;
};

// Shared by every visitor: CloudFront serves one copy for 5 s, then refreshes in the background.
const PUBLIC_CACHE = { 'cache-control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=30' };

/** Calendar dates go out as UTC midnight ISO strings, the format the frontend has always received. */
const isoDate = (date: string) => `${date}T00:00:00.000Z`;
const imageUrl = (e: EventItem) => (e.imageKey ? `/api/events/${e.eventId}/image?v=${Date.parse(e.updatedAt) || 0}` : '');

function publicEvent(e: EventItem, now: Date) {
  return {
    _id: e.eventId,
    eventName: e.eventName,
    eventType: e.eventType,
    bookingFormTemplate: e.bookingFormTemplate || 'practitioner-institutional',
    venue: e.venue,
    description: e.description,
    imageUrl: imageUrl(e),
    numberOfDays: e.numberOfDays,
    startDate: isoDate(e.startDate),
    endDate: isoDate(e.endDate),
    timeZone: eventTimeZone(e.timeZone),
    status: eventStatus(e.startDate, e.endDate, now, e.timeZone, e.status),
    totalSlots: e.totalSlots ?? 0,
    bookedSlots: e.bookedSlots ?? 0,
    registrationMode: registrationModeOf(e),
    capacity: registrationModeOf(e) === 'open' ? e.capacity ?? null : null,
    stand: registrationModeOf(e) === 'info' ? e.stand ?? '' : '',
    links: registrationModeOf(e) === 'info' ? e.links ?? [] : [],
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

async function getEventItem(eventId: string): Promise<EventItem | undefined> {
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.event(eventId) }));
  return Item as EventItem | undefined;
}

/** GET /api/events — public catalogue, soonest first. */
export const listEvents: Handler = async () => {
  const items: EventItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({
      TableName: TABLE_NAME, IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': lists.events },
      ExclusiveStartKey,
    }));
    items.push(...(page.Items ?? []) as EventItem[]);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  const now = new Date();
  return json(200, { success: true, events: items.map((e) => publicEvent(e, now)) }, PUBLIC_CACHE);
};

/** GET /api/events/:id — event with its day schedules. */
export const getEvent: Handler = async (req) => {
  const { id } = req.params;
  if (!isId(id)) return error(400, 'Invalid event ID.');
  const [event, days] = await Promise.all([
    getEventItem(id),
    db.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :day)',
      ExpressionAttributeValues: { ':pk': keys.event(id).PK, ':day': 'DAY#' },
    })),
  ]);
  if (!event) return error(404, 'Event not found.');
  const daySchedules = ((days.Items ?? []) as DayItem[]).map((d) => ({
    _id: d.dayId,
    dayNumber: d.dayNumber,
    date: isoDate(d.date),
    startTime: d.startTime,
    endTime: d.endTime,
    lunchEnabled: d.lunchEnabled,
    lunchStart: d.lunchStart || '',
    lunchEnd: d.lunchEnd || '',
    slotDuration: String(d.slotDuration),
    slotGap: String(d.slotGap),
    capacity: String(d.capacity),
    sameAsDay1: d.sameAsDay1,
  }));
  return json(200, { success: true, event: { ...publicEvent(event, new Date()), daySchedules } }, PUBLIC_CACHE);
};

/** GET /api/events/:id/image — the event's thumbnail (sanitized at upload). Versioned URL, cached for a year. */
export const eventImage: Handler = async (req) => {
  const { id } = req.params;
  if (!isId(id)) return error(400, 'Invalid event ID.');
  const event = await getEventItem(id);
  if (!event?.imageKey) return error(404, 'Event image not found.');
  const image = await loadImage(event.imageKey);
  return {
    statusCode: 200,
    isBase64Encoded: true,
    headers: {
      'content-type': image.contentType,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': 'inline',
      'cache-control': 'public, max-age=31536000, immutable',
    },
    body: image.body.toString('base64'),
  };
};

/** Reads and validates the admin event form (same fields as the create and edit screens). */
function readEventForm(form: FormData, existing?: EventItem) {
  const value = (key: string, fallback = '') => String(form.get(key) ?? fallback).trim();
  const eventName = value('eventName'), venue = value('venue'), description = value('description');
  const eventType = value('eventType');
  const bookingFormTemplate = value('bookingFormTemplate', existing?.bookingFormTemplate || 'practitioner-institutional');
  const timeZone = value('timeZone', eventTimeZone(existing?.timeZone));
  const startDate = value('startDate'), endDate = value('endDate'), numberOfDays = Number(value('numberOfDays'));
  if (!eventName || !venue || !description) throw new HttpError(400, 'Required event information is missing.');
  if (eventName.length > 200 || venue.length > 300 || description.length > 5000) throw new HttpError(400, 'Event details are too long.');
  if (!EVENT_TYPES.includes(eventType)) throw new HttpError(400, 'Invalid event type.');
  if (!FORM_TEMPLATES.includes(bookingFormTemplate)) throw new HttpError(400, 'Invalid registration form template.');
  const mode = value('registrationMode', registrationModeOf(existing));
  const registrationMode: RegistrationMode = mode === 'open' || mode === 'info' ? mode : 'slots';
  const base = { eventName, venue, description, eventType, bookingFormTemplate, timeZone, startDate, endDate, registrationMode,
    stand: undefined as string | undefined, links: undefined as EventLink[] | undefined };

  if (registrationMode === 'open' || registrationMode === 'info') {
    // Registration only and information only: dates, no schedule. Past dates are allowed so that
    // events we have already attended can be listed.
    if (!isTimeZone(timeZone)) throw new HttpError(400, 'Select a valid event timezone.');
    if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || endDate < startDate) {
      throw new HttpError(400, 'Enter valid event dates with the end on or after the start.');
    }
    const days = Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
    if (days > MAX_OPEN_DAYS) throw new HttpError(400, `An event without time slots can run for at most ${MAX_OPEN_DAYS} days.`);
    if (registrationMode === 'info') {
      const stand = value('stand');
      if (stand.length > 120) throw new HttpError(400, 'Stand or booth details are too long.');
      return { ...base, numberOfDays: days, schedules: [] as ScheduleInput[], capacity: undefined as number | undefined,
        stand: stand || undefined, links: readLinks(value('links')) };
    }
    const rawCapacity = value('capacity');
    const capacity = rawCapacity ? Number(rawCapacity) : undefined;
    if (capacity !== undefined && (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY)) {
      throw new HttpError(400, `Registration limit must be a whole number from 1 to ${MAX_CAPACITY}, or blank for no limit.`);
    }
    return { ...base, numberOfDays: days, schedules: [] as ScheduleInput[], capacity };
  }

  let schedules: ScheduleInput[];
  try { schedules = JSON.parse(value('daySchedules', '[]')); } catch { throw new HttpError(400, 'Invalid day schedule data.'); }
  const problem = scheduleProblem(startDate, endDate, numberOfDays, schedules, timeZone);
  if (problem) throw new HttpError(400, problem);
  return { ...base, numberOfDays, schedules, capacity: undefined as number | undefined };
}

async function batchPut(items: Record<string, unknown>[]): Promise<void> {
  await batchWrite(items.map((Item) => ({ PutRequest: { Item } })));
}

async function batchWrite(all: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < all.length; i += 25) {
    let requests = all.slice(i, i + 25);
    for (let attempt = 0; requests.length; attempt++) {
      if (attempt > 5) throw new Error('DynamoDB did not accept all batch items.');
      if (attempt) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const result = await db.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: requests } }));
      requests = (result.UnprocessedItems?.[TABLE_NAME] ?? []) as typeof requests;
    }
  }
}

/** The thumbnail field, sanitized; undefined when none was chosen. */
async function readThumbnail(form: FormData) {
  const thumbnail = form.get('thumbnail');
  if (thumbnail instanceof File && thumbnail.size > 0) return sanitizeImage(thumbnail);
  if (thumbnail !== null && thumbnail !== '' && !(thumbnail instanceof File)) throw new HttpError(400, 'Choose a JPG, PNG or WebP image file.');
  return undefined;
}

/**
 * POST /api/events — multipart form from the admin "new event" screen; optional `thumbnail` image.
 * Days and slots are written first; the event item is written last, so a half-finished create is
 * never visible in the catalogue.
 */
export const createEvent: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await requireAdmin(req, 'events', 'write');
  const form = await formBody(req);
  const input = readEventForm(form);
  const eventId = newId();

  const thumbnail = await readThumbnail(form);
  const imageKey = thumbnail && await storeImage(thumbnail, `thumbnails/${eventId}-${Date.now()}`);

  const pk = keys.event(eventId).PK;
  const scheduleItems: Record<string, unknown>[] = [];
  let totalSlots = 0;
  input.schedules.forEach((s, index) => {
    const dayNumber = index + 1;
    const day: DayItem = {
      dayId: newId(), dayNumber, date: s.date, startTime: s.startTime, endTime: s.endTime,
      lunchEnabled: s.lunchEnabled, lunchStart: s.lunchEnabled ? s.lunchStart || '' : '', lunchEnd: s.lunchEnabled ? s.lunchEnd || '' : '',
      slotDuration: Number(s.slotDuration), slotGap: Number(s.slotGap), capacity: Number(s.capacity), sameAsDay1: Boolean(s.sameAsDay1),
    };
    scheduleItems.push({ PK: pk, SK: `DAY#${pad(dayNumber)}`, ...day });
    for (const slot of generateSlotTimes(s)) {
      const slotId = newId();
      scheduleItems.push({
        ...keys.slot(eventId, dayNumber, slot.startTime, slotId),
        slotId, dayId: day.dayId, dayNumber, date: s.date, ...slot, capacity: day.capacity, bookedCount: 0,
      });
      totalSlots += day.capacity;
    }
  });
  await batchPut(scheduleItems);
  if (input.registrationMode !== 'slots') totalSlots = input.capacity ?? 0;

  const now = new Date().toISOString();
  const event: EventItem = {
    eventId, eventName: input.eventName, eventType: input.eventType, bookingFormTemplate: input.bookingFormTemplate,
    venue: input.venue, description: input.description, imageKey, numberOfDays: input.numberOfDays,
    startDate: input.startDate, endDate: input.endDate, timeZone: input.timeZone, status: 'ACTIVE',
    totalSlots, bookedSlots: 0, registrationMode: input.registrationMode, capacity: input.capacity,
    ...(input.stand ? { stand: input.stand } : {}), ...(input.links?.length ? { links: input.links } : {}),
    createdBy: admin.username, createdAt: now, updatedAt: now,
  };
  await db.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { ...keys.event(eventId), GSI1PK: lists.events, GSI1SK: `${input.startDate}#${eventId}`, ...event },
    ConditionExpression: 'attribute_not_exists(PK)',
  }));

  await Promise.all([
    bumpRealtime('events'),
    logActivity({ admin: admin.username, action: 'create', resource: 'event', resourceId: eventId, details: { eventName: event.eventName } }),
  ]);
  return json(201, {
    success: true, message: 'Event created successfully.', eventId,
    bookingFormTemplate: event.bookingFormTemplate, imageUrl: imageUrl(event),
  });
};

/* ---------- Editing and removing events ---------- */

const isConditionFailure = (err: unknown) => (err as { name?: string })?.name === 'ConditionalCheckFailedException';

/** Every item under the event's partition with the given sort-key prefix, read strongly consistent. */
async function eventChildren<T>(eventId: string, prefix: string): Promise<(T & { PK: string; SK: string })[]> {
  const items: (T & { PK: string; SK: string })[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({
      TableName: TABLE_NAME, ConsistentRead: true,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': keys.event(eventId).PK, ':prefix': prefix },
      ExclusiveStartKey,
    }));
    items.push(...(page.Items ?? []) as (T & { PK: string; SK: string })[]);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** Runs the writes a few at a time; stops at the first failure. */
async function runLimited(tasks: (() => Promise<unknown>)[], limit = 10): Promise<void> {
  for (let i = 0; i < tasks.length; i += limit) await Promise.all(tasks.slice(i, i + limit).map((t) => t()));
}

type EventInput = ReturnType<typeof readEventForm>;

const dayFields = (s: ScheduleInput) => ({
  date: s.date, startTime: s.startTime, endTime: s.endTime, lunchEnabled: s.lunchEnabled,
  lunchStart: s.lunchEnabled ? s.lunchStart || '' : '', lunchEnd: s.lunchEnabled ? s.lunchEnd || '' : '',
  slotDuration: Number(s.slotDuration), slotGap: Number(s.slotGap), capacity: Number(s.capacity), sameAsDay1: Boolean(s.sameAsDay1),
});

/**
 * Works out the schedule writes for an edit. Booked seats are never moved: each booked slot must
 * still exist (same date, start and end) on the same day number, with room for its bookings.
 * Unbooked slots and days are rewritten freely.
 */
function planSchedule(eventId: string, event: EventItem, input: EventInput, days: (DayItem & { SK: string })[], slots: (SlotItem & { SK: string })[]) {
  if ((event.bookedSlots ?? 0) > 0 && input.timeZone !== eventTimeZone(event.timeZone)) {
    throw new HttpError(409, 'The timezone cannot change while this event has bookings.');
  }
  const desired = input.schedules.map((schedule, index) => ({
    dayNumber: index + 1, schedule, times: generateSlotTimes(schedule),
    dayId: days.find((d) => d.date === schedule.date)?.dayId ?? newId(),
  }));

  for (const slot of slots.filter((s) => s.bookedCount > 0)) {
    const label = `${slot.date} ${slot.startTime}-${slot.endTime}`;
    const day = desired.find((d) => d.schedule.date === slot.date);
    if (!day || !day.times.some((t) => t.startTime === slot.startTime && t.endTime === slot.endTime)) {
      throw new HttpError(409, `The booked slot ${label} cannot be moved or removed. Cancel the event if it cannot go ahead.`);
    }
    if (day.dayNumber !== slot.dayNumber) {
      throw new HttpError(409, `Day ${slot.dayNumber} (${slot.date}) has bookings, so days before it cannot be added or removed.`);
    }
    if (Number(day.schedule.capacity) < slot.bookedCount) {
      throw new HttpError(409, `Capacity for ${label} cannot be lower than its ${slot.bookedCount} existing bookings.`);
    }
  }

  const pk = keys.event(eventId).PK;
  const kept = new Set<string>();
  const writes: (() => Promise<unknown>)[] = [];
  let totalSlots = 0;

  for (const { dayNumber, schedule, times, dayId } of desired) {
    const day: DayItem = { dayId, dayNumber, ...dayFields(schedule) };
    // Days hold no counters, so overwriting them is safe.
    writes.push(() => db.send(new PutCommand({ TableName: TABLE_NAME, Item: { PK: pk, SK: `DAY#${pad(dayNumber)}`, ...day } })));
    for (const time of times) {
      totalSlots += day.capacity;
      const existing = slots.find((o) => o.date === day.date && o.dayNumber === dayNumber && o.startTime === time.startTime && o.endTime === time.endTime);
      if (existing) {
        kept.add(existing.SK);
        // Only capacity and the day link change; seat counts are left to the booking transactions.
        writes.push(() => db.send(new UpdateCommand({
          TableName: TABLE_NAME, Key: { PK: pk, SK: existing.SK },
          UpdateExpression: 'SET #cap = :cap, dayId = :day',
          ConditionExpression: 'bookedCount <= :cap',
          ExpressionAttributeNames: { '#cap': 'capacity' },
          ExpressionAttributeValues: { ':cap': day.capacity, ':day': dayId },
        })));
      } else {
        const slotId = newId();
        writes.push(() => db.send(new PutCommand({
          TableName: TABLE_NAME,
          Item: { ...keys.slot(eventId, dayNumber, time.startTime, slotId), slotId, dayId, dayNumber, date: day.date, ...time, capacity: day.capacity, bookedCount: 0 },
          ConditionExpression: 'attribute_not_exists(PK)',
        })));
      }
    }
  }

  // Removed only while still empty: a seat taken in the meantime makes the delete fail.
  const deletes: (() => Promise<unknown>)[] = [
    ...slots.filter((o) => !kept.has(o.SK)).map((o) => () => db.send(new DeleteCommand({
      TableName: TABLE_NAME, Key: { PK: pk, SK: o.SK },
      ConditionExpression: 'bookedCount = :zero', ExpressionAttributeValues: { ':zero': 0 },
    }))),
    ...days.filter((d) => d.dayNumber > desired.length).map((d) => () => db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: pk, SK: d.SK } }))),
  ];

  const before = JSON.stringify([...days].sort((a, b) => a.dayNumber - b.dayNumber).map((d) => dayFields(d as unknown as ScheduleInput)));
  const after = JSON.stringify(desired.map((d) => dayFields(d.schedule)));
  return { writes, deletes, totalSlots, scheduleChanged: before !== after };
}

/** Empty values (absent, '' or []) compare equal, so clearing an already-empty field is not a change. */
const comparable = (v: unknown) => JSON.stringify(v === undefined || v === '' || (Array.isArray(v) && !v.length) ? null : v);

const EDITABLE_FIELDS = ['eventName', 'eventType', 'bookingFormTemplate', 'venue', 'description', 'timeZone', 'startDate', 'endDate', 'numberOfDays', 'registrationMode', 'capacity', 'stand', 'links'] as const;

/**
 * PUT /api/events/:id — same multipart form as create. Booked slots are kept (see planSchedule).
 * The event is edit-locked while its schedule is rewritten, so no booking or reschedule can land
 * between the checks and the writes.
 */
export const updateEvent: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await requireAdmin(req, 'events', 'write');
  const { id } = req.params;
  if (!isId(id)) return error(400, 'Invalid event ID.');
  const existing = await getEventItem(id);
  if (!existing) return error(404, 'Event not found.');
  if (existing.status === 'CANCELLED') return error(409, 'Cancelled events are kept for history and cannot be edited.');
  const form = await formBody(req);
  const input = readEventForm(form, existing);
  const thumbnail = await readThumbnail(form);

  const lockUntil = Date.now() + EDIT_LOCK_MS;
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: keys.event(id),
      UpdateExpression: 'SET editLock = :until',
      ConditionExpression: `attribute_exists(PK) AND #s <> :cancelled AND ${NOT_EDIT_LOCKED}`,
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':until': lockUntil, ':now': Date.now(), ':cancelled': 'CANCELLED' },
    }));
  } catch (err) {
    if (!isConditionFailure(err)) throw err;
    const current = await getEventItem(id);
    if (!current) return error(404, 'Event not found.');
    if (current.status === 'CANCELLED') return error(409, 'Cancelled events are kept for history and cannot be edited.');
    return error(409, 'Another change to this event is being saved. Wait a moment and try again.');
  }

  let saved = false;
  try {
    const [event, days, slots] = await Promise.all([
      db.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.event(id), ConsistentRead: true })).then((r) => r.Item as EventItem),
      eventChildren<DayItem>(id, 'DAY#'),
      eventChildren<SlotItem>(id, 'SLOT#'),
    ]);
    const booked = event.bookedSlots ?? 0;
    if (booked > 0 && registrationModeOf(event) !== input.registrationMode) {
      throw new HttpError(409, 'The registration type cannot change once people have registered.');
    }
    if (input.registrationMode === 'open' && input.capacity !== undefined && input.capacity < booked) {
      throw new HttpError(409, `The registration limit cannot be lower than the ${booked} people already registered.`);
    }
    if (input.registrationMode === 'open' && booked > 0 && input.timeZone !== eventTimeZone(event.timeZone)) {
      throw new HttpError(409, 'The timezone cannot change while this event has bookings.');
    }
    // Events without time slots have no schedule: any day and slot items left from before are removed (none are booked).
    const plan = input.registrationMode !== 'slots'
      ? {
        writes: [] as (() => Promise<unknown>)[],
        deletes: [...days, ...slots].map((item) => () => db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: { PK: item.PK, SK: item.SK } }))),
        totalSlots: input.capacity ?? 0,
        scheduleChanged: days.length > 0,
      }
      : planSchedule(id, event, input, days, slots);
    const imageKey = thumbnail && await storeImage(thumbnail, `thumbnails/${id}-${Date.now()}`);

    try {
      await runLimited(plan.writes);
      await runLimited(plan.deletes);
    } catch (err) {
      if (!isConditionFailure(err)) throw err;
      throw new HttpError(409, 'Bookings changed while the event was being saved. Reload the event and save again.');
    }

    const now = new Date().toISOString();
    const fields: Record<string, unknown> = {
      eventName: input.eventName, eventType: input.eventType, bookingFormTemplate: input.bookingFormTemplate,
      venue: input.venue, description: input.description, timeZone: input.timeZone, startDate: input.startDate,
      endDate: input.endDate, numberOfDays: input.numberOfDays, totalSlots: plan.totalSlots, registrationMode: input.registrationMode,
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
      ...(input.stand ? { stand: input.stand } : {}),
      ...(input.links?.length ? { links: input.links } : {}),
      GSI1SK: `${input.startDate}#${id}`, updatedAt: now, ...(imageKey ? { imageKey } : {}),
    };
    const names = Object.fromEntries(Object.keys(fields).map((f, i) => [`#f${i}`, f]));
    const values = Object.fromEntries(Object.values(fields).map((v, i) => [`:f${i}`, v]));
    // Optional attributes the new form leaves empty are removed.
    const cleared = (['capacity', 'stand', 'links'] as const).filter((f) => !(f in fields));
    const clearedNames = Object.fromEntries(cleared.map((f) => [`#r_${f}`, f]));
    await db.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: keys.event(id),
      UpdateExpression: `SET ${Object.keys(names).map((n, i) => `${n} = :f${i}`).join(', ')} REMOVE ${['editLock', ...Object.keys(clearedNames)].join(', ')}`,
      ConditionExpression: 'editLock = :until',
      ExpressionAttributeNames: { ...names, ...clearedNames },
      ExpressionAttributeValues: { ...values, ':until': lockUntil },
    }));
    saved = true;

    const changed = [
      ...EDITABLE_FIELDS.filter((f) => comparable(existing[f]) !== comparable(input[f])),
      ...(plan.scheduleChanged ? ['schedule'] : []),
      ...(imageKey ? ['thumbnail'] : []),
    ];
    await Promise.all([
      bumpRealtime('events'),
      bumpRealtime('bookings'),
      logActivity({ admin: admin.username, action: 'update', resource: 'event', resourceId: id, details: { eventName: input.eventName, fields: changed } }),
    ]);
    const updated = { ...existing, ...fields } as EventItem;
    return json(200, {
      success: true, message: 'Event updated successfully.', eventId: id,
      bookingFormTemplate: updated.bookingFormTemplate, imageUrl: imageUrl(updated), updatedAt: now,
    });
  } catch (err) {
    if (isConditionFailure(err)) throw new HttpError(409, 'The event changed while it was being saved. Reload it and save again.');
    throw err;
  } finally {
    if (!saved) {
      // Release the lock early; what was written is consistent, and saving again completes the edit.
      await db.send(new UpdateCommand({
        TableName: TABLE_NAME, Key: keys.event(id), UpdateExpression: 'REMOVE editLock',
        ConditionExpression: 'editLock = :until', ExpressionAttributeValues: { ':until': lockUntil },
      })).catch(() => undefined);
    }
  }
};

/**
 * DELETE /api/events/:id — an event nobody has booked is deleted with its schedule and pending
 * registrations. Once anyone has booked, it is cancelled instead: bookings stay for the record and
 * tickets stop admitting.
 */
export const deleteEvent: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await requireAdmin(req, 'events', 'delete');
  const { id } = req.params;
  if (!isId(id)) return error(400, 'Invalid event ID.');
  const event = await getEventItem(id);
  if (!event) return error(404, 'Event not found.');

  let cancelled = event.status === 'CANCELLED';
  let notifying = false;
  if (!cancelled) {
    try {
      // The event item goes first, and only while unbooked; without it no booking can be created.
      await db.send(new DeleteCommand({
        TableName: TABLE_NAME, Key: keys.event(id),
        ConditionExpression: `attribute_exists(PK) AND bookedSlots = :zero AND ${NOT_EDIT_LOCKED}`,
        ExpressionAttributeValues: { ':zero': 0, ':now': Date.now() },
      }));
    } catch (err) {
      if (!isConditionFailure(err)) throw err;
      const current = await getEventItem(id);
      if (!current) return error(404, 'Event not found.');
      if ((current.bookedSlots ?? 0) <= 0) return error(409, 'This event is being edited. Wait a moment and try again.');
      await db.send(new UpdateCommand({
        TableName: TABLE_NAME, Key: keys.event(id),
        UpdateExpression: 'SET #s = :cancelled, updatedAt = :now',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#s': 'status' },
        ExpressionAttributeValues: { ':cancelled': 'CANCELLED', ':now': new Date().toISOString() },
      }));
      cancelled = true;
    }
    if (!cancelled) {
      const children = await eventChildren<Record<string, unknown>>(id, '');
      await batchWrite(children.map((c) => ({ DeleteRequest: { Key: { PK: c.PK, SK: c.SK } } })));
    }
    notifying = cancelled && await startCancelNotices(id, admin.username);
    await Promise.all([
      bumpRealtime('events'), bumpRealtime('bookings'), bumpRealtime('attendance'),
      logActivity({
        admin: admin.username, action: cancelled ? 'update' : 'delete', resource: 'event', resourceId: id,
        details: { eventName: event.eventName, cancelled, ...(cancelled ? { attendeesNotified: notifying } : {}) },
      }),
    ]);
  }
  return json(200, {
    success: true, cancelled,
    message: !cancelled ? 'Event deleted successfully.'
      : notifying ? 'Event cancelled. Attendees are being notified by email; booking history is preserved and tickets are no longer valid for admission.'
      : 'Event cancelled. Booking history is preserved; tickets are no longer valid for admission.',
    attendeesNotified: notifying,
  });
};
