import { Temporal } from '@js-temporal/polyfill';
import { QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { db, TABLE_NAME } from '../db/table.js';
import { json } from '../http.js';
import { allEvents, eventBookings, eventPending } from '../lib/admin-data.js';
import { requireAdmin } from '../lib/admins.js';
import { ONLINE_WINDOW_MS, pageLabel } from '../lib/analytics.js';
import type { Handler } from '../router.js';
import { FEEDBACK_PK } from './feedback.js';

type View = {
  kind: 'pageview' | 'api'; ts: string; visitorId: string; sessionId: string; path: string; eventId?: string;
  referrer?: string; device: string; browser: string; os: string; method?: string; status?: number; ms?: number;
  country?: string; city?: string;
};
type Presence = { SK: string; visitorId: string; path: string; eventId?: string; lastSeen: string; device: string };

const RANGES = { '24h': { ms: 24 * 3600e3, unit: 'hour' }, '7d': { ms: 7 * 86400e3, unit: 'day' }, '30d': { ms: 30 * 86400e3, unit: 'day' } } as const;
const TIME_ZONE = 'Asia/Kolkata';
const FUNNEL = [
  ['Events list', '/'],
  ['Event page', '/events/:id'],
  ['Registration form', '/events/:id/book'],
  ['Slot selection', '/events/:id/book/slots'],
] as const;

async function queryAll<T>(input: QueryCommandInput): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({ ...input, ExclusiveStartKey }));
    items.push(...(page.Items ?? []) as T[]);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/** Views and API timings since `since`: one query per UTC day partition. */
async function viewsSince(since: Date, now: Date): Promise<View[]> {
  const days: string[] = [];
  for (let d = new Date(since.toISOString().slice(0, 10)); d <= now; d = new Date(d.getTime() + 86400e3)) days.push(d.toISOString().slice(0, 10));
  const parts = await Promise.all(days.map((day) => queryAll<View>({
    TableName: TABLE_NAME, KeyConditionExpression: 'PK = :pk AND SK >= :since',
    ExpressionAttributeValues: { ':pk': `ANALYTICS#${day}`, ':since': since.toISOString() },
  })));
  return parts.flat();
}

/** Start of the hour or day (in India time) that an instant falls in. */
function bucket(ts: string, unit: 'hour' | 'day'): string {
  const zoned = Temporal.Instant.from(ts).toZonedDateTimeISO(TIME_ZONE);
  const start = unit === 'hour' ? zoned.round({ smallestUnit: 'hour', roundingMode: 'floor' }) : zoned.startOfDay();
  return new Date(start.epochMilliseconds).toISOString();
}

function countBy<T>(rows: T[], key: (row: T) => string | undefined, limit: number, fallback = 'Unknown') {
  const counts = new Map<string, number>();
  for (const row of rows) { const k = key(row) || fallback; counts.set(k, (counts.get(k) || 0) + 1); }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, limit);
}

const unique = (values: (string | undefined)[]) => new Set(values.filter(Boolean)).size;
const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]! : 0);
const oneDecimal = (value: number) => Math.round(value * 10) / 10;

/**
 * GET /api/admin/analytics?range=24h|7d|30d — visits, the booking funnel, top pages and events,
 * where visitors come from and on what, API speed and errors, and app feedback (all time).
 */
