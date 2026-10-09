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
const { normalizePath, eventIdFromPath } = await import('../src/lib/analytics.js');
const call = client(handler);

const PASSWORD = 'Correct-Horse-9';
const EVENT = newId();
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const put = (i: Record<string, unknown>) => table.set(`${i.PK}|${i.SK}`, i);

async function signIn(username: string, over: Record<string, unknown> = {}) {
  const { hash, salt } = await hashPassword(PASSWORD);
  put({ PK: `ADMIN#${username}`, SK: 'META', GSI1PK: 'ADMINS', GSI1SK: username, username, name: username, role: 'superadmin',
    permissions: [], canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '', ...over });
  return jar((await call('POST', '/api/admin/login', { body: { username, password: PASSWORD } })).cookies);
}

const collect = (body: unknown, headers: Record<string, string> = { 'user-agent': PHONE_UA }) =>
  call('POST', '/api/analytics/collect', { body, headers });
const visit = (visitorId: string, sessionId: string, events: unknown[], presence?: string) =>
  collect({ visitorId, sessionId, events, ...(presence ? { presence: { path: presence } } : {}) });

let admin: string[];
beforeEach(async () => {
  await installFakeTable(db);
  put({ PK: `EVENT#${EVENT}`, SK: 'META', GSI1PK: 'EVENTS', GSI1SK: `2026-12-01#${EVENT}`, eventId: EVENT, eventName: 'SSi MantraM at Medanta',
    eventType: 'mantram', venue: 'x', startDate: '2026-12-01', endDate: '2026-12-01', timeZone: 'Asia/Kolkata', status: 'ACTIVE', totalSlots: 5, bookedSlots: 0, updatedAt: '' });
  admin = await signIn('naveen');
});

test('paths are grouped by shape and the home page is "/"', () => {
  assert.equal(normalizePath(`/events/${EVENT}/book?x=1`), '/events/:id/book');
  assert.equal(normalizePath('/events'), '/');
  assert.equal(eventIdFromPath(`/events/${EVENT}`), EVENT);
});

test('collect stores views and presence; ignores bots, admin pages, bad IDs and other sites', async () => {
  const now = Date.now();
  const res = await visit('visitor-0001', 'session-0001', [
    { kind: 'pageview', ts: now, path: '/', referrer: 'https://www.google.com/search?q=ssi' },
    { kind: 'pageview', ts: now, path: '/admin/landing' },
    { kind: 'api', ts: now, path: '/api/events', method: 'get', status: 200, ms: 85.4 },
  ], `/events/${EVENT}`);
  assert.equal(res.status, 204);
  const stored = [...table.values()].filter((i) => String(i.PK).startsWith('ANALYTICS#'));
  assert.equal(stored.length, 2);
  const view = stored.find((i) => i.kind === 'pageview')!;
  assert.deepEqual([view.path, view.referrer, view.device, view.os], ['/', 'google.com', 'Mobile', 'iOS']);
  assert.ok(view.ttl > now / 1000 + 89 * 86400);
  assert.equal(table.get('PRESENCE|session-0001')!.eventId, EVENT);

  const before = table.size;
  assert.equal((await collect({ visitorId: 'visitor-0002', sessionId: 'session-0002', events: [{ kind: 'pageview', path: '/' }] }, { 'user-agent': 'Googlebot/2.1' })).status, 204);
  assert.equal((await collect({ visitorId: 'x', sessionId: 'session-0003', events: [{ kind: 'pageview', path: '/' }] })).status, 204);
  assert.equal((await collect({ visitorId: 'visitor-0004', sessionId: 'session-0004', events: [{ kind: 'pageview', path: '/' }] },
    { 'user-agent': PHONE_UA, origin: 'https://elsewhere.example' })).status, 204);
  assert.equal(table.size, before);
});

