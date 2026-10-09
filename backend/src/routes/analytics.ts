import { BatchWriteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE_NAME, ttlAfter } from '../db/table.js';
import {
  ANALYTICS_TTL_SECONDS, describeAgent, eventIdFromPath, isBot, normalizePath, PRESENCE_TTL_SECONDS, referrerHost,
} from '../lib/analytics.js';
import { assertSameOrigin, jsonBody } from '../lib/body.js';
import { newId } from '../lib/ids.js';
import type { Handler } from '../router.js';

const MAX_EVENTS = 50;
const ID = /^[a-z0-9-]{8,64}$/i;
const HOUR_MS = 60 * 60 * 1000;

const noContent = { statusCode: 204, headers: { 'cache-control': 'no-store' } };

/**
 * POST /api/analytics/collect — batched page views and API timings from visitors' browsers, plus
 * which page an open tab is on. Always answers 204 so it never affects the page. Admin pages and
 * bots are not recorded. Views are kept 90 days (ANALYTICS#<day>), presence 2 minutes (PRESENCE).
 */
export const collectAnalytics: Handler = async (req) => {
  try {
    try { assertSameOrigin(req); } catch { return noContent; } // other sites can't post views
    const userAgent = req.headers['user-agent'] || '';
    if (isBot(userAgent)) return noContent;
    const body = jsonBody<{ visitorId?: unknown; sessionId?: unknown; events?: unknown; presence?: { path?: unknown } }>(req);
    const visitorId = typeof body?.visitorId === 'string' && ID.test(body.visitorId) ? body.visitorId : '';
    const sessionId = typeof body?.sessionId === 'string' && ID.test(body.sessionId) ? body.sessionId : '';
    if (!visitorId || !sessionId) return noContent;

    const now = Date.now();
    const agent = describeAgent(userAgent);
    // Behind CloudFront the request's Host is the Lambda's own, so compare referrers with the site's address.
    const ownHost = new URL(process.env.SITE_URL || 'https://events.ssistudios.com').hostname;
    const items = (Array.isArray(body!.events) ? body!.events : []).slice(0, MAX_EVENTS).flatMap((raw): Record<string, unknown>[] => {
      const item = raw as Record<string, unknown>;
      const kind = item?.kind === 'api' ? 'api' : item?.kind === 'pageview' ? 'pageview' : null;
      const path = typeof item?.path === 'string' && item.path.startsWith('/') ? item.path : '';
      if (!kind || !path || path.startsWith('/admin') || path.startsWith('/api/admin')) return [];
      const ts = new Date(typeof item.ts === 'number' && Math.abs(item.ts - now) < HOUR_MS ? item.ts : now);
      const iso = ts.toISOString();
      const base = {
        PK: `ANALYTICS#${iso.slice(0, 10)}`, SK: `${iso}#${newId(ts.getTime())}`, ttl: ttlAfter(ANALYTICS_TTL_SECONDS, now),
        kind, ts: iso, visitorId, sessionId, path: normalizePath(path), eventId: eventIdFromPath(path), ...agent,
      };
      if (kind === 'pageview') return [{ ...base, referrer: referrerHost(item.referrer, ownHost) }];
      const status = Number(item.status), ms = Number(item.ms);
      return [{
        ...base,
        method: typeof item.method === 'string' ? item.method.toUpperCase().slice(0, 8) : 'GET',
        status: Number.isInteger(status) ? status : 0,
        ms: Number.isFinite(ms) && ms >= 0 ? Math.min(Math.round(ms), 120_000) : undefined,
      }];
    });
    const livePath = typeof body!.presence?.path === 'string' && body!.presence.path.startsWith('/') && !body!.presence.path.startsWith('/admin')
      ? body!.presence.path : '';

    const writes: Promise<unknown>[] = [];
    for (let i = 0; i < items.length; i += 25) {
      // Best effort: views a throttled batch leaves behind are dropped rather than retried.
      writes.push(db.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: items.slice(i, i + 25).map((Item) => ({ PutRequest: { Item } })) } })));
    }
    if (livePath) {
      writes.push(db.send(new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          PK: 'PRESENCE', SK: sessionId, visitorId, path: normalizePath(livePath), eventId: eventIdFromPath(livePath),
          lastSeen: new Date(now).toISOString(), device: agent.device, ttl: ttlAfter(PRESENCE_TTL_SECONDS, now),
        },
      })));
    }
    await Promise.all(writes);
  } catch (err) {
    console.error('Analytics collect failed', err);
  }
  return noContent;
};