export const analyticsSummary: Handler = async (req) => {
  await requireAdmin(req, 'reports');
  const rangeKey = (req.query.range && req.query.range in RANGES ? req.query.range : '24h') as keyof typeof RANGES;
  const range = RANGES[rangeKey];
  const now = new Date();
  const since = new Date(now.getTime() - range.ms);

  const [rows, events, feedback] = await Promise.all([
    viewsSince(since, now),
    allEvents(),
    queryAll<{ rating: number; message?: string; submittedAt: string }>({
      TableName: TABLE_NAME, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :y)',
      ExpressionAttributeValues: { ':pk': FEEDBACK_PK, ':y': '2' }, // rating items start with their timestamp
    }),
  ]);
  const views = rows.filter((r) => r.kind === 'pageview');
  const api = rows.filter((r) => r.kind === 'api');
  const names = new Map(events.map((e) => [e.eventId, e.eventName]));

  const [bookingLists, pendingLists] = await Promise.all([
    Promise.all(events.map((e) => eventBookings(e.eventId))),
    Promise.all(events.map((e) => eventPending(e.eventId))),
  ]);
  const sinceIso = since.toISOString();
  const bookings = bookingLists.flat().filter((b) => b.createdAt >= sinceIso).length;
  const pendingRegistrations = pendingLists.flat().filter((p) => p.updatedAt >= sinceIso).length;

  const sessions = unique(views.map((v) => v.sessionId));
  const confirmedSessions = unique(api.filter((r) => r.path === '/api/bookings' && r.method === 'POST' && r.status === 201).map((r) => r.sessionId));
  const sessionsOn = (path: string) => unique(views.filter((v) => v.path === path).map((v) => v.sessionId));

  const series = new Map<string, { views: number; visitors: Set<string> }>();
  for (const v of views) {
    const t = bucket(v.ts, range.unit);
    const entry = series.get(t) ?? { views: 0, visitors: new Set<string>() };
    entry.views++; entry.visitors.add(v.visitorId); series.set(t, entry);
  }

  const pages = new Map<string, { views: number; sessions: Set<string> }>();
  const eventViews = new Map<string, { views: number; visitors: Set<string> }>();
  for (const v of views) {
    const p = pages.get(v.path) ?? { views: 0, sessions: new Set<string>() };
    p.views++; p.sessions.add(v.sessionId); pages.set(v.path, p);
    if (v.eventId) {
      const e = eventViews.get(v.eventId) ?? { views: 0, visitors: new Set<string>() };
      e.views++; e.visitors.add(v.visitorId); eventViews.set(v.eventId, e);
    }
  }

  const endpoints = new Map<string, { path: string; method: string; ms: number[]; count: number; errors: number }>();
  for (const r of api) {
    const key = `${r.method} ${r.path}`;
    const e = endpoints.get(key) ?? { path: r.path, method: r.method || 'GET', ms: [], count: 0, errors: 0 };
    e.count++;
    if (!r.status || r.status >= 500) e.errors++;
    if (typeof r.ms === 'number') e.ms.push(r.ms);
    endpoints.set(key, e);
  }
  const statusCounts = new Map<number, number>();
  for (const r of api) statusCounts.set(r.status ?? 0, (statusCounts.get(r.status ?? 0) || 0) + 1);

  const ratingTotal = feedback.length;
  return json(200, {
    success: true, range: rangeKey, unit: range.unit,
    totals: {
      views: views.length, visitors: unique(views.map((v) => v.visitorId)), sessions,
      live: unique(rows.filter((r) => r.ts >= new Date(now.getTime() - 5 * 60e3).toISOString()).map((r) => r.visitorId)),
      bookings, pendingRegistrations,
      conversion: sessions ? oneDecimal((confirmedSessions / sessions) * 100) : 0,
    },
    series: [...series].sort(([a], [b]) => a.localeCompare(b)).map(([t, s]) => ({ t, views: s.views, visitors: s.visitors.size })),
    funnel: [...FUNNEL.map(([step, path]) => ({ step, sessions: sessionsOn(path) })), { step: 'Booking confirmed', sessions: confirmedSessions }],
    topPages: [...pages].sort((a, b) => b[1].views - a[1].views).slice(0, 10).map(([path, p]) => ({ path, views: p.views, sessions: p.sessions.size })),
    topEvents: [...eventViews].sort((a, b) => b[1].views - a[1].views).slice(0, 10)
      .map(([eventId, e]) => ({ eventId, name: names.get(eventId) || 'Deleted event', views: e.views, visitors: e.visitors.size })),
    referrers: countBy(views, (v) => v.referrer, 10, 'Direct / none'),
    // CloudFront does not pass visitor location to the API yet, so these show as Unknown.
    countries: countBy(views, (v) => v.country, 10),
    cities: countBy(views, (v) => v.city, 10),
    devices: countBy(views, (v) => v.device, 5),
    browsers: countBy(views, (v) => v.browser, 8),
    os: countBy(views, (v) => v.os, 8),
    api: [...endpoints.values()].sort((a, b) => b.count - a.count).slice(0, 25).map((e) => {
      const ms = [...e.ms].sort((a, b) => a - b);
      return {
        endpoint: e.path, method: e.method, count: e.count, errors: e.errors, errorRate: oneDecimal((e.errors / e.count) * 100),
        p50: Math.round(percentile(ms, 0.5)), p95: Math.round(percentile(ms, 0.95)), max: Math.round(ms.at(-1) ?? 0),
      };
    }),
    feedback: {
      total: ratingTotal,
      average: ratingTotal ? oneDecimal(feedback.reduce((sum, f) => sum + f.rating, 0) / ratingTotal) : 0,
      stars: [5, 4, 3, 2, 1].map((star) => ({ star, count: feedback.filter((f) => f.rating === star).length })),
      latest: [...feedback].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 20)
        .map((f) => ({ rating: f.rating, message: f.message || '', submittedAt: f.submittedAt })),
    },
    statuses: [...statusCounts].sort(([a], [b]) => a - b).map(([status, count]) => ({ status: status || 'Network error', count })),
  });
};

