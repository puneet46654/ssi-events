import { BatchWriteCommand, DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { db, TABLE_NAME } from '../db/table.js';
import { error, HttpError, json } from '../http.js';
import { logActivity } from '../lib/activity.js';
import { currentAdmin, type AdminSession } from '../lib/admins.js';
import { assertSameOrigin, jsonBody } from '../lib/body.js';
import { isId, newId } from '../lib/ids.js';
import type { Handler, Request } from '../router.js';

/*
 * Notes: a shared workspace for every signed-in admin. Folders (name + purpose) hold free-form
 * notes about doctors met in person: who they are and what they are interested in. Nothing in a
 * note is required.
 *
 *   Folder  NOTEFOLDER#<id> / META          GSI1PK NOTEFOLDERS, GSI1SK <createdAt>
 *   Note    NOTEFOLDER#<id> / NOTE#<noteId>  (noteId is time-ordered)
 */

const FOLDERS = 'NOTEFOLDERS';
const folderKey = (id: string) => ({ PK: `NOTEFOLDER#${id}`, SK: 'META' });
const noteKey = (folderId: string, noteId: string) => ({ PK: `NOTEFOLDER#${folderId}`, SK: `NOTE#${noteId}` });

/** Free-text note fields, all optional. */
const NOTE_FIELDS = ['title', 'fullName', 'mobile', 'email', 'hospital', 'specialty', 'city', 'text'] as const;
const MAX_FIELD = 4000;

type Folder = { folderId: string; name: string; purpose: string; createdAt: string; createdBy: string; createdByUser: string; updatedAt: string; updatedBy: string };
type Note = {
  folderId: string; noteId: string; interests: string[]; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
} & Partial<Record<(typeof NOTE_FIELDS)[number], string>>;

async function signedIn(req: Request): Promise<AdminSession> {
  const admin = await currentAdmin(req);
  if (!admin) throw new HttpError(401, 'Your admin session has expired. Please sign in again.');
  return admin;
}
const who = (admin: AdminSession) => admin.name || admin.username;
const str = (value: unknown, max = MAX_FIELD) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

function readNote(body: Record<string, unknown> | null) {
  const fields: Record<string, string> = {};
  for (const key of NOTE_FIELDS) fields[key] = str(body?.[key]);
  const interests = Array.isArray(body?.interests)
    ? [...new Set(body.interests.map((i) => str(i, 80)).filter(Boolean))].slice(0, 20)
    : [];
  return { fields, interests };
}

async function getFolder(id: string): Promise<Folder | undefined> {
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: folderKey(id) }));
  return Item as Folder | undefined;
}

async function folderNotes(id: string): Promise<Note[]> {
  const notes: Note[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new QueryCommand({
      TableName: TABLE_NAME, KeyConditionExpression: 'PK = :pk AND begins_with(SK, :n)',
      ExpressionAttributeValues: { ':pk': folderKey(id).PK, ':n': 'NOTE#' }, ExclusiveStartKey,
    }));
    notes.push(...(page.Items ?? []) as Note[]);
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return notes;
}

const publicFolder = (f: Folder, noteCount?: number) => ({
  id: f.folderId, name: f.name, purpose: f.purpose, createdAt: f.createdAt, createdBy: f.createdBy,
  updatedAt: f.updatedAt, updatedBy: f.updatedBy, ...(noteCount === undefined ? {} : { noteCount }),
});
const publicNote = (n: Note) => ({
  id: n.noteId, ...Object.fromEntries(NOTE_FIELDS.map((k) => [k, n[k] ?? ''])), interests: n.interests ?? [],
  createdAt: n.createdAt, createdBy: n.createdBy, updatedAt: n.updatedAt, updatedBy: n.updatedBy,
});

