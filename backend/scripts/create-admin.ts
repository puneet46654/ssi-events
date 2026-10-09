/**
 * Creates an admin account, or resets its password, directly in DynamoDB. Run by an AWS administrator:
 *
 *   cd backend
 *   npx tsx scripts/create-admin.ts --username naveen --name "Naveen" [--role superadmin|admin|staff] [--reset]
 *
 * A strong random password is generated and printed once; only its scrypt hash is stored.
 * Resetting a password signs that admin out everywhere.
 */
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { ADMIN_PERMISSIONS, getAdmin, putAdmin, type AdminItem, type AdminRole } from '../src/lib/admins.js';
import { hashPassword } from '../src/lib/passwords.js';

const { values } = parseArgs({
  options: {
    username: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'superadmin' },
    reset: { type: 'boolean', default: false },
  },
});

const username = values.username?.trim().toLowerCase() ?? '';
const role = values.role as AdminRole;
if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error('--username: 3-40 characters, a-z 0-9 . _ -');
if (!['superadmin', 'admin', 'staff'].includes(role)) throw new Error('--role must be superadmin, admin or staff');

// 20 characters from an unambiguous alphabet, plus guaranteed upper, lower and digit.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const password = 'Aa2' + [...randomBytes(17)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
const { hash, salt } = await hashPassword(password);

const existing = await getAdmin(username);
if (existing && !values.reset) throw new Error(`Admin "${username}" already exists. Pass --reset to set a new password.`);

const now = new Date().toISOString();
const admin: AdminItem = existing
  ? { ...existing, passwordHash: hash, passwordSalt: salt, isActive: true, updatedAt: now }
  : {
      username, name: values.name?.trim() || username, role,
      permissions: role === 'superadmin' ? [...ADMIN_PERMISSIONS] : ['dashboard'],
      canCreate: role === 'superadmin', canDelete: role === 'superadmin',
      isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: now, updatedAt: now,
    };
await putAdmin(admin, !existing);

console.log(`\n${existing ? 'Password reset' : 'Created'}: ${admin.username} (${admin.role})`);
console.log(`Password (shown once, store it in a password manager): ${password}\n`);
