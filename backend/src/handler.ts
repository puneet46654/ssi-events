import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { error, HttpError, type Response } from './http.js';
import { Router } from './router.js';
import { collectAnalytics } from './routes/analytics.js';
import { listEvents } from './routes/events.js';
import { health } from './routes/health.js';
import { realtimeVersions } from './routes/realtime.js';

// Every endpoint is registered here and documented in docs/api-contract.md.
export const router = new Router()
  .get('/api/health', health)
  .get('/api/events', listEvents)
  .get('/api/realtime', realtimeVersions)
  .post('/api/analytics/collect', collectAnalytics);

export async function handler(event: APIGatewayProxyEventV2): Promise<Response> {
  try {
    return await router.handle(event);
  } catch (err) {
    if (err instanceof HttpError) return error(err.statusCode, err.message);
    console.error('Unhandled error', { path: event.rawPath, method: event.requestContext.http.method, err });
    return error(500, 'Something went wrong. Please try again.');
  }
}
