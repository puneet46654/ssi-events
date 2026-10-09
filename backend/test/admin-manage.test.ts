import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, test } from 'node:test';
import { client, installFakeTable, jar, table } from './fake-table.js';

process.env.ADMIN_SESSION_SECRET = 'a'.repeat(64);
process.env.BOOKING_ACCESS_SECRET = 'b'.repeat(64);

const { db } = await import('../src/db/table.js');
const { handler } = await import('../src/handler.js');
const { hashPassword } = await import('../src/lib/passwords.js');
const call = client(handler);

const PASSWORD = 'Correct-Horse-9';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const [D1, D2, D3] = [day(30), day(31), day(32)];

async function addAdmin(username: string, over: Record<string, unknown> = {}) {
  const { hash, salt } = await hashPassword(PASSWORD);
  table.set(`ADMIN#${username}|META`, {
    PK: `ADMIN#${username}`, SK: 'META', GSI1PK: 'ADMINS', GSI1SK: username, username, name: username, role: 'superadmin',
    permissions: ['events'], canCreate: true, canDelete: true, isActive: true,
    passwordHash: hash, passwordSalt: salt, createdAt: '2026-01-01T00:00:00Z', updatedAt: '', ...over,
  });
}

async function signIn(username: string, password = PASSWORD) {
  const res = await call('POST', '/api/admin/login', { body: { username, password } });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  return jar(res.cookies);
}

