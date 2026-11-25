/*
 * Demo deployments only (Vercel, or DEMO_MODE=1): serve /api/* from the real backend handler
 * running on sample data in memory (backend/scripts/demo-api.ts). In the AWS deployment CloudFront
 * sends /api/* to the backend Lambda and this route is never reached; without DEMO_MODE it 404s.
 */
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function serve(request: NextRequest): Promise<Response> {
  // On Vercel (VERCEL=1) the demo is on automatically; AWS never sets it.
  if (process.env.DEMO_MODE !== '1' && process.env.VERCEL !== '1') return Response.json({ success: false, error: 'Not found.' }, { status: 404 });

  const { demoHandler } = await import('../../../../backend/scripts/demo-api');
  const handler = await demoHandler();

  const url = new URL(request.url);
  // Same-origin checks: the demo site is its own origin.
  process.env.ALLOWED_ORIGINS = url.origin;
  process.env.SITE_URL = url.origin;

  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : Buffer.from(await request.arrayBuffer());
  const headers = Object.fromEntries([...request.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  const cookie = request.headers.get('cookie');

  const result = await handler({
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    queryStringParameters: Object.fromEntries(url.searchParams),
    headers,
    cookies: cookie ? cookie.split(/;\s*/) : undefined,
    body: body && body.length ? body.toString('base64') : undefined,
    isBase64Encoded: !!(body && body.length),
    requestContext: { http: { method: request.method, path: url.pathname } },
  } as never);

  const out = typeof result === 'string' ? { statusCode: 200, body: result } : result;
  const responseHeaders = new Headers();
  for (const [k, v] of Object.entries(out.headers ?? {})) responseHeaders.set(k, String(v));
  for (const c of out.cookies ?? []) responseHeaders.append('set-cookie', c);
  const payload = out.body ? Buffer.from(out.body, out.isBase64Encoded ? 'base64' : 'utf8') : null;
  return new Response(payload, { status: out.statusCode ?? 200, headers: responseHeaders });
}

export { serve as GET, serve as POST, serve as PUT, serve as PATCH, serve as DELETE };
