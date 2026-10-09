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
const { registrationTrend } = await import('../src/routes/admin-reports.js');
const call = client(handler);

const PASSWORD = 'Correct-Horse-9';
const today = new Date().toISOString().slice(0, 10);
const later = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
const [LIVE, SOON, DAY_L, DAY_S, SLOT_L, SLOT_S] = [newId(), newId(), newId(), newId(), newId(), newId()];
const put = (i: Record<string, unknown>) => table.set(`${i.PK}|${i.SK}`, i);

function seedEvent(eventId: string, dayId: string, slotId: string, date: string, name: string, type: string) {
  put({ PK: `EVENT#${eventId}`, SK: 'META', GSI1PK: 'EVENTS', GSI1SK: `${date}#${eventId}`, eventId, eventName: name, eventType: type,
    venue: 'Gurugram', description: 'x', startDate: date, endDate: date, timeZone: 'UTC', status: 'ACTIVE',
    totalSlots: 10, bookedSlots: 0, updatedAt: '2026-10-09T00:00:00Z' });
  put({ PK: `EVENT#${eventId}`, SK: 'DAY#01', dayId, dayNumber: 1, date, startTime: '00:00', endTime: '23:59' });
  put({ PK: `EVENT#${eventId}`, SK: `SLOT#01#00:00#${slotId}`, slotId, dayId, dayNumber: 1, date, startTime: '00:00', endTime: '23:59', capacity: 10, bookedCount: 0 });
}

async function signIn(username: string, over: Record<string, unknown> = {}) {
  const { hash, salt } = await hashPassword(PASSWORD);
  put({ PK: `ADMIN#${username}`, SK: 'META', GSI1PK: 'ADMINS', GSI1SK: username, username, name: username, role: 'superadmin',
    permissions: [], canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '', ...over });
  return jar((await call('POST', '/api/admin/login', { body: { username, password: PASSWORD } })).cookies);
}

async function book(eventId: string, dayId: string, slotId: string, n: number) {
  const res = await call('POST', '/api/bookings', { body: { eventId, dayScheduleId: dayId, slotId, idempotencyKey: randomUUID(),
    details: { fullName: `Dr ${n}`, email: `t${n}@example.com`, mobile: `98765432${String(n).padStart(2, '0')}`, countryCode: '+91', hospitalName: 'AIIMS', specialty: 'Urology' } } });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.booking.bookingId as string;
}

let admin: string[];
beforeEach(async () => {
  await installFakeTable(db);
  seedEvent(LIVE, DAY_L, SLOT_L, today, 'SSi MantraM at Medanta', 'mantram');
  seedEvent(SOON, DAY_S, SLOT_S, later, 'SSi MantraM at AIIMS Jodhpur', 'mantram');
  admin = await signIn('naveen');
});

test('report: summary, per-event performance, charts and the ledger', async () => {
  const first = await book(LIVE, DAY_L, SLOT_L, 1);
  await book(LIVE, DAY_L, SLOT_L, 2);
  await book(SOON, DAY_S, SLOT_S, 3);
  const scan = await call('POST', '/api/admin/attendance', { cookies: admin, body: { eventId: LIVE, method: 'MANUAL', bookingId: first } });
  assert.equal(scan.status, 200);

  const res = await call('GET', '/api/admin/reports?timeZone=UTC', { cookies: admin });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const { summary, eventPerformance, charts, bookings, eventOptions } = res.data;
  assert.deepEqual(
    [summary.totalBookings, summary.present, summary.notPresent, summary.attendanceRate, summary.manualCheckIns, summary.qrCheckIns],
    [3, 1, 2, 33.33, 1, 0]);
  assert.deepEqual([summary.totalCapacity, summary.reservedCapacity, summary.remainingCapacity, summary.slotUtilization], [20, 3, 17, 15]);
  assert.deepEqual([summary.events, summary.liveEvents], [2, 1]);
  assert.deepEqual(eventPerformance.map((e: any) => [e.eventName, e.registrations, e.present, e.utilization]),
    [['SSi MantraM at Medanta', 2, 1, 20], ['SSi MantraM at AIIMS Jodhpur', 1, 0, 10]]);
  assert.equal(charts.attendanceByEvent[0].fullEventName, 'SSi MantraM at Medanta');
  assert.deepEqual(charts.attendanceStatus, [{ name: 'Present', value: 1 }, { name: 'Not Present', value: 2 }]);
  assert.equal(charts.registrationTrend.at(-1).registered, 3);
  assert.equal(bookings.length, 3);
  const row = bookings.find((b: any) => b.bookingId === first);
  assert.deepEqual([row.hospital, row.specialty, row.attendanceStatus, row.checkInMethod, row.checkedInBy], ['AIIMS', 'Urology', 'PRESENT', 'MANUAL', 'naveen']);
  assert.equal(eventOptions.length, 2);
});

