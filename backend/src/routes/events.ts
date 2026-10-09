import { BatchWriteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, keys, lists, pad, TABLE_NAME } from '../db/table.js';
import { error, HttpError, json } from '../http.js';
import { bumpRealtime, logActivity } from '../lib/activity.js';
import { requireAdmin } from '../lib/admins.js';
import { assertSameOrigin, formBody } from '../lib/body.js';
import { eventStatus, eventTimeZone } from '../lib/dates.js';
import { isId, newId } from '../lib/ids.js';
import { loadImage, sanitizeImage, storeImage } from '../lib/images.js';
import { generateSlotTimes, scheduleProblem, type ScheduleInput } from '../lib/schedule.js';
import type { Handler } from '../router.js';

const EVENT_TYPES = ['conference', 'mantram', 'event'];
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
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

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

/** Reads and validates the admin event form (same fields as the existing create-event screen). */
function readEventForm(form: FormData) {
  const value = (key: string, fallback = '') => String(form.get(key) ?? fallback).trim();
  const eventName = value('eventName'), venue = value('venue'), description = value('description');
  const eventType = value('eventType');
  const bookingFormTemplate = value('bookingFormTemplate', 'practitioner-institutional');
  const timeZone = value('timeZone', 'Asia/Kolkata');
  const startDate = value('startDate'), endDate = value('endDate'), numberOfDays = Number(value('numberOfDays'));
  if (!eventName || !venue || !description) throw new HttpError(400, 'Required event information is missing.');
  if (eventName.length > 200 || venue.length > 300 || description.length > 5000) throw new HttpError(400, 'Event details are too long.');
  if (!EVENT_TYPES.includes(eventType)) throw new HttpError(400, 'Invalid event type.');
  if (!FORM_TEMPLATES.includes(bookingFormTemplate)) throw new HttpError(400, 'Invalid registration form template.');
  let schedules: ScheduleInput[];
  try { schedules = JSON.parse(value('daySchedules', '[]')); } catch { throw new HttpError(400, 'Invalid day schedule data.'); }
  const problem = scheduleProblem(startDate, endDate, numberOfDays, schedules, timeZone);
  if (problem) throw new HttpError(400, problem);
  return { eventName, venue, description, eventType, bookingFormTemplate, timeZone, startDate, endDate, numberOfDays, schedules };
}

async function batchPut(items: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    let requests = items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; requests.length; attempt++) {
      if (attempt > 5) throw new Error('DynamoDB did not accept all schedule items.');
      if (attempt) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      const result = await db.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: requests } }));
      requests = (result.UnprocessedItems?.[TABLE_NAME] ?? []) as typeof requests;
    }
  }
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

  const thumbnail = form.get('thumbnail');
  let imageKey: string | undefined;
  if (thumbnail instanceof File && thumbnail.size > 0) {
    imageKey = await storeImage(await sanitizeImage(thumbnail), `thumbnails/${eventId}-${Date.now()}`);
  } else if (thumbnail !== null && thumbnail !== '' && !(thumbnail instanceof File)) {
    throw new HttpError(400, 'Choose a JPG, PNG or WebP image file.');
  }

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

  const now = new Date().toISOString();
  const event: EventItem = {
    eventId, eventName: input.eventName, eventType: input.eventType, bookingFormTemplate: input.bookingFormTemplate,
    venue: input.venue, description: input.description, imageKey, numberOfDays: input.numberOfDays,
    startDate: input.startDate, endDate: input.endDate, timeZone: input.timeZone, status: 'ACTIVE',
    totalSlots, bookedSlots: 0, createdBy: admin.username, createdAt: now, updatedAt: now,
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