test('analytics summary: totals, funnel, pages, events, API speed and feedback', async () => {
  const now = Date.now();
  await visit('visitor-a', 'session-a', [
    { kind: 'pageview', ts: now, path: '/' },
    { kind: 'pageview', ts: now, path: `/events/${EVENT}` },
    { kind: 'pageview', ts: now, path: `/events/${EVENT}/book` },
    { kind: 'pageview', ts: now, path: `/events/${EVENT}/book/slots` },
    { kind: 'api', ts: now, path: '/api/bookings', method: 'POST', status: 201, ms: 300 },
  ]);
  await visit('visitor-b', 'session-b', [
    { kind: 'pageview', ts: now, path: '/' },
    { kind: 'api', ts: now, path: '/api/events', method: 'GET', status: 200, ms: 40 },
    { kind: 'api', ts: now, path: '/api/events', method: 'GET', status: 500, ms: 900 },
  ]);
  await call('POST', '/api/feedback', { body: { rating: 5, message: 'Smooth booking' } });
  await call('POST', '/api/feedback', { body: { rating: 3 } });

  const res = await call('GET', '/api/admin/analytics?range=7d', { cookies: admin });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  const d = res.data;
  assert.deepEqual([d.totals.views, d.totals.visitors, d.totals.sessions, d.totals.live, d.totals.conversion], [5, 2, 2, 2, 50]);
  assert.deepEqual(d.funnel.map((f: any) => f.sessions), [2, 1, 1, 1, 1]);
  assert.equal(d.topPages[0].path, '/');
  assert.deepEqual(d.topEvents.map((e: any) => [e.name, e.views]), [['SSi MantraM at Medanta', 3]]);
  const events = d.api.find((a: any) => a.endpoint === '/api/events');
  assert.deepEqual([events.count, events.errors, events.errorRate, events.p50, events.max], [2, 1, 50, 40, 900]);
  assert.deepEqual(d.feedback.stars.map((s: any) => s.count), [1, 0, 1, 0, 0]);
  assert.deepEqual([d.feedback.total, d.feedback.average, d.feedback.latest.length], [2, 4, 2]);
  assert.equal(d.series.reduce((sum: number, p: any) => sum + p.views, 0), 5);
});

test('live view: who is online now and on which page', async () => {
  await visit('visitor-a', 'session-a', [{ kind: 'pageview', ts: Date.now(), path: `/events/${EVENT}/book/slots` }], `/events/${EVENT}/book/slots`);
  await visit('visitor-b', 'session-b', [], '/events/mytickets');
  put({ PK: 'PRESENCE', SK: 'session-old', visitorId: 'visitor-c', path: '/', lastSeen: new Date(Date.now() - 120_000).toISOString(), device: 'Desktop' });
  const res = await call('GET', '/api/admin/analytics/live', { cookies: admin });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.online, 2);
  assert.deepEqual(res.data.pagesNow.map((p: any) => p.page).sort(), ['My Tickets', 'SSi MantraM at Medanta · choosing a slot']);
  assert.equal(res.data.perMinute.length, 30);
  assert.equal(res.data.perMinute.at(-1).views, 1);
  assert.equal(res.data.recent[0].page, 'SSi MantraM at Medanta · choosing a slot');
});

test('analytics need the reports module', async () => {
  assert.equal((await call('GET', '/api/admin/analytics')).status, 401);
  const staff = await signIn('staff', { role: 'staff', permissions: ['check-in'] });
  assert.equal((await call('GET', '/api/admin/analytics', { cookies: staff })).status, 403);
  assert.equal((await call('GET', '/api/admin/analytics/live', { cookies: staff })).status, 403);
});

test('feedback: one rating per browser, checked by status', async () => {
  const first = await call('POST', '/api/feedback', { body: { rating: 4, message: '  Helpful  ' } });
  assert.equal(first.status, 200);
  const browser = jar(first.cookies);
  assert.match(first.cookies[0]!, /^ssievents_session_id=[0-9a-f-]{36}; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
  assert.equal((await call('GET', '/api/feedback', { cookies: browser })).data.submitted, true);
  const again = await call('POST', '/api/feedback', { body: { rating: 5 }, cookies: browser });
  assert.equal(again.status, 409);
  assert.equal(again.data.duplicate, true);
  assert.equal((await call('POST', '/api/feedback', { body: { rating: 6 } })).status, 400);
  assert.equal((await call('GET', '/api/feedback')).data.submitted, false);
  const ratings = [...table.values()].filter((i) => i.PK === 'FEEDBACK#APP' && !String(i.SK).startsWith('SESSION#'));
  assert.deepEqual(ratings.map((r) => [r.rating, r.message]), [[4, 'Helpful']]);
});
