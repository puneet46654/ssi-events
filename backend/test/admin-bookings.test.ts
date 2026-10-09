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
const today = new Date().toISOString().slice(0, 10); // events below use UTC, so this is "today" there
const later = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const [LIVE, SOON, DAY_L, DAY_S, SLOT_L, SLOT_S] = [newId(), newId(), newId(), newId(), newId(), newId()];

const put = (i: Record<string, unknown>) => table.set(`${i.PK}|${i.SK}`, i);

function seedEvent(eventId: string, dayId: string, slotId: string, date: string, start: string, end: string, name: string) {
  put({ PK: `EVENT#${eventId}`, SK: 'META', GSI1PK: 'EVENTS', GSI1SK: `${date}#${eventId}`, eventId, eventName: name, eventType: 'mantram',
    venue: 'Gurugram', description: 'x', startDate: date, endDate: date, timeZone: 'UTC', status: 'ACTIVE',
    totalSlots: 5, bookedSlots: 0, updatedAt: '2026-10-09T00:00:00Z' });
  put({ PK: `EVENT#${eventId}`, SK: 'DAY#01', dayId, dayNumber: 1, date, startTime: start, endTime: end });
  put({ PK: `EVENT#${eventId}`, SK: `SLOT#01#${start}#${slotId}`, slotId, dayId, dayNumber: 1, date, startTime: start, endTime: end, capacity: 5, bookedCount: 0 });
}

async function addAdmin(username: string, over: Record<string, unknown> = {}) {
  const { hash, salt } = await hashPassword(PASSWORD);
  put({ PK: `ADMIN#${username}`, SK: 'META', GSI1PK: 'ADMINS', GSI1SK: username, username, name: username, role: 'superadmin',
    permissions: [], canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '', ...over });
  const res = await call('POST', '/api/admin/login', { body: { username, password: PASSWORD } });
  return jar(res.cookies);
}

const details = (n: number, over: Record<string, string> = {}) => ({
  fullName: `Dr Test ${n}`, email: `t${n}@example.com`, mobile: `98765432${String(n).padStart(2, '0')}`, countryCode: '+91',
  specialty: n % 2 ? 'Urology' : 'Cardiology', ...over,
});
async function book(eventId: string, dayId: string, slotId: string, n: number) {
  const res = await call('POST', '/api/bookings', { body: { eventId, dayScheduleId: dayId, slotId, details: details(n), idempotencyKey: randomUUID() } });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data.booking.bookingId as string;
}

let admin: string[];
beforeEach(async () => {
  await installFakeTable(db);
  seedEvent(LIVE, DAY_L, SLOT_L, today, '00:00', '23:59', 'MantraM Gurugram');
  seedEvent(SOON, DAY_S, SLOT_S, later, '09:00', '10:00', 'MantraM Pune');
  admin = await addAdmin('naveen');
});

/* ---------- Bookings list ---------- */

test('lists bookings and pending registrations with stats, filters and pagination', async () => {
  await book(LIVE, DAY_L, SLOT_L, 1);
  await book(SOON, DAY_S, SLOT_S, 2);
  await book(SOON, DAY_S, SLOT_S, 3);
  await call('POST', '/api/bookings/pending', { body: { eventId: SOON, draftId: randomUUID(), details: details(4) } });

  const all = await call('GET', '/api/admin/bookings', { cookies: admin });
  assert.equal(all.status, 200, JSON.stringify(all.data));
  assert.equal(all.data.pagination.total, 4);
  assert.deepEqual(all.data.stats, { total: 3, upcoming: 3, past: 0, pending: 1 });
  assert.equal(all.data.bookings.filter((b: any) => b.pending).length, 1);
  assert.deepEqual(all.data.filterOptions.specialty, ['Cardiology', 'Urology']);

  const pune = await call('GET', `/api/admin/bookings?eventId=${SOON}&status=confirmed`, { cookies: admin });
  assert.equal(pune.data.pagination.total, 2);
  assert.equal(pune.data.filterOptions.slots.length, 1);
  const search = await call('GET', '/api/admin/bookings?search=t3@example', { cookies: admin });
  assert.deepEqual(search.data.bookings.map((b: any) => b.attendee.fullName), ['Dr Test 3']);
  const uro = await call('GET', '/api/admin/bookings?specialty=urology', { cookies: admin });
  assert.equal(uro.data.pagination.total, 2);
  const paged = await call('GET', '/api/admin/bookings?limit=3&page=2&sort=name', { cookies: admin });
  assert.equal(paged.data.bookings.length, 1);
  assert.equal(paged.data.pagination.pages, 2);
});

