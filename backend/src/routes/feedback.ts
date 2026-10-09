import { randomUUID } from 'node:crypto';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { db, TABLE_NAME } from '../db/table.js';
import { json } from '../http.js';
import { assertSameOrigin, jsonBody } from '../lib/body.js';
import { sha256 } from '../lib/bookings.js';
import { cookie, readCookie } from '../lib/cookies.js';
import { newId } from '../lib/ids.js';
import type { Handler, Request } from '../router.js';

/*
 * App feedback: a 1-5 star rating with an optional comment, one per browser. It never identifies an
 * attendee. Items: FEEDBACK#APP / <timestamp>#<id> (the rating) and FEEDBACK#APP / SESSION#<hash>
 * (marks that this browser has rated). Summarised on the admin analytics screen.
 */

const SESSION_COOKIE = 'ssievents_session_id';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const UUID = /^[0-9a-f-]{36}$/i;
const DUPLICATE = 'You have already shared your feedback. Thank you!';
export const FEEDBACK_PK = 'FEEDBACK#APP';

function session(req: Request): string {
  const value = readCookie(req, SESSION_COOKIE);
  return value && UUID.test(value) ? value : randomUUID();
}

const marker = (id: string) => ({ PK: FEEDBACK_PK, SK: `SESSION#${sha256(id)}` });
const reply = (id: string, status: number, body: Record<string, unknown>) => json(status, body, {}, [cookie(SESSION_COOKIE, id, SESSION_SECONDS)]);

/** GET /api/feedback — whether this browser has already rated the app. */
export const feedbackStatus: Handler = async (req) => {
  const id = session(req);
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: marker(id) }));
  return reply(id, 200, { success: true, submitted: Boolean(Item) });
};

/** POST /api/feedback — `{ rating: 1-5, message? }`. A second rating from the same browser gets 409. */
export const submitFeedback: Handler = async (req) => {
  assertSameOrigin(req);
  const id = session(req);
  const body = jsonBody<{ rating?: unknown; message?: unknown }>(req);
  const rating = Number(body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return reply(id, 400, { success: false, error: 'Choose a rating from 1 to 5 stars.' });
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 500) : '';
  const now = new Date();
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: TABLE_NAME, Item: { ...marker(id), createdAt: now.toISOString() }, ConditionExpression: 'attribute_not_exists(PK)' } },
        { Put: { TableName: TABLE_NAME, Item: { PK: FEEDBACK_PK, SK: `${now.toISOString()}#${newId(now.getTime())}`, rating, message, submittedAt: now.toISOString() } } },
      ],
    }));
  } catch (err) {
    if (err instanceof TransactionCanceledException) return reply(id, 409, { success: false, duplicate: true, error: DUPLICATE });
    throw err;
  }
  return reply(id, 200, { success: true });
};
