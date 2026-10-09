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

const LINKS = JSON.stringify([
  { label: 'Conference website', url: 'https://www.example.org/congress' },
  { label: 'LinkedIn post', url: 'https://www.linkedin.com/posts/example' },
]);

function form(over: Record<string, string> = {}) {
  const f = new FormData();
  const fields: Record<string, string> = {
    eventName: 'Annual Congress 2026', eventType: 'participation', venue: 'Fira Gran Via, Barcelona', description: 'Live demonstrations at our stand.',
    timeZone: 'Europe/Madrid', startDate: day(-1), endDate: day(2), registrationMode: 'info', stand: 'Hall 8, Stand C12', links: LINKS, ...over,
  };
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}
async function send(method: string, path: string, f: FormData) {
  const encoded = new Response(f);
  return call(method, path, { raw: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type')!, cookies: admin });
}
const meta = (id: string) => table.get(`EVENT#${id}|META`)!;

beforeEach(async () => {
  await installFakeTable(db);
  const { hash, salt } = await hashPassword('Correct-Horse-9');
  put({ PK: 'ADMIN#naveen', SK: 'META', GSI1PK: 'ADMINS', GSI1SK: 'naveen', username: 'naveen', name: 'N', role: 'superadmin', permissions: [],
    canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '' });
  admin = jar((await call('POST', '/api/admin/login', { body: { username: 'naveen', password: 'Correct-Horse-9' } })).cookies);
});

test('an information-only event stores its stand and links and has no schedule', async () => {
  const res = await send('POST', '/api/events', form());
  assert.equal(res.status, 201, JSON.stringify(res.data));
  const id = res.data.eventId;
  assert.equal([...table.values()].filter((i) => i.PK === `EVENT#${id}` && i.SK !== 'META').length, 0);
  assert.deepEqual([meta(id).registrationMode, meta(id).totalSlots, meta(id).stand], ['info', 0, 'Hall 8, Stand C12']);
  const detail = (await call('GET', `/api/events/${id}`)).data.event;
  assert.deepEqual([detail.registrationMode, detail.stand, detail.links.length, detail.status], ['info', 'Hall 8, Stand C12', 2, 'LIVE']);
  assert.equal(detail.links[1].url, 'https://www.linkedin.com/posts/example');
});

test('past dates are accepted, so events already attended can be listed', async () => {
  const res = await send('POST', '/api/events', form({ startDate: day(-40), endDate: day(-38) }));
  assert.equal(res.status, 201, JSON.stringify(res.data));
  assert.equal((await call('GET', `/api/events/${res.data.eventId}`)).data.event.status, 'COMPLETED');
});

test('links must be labelled http(s) addresses, at most four', async () => {
  const bad = async (links: unknown) => (await send('POST', '/api/events', form({ links: JSON.stringify(links) }))).status;
  assert.equal(await bad([{ label: 'Site', url: 'javascript:alert(1)' }]), 400);
  assert.equal(await bad([{ label: '', url: 'https://example.org' }]), 400);
  assert.equal(await bad([{ label: 'Site', url: 'example.org' }]), 400);
  assert.equal(await bad(Array.from({ length: 5 }, (_, i) => ({ label: `L${i}`, url: 'https://example.org' }))), 400);
  assert.equal(await bad([{ label: '', url: '' }]), 201); // empty rows are ignored
});

test('nobody can book or pre-register for an information-only event', async () => {
  const id = (await send('POST', '/api/events', form())).data.eventId;
  const details = { fullName: 'Dr A', email: 'a@example.com', mobile: '9876543210', countryCode: '+91' };
  const booking = await call('POST', '/api/bookings', { body: { eventId: id, idempotencyKey: randomUUID(), details } });
  assert.equal(booking.status, 409);
  assert.match(booking.data.error, /information only/);
  const pending = await call('POST', '/api/bookings/pending', { body: { eventId: id, draftId: randomUUID(), details } });
  assert.equal(pending.status, 409);
  assert.equal(meta(id).bookedSlots, 0);
});

test('switching to another registration type clears the stand and links', async () => {
  const id = (await send('POST', '/api/events', form())).data.eventId;
  const res = await send('PUT', `/api/events/${id}`, form({ registrationMode: 'open', startDate: day(0), endDate: day(1), capacity: '' }));
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.deepEqual([meta(id).registrationMode, meta(id).stand, meta(id).links], ['open', undefined, undefined]);
  const detail = (await call('GET', `/api/events/${id}`)).data.event;
  assert.deepEqual([detail.stand, detail.links], ['', []]);
});

test('information-only events are not offered for check-in', async () => {
  const id = (await send('POST', '/api/events', form())).data.eventId;
  const res = await call('GET', '/api/admin/attendance', { cookies: admin });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.events.some((e: { id: string }) => e.id === id), false);
});
