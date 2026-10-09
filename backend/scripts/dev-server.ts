/**
 * Local API for frontend development: the real Lambda handler on http://localhost:4000, backed by
 * an in-memory table (test/fake-table.ts) and an in-memory image store. No AWS account needed and
 * nothing touches production. Data is reset on every start.
 *
 *   cd backend && npm run dev          # API on :4000
 *   cd frontend && npm run dev         # site on :3000, /api proxied to :4000
 *
 * Sign in at http://localhost:3000/admin/login as `admin` / `Dev-Password-1`.
 * Emails are not sent (MAIL_FROM is unset).
 */
import { createServer, type IncomingMessage } from 'node:http';
import { mock } from 'node:test';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

process.env.ADMIN_SESSION_SECRET ||= 'dev-only-admin-session-secret-0123456789abcdef';
process.env.BOOKING_ACCESS_SECRET ||= 'dev-only-booking-access-secret-0123456789abcdef';
process.env.ALLOWED_ORIGINS ||= 'http://localhost:3000';
process.env.SITE_URL ||= 'http://localhost:3000';
delete process.env.MAIL_FROM;
delete process.env.AWS_LAMBDA_FUNCTION_NAME;

const PORT = Number(process.env.PORT || 4000);
const { S3Client } = await import('@aws-sdk/client-s3');
const { db } = await import('../src/db/table.js');
const { handler } = await import('../src/handler.js');
const { hashPassword } = await import('../src/lib/passwords.js');
const { installFakeTable, table, client, jar } = await import('../test/fake-table.js');

await installFakeTable(db);

// Event images live in memory instead of S3.
const images = new Map<string, { body: Uint8Array; type: string }>();
mock.method(S3Client.prototype, 'send', async (command: any) => {
  const { Key, Body, ContentType } = command.input;
  if (command.constructor.name === 'PutObjectCommand') { images.set(Key, { body: Body, type: ContentType }); return {}; }
  const image = images.get(Key);
  if (!image) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
  return { Body: { transformToByteArray: async () => image.body }, ContentType: image.type };
});

/* ---------- Sample data ---------- */

const { hash, salt } = await hashPassword('Dev-Password-1');
table.set('ADMIN#admin|META', {
  PK: 'ADMIN#admin', SK: 'META', GSI1PK: 'ADMINS', GSI1SK: 'admin', username: 'admin', name: 'Local Admin', email: 'admin@example.com',
  role: 'superadmin', permissions: [], canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

const call = client(handler);
const cookies = jar((await call('POST', '/api/admin/login', { body: { username: 'admin', password: 'Dev-Password-1' } })).cookies);
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
async function createEvent(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const encoded = new Response(form);
  const res = await call('POST', '/api/events', { raw: Buffer.from(await encoded.arrayBuffer()), contentType: encoded.headers.get('content-type')!, cookies });
  if (res.status !== 201) throw new Error(`Seeding failed: ${JSON.stringify(res.data)}`);
}
const common = { venue: 'SSI Innovation Centre, Gurugram', timeZone: 'Asia/Kolkata', description: 'Sample event for local development.' };
await createEvent({
  ...common, eventName: 'SSi MantraM visit (sample)', eventType: 'mantram', bookingFormTemplate: 'template-2', registrationMode: 'slots',
  startDate: day(0), endDate: day(1), numberOfDays: '2',
  daySchedules: JSON.stringify([day(0), day(1)].map((date) => ({
    date, startTime: '09:00', endTime: '17:00', lunchEnabled: true, lunchStart: '13:00', lunchEnd: '14:00', slotDuration: '30', slotGap: '0', capacity: '4',
  }))),
});
await createEvent({
  ...common, eventName: 'CME open house (sample, registration only)', eventType: 'event', bookingFormTemplate: 'practitioner-institutional',
  registrationMode: 'open', capacity: '50', startDate: day(3), endDate: day(3), numberOfDays: '1',
});

/* ---------- HTTP ---------- */

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const body = await readBody(req);
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? '']));
  const event = {
    rawPath: url.pathname, rawQueryString: url.search.slice(1),
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers, cookies: headers.cookie ? headers.cookie.split(/;\s*/) : undefined,
    body: body.length ? body.toString('base64') : undefined, isBase64Encoded: body.length > 0,
    requestContext: { http: { method: req.method || 'GET', path: url.pathname } },
  } as unknown as APIGatewayProxyEventV2;
  // /api/health asks DynamoDB for the table status; the in-memory table has none.
  const out = url.pathname === '/api/health'
    ? { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ success: true, service: 'ssi-events-api', release: 'local', database: { table: 'in-memory', status: 'ACTIVE' } }) }
    : await handler(event);
  const result = typeof out === 'object' && out ? out : { statusCode: 200, body: String(out ?? '') };
  res.statusCode = result.statusCode ?? 200;
  for (const [k, v] of Object.entries(result.headers ?? {})) res.setHeader(k, String(v));
  if (result.cookies?.length) res.setHeader('set-cookie', result.cookies);
  res.end(result.body ? Buffer.from(result.body, result.isBase64Encoded ? 'base64' : 'utf8') : undefined);
  console.log(`${req.method} ${url.pathname} ${res.statusCode}`);
}).listen(PORT, () => {
  console.log(`Local API on http://localhost:${PORT} (in-memory data, reset on restart)`);
  console.log('Admin sign-in: admin / Dev-Password-1');
});
