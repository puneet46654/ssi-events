import { DeleteCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { db, keys, TABLE_NAME } from '../db/table.js';
import { error, HttpError, json } from '../http.js';
import { logActivity } from '../lib/activity.js';
import {
  ADMIN_PERMISSIONS, adminRecord, allAdmins, getAdmin, isAdminEmail, requireAdmin, type AdminItem, type AdminPermission, type AdminRole,
} from '../lib/admins.js';
import { assertSameOrigin, jsonBody } from '../lib/body.js';
import { hashPassword, passwordProblem } from '../lib/passwords.js';
import type { Handler } from '../router.js';

// User & Access is superadmin-only: `auth` is never granted to other roles (see profileOf).

const USERNAME = /^[a-z0-9._-]{3,40}$/;
const ROLES: AdminRole[] = ['superadmin', 'admin', 'staff'];
const ASSIGNABLE = ADMIN_PERMISSIONS.filter((p) => p !== 'auth');

type UserBody = {
  username?: unknown; name?: unknown; email?: unknown; password?: unknown; role?: unknown;
  permissions?: unknown; canCreate?: unknown; canDelete?: unknown; isActive?: unknown;
};

const isConditionFailure = (err: unknown) => (err as { name?: string })?.name === 'ConditionalCheckFailedException';

/** What the User & Access screen shows; never the password hash or salt. Users are addressed by login ID. */
function publicUser(a: AdminItem) {
  const superadmin = a.role === 'superadmin';
  return {
    _id: a.username, username: a.username, name: a.name, email: a.email ?? '', role: a.role,
    permissions: superadmin ? [...ADMIN_PERMISSIONS] : a.permissions.filter((p) => p !== 'auth'),
    canCreate: superadmin || a.canCreate, canDelete: superadmin || a.canDelete, isActive: a.isActive,
    createdBy: a.createdBy, lastLoginAt: a.lastLoginAt, createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

/** Optional email: blank clears it; otherwise valid and not used by another admin. */
async function readEmail(value: unknown, self?: string): Promise<string | undefined> {
  if (value === undefined || value === null) return undefined;
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) return '';
  if (!isAdminEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  if ((await allAdmins()).some((a) => a.email === email && a.username !== self)) {
    throw new HttpError(409, 'That email address is already used by another admin.');
  }
  return email;
}

/** Role and access from the form. Superadmins always get everything. */
function readAccess(body: UserBody, current?: AdminItem) {
  const role = (body.role === undefined ? current?.role : body.role) as AdminRole;
  if (!ROLES.includes(role)) throw new HttpError(400, 'Role must be Superadmin, Admin or Staff.');
  if (role === 'superadmin') return { role, permissions: [...ADMIN_PERMISSIONS], canCreate: true, canDelete: true };
  const requested = body.permissions === undefined ? current?.permissions ?? [] : body.permissions;
  if (!Array.isArray(requested)) throw new HttpError(400, 'Invalid module access.');
  const permissions = ASSIGNABLE.filter((p) => requested.includes(p)) as AdminPermission[];
  if (!permissions.length) throw new HttpError(400, 'Select at least one module this user can access.');
  const flag = (value: unknown, fallback: boolean) => (value === undefined ? fallback : value === true);
  return {
    role, permissions,
    canCreate: flag(body.canCreate, current?.role === 'superadmin' ? false : current?.canCreate ?? false),
    canDelete: flag(body.canDelete, current?.role === 'superadmin' ? false : current?.canDelete ?? false),
  };
}

function readName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (name.length < 2 || name.length > 100) throw new HttpError(400, 'Enter the full name (2-100 characters).');
  return name;
}

async function readPassword(value: unknown) {
  if (typeof value !== 'string' || value.length > 256) throw new HttpError(400, 'Enter a password.');
  const problem = passwordProblem(value);
  if (problem) throw new HttpError(400, `Password: ${problem}`);
  return hashPassword(value);
}

/** Refuses a change that would leave no active superadmin to manage access. */
async function keepOneSuperadmin(user: AdminItem, stillActiveSuperadmin: boolean): Promise<void> {
  if (user.role !== 'superadmin' || !user.isActive || stillActiveSuperadmin) return;
  const others = (await allAdmins()).filter((a) => a.username !== user.username && a.role === 'superadmin' && a.isActive);
  if (!others.length) throw new HttpError(400, 'At least one active Superadmin must remain.');
}

/** GET /api/admin/users — every admin account, newest first. */
export const listUsers: Handler = async (req) => {
  await requireAdmin(req, 'auth');
  const users = (await allAdmins()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(publicUser);
  return json(200, { success: true, users });
};

/** POST /api/admin/users — `{ username, name, password, role, permissions, canCreate, canDelete, isActive }`. */
export const createUser: Handler = async (req) => {
  assertSameOrigin(req);
  const session = await requireAdmin(req, 'auth', 'write');
  const body = jsonBody<UserBody>(req) ?? {};
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  if (!USERNAME.test(username)) throw new HttpError(400, 'Login ID: 3-40 characters, using a-z, 0-9, dot, hyphen or underscore.');
  const name = readName(body.name);
  const email = await readEmail(body.email);
  const access = readAccess(body);
  const { hash, salt } = await readPassword(body.password);

  const now = new Date().toISOString();
  const user: AdminItem = {
    username, name, ...(email ? { email } : {}), ...access, isActive: body.isActive !== false,
    passwordHash: hash, passwordSalt: salt, createdBy: session.username, createdAt: now, updatedAt: now,
  };
  try {
    await db.send(new PutCommand({ TableName: TABLE_NAME, Item: adminRecord(user), ConditionExpression: 'attribute_not_exists(PK)' }));
  } catch (err) {
    if (isConditionFailure(err)) throw new HttpError(409, `Login ID "${username}" is already taken.`);
    throw err;
  }
  await logActivity({
    admin: session.username, action: 'create', resource: 'admin_user', resourceId: username,
    details: { username, role: user.role, permissions: user.permissions, canCreate: user.canCreate, canDelete: user.canDelete },
  });
  return json(201, { success: true, user: publicUser(user) });
};

const AUDITED = ['username', 'name', 'email', 'role', 'permissions', 'canCreate', 'canDelete', 'isActive'] as const;
const ACCESS_FIELDS = ['role', 'permissions', 'canCreate', 'canDelete'];

/**
 * PUT /api/admin/users/:id — any of the create fields; `password` only when resetting it. A reset or a
 * login ID change signs that user out everywhere. Superadmins can't change their own role, status or ID.
 */
export const updateUser: Handler = async (req) => {
  assertSameOrigin(req);
  const session = await requireAdmin(req, 'auth', 'write');
  const id = req.params.id!.toLowerCase();
  if (!USERNAME.test(id)) return error(400, 'Invalid user ID.');
  const user = await getAdmin(id);
  if (!user) return error(404, 'User not found.');
  const body = jsonBody<UserBody>(req) ?? {};

  const username = typeof body.username === 'string' && body.username.trim() ? body.username.trim().toLowerCase() : user.username;
  if (!USERNAME.test(username)) throw new HttpError(400, 'Login ID: 3-40 characters, using a-z, 0-9, dot, hyphen or underscore.');
  const access = readAccess(body, user);
  const isActive = body.isActive === undefined ? user.isActive : body.isActive === true;
  const self = user.username === session.username;
  if (self && (username !== user.username || access.role !== user.role || !isActive)) {
    throw new HttpError(400, 'You cannot change your own login ID, role or status. Ask another Superadmin.');
  }
  await keepOneSuperadmin(user, access.role === 'superadmin' && isActive);

  const email = await readEmail(body.email, user.username);
  const reset = typeof body.password === 'string' && body.password.length > 0;
  const credentials = reset ? await readPassword(body.password) : null;
  const updated: AdminItem = {
    ...user, username, ...access, isActive,
    name: body.name === undefined ? user.name : readName(body.name),
    ...(email === undefined ? {} : { email: email || undefined }),
    ...(credentials ? { passwordHash: credentials.hash, passwordSalt: credentials.salt } : {}),
    updatedAt: new Date().toISOString(),
  };

  try {
    if (username === user.username) {
      await db.send(new PutCommand({ TableName: TABLE_NAME, Item: adminRecord(updated), ConditionExpression: 'attribute_exists(PK)' }));
    } else {
      // The login ID is the key, so a rename moves the item.
      await db.send(new TransactWriteCommand({
        TransactItems: [
          { Delete: { TableName: TABLE_NAME, Key: keys.admin(user.username), ConditionExpression: 'attribute_exists(PK)' } },
          { Put: { TableName: TABLE_NAME, Item: adminRecord(updated), ConditionExpression: 'attribute_not_exists(PK)' } },
        ],
      }));
    }
  } catch (err) {
    if (err instanceof TransactionCanceledException && err.CancellationReasons?.[1]?.Code === 'ConditionalCheckFailed') {
      throw new HttpError(409, `Login ID "${username}" is already taken.`);
    }
    if (isConditionFailure(err) || err instanceof TransactionCanceledException) throw new HttpError(404, 'User not found.');
    throw err;
  }

  const changes = Object.fromEntries(AUDITED
    .filter((f) => JSON.stringify(user[f]) !== JSON.stringify(updated[f]))
    .map((f) => [f, { from: user[f], to: updated[f] }]));
  if (Object.keys(changes).length || reset) {
    await logActivity({
      admin: session.username, action: Object.keys(changes).some((f) => ACCESS_FIELDS.includes(f)) ? 'role_change' : 'update',
      resource: 'admin_user', resourceId: username,
      details: { username, changes, ...(reset ? { credentialReset: true } : {}) },
    });
  }
  return json(200, { success: true, user: publicUser(updated) });
};

/** DELETE /api/admin/users/:id — removes an account. Not your own, and not the last active Superadmin. */
export const deleteUser: Handler = async (req) => {
  assertSameOrigin(req);
  const session = await requireAdmin(req, 'auth', 'delete');
  const id = req.params.id!.toLowerCase();
  if (!USERNAME.test(id)) return error(400, 'Invalid user ID.');
  const user = await getAdmin(id);
  if (!user) return error(404, 'User not found.');
  if (user.username === session.username) return error(400, 'You cannot delete your own account.');
  await keepOneSuperadmin(user, false);
  await db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: keys.admin(user.username) }));
  await logActivity({ admin: session.username, action: 'delete', resource: 'admin_user', resourceId: user.username, details: { username: user.username, role: user.role } });
  return json(200, { success: true, message: `User @${user.username} deleted.` });
};
