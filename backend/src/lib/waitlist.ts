import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { db, keys, lists, TABLE_NAME } from '../db/table.js';
import { HttpError } from '../http.js';
import { getBooking, getEventCore, getSlots, hasSlotEnded, type BookingItem, type EventCore } from './bookings.js';
import { eventStatus } from './dates.js';
import { notifyAttendee } from './email.js';
import { EDIT_LOCKED_MESSAGE, NOT_EDIT_LOCKED } from './event-lock.js';

const gsi1sk = (dayNumber: number, startTime: string, bookingId: string, at?: string) =>
  `${String(dayNumber).padStart(2, '0')}#${startTime}${at ? `#${at}` : ''}#${bookingId}`;

/**
 * Moves a waitlist place, by the attendee (My Tickets) or by staff.
 *
 * - Target slot has a free seat (this can be the place's own slot, once a seat frees up): the place
 *   becomes a confirmed booking in that slot, with a QR ticket, and is emailed as confirmed.
 * - Target slot is full: the place moves to that slot's waitlist, at the back of its queue.
 *
 * Returns the updated booking and whether it is now confirmed.
 */
export async function moveWaitlistEntry(
  entry: BookingItem, event: EventCore, dayId: string, slotId: string,
): Promise<{ booking: BookingItem; confirmed: boolean }> {
  if (!entry.waitlisted) throw new HttpError(409, 'This is not a waitlist place.');
  if (event.status === 'CANCELLED') throw new HttpError(409, 'This event has been cancelled.');
  const slot = (await getSlots(entry.eventId)).find((s) => s.slotId === slotId && s.dayId === dayId);
  if (!slot) throw new HttpError(400, 'Choose a valid time slot.');
  if (hasSlotEnded(slot.date, slot.endTime, event.timeZone)) throw new HttpError(409, 'This time slot has already ended. Please choose another slot.');

  const seatFree = slot.bookedCount < slot.capacity;
  if (!seatFree && slot.slotId === entry.slotId) throw new HttpError(409, 'You are already on the waitlist for this time slot, and it is still full.');

  const now = new Date().toISOString();
  const slotFields = {
    ':slot': slot.slotId, ':sk': slot.SK, ':day': slot.dayId, ':dn': slot.dayNumber, ':date': slot.date,
    ':st': slot.startTime, ':et': slot.endTime, ':now': now, ':yes': true,
  };
  const eventCheck = {
    TableName: TABLE_NAME, Key: keys.event(entry.eventId),
    ConditionExpression: `attribute_exists(PK) AND #s <> :cancelled AND ${NOT_EDIT_LOCKED}`,
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':cancelled': 'CANCELLED', ':now': Date.now() } as Record<string, unknown>,
  };
  const setSlot = 'slotId = :slot, slotSK = :sk, dayId = :day, dayNumber = :dn, #d = :date, startTime = :st, endTime = :et, updatedAt = :now';

  try {
    if (seatFree) {
      await db.send(new TransactWriteCommand({
        TransactItems: [
          { Update: { // claim the seat only while one is free
            TableName: TABLE_NAME, Key: { PK: slot.PK, SK: slot.SK },
            UpdateExpression: 'SET bookedCount = bookedCount + :one', ConditionExpression: 'bookedCount < #cap',
            ExpressionAttributeNames: { '#cap': 'capacity' }, ExpressionAttributeValues: { ':one': 1 },
          } },
          { Update: {
            ...eventCheck, UpdateExpression: 'ADD bookedSlots :one',
            ExpressionAttributeValues: { ...eventCheck.ExpressionAttributeValues, ':one': 1 },
          } },
          { Update: {
            TableName: TABLE_NAME, Key: keys.booking(entry.bookingId),
            UpdateExpression: `SET ${setSlot}, GSI1PK = :g1, GSI1SK = :g1s, confirmedFromWaitlist = :yes REMOVE waitlisted, waitlistedAt`,
            ConditionExpression: 'attribute_exists(PK) AND waitlisted = :yes',
            ExpressionAttributeNames: { '#d': 'date' },
            ExpressionAttributeValues: { ...slotFields, ':g1': lists.eventBookings(entry.eventId), ':g1s': gsi1sk(slot.dayNumber, slot.startTime, entry.bookingId) },
          } },
        ],
      }));
    } else {
      await db.send(new TransactWriteCommand({
        TransactItems: [
          { ConditionCheck: eventCheck },
          { Update: {
            TableName: TABLE_NAME, Key: keys.booking(entry.bookingId),
            UpdateExpression: `SET ${setSlot}, waitlistedAt = :now, GSI1SK = :g1s`,
            ConditionExpression: 'attribute_exists(PK) AND waitlisted = :yes',
            ExpressionAttributeNames: { '#d': 'date' },
            ExpressionAttributeValues: { ...slotFields, ':g1s': gsi1sk(slot.dayNumber, slot.startTime, entry.bookingId, now) },
          } },
        ],
      }));
    }
  } catch (err) {
    if (!(err instanceof TransactionCanceledException)) throw err;
    const reasons = (err.CancellationReasons ?? []).map((r) => r.Code === 'ConditionalCheckFailed');
    if (seatFree && reasons[0]) throw new HttpError(409, 'That seat was just taken. Reload and choose again.');
    if (reasons[seatFree ? 1 : 0]) throw new HttpError(409, EDIT_LOCKED_MESSAGE);
    throw new HttpError(409, 'This waitlist place has just changed (it may have been seated). Reload and try again.');
  }

  const booking = (await getBooking(entry.bookingId))!;
  if (seatFree) await notifyAttendee('confirmed', booking, event);
  return { booking, confirmed: seatFree };
}