const MINUTES = 30;

/** GET /api/admin/analytics/live — who is on the site now, on which pages, and the last 30 minutes. Polled every few seconds. */
export const analyticsLive: Handler = async (req) => {
  await requireAdmin(req, 'reports');
  const now = new Date();
  const [presence, recentRows, events] = await Promise.all([
    queryAll<Presence>({ TableName: TABLE_NAME, KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': 'PRESENCE' } }),
    viewsSince(new Date(now.getTime() - 60 * 60e3), now),
    allEvents(),
  ]);
  const names = new Map(events.map((e) => [e.eventId, e.eventName]));
  const label = (path: string, eventId?: string) => pageLabel(path, eventId ? names.get(eventId) || 'Event' : 'Event');
  // Presence items expire through TTL, which can lag; the timestamp decides who is online.
  const online = presence.filter((p) => p.lastSeen >= new Date(now.getTime() - ONLINE_WINDOW_MS).toISOString());
  const views = recentRows.filter((r) => r.kind === 'pageview').sort((a, b) => b.ts.localeCompare(a.ts));

  const pagesNow = new Map<string, number>();
  for (const p of online) { const page = label(p.path, p.eventId); pagesNow.set(page, (pagesNow.get(page) || 0) + 1); }
  const thisMinute = Math.floor(now.getTime() / 60e3) * 60e3;
  const perMinute = new Map<number, number>();
  for (const v of views) {
    const minute = Math.floor(Date.parse(v.ts) / 60e3) * 60e3;
    if (minute > thisMinute - MINUTES * 60e3) perMinute.set(minute, (perMinute.get(minute) || 0) + 1);
  }

  return json(200, {
    success: true, at: now.toISOString(),
    online: unique(online.map((p) => p.visitorId)), onlineTabs: online.length,
    pagesNow: [...pagesNow].map(([page, count]) => ({ page, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    devicesNow: ['Mobile', 'Desktop', 'Tablet'].map((device) => ({ device, count: online.filter((p) => p.device === device).length })),
    recent: views.slice(0, 20).map((v) => ({ ts: v.ts, page: label(v.path, v.eventId), city: v.city, country: v.country, device: v.device, browser: v.browser })),
    perMinute: Array.from({ length: MINUTES }, (_, i) => {
      const t = thisMinute - (MINUTES - 1 - i) * 60e3;
      return { t: new Date(t).toISOString(), views: perMinute.get(t) || 0 };
    }),
  });
};
