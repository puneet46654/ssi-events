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

// The slot runs from an hour from now; skip near midnight, where it would cross into another day.
const nowMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
const nearMidnight = nowMin > 1440 - 150;
const hhmm = (offset: number) => { const m = nowMin + offset; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const today = new Date().toISOString().slice(0, 10);
const [EVENT, DAY, SLOT, SLOT2, SLOT3] = [newId(), newId(), newId(), newId(), newId()];
const put = (i: Record<string, unknown>) => table.set(`${i.PK}|${i.SK}`, i);
const slotItem = () => [...table.values()].find((i) => i.slotId === SLOT && String(i.SK).startsWith('SLOT#'))!;
const eventItem = () => table.get(`EVENT#${EVENT}|META`)!;

let admin: string[];
beforeEach(async () => {
  await installFakeTable(db);
  put({ PK: `EVENT#${EVENT}`, SK: 'META', GSI1PK: 'EVENTS', GSI1SK: `${today}#${EVENT}`, eventId: EVENT, eventName: 'MantraM today', eventType: 'mantram',
    venue: 'x', startDate: today, endDate: today, timeZone: 'UTC', status: 'ACTIVE', totalSlots: 1, bookedSlots: 0, updatedAt: '' });
  put({ PK: `EVENT#${EVENT}`, SK: 'DAY#01', dayId: DAY, dayNumber: 1, date: today, startTime: '00:00', endTime: '23:59' });
  put({ PK: `EVENT#${EVENT}`, SK: `SLOT#01#${hhmm(60)}#${SLOT}`, slotId: SLOT, dayId: DAY, dayNumber: 1, date: today,
    startTime: hhmm(60), endTime: hhmm(90), capacity: 1, bookedCount: 0 });
  put({ PK: `EVENT#${EVENT}`, SK: `SLOT#01#${hhmm(95)}#${SLOT2}`, slotId: SLOT2, dayId: DAY, dayNumber: 1, date: today,
    startTime: hhmm(95), endTime: hhmm(110), capacity: 1, bookedCount: 0 });
  put({ PK: `EVENT#${EVENT}`, SK: `SLOT#01#${hhmm(115)}#${SLOT3}`, slotId: SLOT3, dayId: DAY, dayNumber: 1, date: today,
    startTime: hhmm(115), endTime: hhmm(130), capacity: 1, bookedCount: 1 });
  const { hash, salt } = await hashPassword('Correct-Horse-9');
  put({ PK: 'ADMIN#naveen', SK: 'META', GSI1PK: 'ADMINS', GSI1SK: 'naveen', username: 'naveen', name: 'N', role: 'superadmin', permissions: [],
    canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '' });
  admin = jar((await call('POST', '/api/admin/login', { body: { username: 'naveen', password: 'Correct-Horse-9' } })).cookies);
});

const details = (n: number) => ({ fullName: `Dr ${n}`, email: `t${n}@example.com`, mobile: `98765432${String(n).padStart(2, '0')}`, countryCode: '+91' });
const book = (n: number, waitlist = false) => call('POST', '/api/bookings', {
  body: { eventId: EVENT, dayScheduleId: DAY, slotId: SLOT, idempotencyKey: randomUUID(), details: details(n), ...(waitlist ? { waitlist: true } : {}) },
});

test('a full slot offers its waitlist; joining holds no seat and gives no QR', { skip: nearMidnight }, async () => {
  assert.equal((await book(1)).status, 201);
  assert.equal((await book(2)).status, 409, 'a plain booking into a full slot is still refused');

  const s = (await call('GET', `/api/events/${EVENT}/slots`)).data.days[0].slots[0];
  assert.deepEqual([s.available, s.waitlistOpen, s.waitlistCount], [false, true, 0]);

  const first = await book(2, true);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.deepEqual([first.data.booking.status, first.data.booking.waitlistPosition, first.data.booking.qrData], ['WAITLISTED', 1, '']);
  assert.equal((await book(3, true)).data.booking.waitlistPosition, 2);
  assert.equal(slotItem().bookedCount, 1, 'waitlist places take no seat');
  assert.equal(eventItem().bookedSlots, 1);

  const again = await book(2, true);
  assert.equal(again.status, 200, 'joining twice returns the same place');
  assert.equal(again.data.booking.bookingId, first.data.booking.bookingId);
});

test('with waitlist:true and a free seat, the attendee simply books', { skip: nearMidnight }, async () => {
  const res = await book(1, true);
  assert.equal(res.status, 201);
  assert.equal(res.data.booking.status, 'ACTIVE');
});

test('staff seat a waitlisted attendee: present, counted, off the waitlist; check-in refuses waitlist references', { skip: nearMidnight }, async () => {
  await book(1);
  const id = (await book(2, true)).data.booking.bookingId as string;

  const scan = await call('POST', '/api/admin/attendance', { cookies: admin, body: { eventId: EVENT, method: 'MANUAL', bookingId: id } });
  assert.equal(scan.status, 409);
  assert.match(scan.data.error, /waitlist place/);

  const list = await call('GET', `/api/admin/waitlist?eventId=${EVENT}`, { cookies: admin });
  assert.equal(list.status, 200, JSON.stringify(list.data));
  assert.deepEqual(
    list.data.slots.map((g: any) => [g.capacity, g.booked, g.arrived, g.entries.map((e: any) => [e.fullName, e.position])]),
    [[1, 1, 0, [['Dr 2', 1]]]],
  );

  const seat = await call('POST', '/api/admin/waitlist/seat', { cookies: admin, body: { eventId: EVENT, bookingId: id } });
  assert.equal(seat.status, 200, JSON.stringify(seat.data));
  const b = table.get(`BOOKING#${id}|META`)!;
  assert.deepEqual(
    [b.waitlisted, b.seatedFromWaitlist, b.attendanceStatus, b.checkInMethod, b.GSI1PK],
    [undefined, true, 'PRESENT', 'MANUAL', `EVENT#${EVENT}#BOOKINGS`],
  );
  assert.equal(slotItem().bookedCount, 2);
  assert.equal(eventItem().bookedSlots, 2);
  assert.equal((await call('GET', `/api/admin/waitlist?eventId=${EVENT}`, { cookies: admin })).data.total, 0);
  assert.equal((await call('POST', '/api/admin/waitlist/seat', { cookies: admin, body: { eventId: EVENT, bookingId: id } })).status, 409);
});

test('admin Bookings lists waitlist places (All / Waitlisted), not under Confirmed; deleting one frees no seat', { skip: nearMidnight }, async () => {
  await book(1);
  const id = (await book(2, true)).data.booking.bookingId as string;

  const all = await call('GET', '/api/admin/bookings?limit=100', { cookies: admin });
  const row = all.data.bookings.find((b: any) => b.bookingId === id);
  assert.deepEqual([row?.waitlisted, row?.waitlistPosition, row?.slot?._id], [true, 1, SLOT]);
  assert.equal(all.data.stats.total, 1, 'stats count real bookings only');
  assert.equal(all.data.stats.waitlisted, 1);
  const onlyWaitlist = await call('GET', '/api/admin/bookings?limit=100&status=waitlisted', { cookies: admin });
  assert.deepEqual(onlyWaitlist.data.bookings.map((b: any) => b.bookingId), [id]);
  const confirmed = await call('GET', '/api/admin/bookings?limit=100&status=confirmed', { cookies: admin });
  assert.ok(!confirmed.data.bookings.some((b: any) => b.bookingId === id));

  const del = await call('DELETE', `/api/admin/bookings/${id}`, { cookies: admin });
  assert.equal(del.status, 200, JSON.stringify(del.data));
  assert.equal(slotItem().bookedCount, 1, 'removing a waitlist place frees no seat');
  assert.equal(eventItem().bookedSlots, 1);

  // Mark present on a waitlisted doctor (booking page) seats them.
  const other = (await book(3, true)).data.booking.bookingId as string;
  const mark = await call('PATCH', `/api/admin/bookings/${other}`, { cookies: admin, body: { attendanceStatus: 'PRESENT' } });
  assert.equal(mark.status, 200, JSON.stringify(mark.data));
  const seated = table.get(`BOOKING#${other}|META`)!;
  assert.deepEqual([seated.waitlisted, seated.seatedFromWaitlist, seated.attendanceStatus], [undefined, true, 'PRESENT']);
  assert.equal(slotItem().bookedCount, 2);
});

test('an attendee can leave the waitlist; seats are untouched', { skip: nearMidnight }, async () => {
  await book(1);
  const joined = await book(2, true);
  const id = joined.data.booking.bookingId as string;
  const res = await call('DELETE', `/api/bookings?bookingId=${id}`, { cookies: jar(joined.cookies) });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(table.get(`BOOKING#${id}|META`), undefined);
  assert.equal(slotItem().bookedCount, 1);
});

const slotById = (id: string) => [...table.values()].find((i) => i.slotId === id && String(i.SK).startsWith('SLOT#'))!;

test('a waitlisted attendee changes slot from My Tickets: to a free seat = confirmed with QR; to a full slot = back of that queue', { skip: nearMidnight }, async () => {
  await book(1);
  const joined = await book(2, true);
  const cookies = jar(joined.cookies);
  const id = joined.data.booking.bookingId as string;

  const toFull = await call('PATCH', '/api/bookings', { cookies, body: { bookingId: id, dayScheduleId: DAY, slotId: SLOT3 } });
  assert.equal(toFull.status, 200, JSON.stringify(toFull.data));
  assert.deepEqual(
    [toFull.data.confirmed, toFull.data.booking.status, toFull.data.booking.slotId, toFull.data.booking.waitlistPosition],
    [false, 'WAITLISTED', SLOT3, 1],
  );
  assert.equal(slotById(SLOT3).bookedCount, 1, 'no seat taken');

  const toFree = await call('PATCH', '/api/bookings', { cookies, body: { bookingId: id, dayScheduleId: DAY, slotId: SLOT2 } });
  assert.equal(toFree.status, 200, JSON.stringify(toFree.data));
  assert.equal(toFree.data.confirmed, true);
  assert.equal(toFree.data.booking.status, 'ACTIVE');
  assert.ok(toFree.data.booking.qrData, 'a confirmed booking has a QR code');
  assert.equal(slotById(SLOT2).bookedCount, 1);
  assert.equal(eventItem().bookedSlots, 2);
  const b = table.get(`BOOKING#${id}|META`)!;
  assert.deepEqual([b.waitlisted, b.confirmedFromWaitlist, b.GSI1PK], [undefined, true, `EVENT#${EVENT}#BOOKINGS`]);
});

test('when a seat frees up in their own slot, a waitlisted attendee can take it', { skip: nearMidnight }, async () => {
  const first = await book(1);
  const joined = await book(2, true);
  const id = joined.data.booking.bookingId as string;
  const stay = await call('PATCH', '/api/bookings', { cookies: jar(joined.cookies), body: { bookingId: id, dayScheduleId: DAY, slotId: SLOT } });
  assert.equal(stay.status, 409, 'own slot still full');

  await call('DELETE', `/api/bookings?bookingId=${first.data.booking.bookingId}`, { cookies: jar(first.cookies) });
  const take = await call('PATCH', '/api/bookings', { cookies: jar(joined.cookies), body: { bookingId: id, dayScheduleId: DAY, slotId: SLOT } });
  assert.equal(take.status, 200, JSON.stringify(take.data));
  assert.equal(take.data.booking.status, 'ACTIVE');
  assert.equal(slotItem().bookedCount, 1);
});

test("admin changes a waitlisted attendee's slot", { skip: nearMidnight }, async () => {
  await book(1);
  const id = (await book(2, true)).data.booking.bookingId as string;
  const res = await call('POST', '/api/admin/waitlist/move', { cookies: admin, body: { eventId: EVENT, bookingId: id, dayScheduleId: DAY, slotId: SLOT2 } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.confirmed, true);
  assert.equal(table.get(`BOOKING#${id}|META`)!.slotId, SLOT2);
});
