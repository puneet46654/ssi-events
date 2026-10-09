import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { TABLE_NAME, db } from '../db/table.js';
import { json } from '../http.js';
import { requireAdmin } from '../lib/admins.js';
import type { Handler } from '../router.js';

const MAX_LOGS = 200;
const RETENTION_MS = 366 * 24 * 60 * 60 * 1000; // entries expire after a year

function instant(value: string | undefined, fallback: Date): Date {
  const date = value ? new Date(value) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

/** `yyyy-mm` partitions from `to` back to `from`, newest first. */
function monthsBetween(from: Date, to: Date): string[] {
  const months: string[] = [];
  const cursor = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  const first = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1);
  while (cursor.getTime() >= first) {
    months.push(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return months;
}

/**
 * GET /api/admin/activity?admin=&action=&from=&to= — the admin audit trail, newest first, at most 200
 * entries. `from` / `to` are ISO timestamps; without them the last year is searched.
 */
export const listActivity: Handler = async (req) => {
  await requireAdmin(req, 'auth');
  const now = new Date();
  const to = instant(req.query.to, now);
  const from = new Date(Math.max(instant(req.query.from, new Date(0)).getTime(), now.getTime() - RETENTION_MS));
  const admin = (req.query.admin || '').trim().toLowerCase().slice(0, 80);
  const action = /^[a-z_]{1,40}$/.test(req.query.action || '') ? req.query.action! : '';

  const filters: string[] = [];
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = { ':from': from.toISOString(), ':to': `${to.toISOString()}~` };
  if (admin) { filters.push('#admin = :admin'); names['#admin'] = 'admin'; values[':admin'] = admin; }
  if (action) { filters.push('#action = :action'); names['#action'] = 'action'; values[':action'] = action; }

  const logs: Record<string, unknown>[] = [];
  for (const month of monthsBetween(from, to)) {
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await db.send(new QueryCommand({
        TableName: TABLE_NAME, ScanIndexForward: false, ExclusiveStartKey,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :from AND :to',
        ExpressionAttributeValues: { ...values, ':pk': `ADMINLOG#${month}` },
        ...(filters.length ? { FilterExpression: filters.join(' AND '), ExpressionAttributeNames: names } : {}),
      }));
      for (const item of page.Items ?? []) {
        const { PK: _pk, SK, ttl: _ttl, ...entry } = item;
        logs.push({ _id: SK, ...entry });
      }
      ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey && logs.length < MAX_LOGS);
    if (logs.length >= MAX_LOGS) break;
  }
  return json(200, { success: true, logs: logs.slice(0, MAX_LOGS) });
};
