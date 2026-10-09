import { logActivity } from '../lib/activity.js';
import {
  clearSessionCookie, currentAdmin, getAdmin, isLoginLocked, profileOf, recordFailedLogin, recordLogin, sessionCookie,
} from '../lib/admins.js';
import { assertSameOrigin, jsonBody } from '../lib/body.js';
import { verifyPassword } from '../lib/passwords.js';
import { error, json } from '../http.js';
import type { Handler } from '../router.js';

// Compared against when the username is unknown, so response time doesn't reveal which IDs exist.
const DUMMY = { hash: '0'.repeat(128), salt: '0'.repeat(32) };

/** POST /api/admin/login — `{ username, password }` → session cookie + profile. */
export const login: Handler = async (req) => {
  assertSameOrigin(req);
  const body = jsonBody<{ username?: unknown; password?: unknown }>(req);
  const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || !password || username.length > 80 || password.length > 256) {
    return error(400, 'Enter your login ID and password.');
  }
  if (await isLoginLocked(username)) return error(429, 'Too many failed attempts. Try again in 15 minutes.');

  const admin = await getAdmin(username);
  const valid = await verifyPassword(password, admin?.passwordHash ?? DUMMY.hash, admin?.passwordSalt ?? DUMMY.salt);
  if (!admin || !admin.isActive || !valid) {
    await recordFailedLogin(username);
    await logActivity({ admin: username, action: 'login_failed', resource: 'auth' });
    return error(401, 'Invalid login ID or password.');
  }

  const loggedInAt = Date.now();
  await recordLogin(admin.username);
  await logActivity({ admin: admin.username, action: 'login', resource: 'auth', details: { role: admin.role } });
  return json(200, { success: true, user: profileOf(admin), loggedInAt }, {}, [sessionCookie(admin, loggedInAt)]);
};

/** POST /api/admin/logout — clears the session cookie. */
export const logout: Handler = async (req) => {
  assertSameOrigin(req);
  const session = await currentAdmin(req);
  if (session) await logActivity({ admin: session.username, action: 'logout', resource: 'auth' });
  return json(200, { success: true }, {}, [clearSessionCookie()]);
};

/** GET /api/admin/session — the signed-in admin's current access, or 401. */
export const session: Handler = async (req) => {
  const current = await currentAdmin(req);
  if (!current) return error(401, 'Please sign in again.', [clearSessionCookie()]);
  return json(200, { success: true, user: current });
};
