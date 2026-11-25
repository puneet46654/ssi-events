import { QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { db, keys, lists, TABLE_NAME } from '../db/table.js';
import type { BookingDetails, BookingItem } from './bookings.js';

/* Admin screens read whole events at a time. Events are occasional and each holds at most a few
 * thousand bookings, so loading an event's bookings and filtering in memory stays cheap. */

export type AdminEvent = {
  eventId: string; eventName: string; eventType: string; venue: string; startDate: string; endDate: string;
  timeZone: string; status: string; totalSlots: number; bookedSlots: number; imageKey?: string; updatedAt: string;
  registrationMode?: string; capacity?: number;
};

/** Pending registration (`EVENT#<id>` / `PENDING#<draftId>`): details saved, no slot chosen yet. */
export type PendingItem = {
  eventId: string; draftId: string; details: BookingDetails; phone: string; email: string;
  expiresAt: string; updatedAt: string;
};

async function queryAll<T>(input: QueryCommandInput): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({ ...input, ExclusiveStartKey }));
    items.push(...(page.Items ?? []) as T[]);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

export const allEvents = () => queryAll<AdminEvent>({
  TableName: TABLE_NAME, IndexName: 'GSI1',
  KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': lists.events },
});

export const eventBookings = (eventId: string) => queryAll<BookingItem>({
  TableName: TABLE_NAME, IndexName: 'GSI1',
  KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': lists.eventBookings(eventId) },
});

/** Unexpired pending registrations (TTL deletion can lag by days, so expiry is checked here too). */
export async function eventPending(eventId: string): Promise<PendingItem[]> {
  const items = await queryAll<PendingItem>({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :p)',
    ExpressionAttributeValues: { ':pk': keys.event(eventId).PK, ':p': 'PENDING#' },
  });
  const now = new Date().toISOString();
  return items.filter((p) => !p.expiresAt || p.expiresAt > now);
}

/* Pending rows have no booking reference, so the admin screens address them as `<eventId>_<draftId>`. */
export const pendingRowId = (p: Pick<PendingItem, 'eventId' | 'draftId'>) => `${p.eventId}_${p.draftId}`;

export function parsePendingRowId(id: string): { eventId: string; draftId: string } | null {
  const match = /^([0-9A-HJKMNP-TV-Z]{26})_([0-9a-f-]{36})$/i.exec(id);
  return match ? { eventId: match[1]!.toUpperCase(), draftId: match[2]!.toLowerCase() } : null;
}

/** An event's waitlist places (see `lists.eventWaitlist`), oldest first within each slot. */
export async function eventWaitlist(eventId: string): Promise<BookingItem[]> {
  const items = await queryAll<BookingItem>({
    TableName: TABLE_NAME, IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :pk', ExpressionAttributeValues: { ':pk': lists.eventWaitlist(eventId) },
  });
  return items.filter((b) => b.waitlisted).sort((a, b) => a.slotId.localeCompare(b.slotId) || queuedAt(a).localeCompare(queuedAt(b)));
}

/** When a waitlist place joined its current slot's queue. */
export const queuedAt = (b: BookingItem) => b.waitlistedAt || b.createdAt;

/** 1-based place of each waitlist entry in its slot's queue, by join time. */
export function waitlistPositions(entries: BookingItem[]): Map<string, number> {
  const positions = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const b of [...entries].sort((x, y) => queuedAt(x).localeCompare(queuedAt(y)))) {
    const n = (counts.get(b.slotId) ?? 0) + 1;
    counts.set(b.slotId, n);
    positions.set(b.bookingId, n);
  }
  return positions;
}
