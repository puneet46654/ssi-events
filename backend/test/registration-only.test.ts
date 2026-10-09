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

const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const put = (i: Record<string, unknown>) => table.set(`${i.PK}|${i.SK}`, i);
let admin: string[];

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const fields: Record<string, string> = {
    eventName: 'SSI Open Day', eventType: 'event', bookingFormTemplate: 'template-2', venue: 'SSI Gurugram', description: 'Open house',
    timeZone: 'UTC', startDate: day(0), endDate: day(1), registrationMode: 'open', capacity: '2', ...over,
  };
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}
async function send(method: string, path: string, f: FormData) {
  const encoded = new Response(f);
  return call(method, path, { raw: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type')!, cookies: admin });
}
const register = (eventId: string, n: number) => call('POST', '/api/bookings', { body: { eventId, idempotencyKey: randomUUID(),
  details: { fullName: `Dr ${n}`, email: `t${n}@example.com`, mobile: `98765432${String(n).padStart(2, '0')}`, countryCode: '+91' } } });
const meta = (id: string) => table.get(`EVENT#${id}|META`)!;

beforeEach(async () => {
  await installFakeTable(db);
  const { hash, salt } = await hashPassword('Correct-Horse-9');
  put({ PK: 'ADMIN#naveen', SK: 'META', GSI1PK: 'ADMINS', GSI1SK: 'naveen', username: 'naveen', name: 'N', role: 'superadmin', permissions: [],
    canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '' });
  admin = jar((await call('POST', '/api/admin/login', { body: { username: 'naveen', password: 'Correct-Horse-9' } })).cookies);
});

test('a registration-only event has no schedule and reports its mode and limit', async () => {
  const res = await send('POST', '/api/events', form());
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const id = res.data.eventId;
  assert.equal([...table.values()].filter((i) => i.PK === `EVENT#${id}` && i.SK !== 'META').length, 0);
  assert.deepEqual([meta(id).registrationMode, meta(id).capacity, meta(id).totalSlots, meta(id).numberOfDays], ['open', 2, 2, 2]);
  const detail = await call('GET', `/api/events/${id}`);
  assert.deepEqual([detail.data.event.registrationMode, detail.data.event.capacity, detail.data.event.daySchedules.length], ['open', 2, 0]);
  const slots = await call('GET', `/api/events/${id}/slots`);
  assert.deepEqual([slots.data.event.registrationMode, slots.data.event.remaining, slots.data.days.length], ['open', 2, 0]);
});

test('registering needs no slot; the limit is enforced; cancelling frees a place; no rescheduling', async () => {
  const id = (await send('POST', '/api/events', form())).data.eventId;
  const first = await register(id, 1);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const ticket = first.data.booking;
  assert.deepEqual([ticket.registrationOnly, ticket.startTime, ticket.status, ticket.eventEndDate], [true, '', 'ACTIVE', `${day(1)}T00:00:00.000Z`]);
  assert.equal((await register(id, 2)).status, 201);
  const full = await register(id, 3);
  assert.equal(full.status, 409);
  assert.equal(full.data.error, 'Registration for this event is full.');
  assert.equal(meta(id).bookedSlots, 2);

  const grant = first.cookies.map((c) => c.split(';')[0]!);
  const move = await call('PATCH', '/api/bookings', { cookies: grant, body: { bookingId: ticket.bookingId, dayScheduleId: '01JA0000000000000000000000', slotId: '01JA0000000000000000000001' } });
  assert.equal(move.status, 409);
  assert.equal((await call('DELETE', `/api/bookings?bookingId=${ticket.bookingId}`, { cookies: grant })).status, 200);
  assert.equal(meta(id).bookedSlots, 1);
  assert.equal((await register(id, 3)).status, 201);
});

test('without a limit any number can register', async () => {
  const id = (await send('POST', '/api/events', form({ capacity: '' }))).data.eventId;
  assert.equal(meta(id).capacity, undefined);
  for (const n of [1, 2, 3, 4]) assert.equal((await register(id, n)).status, 201);
});

test('check-in works at any time on the event days; admin lists show no slot', async () => {
  const id = (await send('POST', '/api/events', form())).data.eventId;
  const ref = (await register(id, 1)).data.booking.bookingId;
  const scan = await call('POST', '/api/admin/attendance', { cookies: admin, body: { eventId: id, method: 'MANUAL', bookingId: ref } });
  assert.equal(scan.status, 200, JSON.stringify(scan.data));
  const list = await call('GET', `/api/admin/bookings?eventId=${id}`, { cookies: admin });
  assert.deepEqual([list.data.bookings[0].slot, list.data.bookings[0].registrationOnly], [null, true]);
  const detail = await call('GET', `/api/admin/bookings/${ref}`, { cookies: admin });
  assert.deepEqual([detail.data.booking.slotId, detail.data.booking.registrationOnly], [null, true]);
  const dash = await call('GET', '/api/admin/dashboard', { cookies: admin });
  assert.deepEqual([dash.data.stats.todayAttendance, dash.data.stats.availableSlots], [1, 1]);
  assert.equal((await call('DELETE', `/api/admin/bookings/${ref}`, { cookies: admin })).status, 200);
  assert.equal(meta(id).bookedSlots, 0);
});

test('validation and edit rules', async () => {
  assert.equal((await send('POST', '/api/events', form({ endDate: day(-1) }))).status, 400);
  assert.equal((await send('POST', '/api/events', form({ capacity: '0' }))).status, 400);
  assert.equal((await send('POST', '/api/events', form({ endDate: day(40) }))).status, 400);

  const id = (await send('POST', '/api/events', form())).data.eventId;
  await register(id, 1);
  await register(id, 2);
  const lower = await send('PUT', `/api/events/${id}`, form({ capacity: '1' }));
  assert.equal(lower.status, 409);
  const toSlots = await send('PUT', `/api/events/${id}`, form({ registrationMode: 'slots', numberOfDays: '1', endDate: day(0),
    daySchedules: JSON.stringify([{ date: day(0), startTime: '09:00', endTime: '10:00', lunchEnabled: false, slotDuration: '30', slotGap: '0', capacity: '4' }]) }));
  assert.equal(toSlots.status, 409);
  const raise = await send('PUT', `/api/events/${id}`, form({ capacity: '' }));
  assert.equal(raise.status, 200, JSON.stringify(raise.data));
  assert.equal(meta(id).capacity, undefined); // limit removed
  assert.equal((await register(id, 3)).status, 201);
});

test('an unbooked time-slot event can become registration-only; its schedule is removed', async () => {
  const slotted = form({ registrationMode: 'slots', numberOfDays: '1', endDate: day(0), capacity: '',
    daySchedules: JSON.stringify([{ date: day(0), startTime: '09:00', endTime: '10:00', lunchEnabled: false, slotDuration: '30', slotGap: '0', capacity: '4' }]) });
  const id = (await send('POST', '/api/events', slotted)).data.eventId;
  assert.ok([...table.values()].some((i) => i.PK === `EVENT#${id}` && String(i.SK).startsWith('SLOT#')));
  const res = await send('PUT', `/api/events/${id}`, form());
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal([...table.values()].filter((i) => i.PK === `EVENT#${id}` && i.SK !== 'META').length, 0);
  assert.deepEqual([meta(id).registrationMode, meta(id).totalSlots], ['open', 2]);
});
