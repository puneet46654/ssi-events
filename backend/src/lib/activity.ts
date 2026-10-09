import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, keys, TABLE_NAME, ttlAfter } from '../db/table.js';
import { newId } from './ids.js';

const SENSITIVE_KEY = /pass|token|secret|hash|salt|cookie|session/i;
const ONE_YEAR = 365 * 24 * 60 * 60;

function stripSensitive(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => stripSensitive(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, v]) => [key, stripSensitive(v, depth + 1)]));
}

export type Activity = {
  admin: string;
  action: string;          // login, login_failed, logout, create, update, delete, ...
  resource: string;        // auth, event, booking, user, ...
  resourceId?: string;
  details?: Record<string, unknown>;
};

/** Admin audit trail, kept for a year. Never fails the request it records. */
export async function logActivity(entry: Activity): Promise<void> {
  const now = new Date();
  try {
    await db.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        PK: `ADMINLOG#${now.toISOString().slice(0, 7)}`,
        SK: `${now.toISOString()}#${newId(now.getTime())}`,
        ...entry,
        admin: entry.admin.slice(0, 80),
        details: entry.details ? stripSensitive(entry.details) : undefined,
        createdAt: now.toISOString(),
        ttl: ttlAfter(ONE_YEAR, now.getTime()),
      },
    }));
  } catch (err) {
    console.error('Admin activity log failed', err);
  }
}

/** Moves a realtime revision counter so open screens refetch (see GET /api/realtime). */
export async function bumpRealtime(resource: 'events' | 'bookings' | 'attendance'): Promise<void> {
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE_NAME, Key: keys.realtime(),
      UpdateExpression: 'ADD #r :one', ExpressionAttributeNames: { '#r': resource }, ExpressionAttributeValues: { ':one': 1 },
    }));
  } catch (err) {
    console.error('Realtime bump failed', err);
  }
}
