import { DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { db, TABLE_NAME } from '../db/table.js';
import { json } from '../http.js';
import type { Handler } from '../router.js';

/** Liveness plus a DynamoDB reachability check. Used by the deploy smoke test. */
export const health: Handler = async () => {
  const started = Date.now();
  try {
    const { Table } = await db.send(new DescribeTableCommand({ TableName: TABLE_NAME }));
    return json(200, {
      success: true,
      service: 'ssi-events-api',
      release: process.env.RELEASE || 'dev',
      database: { table: TABLE_NAME, status: Table?.TableStatus, latencyMs: Date.now() - started },
    });
  } catch (err) {
    console.error('Health check: DynamoDB unreachable', err);
    return json(503, { success: false, service: 'ssi-events-api', database: { table: TABLE_NAME, status: 'UNREACHABLE' } });
  }
};
