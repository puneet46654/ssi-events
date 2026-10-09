import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, test } from 'node:test';
import { client, installFakeTable, jar, table } from './fake-table.js';

process.env.ADMIN_SESSION_SECRET = 'a'.repeat(64);
process.env.BOOKING_ACCESS_SECRET = 'b'.repeat(64);

const { db } = await import('../src/db/table.js');
const { handler } = await import('../src/handler.js');
const { newId } = await import('../src/lib/ids.js');
const call = client(handler);

const [EVENT, DAY, SLOT_A, SLOT_B] = [newId(), newId(), newId(), newId()];
const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

function seed(over: { capacity?: number; status?: string; date?: string } = {}) {
  const d = over.date ?? date;
  const put = (i: Record<string, unknown>) => table.set(`${i.PK}|${i.SK}`, i);
  put({ PK: `EVENT#${EVENT}`, SK: 'META', GSI1PK: 'EVENTS', eventId: EVENT, eventName: 'SSI Masterclass', venue: 'Gurugram',
    description: 'x', startDate: d, endDate: d, timeZone: 'Asia/Kolkata', status: over.status ?? 'ACTIVE',
    totalSlots: 2 * (over.capacity ?? 2), bookedSlots: 0, updatedAt: '2026-10-09T00:00:00Z' });
  put({ PK: `EVENT#${EVENT}`, SK: 'DAY#01', dayId: DAY, dayNumber: 1, date: d, startTime: '09:00', endTime: '10:00' });
  for (const [slotId, start, end] of [[SLOT_A, '09:00', '09:30'], [SLOT_B, '09:30', '10:00']]) {
    put({ PK: `EVENT#${EVENT}`, SK: `SLOT#01#${start}#${slotId}`, slotId, dayId: DAY, dayNumber: 1, date: d,
      startTime: start, endTime: end, capacity: over.capacity ?? 2, bookedCount: 0 });
  }
}

const slotOf = (id: string) => [...table.values()].find((i) => i.slotId === id && String(i.SK).startsWith('SLOT#'))!;
const eventMeta = () => table.get(`EVENT#${EVENT}|META`)!;
const details = (n = 1) => ({ fullName: `Dr Test ${n}`, email: `test${n}@example.com`, mobile: `98765432${String(n).padStart(2, '0')}`, countryCode: '+91', specialty: 'Urology' });
const book = (slotId = SLOT_A, d = details(), key = randomUUID()) =>
  call('POST', '/api/bookings', { body: { eventId: EVENT, dayScheduleId: DAY, slotId, details: d, idempotencyKey: key } });

beforeEach(async () => { await installFakeTable(db); });

test('slots show live availability', async () => {
  seed();
  await book();
  const res = await call('GET', `/api/events/${EVENT}/slots`);
  assert.equal(res.status, 200);
  const slots = res.data.days[0].slots;
  assert.deepEqual(slots.map((s: any) => [s.startTime, s.remaining, s.available]), [['09:00', 1, true], ['09:30', 2, true]]);
});

test('booking claims a seat, counts it on the event and grants ticket access', async () => {
  seed();
  const res = await book();
  assert.equal(res.status, 201);
  assert.match(res.data.booking.bookingId, /^SSI-EV-\d{4}-[0-9A-F]{12}$/);
  assert.equal(res.data.booking.status, 'ACTIVE');
  assert.equal(slotOf(SLOT_A).bookedCount, 1);
  assert.equal(eventMeta().bookedSlots, 1);
  assert.equal(res.cookies.length, 1);
  assert.match(res.cookies[0]!, /^ssievents_ticket_[0-9a-f]{24}=\d+\.[0-9a-f]{64}; .*HttpOnly; Secure; SameSite=Lax$/);
  const qr = JSON.parse(res.data.booking.qrData);
  assert.equal(qr.type, 'SSI_EVENTS_ATTENDANCE');
});

test('a retried request returns the same booking; a reused key with other details is refused', async () => {
  seed();
  const key = randomUUID();
  const first = await book(SLOT_A, details(1), key);
  const retry = await book(SLOT_A, details(1), key);
  assert.equal(retry.status, 200);
  assert.equal(retry.data.existing, true);
  assert.equal(retry.data.booking.bookingId, first.data.booking.bookingId);
  assert.equal(slotOf(SLOT_A).bookedCount, 1);
  assert.equal((await book(SLOT_A, details(2), key)).status, 409);
});

test('a full slot refuses further bookings', async () => {
  seed({ capacity: 1 });
  assert.equal((await book(SLOT_A, details(1))).status, 201);
  const full = await book(SLOT_A, details(2));
  assert.equal(full.status, 409);
  assert.equal(full.data.error, 'This slot is no longer available.');
  assert.equal(slotOf(SLOT_A).bookedCount, 1);
});