test('the bookings list needs the bookings module', async () => {
  const staff = await addAdmin('staff', { role: 'staff', permissions: ['check-in'] });
  assert.equal((await call('GET', '/api/admin/bookings', { cookies: staff })).status, 403);
  assert.equal((await call('GET', '/api/admin/bookings')).status, 401);
});

/* ---------- One booking ---------- */

test('detail, edit details (phone index follows) and mark attendance by hand', async () => {
  const id = await book(SOON, DAY_S, SLOT_S, 1);
  const detail = await call('GET', `/api/admin/bookings/${id}`, { cookies: admin });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.booking.eventId.eventName, 'MantraM Pune');
  assert.equal(detail.data.booking.slotId.startTime, '09:00');

  const res = await call('PATCH', `/api/admin/bookings/${id}`, { cookies: admin,
    body: { details: { fullName: 'Dr Renamed', mobile: '9123456780' }, attendanceStatus: 'PRESENT' } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const stored = table.get(`BOOKING#${id}|META`)!;
  assert.equal(stored.details.fullName, 'Dr Renamed');
  assert.equal(stored.GSI2PK, `PHONE#${stored.phone}`);
  assert.match(stored.phone, /9123456780$/);
  assert.equal(stored.attendanceStatus, 'PRESENT');
  assert.equal(stored.checkInMethod, 'MANUAL');

  const undo = await call('PATCH', `/api/admin/bookings/${id}`, { cookies: admin, body: { details: {}, attendanceStatus: 'NOT_PRESENT' } });
  assert.equal(undo.status, 200);
  assert.equal(table.get(`BOOKING#${id}|META`)!.checkInMethod, undefined);
  const bad = await call('PATCH', `/api/admin/bookings/${id}`, { cookies: admin, body: { details: { email: 'nope' } } });
  assert.equal(bad.status, 400);
});

test('deleting a booking frees the seat; pending registrations can be edited and discarded', async () => {
  const id = await book(SOON, DAY_S, SLOT_S, 1);
  const slot = () => [...table.values()].find((i) => i.slotId === SLOT_S && String(i.SK).startsWith('SLOT#'))!;
  assert.equal(slot().bookedCount, 1);
  assert.equal((await call('DELETE', `/api/admin/bookings/${id}`, { cookies: admin })).status, 200);
  assert.equal(slot().bookedCount, 0);
  assert.equal(table.get(`EVENT#${SOON}|META`)!.bookedSlots, 0);
  assert.equal((await call('GET', `/api/admin/bookings/${id}`, { cookies: admin })).status, 404);

  const draftId = randomUUID();
  await call('POST', '/api/bookings/pending', { body: { eventId: SOON, draftId, details: details(5) } });
  const pid = `${SOON}_${draftId}`;
  const edited = await call('PATCH', `/api/admin/bookings/${pid}`, { cookies: admin, body: { details: { fullName: 'Dr Pending' } } });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.booking.pending, true);
  assert.equal((await call('DELETE', `/api/admin/bookings/pending/${pid}`, { cookies: admin })).status, 200);
  assert.equal((await call('DELETE', `/api/admin/bookings/pending/${pid}`, { cookies: admin })).status, 404);
});

