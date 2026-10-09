import { HttpError } from '../http.js';
import type { Request } from '../router.js';

function rawBody(req: Request): Buffer {
  const { body, isBase64Encoded } = req.event;
  if (!body) return Buffer.alloc(0);
  return isBase64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
}

/** JSON body, or null when absent or malformed. */
export function jsonBody<T = Record<string, unknown>>(req: Request): T | null {
  try {
    const parsed = JSON.parse(rawBody(req).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed as T : null;
  } catch {
    return null;
  }
}

/** multipart/form-data body, parsed with Node's built-in fetch implementation. */
export async function formBody(req: Request): Promise<FormData> {
  const type = req.headers['content-type'] || '';
  if (!type.startsWith('multipart/form-data')) throw new HttpError(400, 'Expected a form submission.');
  try {
    return await new globalThis.Request('http://form.local/', { method: 'POST', headers: { 'content-type': type }, body: new Uint8Array(rawBody(req)) }).formData();
  } catch {
    throw new HttpError(400, 'The form submission could not be read.');
  }
}

/** Rejects cross-site browser requests that change data (in addition to the SameSite cookie). */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.origin;
  if (!origin) return; // non-browser clients and same-origin GET-style navigations send none
  const allowed = (process.env.ALLOWED_ORIGINS || 'https://events.ssistudios.com').split(',').map((o) => o.trim());
  if (!allowed.includes(origin)) throw new HttpError(403, 'Requests from this site are not allowed.');
}
