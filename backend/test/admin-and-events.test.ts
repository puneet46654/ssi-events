import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

process.env.ADMIN_SESSION_SECRET = 'x'.repeat(64);

const { db } = await import('../src/db/table.js');
const { handler } = await import('../src/handler.js');
const { hashPassword } = await import('../src/lib/passwords.js');
const { isId } = await import('../src/lib/ids.js');

/* In-memory stand-in for the DynamoDB table: enough of Get/Put/Update/Query/BatchWrite for these routes. */
type Item = Record<string, any>;
let table: Map<string, Item>;
const k = (i: Item) => `${i.PK}|${i.SK}`;

beforeEach(() => {
  table = new Map();
  mock.method(db, 'send', async (command: any) => {
    const input = command.input;
    switch (command.constructor.name) {
      case 'GetCommand': return { Item: table.get(k(input.Key)) };
      case 'PutCommand':
        if (input.ConditionExpression?.includes('attribute_not_exists') && table.has(k(input.Item))) {
          throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
        }
        table.set(k(input.Item), input.Item); return {};
      case 'UpdateCommand': {
        const item = table.get(k(input.Key)) ?? { ...input.Key };
        if (input.UpdateExpression.startsWith('SET lastLoginAt')) item.lastLoginAt = input.ExpressionAttributeValues[':now'];
        table.set(k(input.Key), item); return {};
      }
      case 'BatchWriteCommand':
        for (const r of Object.values(input.RequestItems)[0] as any[]) table.set(k(r.PutRequest.Item), r.PutRequest.Item);
        return {};
      case 'QueryCommand': {
        const v = input.ExpressionAttributeValues;
        const rows = [...table.values()].filter((i) =>
          input.IndexName === 'GSI1' ? i.GSI1PK === v[':pk']
            : i.PK === v[':pk'] && (v[':since'] ? i.SK >= v[':since'] : v[':day'] ? i.SK.startsWith(v[':day']) : true));
        return input.Select === 'COUNT' ? { Count: rows.length } : { Items: rows };
      }
      default: throw new Error(`unexpected ${command.constructor.name}`);
    }
  });
});

async function addAdmin(username: string, password: string, over: Item = {}) {
  const { hash, salt } = await hashPassword(password);
  table.set(`ADMIN#${username}|META`, {
    PK: `ADMIN#${username}`, SK: 'META', username, name: 'Test Admin', role: 'admin',
    permissions: ['events'], canCreate: true, canDelete: false, isActive: true,
    passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '', ...over,
  });
}

function request(method: string, rawPath: string, opts: { body?: string | Buffer; headers?: Record<string, string>; cookies?: string[] } = {}) {
  const body = opts.body === undefined ? undefined : Buffer.from(opts.body).toString('base64');
  return handler({
    rawPath, requestContext: { http: { method } }, headers: { 'content-type': 'application/json', ...opts.headers },
    cookies: opts.cookies, body, isBase64Encoded: body !== undefined,
  } as unknown as APIGatewayProxyEventV2);
}

const login = (username: string, password: string, headers: Record<string, string> = {}) =>
  request('POST', '/api/admin/login', { body: JSON.stringify({ username, password }), headers });
const sessionCookieFrom = (res: any) => (res.cookies?.[0] as string).split(';')[0]!;

test('login sets a secure session cookie and returns the profile', async () => {
  await addAdmin('alice', 'Correct-Horse-9');
  const res = await login('Alice', 'Correct-Horse-9');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body as string);
  assert.equal(body.user.username, 'alice');
  assert.deepEqual(body.user.permissions, ['events']);
  assert.match(res.cookies![0]!, /^ssi_admin_session=.+; Path=\/; Max-Age=28800; HttpOnly; Secure; SameSite=Lax$/);

  const session = await request('GET', '/api/admin/session', { cookies: [sessionCookieFrom(res)] });
  assert.equal(session.statusCode, 200);
  assert.equal(JSON.parse(session.body as string).user.username, 'alice');
});

test('wrong password, unknown user and inactive user all get the same 401', async () => {
  await addAdmin('bob', 'Correct-Horse-9');
  await addAdmin('carol', 'Correct-Horse-9', { isActive: false });
  for (const [u, p] of [['bob', 'nope'], ['nobody', 'Correct-Horse-9'], ['carol', 'Correct-Horse-9']]) {
    const res = await login(u!, p!);
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body as string).error, 'Invalid login ID, email or password.');
  }
});

test('five failures lock the account for 15 minutes', async () => {
  await addAdmin('dave', 'Correct-Horse-9');
  for (let i = 0; i < 5; i++) await login('dave', 'wrong');
  assert.equal((await login('dave', 'Correct-Horse-9')).statusCode, 429);
});

