import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { db, lists, TABLE_NAME } from '../db/table.js';
import { json } from '../http.js';
import { eventStatus, eventTimeZone } from '../lib/dates.js';
import type { Handler } from '../router.js';

/** Event item (`EVENT#<id>` / `META`) as stored; see docs/data-model.md. */
export type EventItem = {
  eventId: string;
  eventName: string;
  eventType: string;
  bookingFormTemplate?: string;
  venue: string;
  description: string;
  imageKey?: string;
  startDate: string;
  endDate: string;
  timeZone?: string;
  status?: string;
  totalSlots?: number;
  bookedSlots?: number;
  createdAt: string;
  updatedAt: string;
};

// Shared by every visitor: CloudFront serves one copy for 5 s, then refreshes in the background.
const LIST_CACHE = { 'cache-control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=30' };

/** GET /api/events — public catalogue, soonest first. */
export const listEvents: Handler = async () => {
  const items: EventItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': lists.events },
      ExclusiveStartKey,
    }));
    items.push(...(page.Items ?? []) as EventItem[]);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const now = new Date();
  const events = items.map((event) => ({
    _id: event.eventId,
    eventName: event.eventName,
    eventType: event.eventType,
    bookingFormTemplate: event.bookingFormTemplate || 'practitioner-institutional',
    venue: event.venue,
    startDate: event.startDate,
    endDate: event.endDate,
    timeZone: eventTimeZone(event.timeZone),
    description: event.description,
    imageUrl: event.imageKey ? `/api/events/${event.eventId}/image?v=${Date.parse(event.updatedAt) || 0}` : '',
    totalSlots: event.totalSlots ?? 0,
    bookedSlots: event.bookedSlots ?? 0,
    status: eventStatus(event.startDate, event.endDate, now, event.timeZone ?? '', event.status),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  }));
  return json(200, { success: true, events }, LIST_CACHE);
};
