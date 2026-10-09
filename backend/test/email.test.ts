import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, mock, test } from 'node:test';
import { client, installFakeTable, table } from './fake-table.js';

process.env.ADMIN_SESSION_SECRET = 'a'.repeat(64);
process.env.BOOKING_ACCESS_SECRET = 'b'.repeat(64);

const { db } = await import('../src/db/table.js');
const { handler } = await import('../src/handler.js');
const { newId } = await import('../src/lib/ids.js');
const { ses, ticketEmail, mimeMessage } = await import('../src/lib/email.js');
const call = client(handler);

const [EVENT, DAY, SLOT_A, SLOT_B] = [newId(), newId(), newId(), newId()];
const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const put = (i: Record<string, unknown>) => table.set(`${i.PK}|${i.SK}`, i);

function seed() {
  put({ PK: `EVENT#${EVENT}`, SK: 'META', GSI1PK: 'EVENTS', eventId: EVENT, eventName: 'MantraM <Gurugram>', venue: 'Medanta, Gurugram',
    description: 'x', startDate: date, endDate: date, timeZone: 'Asia/Kolkata', status: 'ACTIVE', totalSlots: 4, bookedSlots: 0, updatedAt: '2026-10-09T00:00:00Z' });
  put({ PK: `EVENT#${EVENT}`, SK: 'DAY#01', dayId: DAY, dayNumber: 1, date, startTime: '09:00', endTime: '10:00' });
  for (const [slotId, start, end] of [[SLOT_A, '09:00', '09:30'], [SLOT_B, '09:30', '10:00']]) {
    put({ PK: `EVENT#${EVENT}`, SK: `SLOT#01#${start}#${slotId}`, slotId, dayId: DAY, dayNumber: 1, date, startTime: start, endTime: end, capacity: 2, bookedCount: 0 });
  }
}

const details = { title: 'Dr.', fullName: 'Asha Rao', email: 'asha@example.com', mobile: '9876543210', countryCode: '+91' };
let sent: Buffer[];

beforeEach(async () => {
  await installFakeTable(db);
  seed();
  sent = [];
  process.env.MAIL_FROM = 'SS Innovations Events <tickets@events.ssistudios.com>';
  mock.method(ses, 'send', async (command: any) => { sent.push(Buffer.from(command.input.Content.Raw.Data)); return { MessageId: `m-${sent.length}` }; });
});
afterEach(() => { delete process.env.MAIL_FROM; delete process.env.MAIL_CC; mock.restoreAll(); });

const decodedParts = (raw: Buffer) => [...raw.toString().matchAll(/base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)]
  .map((m) => Buffer.from(m[1]!.replace(/\r\n/g, ''), 'base64'));

