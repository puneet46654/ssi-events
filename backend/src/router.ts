import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { error, type Response } from './http.js';

export type Request = {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: string;
  event: APIGatewayProxyEventV2;
};

export type Handler = (req: Request) => Promise<Response>;

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

/** Minimal method + path router. Patterns use `:name` segments, e.g. `/api/events/:id/slots`. */
export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const source = path.replace(/\/:([A-Za-z]+)/g, (_match, key: string) => {
      keys.push(key);
      return '/([^/]+)';
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}/?$`), keys, handler });
    return this;
  }

  get(path: string, handler: Handler) { return this.add('GET', path, handler); }
  post(path: string, handler: Handler) { return this.add('POST', path, handler); }
  put(path: string, handler: Handler) { return this.add('PUT', path, handler); }
  patch(path: string, handler: Handler) { return this.add('PATCH', path, handler); }
  delete(path: string, handler: Handler) { return this.add('DELETE', path, handler); }

  async handle(event: APIGatewayProxyEventV2): Promise<Response> {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    let pathMatched = false;

    for (const route of this.routes) {
      const match = route.pattern.exec(path);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== method) continue;

      const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(match[i + 1] ?? '')]));
      const body = !event.body ? ''
        : event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
      return route.handler({
        method,
        path,
        params,
        query: Object.fromEntries(Object.entries(event.queryStringParameters ?? {}).map(([k, v]) => [k, v ?? ''])),
        headers: Object.fromEntries(Object.entries(event.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v ?? ''])),
        body,
        event,
      });
    }
    return pathMatched ? error(405, 'Method not allowed.') : error(404, 'Not found.');
  }
}
