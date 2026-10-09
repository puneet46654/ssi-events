import type { Request } from '../router.js';

/** Cookies from a function-URL event (`event.cookies`) or a plain `cookie` header. */
export function readCookie(req: Request, name: string): string | undefined {
  const pairs = req.event.cookies ?? (req.headers.cookie ? req.headers.cookie.split(';') : []);
  for (const pair of pairs) {
    const index = pair.indexOf('=');
    if (index > 0 && pair.slice(0, index).trim() === name) return decodeURIComponent(pair.slice(index + 1).trim());
  }
  return undefined;
}

/** HttpOnly, Secure, SameSite=Lax cookie for the whole site. `maxAge` 0 deletes it. */
export function cookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}
