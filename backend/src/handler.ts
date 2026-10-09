import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { error, HttpError, type Response } from './http.js';
import { Router } from './router.js';
import { health } from './routes/health.js';

// Every endpoint is registered here and documented in docs/api-contract.md.
export const router = new Router()
  .get('/api/health', health);

export async function handler(event: APIGatewayProxyEventV2): Promise<Response> {
  try {
    return await router.handle(event);
  } catch (err) {
    if (err instanceof HttpError) return error(err.statusCode, err.message);
    console.error('Unhandled error', { path: event.rawPath, method: event.requestContext.http.method, err });
    return error(500, 'Something went wrong. Please try again.');
  }
}