test('report filters: event, attendance and registration dates', async () => {
  const first = await book(LIVE, DAY_L, SLOT_L, 1);
  await book(SOON, DAY_S, SLOT_S, 2);
  await call('POST', '/api/admin/attendance', { cookies: admin, body: { eventId: LIVE, method: 'MANUAL', bookingId: first } });

  const one = await call('GET', `/api/admin/reports?eventId=${SOON}`, { cookies: admin });
  assert.deepEqual([one.data.summary.totalBookings, one.data.summary.events, one.data.eventOptions.length], [1, 1, 2]);
  const attended = await call('GET', '/api/admin/reports?attendance=present', { cookies: admin });
  assert.deepEqual(attended.data.bookings.map((b: any) => b.bookingId), [first]);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const none = await call('GET', `/api/admin/reports?from=${yesterday}&to=${yesterday}&timeZone=UTC`, { cookies: admin });
  assert.equal(none.data.summary.totalBookings, 0);
  const todayOnly = await call('GET', `/api/admin/reports?from=${today}&to=${today}&timeZone=UTC`, { cookies: admin });
  assert.equal(todayOnly.data.summary.totalBookings, 2);
});

test('report input checks and access', async () => {
  assert.equal((await call('GET', '/api/admin/reports?eventId=nope', { cookies: admin })).status, 400);
  assert.equal((await call('GET', '/api/admin/reports?from=2026-13-01', { cookies: admin })).status, 400);
  assert.equal((await call('GET', '/api/admin/reports?from=2026-10-10&to=2026-10-01', { cookies: admin })).status, 400);
  assert.equal((await call('GET', '/api/admin/reports?timeZone=Mars/Base', { cookies: admin })).status, 400);
  assert.equal((await call('GET', '/api/admin/reports')).status, 401);
  const staff = await signIn('staff', { role: 'staff', permissions: ['check-in'] });
  assert.equal((await call('GET', '/api/admin/reports', { cookies: staff })).status, 403);
});

test('registration trend: daily buckets, monthly past 62 days', () => {
  const rows = [
    { createdAt: '2026-10-01T10:00:00Z', attendanceStatus: 'PRESENT' },
    { createdAt: '2026-10-03T23:30:00Z', attendanceStatus: 'NOT_PRESENT' }, // 4 Oct in India
  ];
  const daily = registrationTrend(rows, '2026-10-01', '2026-10-04', new Date(), 'Asia/Kolkata');
  assert.deepEqual(daily.map((d) => d.registered), [1, 0, 0, 1]);
  assert.equal(daily[0]!.period, '01 Oct');
  const monthly = registrationTrend(rows, '2026-08-01', '2026-10-31', new Date(), 'UTC');
  assert.deepEqual(monthly.map((m) => [m.period, m.registered, m.present]), [['Aug 2026', 0, 0], ['Sept 2026', 0, 0], ['Oct 2026', 2, 1]]);
});
