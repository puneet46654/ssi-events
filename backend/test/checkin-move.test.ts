import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, test } from 'node:test';
import { client, installFakeTable, jar, table } from './fake-table.js';

process.env.ADMIN_SESSION_SECRET = 'a'.repeat(64);
process.env.BOOKING_ACCESS_SECRET = 'b'.repeat(64);

const { db } = await import('../src/db/table.js');
const { handler } = await import('../src/handler.js');
const { hashPassword } = await import('../src/lib/passwords.js');
const { newId } = await import('../src/lib/ids.js');
const call = client(handler);

// Slots are placed around "now" in UTC; skip near midnight, where they would cross into another day.
const nowMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
const nearMidnight = nowMin < 30 || nowMin > 1440 - 120;
const hhmm = (offset: number) => { const m = nowMin + offset; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const today = new Date().toISOString().slice(0, 10);
const [EVENT, DAY] = [newId(), newId()];
const SLOTS = {
  booked: { id: newId(), start: hhmm(60), end: hhmm(90), capacity: 5 },    // the ticket's own slot, an hour away
  now: { id: newId(), start: hhmm(-10), end: hhmm(20), capacity: 3 },      // running now, seats free
  full: { id: newId(), start: hhmm(-5), end: hhmm(25), capacity: 1 },      // running now, no seats
  soon: { id: newId(), start: hhmm(10), end: hhmm(40), capacity: 3 },      // starts in 10 minutes: open under the 15-minute rule
};
const put = (i: Record<string, unknown>) => table.set(`${i.PK}|${i.SK}`, i);
const slotItem = (id: string) => [...table.values()].find((i) => i.slotId === id && String(i.SK).startsWith('SLOT#'))!;

let admin: string[];
beforeEach(async () => {
  await installFakeTable(db);
  put({ PK: `EVENT#${EVENT}`, SK: 'META', GSI1PK: 'EVENTS', GSI1SK: `${today}#${EVENT}`, eventId: EVENT, eventName: 'MantraM today', eventType: 'mantram',
    venue: 'x', startDate: today, endDate: today, timeZone: 'UTC', status: 'ACTIVE', totalSlots: 12, bookedSlots: 0, updatedAt: '' });
  put({ PK: `EVENT#${EVENT}`, SK: 'DAY#01', dayId: DAY, dayNumber: 1, date: today, startTime: '00:00', endTime: '23:59' });
  for (const s of Object.values(SLOTS)) {
    put({ PK: `EVENT#${EVENT}`, SK: `SLOT#01#${s.start}#${s.id}`, slotId: s.id, dayId: DAY, dayNumber: 1, date: today,
      startTime: s.start, endTime: s.end, capacity: s.capacity, bookedCount: 0 });
  }
  const { hash, salt } = await hashPassword('Correct-Horse-9');
  put({ PK: 'ADMIN#naveen', SK: 'META', GSI1PK: 'ADMINS', GSI1SK: 'naveen', username: 'naveen', name: 'N', role: 'superadmin', permissions: [],
    canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '' });
  admin = jar((await call('POST', '/api/admin/login', { body: { username: 'naveen', password: 'Correct-Horse-9' } })).cookies);
});

async function bookInto(slotId: string, n: number) {
  const res = await call('POST', '/api/bookings', { body: { eventId: EVENT, dayScheduleId: DAY, slotId, idempotencyKey: randomUUID(),
    details: { fullName: `Dr ${n}`, email: `t${n}@example.com`, mobile: `98765432${String(n).padStart(2, '0')}`, countryCode: '+91' } } });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.booking.bookingId as string;
}
const scan = (bookingId: string, moveToSlotId?: string) =>
  call('POST', '/api/admin/attendance', { cookies: admin, body: { eventId: EVENT, method: 'MANUAL', bookingId, ...(moveToSlotId ? { moveToSlotId } : {}) } });

test('check-in opens 15 minutes before the slot', { skip: nearMidnight }, async () => {
  const id = await bookInto(SLOTS.soon.id, 1);
  const res = await scan(id);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.alreadyPresent, false);
});

test('an early arrival is offered the slots open now with free seats, and can be moved in and checked in', { skip: nearMidnight }, async () => {
  await bookInto(SLOTS.full.id, 9); // fills the only seat in "full"
  const id = await bookInto(SLOTS.booked.id, 1);

  const early = await scan(id);
  assert.equal(early.status, 409);
  assert.match(early.data.error, new RegExp(`Check-in opens at ${hhmm(45)}`));
  assert.deepEqual(early.data.openSlots.map((s: any) => [s.startTime, s.remaining]), [[SLOTS.now.start, 3], [SLOTS.soon.start, 3]]);

  const moved = await scan(id, SLOTS.now.id);
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(moved.data.booking.startTime, SLOTS.now.start);
  assert.match(moved.data.message, /^Moved to .* and checked in\.$/);
  const booking = table.get(`BOOKING#${id}|META`)!;
  assert.deepEqual([booking.slotId, booking.startTime, booking.attendanceStatus, booking.checkInMethod], [SLOTS.now.id, SLOTS.now.start, 'PRESENT', 'MANUAL']);
  assert.equal(slotItem(SLOTS.now.id).bookedCount, 1);
  assert.equal(slotItem(SLOTS.booked.id).bookedCount, 0);
  assert.equal((await scan(id)).data.alreadyPresent, true);
});

test('moving into a full or closed slot is refused and changes nothing', { skip: nearMidnight }, async () => {
  await bookInto(SLOTS.full.id, 9);
  const id = await bookInto(SLOTS.booked.id, 1);
  assert.equal((await scan(id, SLOTS.full.id)).status, 409);
  assert.equal((await scan(id, SLOTS.booked.id)).status, 409); // its own slot isn't open yet
  assert.equal((await scan(id, 'not-an-id')).status, 400);
  assert.equal(table.get(`BOOKING#${id}|META`)!.attendanceStatus, 'NOT_PRESENT');
  assert.equal(slotItem(SLOTS.booked.id).bookedCount, 1);
});
