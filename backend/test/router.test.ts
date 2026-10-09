import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { json } from '../src/http.js';
import { Router } from '../src/router.js';

function event(method: string, rawPath: string, extra: Partial<APIGatewayProxyEventV2> = {}): APIGatewayProxyEventV2 {
  return { rawPath, requestContext: { http: { method } }, headers: {}, ...extra } as unknown as APIGatewayProxyEventV2;
}

const router = new Router()
  .get('/api/events/:id/slots', async (req) => json(200, { id: req.params.id, day: req.query.day }))
  .post('/api/bookings', async (req) => json(201, JSON.parse(req.body)));

test('matches path params and query', async () => {
  const res = await router.handle(event('GET', '/api/events/abc%20d/slots', { queryStringParameters: { day: '2' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body as string), { id: 'abc d', day: '2' });
});

test('tolerates a trailing slash', async () => {
  assert.equal((await router.handle(event('GET', '/api/events/x/slots/'))).statusCode, 200);
});

test('decodes base64 bodies from function URLs', async () => {
  const body = Buffer.from(JSON.stringify({ a: 1 })).toString('base64');
  const res = await router.handle(event('POST', '/api/bookings', { body, isBase64Encoded: true }));
  assert.deepEqual(JSON.parse(res.body as string), { a: 1 });
});

test('405 for a known path with the wrong method, 404 otherwise', async () => {
  assert.equal((await router.handle(event('DELETE', '/api/bookings'))).statusCode, 405);
  assert.equal((await router.handle(event('GET', '/api/nope'))).statusCode, 404);
});

test('API responses are not cacheable by default', () => {
  assert.equal(json(200, {}).headers?.['cache-control'], 'no-store');
});