/* GET /api/admin/notes/folders — every folder, newest first, with note counts. */
export const listFolders: Handler = async (req) => {
  await signedIn(req);
  const { Items = [] } = await db.send(new QueryCommand({
    TableName: TABLE_NAME, IndexName: 'GSI1', KeyConditionExpression: 'GSI1PK = :pk',
    ExpressionAttributeValues: { ':pk': FOLDERS }, ScanIndexForward: false,
  }));
  const folders = (Items as Folder[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const counts = await Promise.all(folders.map(async (f) => (await folderNotes(f.folderId)).length));
  return json(200, { success: true, folders: folders.map((f, i) => publicFolder(f, counts[i])) }, { 'cache-control': 'no-store' });
};

/* POST /api/admin/notes/folders — `{ name, purpose? }`. */
export const createFolder: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await signedIn(req);
  const body = jsonBody<Record<string, unknown>>(req);
  const name = str(body?.name, 120);
  if (!name) return error(400, 'Give the folder a name.');
  const now = new Date().toISOString();
  const folder: Folder = { folderId: newId(), name, purpose: str(body?.purpose, 1000), createdAt: now, createdBy: who(admin), createdByUser: admin.username, updatedAt: now, updatedBy: who(admin) };
  await db.send(new PutCommand({
    TableName: TABLE_NAME, Item: { ...folderKey(folder.folderId), GSI1PK: FOLDERS, GSI1SK: now, ...folder },
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
  await logActivity({ admin: admin.username, action: 'create', resource: 'note-folder', resourceId: folder.folderId, details: { name } });
  return json(201, { success: true, folder: publicFolder(folder, 0) });
};

/* GET /api/admin/notes/folders/:id — the folder and its notes, newest first. */
export const getFolderWithNotes: Handler = async (req) => {
  await signedIn(req);
  const { id } = req.params as { id: string };
  if (!isId(id)) return error(400, 'Invalid folder.');
  const folder = await getFolder(id);
  if (!folder) return error(404, 'Folder not found.');
  const notes = (await folderNotes(id)).sort((a, b) => b.noteId.localeCompare(a.noteId));
  return json(200, { success: true, folder: publicFolder(folder, notes.length), notes: notes.map(publicNote) }, { 'cache-control': 'no-store' });
};

/* PATCH /api/admin/notes/folders/:id — `{ name?, purpose? }`. */
export const updateFolder: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await signedIn(req);
  const { id } = req.params as { id: string };
  if (!isId(id)) return error(400, 'Invalid folder.');
  const folder = await getFolder(id);
  if (!folder) return error(404, 'Folder not found.');
  const body = jsonBody<Record<string, unknown>>(req);
  const name = body?.name === undefined ? folder.name : str(body.name, 120);
  if (!name) return error(400, 'Give the folder a name.');
  const purpose = body?.purpose === undefined ? folder.purpose : str(body.purpose, 1000);
  const now = new Date().toISOString();
  await db.send(new UpdateCommand({
    TableName: TABLE_NAME, Key: folderKey(id),
    UpdateExpression: 'SET #n = :n, purpose = :p, updatedAt = :now, updatedBy = :by',
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeNames: { '#n': 'name' },
    ExpressionAttributeValues: { ':n': name, ':p': purpose, ':now': now, ':by': who(admin) },
  }));
  return json(200, { success: true, folder: publicFolder({ ...folder, name, purpose, updatedAt: now, updatedBy: who(admin) }) });
};

/* DELETE /api/admin/notes/folders/:id — removes the folder and every note in it. */
export const deleteFolder: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await signedIn(req);
  const { id } = req.params as { id: string };
  if (!isId(id)) return error(400, 'Invalid folder.');
  const folder = await getFolder(id);
  if (!folder) return error(404, 'Folder not found.');
  if (admin.role !== 'superadmin' && folder.createdByUser !== admin.username) {
    return error(403, 'Only the person who created this folder, or a super admin, can delete it.');
  }
  const notes = await folderNotes(id);
  for (let i = 0; i < notes.length; i += 25) {
    await db.send(new BatchWriteCommand({ RequestItems: { [TABLE_NAME]: notes.slice(i, i + 25).map((n) => ({ DeleteRequest: { Key: noteKey(id, n.noteId) } })) } }));
  }
  await db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: folderKey(id) }));
  await logActivity({ admin: admin.username, action: 'delete', resource: 'note-folder', resourceId: id, details: { name: folder.name, notes: notes.length } });
  return json(200, { success: true });
};

/* POST /api/admin/notes/folders/:id/notes — a note; every field is optional, but it must say something. */
export const createNote: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await signedIn(req);
  const { id } = req.params as { id: string };
  if (!isId(id)) return error(400, 'Invalid folder.');
  if (!await getFolder(id)) return error(404, 'Folder not found.');
  const { fields, interests } = readNote(jsonBody<Record<string, unknown>>(req));
  if (!Object.values(fields).some(Boolean) && !interests.length) return error(400, 'Write something in the note first.');
  const now = new Date().toISOString();
  const note: Note = { folderId: id, noteId: newId(), ...fields, interests, createdAt: now, createdBy: who(admin), updatedAt: now, updatedBy: who(admin) };
  await db.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...noteKey(id, note.noteId), ...note }, ConditionExpression: 'attribute_not_exists(PK)' }));
  return json(201, { success: true, note: publicNote(note) });
};

/* PATCH /api/admin/notes/folders/:id/notes/:noteId — replaces the note's fields. */
export const updateNote: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await signedIn(req);
  const { id, noteId } = req.params as { id: string; noteId: string };
  if (!isId(id) || !isId(noteId)) return error(400, 'Invalid note.');
  const { Item } = await db.send(new GetCommand({ TableName: TABLE_NAME, Key: noteKey(id, noteId) }));
  if (!Item) return error(404, 'Note not found.');
  const { fields, interests } = readNote(jsonBody<Record<string, unknown>>(req));
  const note: Note = { ...(Item as Note), ...fields, interests, updatedAt: new Date().toISOString(), updatedBy: who(admin) };
  await db.send(new PutCommand({ TableName: TABLE_NAME, Item: { ...noteKey(id, noteId), ...note }, ConditionExpression: 'attribute_exists(PK)' }));
  return json(200, { success: true, note: publicNote(note) });
};

/* DELETE /api/admin/notes/folders/:id/notes/:noteId */
export const deleteNote: Handler = async (req) => {
  assertSameOrigin(req);
  const admin = await signedIn(req);
  const { id, noteId } = req.params as { id: string; noteId: string };
  if (!isId(id) || !isId(noteId)) return error(400, 'Invalid note.');
  try {
    await db.send(new DeleteCommand({ TableName: TABLE_NAME, Key: noteKey(id, noteId), ConditionExpression: 'attribute_exists(PK)' }));
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return error(404, 'Note not found.');
    throw err;
  }
  await logActivity({ admin: admin.username, action: 'delete', resource: 'note', resourceId: noteId, details: { folderId: id } });
  return json(200, { success: true });
};
