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

const PASSWORD = 'Correct-Horse-9';
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const put = (i: Record<string, unknown>) => table.set(`${i.PK}|${i.SK}`, i);
const ids = Array.from({ length: 4 }, () => ({ event: newId(), day: newId(), slot: newId() }));

function seedEvent(n: number, date: string, name: string, status = 'ACTIVE') {
  const { event, day: dayId, slot } = ids[n]!;
  put({ PK: `EVENT#${event}`, SK: 'META', GSI1PK: 'EVENTS', GSI1SK: `${date}#${event}`, eventId: event, eventName: name, eventType: 'mantram',
    venue: 'Gurugram', description: 'x', startDate: date, endDate: date, timeZone: 'UTC', status, totalSlots: 5, bookedSlots: 0, updatedAt: '' });
  put({ PK: `EVENT#${event}`, SK: 'DAY#01', dayId, dayNumber: 1, date, startTime: '00:00', endTime: '23:59' });
  put({ PK: `EVENT#${event}`, SK: `SLOT#01#00:00#${slot}`, slotId: slot, dayId, dayNumber: 1, date, startTime: '00:00', endTime: '23:59', capacity: 5, bookedCount: 0 });
}

async function signIn(username: string, over: Record<string, unknown> = {}) {
  const { hash, salt } = await hashPassword(PASSWORD);
  put({ PK: `ADMIN#${username}`, SK: 'META', GSI1PK: 'ADMINS', GSI1SK: username, username, name: username, role: 'superadmin',
    permissions: [], canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '', ...over });
  return jar((await call('POST', '/api/admin/login', { body: { username, password: PASSWORD } })).cookies);
}

async function book(n: number, who: number) {
  const { event, day: dayId, slot } = ids[n]!;
  const res = await call('POST', '/api/bookings', { body: { eventId: event, dayScheduleId: dayId, slotId: slot, idempotencyKey: randomUUID(),
    details: { fullName: `Dr ${who}`, email: `t${who}@example.com`, mobile: `98765432${String(who).padStart(2, '0')}`, countryCode: '+91' } } });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.booking.bookingId as string;
}

let admin: string[];
beforeEach(async () => {
  await installFakeTable(db);
  seedEvent(0, day(0), 'MantraM today');
  seedEvent(1, day(10), 'MantraM soon');
  seedEvent(2, day(-10), 'MantraM last week');
  seedEvent(3, day(20), 'MantraM cancelled', 'CANCELLED');
  admin = await signIn('naveen');
});

test('dashboard figures, latest bookings and next events', async () => {
  const first = await book(0, 1);
  await book(0, 2);
  await book(1, 3);
  await call('POST', '/api/admin/attendance', { cookies: admin, body: { eventId: ids[0]!.event, method: 'MANUAL', bookingId: first } });

  const res = await call('GET', '/api/admin/dashboard', { cookies: admin });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  // 4 events, 1 live; 3 bookings, 1 attended today; free seats today onward: (5-2) + (5-1), the cancelled event excluded.
  assert.deepEqual(res.data.stats, { totalEvents: 4, liveToday: 1, totalBookings: 3, todayAttendance: 1, availableSlots: 7 });
  assert.equal(res.data.recentBookings.length, 3);
  assert.deepEqual(new Set(res.data.recentBookings.map((b: any) => b.fullName)), new Set(['Dr 1', 'Dr 2', 'Dr 3']));
  assert.deepEqual(res.data.upcomingEvents.map((e: any) => [e.eventName, e.status, e.booked, e.capacity, e.percentage]),
    [['MantraM today', 'LIVE', 2, 5, 40], ['MantraM soon', 'UPCOMING', 1, 5, 20]]);
});

test('dashboard needs the dashboard module', async () => {
  assert.equal((await call('GET', '/api/admin/dashboard')).status, 401);
  const staff = await signIn('staff', { role: 'staff', permissions: ['check-in'] });
  assert.equal((await call('GET', '/api/admin/dashboard', { cookies: staff })).status, 403);
  const viewer = await signIn('viewer', { role: 'staff', permissions: ['dashboard'] });
  assert.equal((await call('GET', '/api/admin/dashboard', { cookies: viewer })).status, 200);
});
