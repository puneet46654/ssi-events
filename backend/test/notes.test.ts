import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { client, installFakeTable, jar, table } from './fake-table.js';

process.env.ADMIN_SESSION_SECRET = 'a'.repeat(64);
process.env.BOOKING_ACCESS_SECRET = 'b'.repeat(64);

const { db } = await import('../src/db/table.js');
const { handler } = await import('../src/handler.js');
const { hashPassword } = await import('../src/lib/passwords.js');
const call = client(handler);
const put = (i: Record<string, unknown>) => table.set(`${i.PK}|${i.SK}`, i);

async function signIn(username: string, role: string, permissions: string[] = []) {
  const { hash, salt } = await hashPassword('Correct-Horse-9');
  put({ PK: `ADMIN#${username}`, SK: 'META', GSI1PK: 'ADMINS', GSI1SK: username, username, name: username.toUpperCase(), role, permissions,
    canCreate: true, canDelete: true, isActive: true, passwordHash: hash, passwordSalt: salt, createdAt: '', updatedAt: '' });
  return jar((await call('POST', '/api/admin/login', { body: { username, password: 'Correct-Horse-9' } })).cookies);
}

let boss: string[], staff: string[];
beforeEach(async () => {
  await installFakeTable(db);
  boss = await signIn('naveen', 'superadmin');
  staff = await signIn('ravi', 'staff', ['check-in']);
});

test('notes need a signed-in admin', async () => {
  assert.equal((await call('GET', '/api/admin/notes/folders')).status, 401);
});

test('a shared folder: any admin creates, sees and writes notes; nothing in a note is required', async () => {
  const created = await call('POST', '/api/admin/notes/folders', { cookies: staff, body: { name: 'AIIMS visit 25 Nov', purpose: 'Doctors interested in a faculty tour' } });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const folder = created.data.folder;
  assert.deepEqual([folder.name, folder.purpose, folder.createdBy, folder.noteCount], ['AIIMS visit 25 Nov', 'Doctors interested in a faculty tour', 'RAVI', 0]);
  assert.equal((await call('POST', '/api/admin/notes/folders', { cookies: staff, body: { purpose: 'x' } })).status, 400, 'a folder needs a name');

  const listed = await call('GET', '/api/admin/notes/folders', { cookies: boss });
  assert.deepEqual(listed.data.folders.map((f: any) => f.id), [folder.id], 'every admin sees the same folders');

  const onlyName = await call('POST', `/api/admin/notes/folders/${folder.id}/notes`, { cookies: boss, body: { fullName: 'Dr Mehta' } });
  assert.equal(onlyName.status, 201, JSON.stringify(onlyName.data));
  const onlyInterest = await call('POST', `/api/admin/notes/folders/${folder.id}/notes`, { cookies: staff, body: { interests: ['Faculty tour', 'Faculty tour', 'Training'] } });
  assert.deepEqual(onlyInterest.data.note.interests, ['Faculty tour', 'Training']);
  assert.equal((await call('POST', `/api/admin/notes/folders/${folder.id}/notes`, { cookies: staff, body: {} })).status, 400, 'an empty note is refused');

  const edited = await call('PATCH', `/api/admin/notes/folders/${folder.id}/notes/${onlyName.data.note.id}`, { cookies: staff, body: { fullName: 'Dr Mehta', mobile: '98100 00000', text: 'Wants the robot demo' } });
  assert.deepEqual([edited.data.note.mobile, edited.data.note.createdBy, edited.data.note.updatedBy], ['98100 00000', 'NAVEEN', 'RAVI']);

  const view = await call('GET', `/api/admin/notes/folders/${folder.id}`, { cookies: boss });
  assert.equal(view.data.notes.length, 2);
  assert.equal(view.data.folder.noteCount, 2);

  assert.equal((await call('DELETE', `/api/admin/notes/folders/${folder.id}/notes/${onlyInterest.data.note.id}`, { cookies: boss })).status, 200);
  assert.equal((await call('GET', `/api/admin/notes/folders/${folder.id}`, { cookies: boss })).data.notes.length, 1);
});

test('only the creator or a super admin can delete a folder; deleting removes its notes', async () => {
  const folder = (await call('POST', '/api/admin/notes/folders', { cookies: boss, body: { name: 'Conference leads' } })).data.folder;
  await call('POST', `/api/admin/notes/folders/${folder.id}/notes`, { cookies: boss, body: { text: 'Call back next week' } });
  assert.equal((await call('DELETE', `/api/admin/notes/folders/${folder.id}`, { cookies: staff })).status, 403);
  assert.equal((await call('DELETE', `/api/admin/notes/folders/${folder.id}`, { cookies: boss })).status, 200);
  assert.equal([...table.keys()].filter((k) => k.startsWith(`NOTEFOLDER#${folder.id}`)).length, 0);
});