test('cancelled events and past slots cannot be booked', async () => {
  seed({ status: 'CANCELLED' });
  assert.equal((await book()).status, 409);
  await installFakeTable(db);
  seed({ date: '2020-01-01' });
  assert.equal((await book()).status, 409);
});

test('invalid input is rejected with a reason', async () => {
  seed();
  assert.equal((await book(SLOT_A, { ...details(), email: 'nope' })).data.error, 'Enter a valid email address.');
  assert.equal((await book(SLOT_A, { ...details(), mobile: '12' })).data.error, 'Enter a valid full mobile number.');
  assert.equal((await book('not-an-id')).status, 400);
  const noKey = await call('POST', '/api/bookings', { body: { eventId: EVENT, dayScheduleId: DAY, slotId: SLOT_A, details: details() } });
  assert.equal(noKey.status, 400);
});

test('a ticket can be read only by a browser holding its grant', async () => {
  seed();
  const { data, cookies } = await book();
  const id = data.booking.bookingId;
  assert.equal((await call('GET', `/api/bookings?bookingId=${id}`)).status, 403);
  const own = await call('GET', `/api/bookings?bookingId=${id}`, { cookies: jar(cookies) });
  assert.equal(own.status, 200);
  assert.equal(own.data.booking.details.fullName, 'Dr Test 1');
});

test('My Tickets: a phone number alone reveals nothing; reference + number unlocks the ticket', async () => {
  seed();
  const { data, cookies } = await book();
  const id = data.booking.bookingId;
  const mobile = '919876543201';

  const sameDevice = await call('POST', '/api/events/mytickets', { body: { mobile }, cookies: jar(cookies) });
  assert.deepEqual(sameDevice.data.tickets.map((t: any) => t.bookingId), [id]);
  assert.equal(sameDevice.data.tickets[0].canManage, true);

  const otherDevice = await call('POST', '/api/events/mytickets', { body: { mobile } });
  assert.deepEqual(otherDevice.data.tickets, []);
  assert.equal(otherDevice.data.referenceNeeded, true);
  const unknownNumber = await call('POST', '/api/events/mytickets', { body: { mobile: '919999999999' } });
  assert.deepEqual(unknownNumber.data, otherDevice.data); // indistinguishable

  const withRef = await call('POST', '/api/events/mytickets', { body: { mobile, bookingId: id.toLowerCase() } });
  assert.deepEqual(withRef.data.tickets.map((t: any) => t.bookingId), [id]);
  assert.equal(withRef.cookies.length, 1);

  const wrongRef = await call('POST', '/api/events/mytickets', { body: { mobile, bookingId: 'SSI-EV-2026-000000000000' } });
  assert.equal(wrongRef.status, 404);
});

test('reschedule moves the seat; cancel releases it and the retry key', async () => {
  seed();
  const { data, cookies } = await book();
  const id = data.booking.bookingId;
  const moved = await call('PATCH', '/api/bookings', { body: { bookingId: id, dayScheduleId: DAY, slotId: SLOT_B }, cookies: jar(cookies) });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.booking.startTime, '09:30');
  assert.deepEqual([slotOf(SLOT_A).bookedCount, slotOf(SLOT_B).bookedCount], [0, 1]);

  assert.equal((await call('DELETE', `/api/bookings?bookingId=${id}`)).status, 403);
  const cancelled = await call('DELETE', `/api/bookings?bookingId=${id}`, { cookies: jar(cookies) });
  assert.equal(cancelled.status, 200);
  assert.equal(slotOf(SLOT_B).bookedCount, 0);
  assert.equal(eventMeta().bookedSlots, 0);
  assert.equal([...table.keys()].some((key) => key.includes('REQUEST#') || key.startsWith('BOOKING#')), false);
});

test('pending details are saved, then cleared by the confirmed booking', async () => {
  seed();
  const draftId = randomUUID();
  const saved = await call('POST', '/api/bookings/pending', { body: { eventId: EVENT, draftId, details: details() } });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.saved, true);
  assert.ok([...table.keys()].some((key) => key.endsWith(`PENDING#${draftId}`)));
  await book();
  assert.equal([...table.keys()].some((key) => key.includes('PENDING#')), false);
});

test('cross-site booking requests are refused', async () => {
  seed();
  const res = await call('POST', '/api/bookings', {
    body: { eventId: EVENT, dayScheduleId: DAY, slotId: SLOT_A, details: details(), idempotencyKey: randomUUID() },
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(res.status, 403);
});