test('booking sends a confirmation with the QR code, and records it on the booking', async () => {
  const res = await call('POST', '/api/bookings', { body: { eventId: EVENT, dayScheduleId: DAY, slotId: SLOT_A, details, idempotencyKey: randomUUID() } });
  assert.equal(res.status, 201);
  assert.equal(sent.length, 1);
  const raw = sent[0]!.toString();
  assert.match(raw, /^From: SS Innovations Events <tickets@events.ssistudios.com>\r\nTo: asha@example.com\r\n/);
  assert.match(raw, /Content-ID: <ticket-qr@events.ssistudios.com>/);
  const [text, html] = decodedParts(sent[0]!).map(String);
  assert.match(text!, /Dear Dr\. Asha Rao,/);
  assert.match(text!, new RegExp(`Booking reference: ${res.data.booking.bookingId}`));
  assert.match(text!, /09:00 – 09:30 \(India Standard Time\)/);
  assert.match(html!, /MantraM &#60;Gurugram&#62;/); // attendee-visible values are escaped
  assert.equal(table.get(`BOOKING#${res.data.booking.bookingId}|META`)!.lastEmail.messageId, 'm-1');

  // A retried request returns the same booking and does not email again.
  const replay = await call('POST', '/api/bookings', { body: { eventId: EVENT, dayScheduleId: DAY, slotId: SLOT_A, details, idempotencyKey: randomUUID() } });
  assert.equal(replay.status, 201); // a different key is a new booking
  assert.equal(sent.length, 2);
});

test('reschedule and cancel each send their own email', async () => {
  const booked = await call('POST', '/api/bookings', { body: { eventId: EVENT, dayScheduleId: DAY, slotId: SLOT_A, details, idempotencyKey: randomUUID() } });
  const cookies = booked.cookies.map((c) => c.split(';')[0]!);
  const bookingId = booked.data.booking.bookingId;
  const moved = await call('PATCH', '/api/bookings', { cookies, body: { bookingId, dayScheduleId: DAY, slotId: SLOT_B } });
  assert.equal(moved.status, 200);
  assert.match(String(decodedParts(sent[1]!)[0]), /09:30 – 10:00/);
  assert.match(sent[1]!.toString(), /Subject: =\?UTF-8\?B\?/);
  const cancelled = await call('DELETE', `/api/bookings?bookingId=${bookingId}`, { cookies });
  assert.equal(cancelled.status, 200);
  assert.equal(sent.length, 3);
  assert.doesNotMatch(sent[2]!.toString(), /Content-ID/); // no QR on a cancellation
});

test('an email failure never fails the booking', async () => {
  mock.method(ses, 'send', async () => { throw Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' }); });
  const errors = mock.method(console, 'error', () => undefined);
  const res = await call('POST', '/api/bookings', { body: { eventId: EVENT, dayScheduleId: DAY, slotId: SLOT_A, details, idempotencyKey: randomUUID() } });
  assert.equal(res.status, 201);
  assert.equal(table.get(`BOOKING#${res.data.booking.bookingId}|META`)!.lastEmail.error, 'TooManyRequestsException');
  assert.ok(errors.mock.callCount() >= 1);
});

test('nothing is sent when email is not configured', async () => {
  delete process.env.MAIL_FROM;
  const res = await call('POST', '/api/bookings', { body: { eventId: EVENT, dayScheduleId: DAY, slotId: SLOT_A, details, idempotencyKey: randomUUID() } });
  assert.equal(res.status, 201);
  assert.equal(sent.length, 0);
});

test('message headers cannot be injected through attendee details', async () => {
  const mail = await ticketEmail('confirmed', {
    bookingId: 'SSI-EV-2026-ABCDEF123456', eventId: EVENT, date, startTime: '09:00', endTime: '09:30', email: 'a@example.com',
    details: { fullName: 'X\r\nBcc: evil@example.com', email: 'a@example.com', mobile: '1' },
  } as any, { eventName: 'E\r\nBcc: evil@example.com', venue: 'V', timeZone: 'Asia/Kolkata' } as any);
  const raw = mimeMessage(mail, 'SS Innovations Events <tickets@events.ssistudios.com>').toString();
  assert.doesNotMatch(raw, /^Bcc:/m);
});

test('staff in MAIL_CC are copied on every ticket email', async () => {
  process.env.MAIL_CC = 'naveen.kumar@ssinnovations.org, reena.bhatt@ssinnovations.org,vilayat.ali@ssinnovations.org, not an address';
  const destinations: any[] = [];
  mock.method(ses, 'send', async (command: any) => {
    destinations.push(command.input.Destination);
    sent.push(Buffer.from(command.input.Content.Raw.Data));
    return { MessageId: 'm' };
  });
  const res = await call('POST', '/api/bookings', { body: { eventId: EVENT, dayScheduleId: DAY, slotId: SLOT_A, details, idempotencyKey: randomUUID() } });
  assert.equal(res.status, 201);
  const staff = ['naveen.kumar@ssinnovations.org', 'reena.bhatt@ssinnovations.org', 'vilayat.ali@ssinnovations.org'];
  assert.deepEqual(destinations[0], { ToAddresses: ['asha@example.com'], CcAddresses: staff });
  assert.ok(sent[0]!.toString().includes(`\r\nCc: ${staff.join(', ')}\r\n`));
});