/**
 * Seats a waitlisted attendee in place of a no-show, by staff during the event (Check-in Waitlist
 * list, or "Mark present" on the booking): the place becomes a confirmed booking, checked in
 * (manual), counted on its slot and the event. Capacity is not enforced: the no-show still holds a seat.
 */
export async function seatWaitlistEntry(entry: BookingItem, adminName: string): Promise<string> {
  if (!entry.waitlisted) {
    throw new HttpError(409, entry.attendanceStatus === 'PRESENT' ? 'This attendee has already been seated.' : 'This person is not on the waitlist.');
  }
  const event = await getEventCore(entry.eventId);
  if (!event || eventStatus(event.startDate, event.endDate, new Date(), event.timeZone, event.status) !== 'LIVE') {
    throw new HttpError(409, 'Waitlisted attendees can be marked present only while the event is live. Before the event, use Change slot to give them a free seat.');
  }
  const at = new Date().toISOString();
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Update: {
          TableName: TABLE_NAME, Key: keys.booking(entry.bookingId),
          UpdateExpression: 'SET seatedFromWaitlist = :yes, GSI1PK = :g1, GSI1SK = :g1s, '
            + 'attendanceStatus = :present, checkedInAt = :at, checkedInBy = :by, checkInMethod = :m, updatedAt = :at REMOVE waitlisted, waitlistedAt',
          ConditionExpression: 'attribute_exists(PK) AND waitlisted = :yes',
          ExpressionAttributeValues: {
            ':yes': true, ':g1': lists.eventBookings(entry.eventId), ':g1s': gsi1sk(entry.dayNumber, entry.startTime, entry.bookingId),
            ':present': 'PRESENT', ':at': at, ':by': adminName, ':m': 'MANUAL',
          },
        } },
        { Update: {
          TableName: TABLE_NAME, Key: { PK: keys.event(entry.eventId).PK, SK: entry.slotSK },
          UpdateExpression: 'SET bookedCount = bookedCount + :one', ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeValues: { ':one': 1 },
        } },
        { Update: {
          TableName: TABLE_NAME, Key: keys.event(entry.eventId),
          UpdateExpression: 'ADD bookedSlots :one',
          ConditionExpression: `#s <> :cancelled AND ${NOT_EDIT_LOCKED}`,
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':one': 1, ':cancelled': 'CANCELLED', ':now': Date.now() },
        } },
      ],
    }));
  } catch (err) {
    if (!(err instanceof TransactionCanceledException)) throw err;
    const current = await getBooking(entry.bookingId);
    if (!current) throw new HttpError(409, 'The attendee left the waitlist.');
    if (!current.waitlisted) throw new HttpError(409, 'This attendee has already been seated.');
    throw new HttpError(409, EDIT_LOCKED_MESSAGE);
  }
  return at;
}
