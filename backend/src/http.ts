import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export type Response = APIGatewayProxyStructuredResultV2;

/** JSON response. API responses are never cached by CloudFront or browsers unless a route opts in. */
export function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

export function error(statusCode: number, message: string): Response {
  return json(statusCode, { success: false, error: message });
}

export class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}