test('deleting bookings needs the delete right', async () => {
  const id = await book(SOON, DAY_S, SLOT_S, 1);
  const editor = await addAdmin('editor', { role: 'admin', permissions: ['bookings'], canDelete: false });
  assert.equal((await call('DELETE', `/api/admin/bookings/${id}`, { cookies: editor })).status, 403);
});

/* ---------- Check-in ---------- */

const scan = (code: string, eventId = LIVE, cookies = admin) =>
  call('POST', '/api/admin/attendance', { cookies, body: { eventId, method: 'QR', code } });

test('only live events are offered, with attendance figures', async () => {
  await book(LIVE, DAY_L, SLOT_L, 1);
  const res = await call('GET', `/api/admin/attendance?eventId=${LIVE}`, { cookies: admin });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual(res.data.events.map((e: any) => e.id), [LIVE]);
  assert.deepEqual(res.data.stats, { total: 1, present: 0, remaining: 1, percentage: 0 });
  assert.equal((await call('GET', `/api/admin/attendance?eventId=${SOON}`, { cookies: admin })).status, 400);
});

test('scanning a ticket QR checks the attendee in once; a second scan reports it', async () => {
  const id = await book(LIVE, DAY_L, SLOT_L, 1);
  const ticket = await call('GET', `/api/admin/bookings/${id}`, { cookies: admin });
  assert.equal(ticket.status, 200);
  const qr = JSON.stringify({ type: 'SSI_EVENTS_ATTENDANCE', doctorId: id, bookingId: id, eventId: LIVE });

  const first = await scan(qr);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.alreadyPresent, false);
  assert.equal(table.get(`BOOKING#${id}|META`)!.checkInMethod, 'QR');
  const again = await scan(qr);
  assert.equal(again.data.alreadyPresent, true);

  const summary = await call('GET', `/api/admin/attendance?eventId=${LIVE}`, { cookies: admin });
  assert.equal(summary.data.stats.present, 1);
  assert.equal(summary.data.recent[0].bookingId, id);
});

test('manual check-in by reference, and the refusals', async () => {
  const id = await book(LIVE, DAY_L, SLOT_L, 1);
  const manual = await call('POST', '/api/admin/attendance', { cookies: admin, body: { eventId: LIVE, method: 'MANUAL', bookingId: id.toLowerCase() } });
  assert.equal(manual.status, 200, JSON.stringify(manual.data));

  const other = await book(SOON, DAY_S, SLOT_S, 2);
  const wrongEvent = await scan(JSON.stringify({ type: 'SSI_EVENTS_ATTENDANCE', bookingId: other, eventId: SOON }));
  assert.equal(wrongEvent.status, 409);
  assert.equal((await scan(other)).status, 404); // bare reference of another event's ticket
  assert.equal((await scan(JSON.stringify({ type: 'SOMETHING_ELSE' }))).status, 400);
  assert.equal((await scan('SSI-EV-2026-000000000000')).status, 404);
  assert.equal((await scan(other, SOON)).status, 409); // that event isn't live today
});

test('admission only during the booked slot', async () => {
  const LATE = newId(), DAY = newId(), SLOT = newId();
  seedEvent(LATE, DAY, SLOT, today, '23:58', '23:59', 'MantraM Late');
  const id = await book(LATE, DAY, SLOT, 1);
  const res = await scan(id, LATE);
  // Unless this runs in the last two minutes of the UTC day, the slot hasn't started yet.
  if (new Date().toISOString().slice(11, 16) < '23:58') {
    assert.equal(res.status, 409);
    assert.match(res.data.error, /Check-in for this ticket is open on/);
  }
});

test('check-in needs the check-in module', async () => {
  const id = await book(LIVE, DAY_L, SLOT_L, 1);
  const viewer = await addAdmin('viewer', { role: 'admin', permissions: ['bookings'] });
  assert.equal((await scan(id, LIVE, viewer)).status, 403);
});
