import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { db, keys, TABLE_NAME } from '../db/table.js';
import { json } from '../http.js';
import type { Handler } from '../router.js';

export const REALTIME_RESOURCES = ['events', 'bookings', 'attendance'] as const;

/**
 * GET /api/realtime — one revision counter per resource. Browsers poll it every few seconds and
 * refetch when a number moves. CloudFront caches it for 2 s, so any number of open tabs cost
 * about one DynamoDB read every 2 seconds.
 */
export const realtimeVersions: Handler = async () => {
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.realtime() }));
  const versions = Object.fromEntries(REALTIME_RESOURCES.map((r) => [r, Number(Item?.[r]) || 0]));
  return json(200, { success: true, versions }, {
    'cache-control': 'public, max-age=0, s-maxage=2, stale-while-revalidate=5',
  });
};
