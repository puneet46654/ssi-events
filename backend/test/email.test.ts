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
const { runCancelNotices } = await import('../src/lib/cancel-notices.js');
const { hashPassword } = await import('../src/lib/passwords.js');
const { jar } = await import('./fake-table.js');
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

/* ---------- Event cancellation notices ---------- */

async function adminCookies() {
  const { hash, salt } = await hashPassword('Correct-Horse-9');
  put({ PK: 'ADMIN#naveen', SK: 'META', GSI1PK: 'ADMINS', GSI1SK: 'naveen', username: 'naveen', name: 'Naveen', role: 'superadmin',
    permissions: [], canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '' });
  return jar((await call('POST', '/api/admin/login', { body: { username: 'naveen', password: 'Correct-Horse-9' } })).cookies);
}
const bookAs = (n: number) => call('POST', '/api/bookings', { body: { eventId: EVENT, dayScheduleId: DAY, slotId: n % 2 ? SLOT_A : SLOT_B,
  details: { fullName: `Dr ${n}`, email: `attendee${n}@example.com`, mobile: `98765432${String(n).padStart(2, '0')}`, countryCode: '+91' }, idempotencyKey: randomUUID() } });

test('cancelling a booked event emails each attendee once, without staff copies, then sends staff one summary', async () => {
  process.env.MAIL_CC = 'naveen.kumar@ssinnovations.org,reena.bhatt@ssinnovations.org';
  const destinations: any[] = [];
  mock.method(ses, 'send', async (command: any) => {
    destinations.push(command.input.Destination);
    sent.push(Buffer.from(command.input.Content.Raw.Data));
    return { MessageId: `m-${sent.length}` };
  });
  for (const n of [1, 2, 3]) assert.equal((await bookAs(n)).status, 201);
  destinations.length = 0; sent.length = 0;

  const cookies = await adminCookies();
  const res = await call('DELETE', `/api/events/${EVENT}`, { cookies });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.cancelled, true);
  assert.equal(res.data.attendeesNotified, true);

  const attendeeMails = destinations.filter((d) => d.ToAddresses[0].startsWith('attendee'));
  assert.deepEqual(attendeeMails.map((d) => d.ToAddresses[0]).sort(), ['attendee1@example.com', 'attendee2@example.com', 'attendee3@example.com']);
  assert.ok(attendeeMails.every((d) => !d.CcAddresses));
  const notice = String(decodedParts(sent[0]!)[0]);
  assert.match(notice, /We regret to inform you that the event below has been cancelled/);
  assert.doesNotMatch(sent[0]!.toString(), /Content-ID/); // no QR code
  const summary = destinations.at(-1);
  assert.deepEqual(summary, { ToAddresses: ['naveen.kumar@ssinnovations.org'], CcAddresses: ['reena.bhatt@ssinnovations.org'] });
  assert.match(String(decodedParts(sent.at(-1)!)[0]), /Attendees emailed: 3\./);
  const bookings = [...table.values()].filter((i) => String(i.PK).startsWith('BOOKING#'));
  assert.ok(bookings.every((b) => b.lastEmail.kind === 'event-cancelled'));

  // A retried run emails nobody again (only the staff summary goes out).
  destinations.length = 0;
  await runCancelNotices({ job: 'event-cancelled-emails', eventId: EVENT, startedBy: 'naveen' });
  assert.equal(destinations.filter((d) => d.ToAddresses[0].startsWith('attendee')).length, 0);
});

test('a resumed run continues after the last booking handled', async () => {
  const to: string[] = [];
  mock.method(ses, 'send', async (command: any) => { to.push(command.input.Destination.ToAddresses[0]); return { MessageId: 'm' }; });
  const refs: string[] = [];
  for (const n of [1, 2, 3]) refs.push((await bookAs(n)).data.booking.bookingId);
  table.set(`EVENT#${EVENT}|META`, { ...table.get(`EVENT#${EVENT}|META`)!, status: 'CANCELLED' });
  to.length = 0;
  const sorted = [...refs].sort();
  await runCancelNotices({ job: 'event-cancelled-emails', eventId: EVENT, startedBy: 'naveen', after: sorted[0] });
  assert.equal(to.length, 2);
});

test('no notices for an event that is not cancelled, or without email configured', async () => {
  const to: string[] = [];
  mock.method(ses, 'send', async (command: any) => { to.push(command.input.Destination.ToAddresses[0]); return { MessageId: 'm' }; });
  await bookAs(1);
  to.length = 0;
  await runCancelNotices({ job: 'event-cancelled-emails', eventId: EVENT, startedBy: 'naveen' });
  assert.equal(to.length, 0);
  delete process.env.MAIL_FROM;
  const cookies = await adminCookies();
  const res = await call('DELETE', `/api/events/${EVENT}`, { cookies });
  assert.equal(res.data.cancelled, true);
  assert.equal(res.data.attendeesNotified, false);
  assert.equal(to.length, 0);
});
