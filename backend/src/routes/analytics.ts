import type { Handler } from '../router.js';

/**
 * POST /api/analytics/collect — page-view beacon from visitors' browsers. Always answers 204 so it
 * never affects the page. Storing the views (ANALYTICS# items, 90-day TTL) comes with the admin
 * analytics endpoints; until then the beacon is accepted and discarded.
 */
export const collectAnalytics: Handler = async () => ({
  statusCode: 204,
  headers: { 'cache-control': 'no-store' },
});