type Day = { date: string; startTime: string; endTime: string; capacity: string };
function eventForm(days: Day[], over: Record<string, string> = {}) {
  const form = new FormData();
  const fields: Record<string, string> = {
    eventName: 'SSI Masterclass', eventType: 'conference', bookingFormTemplate: 'practitioner-institutional',
    venue: 'Gurugram', description: 'Hands-on session', timeZone: 'Asia/Kolkata',
    startDate: days[0]!.date, endDate: days.at(-1)!.date, numberOfDays: String(days.length),
    daySchedules: JSON.stringify(days.map((d) => ({ ...d, lunchEnabled: false, slotDuration: '30', slotGap: '0' }))),
    ...over,
  };
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

async function sendForm(method: string, path: string, form: FormData, cookies: string[]) {
  const encoded = new Response(form);
  return call(method, path, { raw: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type')!, cookies });
}

const slots = (eventId: string) => [...table.values()].filter((i) => i.PK === `EVENT#${eventId}` && String(i.SK).startsWith('SLOT#'));
const meta = (eventId: string) => table.get(`EVENT#${eventId}|META`)!;

async function bookFirstSlot(eventId: string, n = 1) {
  const avail = await call('GET', `/api/events/${eventId}/slots`);
  const d = avail.data.days[0];
  const res = await call('POST', '/api/bookings', { body: {
    eventId, dayScheduleId: d._id, slotId: d.slots[0]._id, idempotencyKey: randomUUID(),
    details: { fullName: `Dr ${n}`, email: `t${n}@example.com`, mobile: `98765432${String(n).padStart(2, '0')}`, countryCode: '+91' },
  } });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res;
}

let cookies: string[];
let eventId: string;

beforeEach(async () => {
  await installFakeTable(db);
  await addAdmin('naveen');
  cookies = await signIn('naveen');
  const res = await sendForm('POST', '/api/events', eventForm([{ date: D1, startTime: '09:00', endTime: '10:00', capacity: '4' }]), cookies);
  assert.equal(res.status, 201, JSON.stringify(res.data));
  eventId = res.data.eventId;
});

/* ---------- Event edit ---------- */

test('edit changes details, adds a day and recounts seats', async () => {
  const res = await sendForm('PUT', `/api/events/${eventId}`, eventForm([
    { date: D1, startTime: '09:00', endTime: '10:00', capacity: '4' },
    { date: D2, startTime: '09:00', endTime: '09:30', capacity: '2' },
  ], { venue: 'Hyderabad' }), cookies);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(meta(eventId).venue, 'Hyderabad');
  assert.equal(meta(eventId).totalSlots, 4 * 2 + 2);
  assert.equal(meta(eventId).endDate, D2);
  assert.equal(meta(eventId).editLock, undefined);
  assert.equal(slots(eventId).length, 3);
  const detail = await call('GET', `/api/events/${eventId}`);
  assert.equal(detail.data.event.daySchedules.length, 2);
});

test('edit keeps booked slots and their bookings; shrinking the day removes only empty slots', async () => {
  const booked = await bookFirstSlot(eventId);
  const bookedSlotId = booked.data.booking.slotId;
  const res = await sendForm('PUT', `/api/events/${eventId}`,
    eventForm([{ date: D1, startTime: '09:00', endTime: '09:30', capacity: '3' }]), cookies);
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const left = slots(eventId);
  assert.equal(left.length, 1);
  assert.equal(left[0]!.slotId, bookedSlotId);
  assert.equal(left[0]!.bookedCount, 1);
  assert.equal(left[0]!.capacity, 3);
});

test('edit refuses to move or remove a booked slot, or squeeze it below its bookings', async () => {
  await bookFirstSlot(eventId, 1);
  await bookFirstSlot(eventId, 2);
  const moved = await sendForm('PUT', `/api/events/${eventId}`,
    eventForm([{ date: D1, startTime: '10:00', endTime: '11:00', capacity: '4' }]), cookies);
  assert.equal(moved.status, 409);
  assert.match(moved.data.error, /cannot be moved or removed/);
  const squeezed = await sendForm('PUT', `/api/events/${eventId}`,
    eventForm([{ date: D1, startTime: '09:00', endTime: '10:00', capacity: '1' }]), cookies);
  assert.equal(squeezed.status, 409);
  assert.match(squeezed.data.error, /cannot be lower than its 2 existing bookings/);
  const shifted = await sendForm('PUT', `/api/events/${eventId}`, eventForm([
    { date: day(29), startTime: '09:00', endTime: '10:00', capacity: '4' },
    { date: D1, startTime: '09:00', endTime: '10:00', capacity: '4' },
  ]), cookies);
  assert.equal(shifted.status, 409);
  const tz = await sendForm('PUT', `/api/events/${eventId}`,
    eventForm([{ date: D1, startTime: '09:00', endTime: '10:00', capacity: '4' }], { timeZone: 'Europe/London' }), cookies);
  assert.equal(tz.status, 409);
  assert.equal(slots(eventId).length, 2); // nothing was changed
  assert.equal(meta(eventId).editLock, undefined); // and the lock was released
});

test('bookings are refused while an edit holds the lock', async () => {
  table.set(`EVENT#${eventId}|META`, { ...meta(eventId), editLock: Date.now() + 60_000 });
  const avail = await call('GET', `/api/events/${eventId}/slots`);
  const d = avail.data.days[0];
  const res = await call('POST', '/api/bookings', { body: {
    eventId, dayScheduleId: d._id, slotId: d.slots[0]._id, idempotencyKey: randomUUID(),
    details: { fullName: 'Dr X', email: 'x@example.com', mobile: '9876543299', countryCode: '+91' },
  } });
  assert.equal(res.status, 409);
  assert.match(res.data.error, /being updated/);
  const second = await sendForm('PUT', `/api/events/${eventId}`, eventForm([{ date: D1, startTime: '09:00', endTime: '10:00', capacity: '4' }]), cookies);
  assert.equal(second.status, 409);
});

test('edit needs events + create rights', async () => {
  await addAdmin('viewer', { role: 'admin', permissions: ['events'], canCreate: false });
  const viewer = await signIn('viewer');
  const res = await sendForm('PUT', `/api/events/${eventId}`, eventForm([{ date: D3, startTime: '09:00', endTime: '10:00', capacity: '4' }]), viewer);
  assert.equal(res.status, 403);
});

/* ---------- Event delete ---------- */

test('deleting an unbooked event removes it and its schedule', async () => {
  const res = await call('DELETE', `/api/events/${eventId}`, { cookies });
  assert.equal(res.status, 200);
  assert.equal(res.data.cancelled, false);
  assert.equal([...table.keys()].filter((key) => key.startsWith(`EVENT#${eventId}`)).length, 0);
  assert.equal((await call('GET', `/api/events/${eventId}`)).status, 404);
});

test('deleting a booked event cancels it instead and keeps the bookings', async () => {
  const booked = await bookFirstSlot(eventId);
  const res = await call('DELETE', `/api/events/${eventId}`, { cookies });
  assert.equal(res.status, 200);
  assert.equal(res.data.cancelled, true);
  assert.equal(meta(eventId).status, 'CANCELLED');
  assert.ok(table.get(`BOOKING#${booked.data.booking.bookingId}|META`));
  const edit = await sendForm('PUT', `/api/events/${eventId}`, eventForm([{ date: D1, startTime: '09:00', endTime: '10:00', capacity: '4' }]), cookies);
  assert.equal(edit.status, 409);
});

test('delete needs events + delete rights', async () => {
  await addAdmin('editor', { role: 'admin', permissions: ['events'], canCreate: true, canDelete: false });
  const editor = await signIn('editor');
  assert.equal((await call('DELETE', `/api/events/${eventId}`, { cookies: editor })).status, 403);
});

/* ---------- Admin users ---------- */

const newUser = (over: Record<string, unknown> = {}) => ({
  username: 'Priya', name: 'Priya Sharma', password: 'Strong-Pass-123', role: 'staff',
  permissions: ['check-in', 'auth', 'bogus'], canCreate: false, canDelete: false, isActive: true, ...over,
});

test('superadmin creates a user who can then sign in with only the granted modules', async () => {
  const res = await call('POST', '/api/admin/users', { body: newUser(), cookies });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal(res.data.user._id, 'priya');
  assert.deepEqual(res.data.user.permissions, ['check-in']); // `auth` and unknown modules dropped
  assert.equal(res.data.user.passwordHash, undefined);
  const priya = await signIn('priya', 'Strong-Pass-123');
  const me = await call('GET', '/api/admin/session', { cookies: priya });
  assert.deepEqual(me.data.user.permissions, ['check-in']);
  assert.equal((await call('GET', '/api/admin/users', { cookies: priya })).status, 403);
  const list = await call('GET', '/api/admin/users', { cookies });
  assert.deepEqual(list.data.users.map((u: any) => u.username).sort(), ['naveen', 'priya']);
});

test('weak passwords, bad IDs and taken IDs are refused', async () => {
  assert.equal((await call('POST', '/api/admin/users', { body: newUser({ password: 'short' }), cookies })).status, 400);
  assert.equal((await call('POST', '/api/admin/users', { body: newUser({ username: 'a b' }), cookies })).status, 400);
  assert.equal((await call('POST', '/api/admin/users', { body: newUser({ permissions: [] }), cookies })).status, 400);
  assert.equal((await call('POST', '/api/admin/users', { body: newUser(), cookies })).status, 201);
  assert.equal((await call('POST', '/api/admin/users', { body: newUser(), cookies })).status, 409);
});

test('editing access applies at once; a password reset or rename signs the user out', async () => {
  await call('POST', '/api/admin/users', { body: newUser(), cookies });
  const priya = await signIn('priya', 'Strong-Pass-123');
  const res = await call('PUT', '/api/admin/users/priya', { body: { name: 'Priya S', permissions: ['bookings'], canCreate: true }, cookies });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const me = await call('GET', '/api/admin/session', { cookies: priya });
  assert.deepEqual(me.data.user.permissions, ['bookings']);

  await call('PUT', '/api/admin/users/priya', { body: { password: 'Another-Pass-456' }, cookies });
  assert.equal((await call('GET', '/api/admin/session', { cookies: priya })).status, 401);

  const renamed = await call('PUT', '/api/admin/users/priya', { body: { username: 'priya.s' }, cookies });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.data));
  assert.equal(table.get('ADMIN#priya|META'), undefined);
  assert.equal(table.get('ADMIN#priya.s|META')?.name, 'Priya S');
});

test('superadmins cannot lock themselves out or remove the last superadmin', async () => {
  assert.equal((await call('PUT', '/api/admin/users/naveen', { body: { role: 'admin', permissions: ['events'] }, cookies })).status, 400);
  assert.equal((await call('PUT', '/api/admin/users/naveen', { body: { isActive: false }, cookies })).status, 400);
  assert.equal((await call('DELETE', '/api/admin/users/naveen', { cookies })).status, 400);
  await addAdmin('other');
  const other = await signIn('other');
  assert.equal((await call('DELETE', '/api/admin/users/naveen', { cookies: other })).status, 200);
  assert.equal((await call('PUT', '/api/admin/users/other', { body: { role: 'staff', permissions: ['events'] }, cookies: other })).status, 400);
});

test('deleting a user ends their access', async () => {
  await call('POST', '/api/admin/users', { body: newUser(), cookies });
  const priya = await signIn('priya', 'Strong-Pass-123');
  assert.equal((await call('DELETE', '/api/admin/users/priya', { cookies })).status, 200);
  assert.equal((await call('GET', '/api/admin/session', { cookies: priya })).status, 401);
  assert.equal((await call('DELETE', '/api/admin/users/priya', { cookies })).status, 404);
});

/* ---------- Activity log ---------- */

test('activity log lists changes newest first and filters by admin and action', async () => {
  await call('POST', '/api/admin/users', { body: newUser(), cookies });
  await call('DELETE', `/api/events/${eventId}`, { cookies });
  const all = await call('GET', '/api/admin/activity', { cookies });
  assert.equal(all.status, 200);
  const actions = all.data.logs.map((l: any) => `${l.action}:${l.resource}`);
  // Entries written in the same millisecond have no fixed order, so compare as a set.
  assert.deepEqual(actions.slice(0, 3).sort(), ['create:admin_user', 'create:event', 'delete:event']);
  assert.ok(all.data.logs[0]._id);
  const deletes = await call('GET', '/api/admin/activity?action=delete', { cookies });
  assert.deepEqual(deletes.data.logs.map((l: any) => l.resource), ['event']);
  const none = await call('GET', '/api/admin/activity?admin=someone', { cookies });
  assert.equal(none.data.logs.length, 0);
});

/* ---------- Sign-in by email ---------- */

test('admins can sign in with their email; it must be unique; failures lock the account either way', async () => {
  const created = await call('POST', '/api/admin/users', { body: newUser({ email: ' Priya.Sharma@SSInnovations.org ' }), cookies });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  assert.equal(created.data.user.email, 'priya.sharma@ssinnovations.org');

  const byEmail = await call('POST', '/api/admin/login', { body: { username: 'priya.sharma@ssinnovations.org', password: 'Strong-Pass-123' } });
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.data.user.username, 'priya');

  const taken = await call('POST', '/api/admin/users', { body: newUser({ username: 'other', email: 'priya.sharma@ssinnovations.org' }), cookies });
  assert.equal(taken.status, 409);
  assert.equal((await call('PUT', '/api/admin/users/priya', { body: { email: 'not-an-email' }, cookies })).status, 400);

  // Five failures split across ID and email still lock the account.
  for (const username of ['priya', 'priya.sharma@ssinnovations.org', 'priya', 'priya.sharma@ssinnovations.org', 'priya']) {
    assert.equal((await call('POST', '/api/admin/login', { body: { username, password: 'wrong-Password-1' } })).status, 401);
  }
  assert.equal((await call('POST', '/api/admin/login', { body: { username: 'priya.sharma@ssinnovations.org', password: 'Strong-Pass-123' } })).status, 429);
  assert.equal((await call('POST', '/api/admin/login', { body: { username: 'nobody@example.com', password: 'x' } })).status, 401);
});
