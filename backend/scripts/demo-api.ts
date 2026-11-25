/**
 * Demo API for a hosted preview (Vercel): the real Lambda handler backed by the in-memory table
 * (test/fake-table.ts) and an in-memory image store, seeded with sample events — the same data as
 * scripts/dev-server.ts. Nothing touches AWS; data lives per server instance and resets when the
 * instance is recycled. Admin sign-in: `admin` / `Dev-Password-1`. Emails are not sent.
 *
 * Used by frontend/app/api/[...path]/route.ts when DEMO_MODE=1. Not part of the AWS deployment.
 */
import { randomUUID } from 'node:crypto';
import { mock } from 'node:test';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

type Handler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2 | string>;

let ready: Promise<Handler> | undefined;

/** The seeded handler, created once per server instance. */
export function demoHandler(): Promise<Handler> {
  ready ??= setUp().catch((err) => { ready = undefined; throw err; });
  return ready;
}

async function setUp(): Promise<Handler> {
  process.env.ADMIN_SESSION_SECRET ||= 'demo-only-admin-session-secret-0123456789abcdef';
  process.env.BOOKING_ACCESS_SECRET ||= 'demo-only-booking-access-secret-0123456789abcdef';
  delete process.env.MAIL_FROM;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;

  const { S3Client } = await import('@aws-sdk/client-s3');
  const { db } = await import('../src/db/table.js');
  const { handler } = await import('../src/handler.js');
  const { hashPassword } = await import('../src/lib/passwords.js');
  const { installFakeTable, table, client, jar } = await import('../test/fake-table.js');

  await installFakeTable(db);

  const images = new Map<string, { body: Uint8Array; type: string }>();
  mock.method(S3Client.prototype, 'send', async (command: any) => {
    const { Key, Body, ContentType } = command.input;
    if (String(command.constructor.name).replace(/^.*_/, '') === 'PutObjectCommand') { images.set(Key, { body: Body, type: ContentType }); return {}; }
    const image = images.get(Key);
    if (!image) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return { Body: { transformToByteArray: async () => image.body }, ContentType: image.type };
  });

  const { hash, salt } = await hashPassword('Dev-Password-1');
  table.set('ADMIN#admin|META', {
    PK: 'ADMIN#admin', SK: 'META', GSI1PK: 'ADMINS', GSI1SK: 'admin', username: 'admin', name: 'Demo Admin', email: 'admin@example.com',
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
    if (res.status !== 201) throw new Error(`Demo seeding failed: ${JSON.stringify(res.data)}`);
  }

  const common = { venue: 'SSI Innovation Centre, Gurugram', timeZone: 'Asia/Kolkata', description: 'Sample event for the demo.' };
  await createEvent({
    ...common, eventName: 'SSi MantraM visit (sample)', eventType: 'mantram', bookingFormTemplate: 'template-2', registrationMode: 'slots',
    startDate: day(0), endDate: day(1), numberOfDays: '2',
    daySchedules: JSON.stringify([day(0), day(1)].map((date) => ({
      date, startTime: '09:00', endTime: '17:00', lunchEnabled: true, lunchStart: '13:00', lunchEnd: '14:00', slotDuration: '30', slotGap: '0', capacity: '4',
    }))),
  });

  // The last slot of each day is full, with two doctors on its waitlist.
  const events = (await call('GET', '/api/events')).data.events as { _id: string; eventName: string }[];
  const visit = events.find((e) => e.eventName === 'SSi MantraM visit (sample)')!;
  type Slot = { _id: string; startTime: string; capacity: number; ended: boolean };
  const days = (await call('GET', `/api/events/${visit._id}/slots`)).data.days as { _id: string; slots: Slot[] }[];
  const doctors = [
    ['Ananya Rao', 'Cardiology', 'Apollo Hospital'], ['Vikram Mehta', 'Urology', 'Fortis Memorial'],
    ['Sara Thomas', 'General Surgery', 'Max Saket'], ['Rohit Kapoor', 'Gynaecology', 'Medanta'],
    ['Meera Iyer', 'Oncology', 'AIIMS Delhi'], ['Arjun Singh', 'Urology', 'Sir Ganga Ram Hospital'],
  ];
  for (const [d, schedule] of days.entries()) {
    const last = schedule.slots[schedule.slots.length - 1];
    if (!last || last.ended) continue;
    for (const [i, [fullName, specialty, hospitalName]] of doctors.entries()) {
      const n = d * 10 + i + 1;
      await call('POST', '/api/bookings', { body: {
        eventId: visit._id, dayScheduleId: schedule._id, slotId: last._id, idempotencyKey: randomUUID(), waitlist: i >= last.capacity,
        details: {
          title: 'Dr.', fullName, specialty, hospitalName, email: `sample${n}@example.com`, mobile: `98100000${String(n).padStart(2, '0')}`,
          countryCode: '+91', country: 'India', state: 'Delhi', city: 'New Delhi',
        },
      } });
    }
  }

  await createEvent({
    ...common, eventName: 'CME open house (sample, registration only)', eventType: 'event', bookingFormTemplate: 'practitioner-institutional',
    registrationMode: 'open', capacity: '50', startDate: day(3), endDate: day(3), numberOfDays: '1',
  });

  return handler as Handler;
}
