import { createHmac, timingSafeEqual } from 'node:crypto';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, keys, lists, TABLE_NAME, ttlAfter } from '../db/table.js';
import { HttpError } from '../http.js';
import type { Request } from '../router.js';
import { cookie, readCookie } from './cookies.js';
import { newId } from './ids.js';

export const ADMIN_PERMISSIONS = ['dashboard', 'events', 'bookings', 'check-in', 'reports', 'auth'] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];
export type AdminRole = 'superadmin' | 'admin' | 'staff';

/** Admin user item (`ADMIN#<username>` / `META`). */
export type AdminItem = {
  username: string;
  name: string;
  role: AdminRole;
  permissions: AdminPermission[];
  canCreate: boolean;
  canDelete: boolean;
  isActive: boolean;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
};

export type AdminProfile = Pick<AdminItem, 'username' | 'name' | 'role' | 'permissions' | 'canCreate' | 'canDelete'>;
export type AdminSession = AdminProfile & { loggedInAt: number };

export const SESSION_COOKIE = 'ssi_admin_session';
export const SESSION_MAX_AGE = 8 * 60 * 60; // seconds
const MAX_FAILED_LOGINS = 5;
const LOCK_SECONDS = 15 * 60;

function secret(): string {
  const value = process.env.ADMIN_SESSION_SECRET;
  // A guessable key would let anyone forge an admin session, so refuse to run without one.
  if (!value || value.length < 32) throw new Error('ADMIN_SESSION_SECRET is missing or shorter than 32 characters.');
  return value;
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

/** Changes whenever the password changes, so a reset signs out every earlier session. */
function credentialVersion(admin: Pick<AdminItem, 'username' | 'passwordHash' | 'passwordSalt'>): string {
  return sign(`admin-credentials:${admin.username}:${admin.passwordHash}:${admin.passwordSalt}`).slice(0, 16);
}

/** Effective access: superadmins have everything; User & Access (`auth`) is superadmin-only. */
export function profileOf(admin: AdminItem): AdminProfile {
  const superadmin = admin.role === 'superadmin';
  return {
    username: admin.username,
    name: admin.name || admin.username,
    role: admin.role,
    permissions: superadmin ? [...ADMIN_PERMISSIONS] : admin.permissions.filter((p) => p !== 'auth'),
    canCreate: superadmin || admin.canCreate,
    canDelete: superadmin || admin.canDelete,
  };
}

export async function getAdmin(username: string): Promise<AdminItem | undefined> {
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: keys.admin(username) }));
  return Item as AdminItem | undefined;
}

export async function putAdmin(admin: AdminItem, mustBeNew = false): Promise<void> {
  await db.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { ...keys.admin(admin.username), GSI1PK: lists.admins, GSI1SK: admin.username, ...admin },
    ...(mustBeNew ? { ConditionExpression: 'attribute_not_exists(PK)' } : {}),
  }));
}

export async function recordLogin(username: string): Promise<void> {
  await db.send(new UpdateCommand({
    TableName: TABLE_NAME, Key: keys.admin(username),
    UpdateExpression: 'SET lastLoginAt = :now', ExpressionAttributeValues: { ':now': new Date().toISOString() },
  }));
}

/** Session cookie value: base64url(JSON payload) + '.' + HMAC-SHA256 signature. */
export function sessionCookie(admin: AdminItem, loggedInAt: number): string {
  const payload = Buffer.from(JSON.stringify({ u: admin.username, t: loggedInAt, v: credentialVersion(admin) })).toString('base64url');
  return cookie(SESSION_COOKIE, `${payload}.${sign(payload)}`, SESSION_MAX_AGE);
}

export const clearSessionCookie = () => cookie(SESSION_COOKIE, '', 0);

/** The signed-in admin, re-read from the table so deactivation and permission changes apply at once. */
export async function currentAdmin(req: Request): Promise<AdminSession | null> {
  const token = readCookie(req, SESSION_COOKIE);
  const [payload, signature] = token?.split('.') ?? [];
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let data: { u?: unknown; t?: unknown; v?: unknown };
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  if (typeof data.u !== 'string' || typeof data.t !== 'number' || typeof data.v !== 'string') return null;
  if (data.t > Date.now() || Date.now() - data.t > SESSION_MAX_AGE * 1000) return null;

  const admin = await getAdmin(data.u);
  if (!admin?.isActive || credentialVersion(admin) !== data.v) return null;
  return { ...profileOf(admin), loggedInAt: data.t };
}

/**
 * Throws 401/403 unless the signed-in admin has `permission` and, for changes, the create/delete
 * right. Superadmins pass every check.
 */
export async function requireAdmin(req: Request, permission: AdminPermission, action: 'read' | 'write' | 'delete' = 'read'): Promise<AdminSession> {
  const session = await currentAdmin(req);
  if (!session) throw new HttpError(401, 'Your admin session has expired. Please sign in again.');
  const allowed = session.role === 'superadmin' || session.permissions.includes(permission)
    && (action === 'read' || (action === 'write' && session.canCreate) || (action === 'delete' && session.canDelete));
  if (!allowed) throw new HttpError(403, 'You do not have permission for this action.');
  return session;
}

/* Failed-login throttle: one item per failure, expiring after the lock window. */

export async function isLoginLocked(username: string): Promise<boolean> {
  const since = new Date(Date.now() - LOCK_SECONDS * 1000).toISOString();
  const { Count } = await db.send(new QueryCommand({
    TableName: TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND SK >= :since',
    ExpressionAttributeValues: { ':pk': `LOGINFAIL#${username}`, ':since': since },
    Select: 'COUNT',
  }));
  return (Count ?? 0) >= MAX_FAILED_LOGINS;
}

export async function recordFailedLogin(username: string): Promise<void> {
  await db.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: { PK: `LOGINFAIL#${username}`, SK: `${new Date().toISOString()}#${newId()}`, ttl: ttlAfter(LOCK_SECONDS) },
  }));
}
