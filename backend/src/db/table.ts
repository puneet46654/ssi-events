import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/** Single DynamoDB table; docs/data-model.md describes every item type and key pattern. */
export const TABLE_NAME = process.env.TABLE_NAME || 'ssi-events';

export const db = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** Primary keys. Keep in sync with docs/data-model.md. */
export const keys = {
  event: (eventId: string) => ({ PK: `EVENT#${eventId}`, SK: 'META' }),
  day: (eventId: string, dayNumber: number) => ({ PK: `EVENT#${eventId}`, SK: `DAY#${pad(dayNumber)}` }),
  slot: (eventId: string, dayNumber: number, startTime: string, slotId: string) =>
    ({ PK: `EVENT#${eventId}`, SK: `SLOT#${pad(dayNumber)}#${startTime}#${slotId}` }),
  bookingRequest: (eventId: string, requestKeyHash: string) =>
    ({ PK: `EVENT#${eventId}`, SK: `REQUEST#${requestKeyHash}` }),
  pendingBooking: (eventId: string, draftId: string) => ({ PK: `EVENT#${eventId}`, SK: `PENDING#${draftId}` }),
  booking: (bookingId: string) => ({ PK: `BOOKING#${bookingId}`, SK: 'META' }),
  admin: (username: string) => ({ PK: `ADMIN#${username.trim().toLowerCase()}`, SK: 'META' }),
  realtime: () => ({ PK: 'REALTIME', SK: 'GLOBAL' }),
};

/** GSI1 partitions used for listings. */
export const lists = {
  events: 'EVENTS',
  eventBookings: (eventId: string) => `EVENT#${eventId}#BOOKINGS`,
  admins: 'ADMINS',
};

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Epoch seconds for the table's TTL attribute (`ttl`). */
export function ttlAfter(seconds: number, from = Date.now()): number {
  return Math.floor(from / 1000) + seconds;
}
