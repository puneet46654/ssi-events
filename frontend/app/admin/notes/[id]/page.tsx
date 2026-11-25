'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminFetch as fetch } from '@/lib/admin-auth';
import { formatNoteTime } from '../format';

type Folder = { id: string; name: string; purpose: string; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string; noteCount: number };
type Note = {
  id: string; title: string; fullName: string; mobile: string; email: string; hospital: string; specialty: string; city: string; text: string;
  interests: string[]; createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
};
type Draft = Omit<Note, 'id' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>;

const EMPTY: Draft = { title: 'Dr.', fullName: '', mobile: '', email: '', hospital: '', specialty: '', city: '', text: '', interests: [] };
const INTERESTS = ['Faculty tour', 'Other events', 'Training / workshop', 'Product demo', 'Partnership'];
const input = 'h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-[14px] outline-none focus:border-primary';

export default function NotesFolderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [folder, setFolder] = useState<Folder | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [editingFolder, setEditingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState({ name: '', purpose: '' });
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/notes/folders/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Unable to load this folder.');
      setFolder(data.folder);
      setNotes(data.notes);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load this folder.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    // Others may be adding notes in the same folder.
    const interval = window.setInterval(() => { void load(); }, 20000);
    return () => { window.clearTimeout(timer); window.clearInterval(interval); };
  }, [load]);

  async function saveFolder(event: FormEvent) {
    event.preventDefault();
    const response = await fetch(`/api/admin/notes/folders/${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(folderDraft),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) { setError(data?.error || 'Could not save the folder.'); return; }
    setFolder((current) => current && { ...current, ...data.folder });
    setEditingFolder(false);
  }

  async function deleteFolder() {
    const response = await fetch(`/api/admin/notes/folders/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) { setError(data?.error || 'Could not delete the folder.'); setConfirmDeleteFolder(false); return; }
    router.push('/admin/notes');
  }

  const query = search.trim().toLowerCase();
  const shown = query
    ? notes.filter((n) => [n.fullName, n.mobile, n.email, n.hospital, n.specialty, n.city, n.text, ...n.interests, n.createdBy].join(' ').toLowerCase().includes(query))
    : notes;

  if (loading) return <div className="p-6 text-[14px] text-gray-400">Loading folder...</div>;
  if (!folder) {
    return (
      <div className="p-6">
        <p className="text-[14px] text-red-700">{error || 'Folder not found.'}</p>
        <Link href="/admin/notes" className="mt-3 inline-block text-[13px] font-semibold text-primary">← All folders</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] p-4 sm:p-6">
      <Link href="/admin/notes" className="text-[13px] font-semibold text-primary">← All folders</Link>

      {editingFolder ? (
        <form onSubmit={saveFolder} className="mt-3 rounded-xl border border-primary/20 bg-white p-4">
          <input value={folderDraft.name} onChange={(e) => setFolderDraft({ ...folderDraft, name: e.target.value })} maxLength={120} className={input} aria-label="Folder name" />
          <input value={folderDraft.purpose} onChange={(e) => setFolderDraft({ ...folderDraft, purpose: e.target.value })} maxLength={1000} placeholder="Purpose" className={`${input} mt-2`} aria-label="Purpose" />
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setEditingFolder(false)} className="h-9 rounded-lg border border-gray-200 px-4 text-[13px] font-semibold">Cancel</button>
            <button type="submit" disabled={!folderDraft.name.trim()} className="h-9 rounded-lg bg-primary px-4 text-[13px] font-semibold text-white disabled:opacity-50">Save</button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-heading text-[24px] font-bold text-secondary">{folder.name}</h1>
            {folder.purpose && <p className="mt-1 text-[14px] text-gray-600">{folder.purpose}</p>}
            <p className="mt-1 text-[12px] text-gray-400">
              Created {formatNoteTime(folder.createdAt)} by {folder.createdBy} · {notes.length} {notes.length === 1 ? 'note' : 'notes'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => { setFolderDraft({ name: folder.name, purpose: folder.purpose }); setEditingFolder(true); }}
              className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-semibold text-secondary hover:bg-gray-50">
              Edit folder
            </button>
            {confirmDeleteFolder ? (
              <>
                <button type="button" onClick={() => setConfirmDeleteFolder(false)} className="h-9 rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-semibold">Keep</button>
                <button type="button" onClick={() => void deleteFolder()} className="h-9 rounded-lg bg-red-600 px-3 text-[13px] font-semibold text-white">
                  Delete folder and {notes.length} {notes.length === 1 ? 'note' : 'notes'}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDeleteFolder(true)} className="h-9 rounded-lg border border-red-200 bg-white px-3 text-[13px] font-semibold text-red-600 hover:bg-red-50">
                Delete
              </button>
            )}
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}

      <NoteEditor
        key="new"
        folderId={id}
        onSaved={(note) => { setNotes((current) => [note, ...current]); }}
      />

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-secondary">Notes</h2>
        {notes.length > 0 && (
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, hospital, interest..." className={`${input} max-w-xs`} />
        )}
      </div>

      {!shown.length ? (
        <p className="mt-4 rounded-xl border border-dashed border-gray-300 bg-white p-6 text-center text-[13px] text-gray-500">
          {query ? 'No note matches your search.' : 'No notes yet. Add the first doctor above.'}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {shown.map((note) => (
            <NoteCard
              key={note.id}
              folderId={id}
              note={note}
              onChanged={(updated) => setNotes((current) => current.map((n) => (n.id === updated.id ? updated : n)))}
              onDeleted={() => setNotes((current) => current.filter((n) => n.id !== note.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Quick note form: every field optional; type what you have and save. */
function NoteEditor({ folderId, note, onSaved, onCancel }: { folderId: string; note?: Note; onSaved: (note: Note) => void; onCancel?: () => void }) {
  const [draft, setDraft] = useState<Draft>(note ? { ...note } : EMPTY);
  const [custom, setCustom] = useState('');
  const [more, setMore] = useState(!!note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof Draft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const toggle = (interest: string) => setDraft((d) => ({
    ...d, interests: d.interests.includes(interest) ? d.interests.filter((i) => i !== interest) : [...d.interests, interest],
  }));
  const addCustom = () => {
    const value = custom.trim();
    if (value && !draft.interests.includes(value)) setDraft((d) => ({ ...d, interests: [...d.interests, value] }));
    setCustom('');
  };
  const empty = !draft.interests.length && !['fullName', 'mobile', 'email', 'hospital', 'specialty', 'city', 'text'].some((k) => draft[k as keyof Draft]?.toString().trim());

  async function save(event: FormEvent) {
    event.preventDefault();
    if (empty || saving) return;
    setSaving(true);
    try {
      const response = await fetch(
        note ? `/api/admin/notes/folders/${encodeURIComponent(folderId)}/notes/${note.id}` : `/api/admin/notes/folders/${encodeURIComponent(folderId)}/notes`,
        { method: note ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, title: draft.fullName.trim() ? draft.title : '' }) },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not save the note.');
      onSaved(data.note);
      if (!note) { setDraft(EMPTY); setMore(false); }
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the note.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className={`${note ? '' : 'mt-5'} rounded-xl border border-gray-200 bg-white p-4 shadow-sm`}>
      {!note && <p className="mb-3 text-[13px] font-semibold text-secondary">Add a note <span className="font-normal text-gray-400">· fill only what you know</span></p>}

      <div className="grid gap-2 sm:grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)]">
        <select value={draft.title} onChange={(e) => set('title', e.target.value)} className={`${input} select-chevron`} aria-label="Title">
          {['Dr.', 'Prof.', 'Mr.', 'Ms.', 'Mrs.', ''].map((t) => <option key={t} value={t}>{t || '—'}</option>)}
        </select>
        <input value={draft.fullName} onChange={(e) => set('fullName', e.target.value)} placeholder="Doctor's name" className={input} aria-label="Name" />
        <input value={draft.mobile} onChange={(e) => set('mobile', e.target.value)} placeholder="Mobile" inputMode="tel" className={input} aria-label="Mobile" />
      </div>

      {more ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input value={draft.hospital} onChange={(e) => set('hospital', e.target.value)} placeholder="Hospital" className={input} aria-label="Hospital" />
          <input value={draft.specialty} onChange={(e) => set('specialty', e.target.value)} placeholder="Specialty" className={input} aria-label="Specialty" />
          <input value={draft.email} onChange={(e) => set('email', e.target.value)} placeholder="Email" inputMode="email" className={input} aria-label="Email" />
          <input value={draft.city} onChange={(e) => set('city', e.target.value)} placeholder="City" className={input} aria-label="City" />
        </div>
      ) : (
        <button type="button" onClick={() => setMore(true)} className="mt-2 text-[12px] font-semibold text-primary">+ Hospital, specialty, email, city</button>
      )}

      <div className="mt-3">
        <p className="text-[12px] font-semibold text-gray-500">Interested in</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {[...INTERESTS, ...draft.interests.filter((i) => !INTERESTS.includes(i))].map((interest) => {
            const on = draft.interests.includes(interest);
            return (
              <button
                key={interest} type="button" aria-pressed={on} onClick={() => toggle(interest)}
                className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${on ? 'border-primary bg-primary text-white' : 'border-gray-200 bg-white text-secondary hover:border-primary/40'}`}
              >
                {interest}
              </button>
            );
          })}
          <input
            value={custom} onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            onBlur={addCustom}
            placeholder="+ other"
            className="h-7 w-28 rounded-full border border-dashed border-gray-300 px-3 text-[12px] outline-none focus:border-primary"
            aria-label="Other interest"
          />
        </div>
      </div>

      <textarea
        value={draft.text} onChange={(e) => set('text', e.target.value)} rows={note ? 4 : 2}
        placeholder="Anything else: what you talked about, follow-up, best time to call..."
        className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-[14px] outline-none focus:border-primary"
        aria-label="Note"
      />

      {error && <p role="alert" className="mt-2 text-[12px] text-red-700">{error}</p>}
      <div className="mt-2 flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="h-9 rounded-lg border border-gray-200 px-4 text-[13px] font-semibold">Cancel</button>}
        <button type="submit" disabled={empty || saving} className="h-9 rounded-lg bg-primary px-4 text-[13px] font-semibold text-white disabled:opacity-40">
          {saving ? 'Saving...' : note ? 'Save changes' : 'Save note'}
        </button>
      </div>
    </form>
  );
}

function NoteCard({ folderId, note, onChanged, onDeleted }: { folderId: string; note: Note; onChanged: (n: Note) => void; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return <NoteEditor folderId={folderId} note={note} onSaved={(n) => { onChanged(n); setEditing(false); }} onCancel={() => setEditing(false)} />;
  }

  async function remove() {
    const response = await fetch(`/api/admin/notes/folders/${encodeURIComponent(folderId)}/notes/${note.id}`, { method: 'DELETE' });
    if (response.ok) onDeleted(); else setConfirming(false);
  }

  const name = [note.title, note.fullName].filter(Boolean).join(' ');
  const contact = [note.mobile, note.email].filter(Boolean);
  const place = [note.specialty, note.hospital, note.city].filter(Boolean).join(' · ');
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          {name && <p className="text-[15px] font-semibold text-secondary">{name}</p>}
          {place && <p className="text-[13px] text-gray-600">{place}</p>}
          {contact.length > 0 && (
            <p className="mt-0.5 text-[13px]">
              {note.mobile && <a href={`tel:${note.mobile.replace(/[^\d+]/g, '')}`} className="font-medium text-primary">{note.mobile}</a>}
              {note.mobile && note.email && <span className="text-gray-300"> · </span>}
              {note.email && <a href={`mailto:${note.email}`} className="font-medium text-primary">{note.email}</a>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" onClick={() => setEditing(true)} className="h-8 rounded-lg border border-gray-200 px-3 text-[12px] font-semibold text-secondary hover:bg-gray-50">Edit</button>
          {confirming ? (
            <>
              <button type="button" onClick={() => setConfirming(false)} className="h-8 rounded-lg border border-gray-200 px-3 text-[12px] font-semibold">Keep</button>
              <button type="button" onClick={() => void remove()} className="h-8 rounded-lg bg-red-600 px-3 text-[12px] font-semibold text-white">Delete note</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} className="h-8 rounded-lg border border-red-200 px-3 text-[12px] font-semibold text-red-600 hover:bg-red-50">Delete</button>
          )}
        </div>
      </div>
      {note.interests.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {note.interests.map((i) => <span key={i} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[12px] font-semibold text-primary">{i}</span>)}
        </div>
      )}
      {note.text && <p className="mt-2 whitespace-pre-wrap text-[14px] text-secondary">{note.text}</p>}
      <p className="mt-2 text-[12px] text-gray-400">
        {note.createdBy}, {formatNoteTime(note.createdAt)}
        {note.updatedAt !== note.createdAt && ` · edited by ${note.updatedBy}, ${formatNoteTime(note.updatedAt)}`}
      </p>
    </article>
  );
}