test('tampered, forged or post-reset cookies are rejected', async () => {
  await addAdmin('erin', 'Correct-Horse-9');
  const cookie = sessionCookieFrom(await login('erin', 'Correct-Horse-9'));
  const [name, value] = cookie.split('=');
  const [payload, sig] = decodeURIComponent(value!).split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'erin', t: Date.now(), v: 'x' })).toString('base64url');
  for (const bad of [`${name}=${payload}.AAAA${sig!.slice(4)}`, `${name}=${forged}.${sig}`]) {
    assert.equal((await request('GET', '/api/admin/session', { cookies: [bad] })).statusCode, 401);
  }
  await addAdmin('erin', 'New-Password-77'); // password reset
  assert.equal((await request('GET', '/api/admin/session', { cookies: [cookie] })).statusCode, 401);
});

test('cross-site login attempts are refused', async () => {
  await addAdmin('frank', 'Correct-Horse-9');
  assert.equal((await login('frank', 'Correct-Horse-9', { origin: 'https://evil.example' })).statusCode, 403);
  assert.equal((await login('frank', 'Correct-Horse-9', { origin: 'https://events.ssistudios.com' })).statusCode, 200);
});

function eventForm(over: Record<string, string> = {}) {
  const form = new FormData();
  const fields: Record<string, string> = {
    eventName: 'SSI Masterclass', eventType: 'conference', bookingFormTemplate: 'practitioner-institutional',
    venue: 'Gurugram', description: 'Hands-on session', timeZone: 'Asia/Kolkata',
    startDate: '2026-11-02', endDate: '2026-11-03', numberOfDays: '2',
    daySchedules: JSON.stringify([
      { date: '2026-11-02', startTime: '09:00', endTime: '10:00', lunchEnabled: false, slotDuration: '30', slotGap: '0', capacity: '4' },
      { date: '2026-11-03', startTime: '09:00', endTime: '09:30', lunchEnabled: false, slotDuration: '30', slotGap: '0', capacity: '2' },
    ]),
    ...over,
  };
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

async function postForm(form: FormData, cookies?: string[]) {
  const encoded = new Response(form);
  return request('POST', '/api/events', {
    body: Buffer.from(await encoded.arrayBuffer()), cookies,
    headers: { 'content-type': encoded.headers.get('content-type')! },
  });
}

test('creating an event needs an admin with events + create rights', async () => {
  assert.equal((await postForm(eventForm())).statusCode, 401);
  await addAdmin('viewer', 'Correct-Horse-9', { canCreate: false });
  const viewer = sessionCookieFrom(await login('viewer', 'Correct-Horse-9'));
  assert.equal((await postForm(eventForm(), [viewer])).statusCode, 403);
});

test('creates the event, its days and slots, then serves it in the catalogue and detail', async () => {
  await addAdmin('gina', 'Correct-Horse-9');
  const cookie = sessionCookieFrom(await login('gina', 'Correct-Horse-9'));
  const res = await postForm(eventForm(), [cookie]);
  assert.equal(res.statusCode, 201, res.body as string);
  const { eventId } = JSON.parse(res.body as string);
  assert.ok(isId(eventId));

  const slots = [...table.values()].filter((i) => i.PK === `EVENT#${eventId}` && i.SK.startsWith('SLOT#'));
  assert.equal(slots.length, 3); // 2 on day 1, 1 on day 2

  const list = JSON.parse((await request('GET', '/api/events')).body as string);
  assert.equal(list.events.length, 1);
  assert.equal(list.events[0].totalSlots, 4 * 2 + 2 * 1);
  assert.equal(list.events[0].startDate, '2026-11-02T00:00:00.000Z');

  const detail = JSON.parse((await request('GET', `/api/events/${eventId}`)).body as string);
  assert.equal(detail.event.daySchedules.length, 2);
  assert.equal(detail.event.daySchedules[1].capacity, '2');
});

test('invalid event input is a 400 with the reason', async () => {
  await addAdmin('hank', 'Correct-Horse-9');
  const cookie = sessionCookieFrom(await login('hank', 'Correct-Horse-9'));
  const res = await postForm(eventForm({ eventType: 'party' }), [cookie]);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body as string).error, 'Invalid event type.');
  assert.equal([...table.keys()].filter((key) => key.startsWith('EVENT#')).length, 0);
});

test('unknown or malformed event IDs', async () => {
  assert.equal((await request('GET', '/api/events/not-an-id')).statusCode, 400);
  assert.equal((await request('GET', '/api/events/01JA0000000000000000000000')).statusCode, 404);
});
