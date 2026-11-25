'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { adminFetch as fetch } from '@/lib/admin-auth';
import { formatNoteTime } from './format';

type Folder = { id: string; name: string; purpose: string; createdAt: string; createdBy: string; noteCount: number };

/** Notes workspace: shared folders, each with a purpose, holding notes about doctors met in person. */
export default function NotesFoldersPage() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/notes/folders', { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Unable to load folders.');
      setFolders(data.folders);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load folders.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const response = await fetch('/api/admin/notes/folders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, purpose }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not create the folder.');
      setFolders((current) => [data.folder, ...current]);
      setName(''); setPurpose(''); setCreating(false); setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the folder.');
    } finally {
      setSaving(false);
    }
  }

  const query = search.trim().toLowerCase();
  const shown = query ? folders.filter((f) => `${f.name} ${f.purpose} ${f.createdBy}`.toLowerCase().includes(query)) : folders;

  return (
    <div className="mx-auto w-full max-w-[1200px] p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-[24px] font-bold text-secondary">Notes</h1>
          <p className="mt-1 text-[13px] text-gray-500">
            A shared workspace for the team. Make a folder for a visit, event or campaign, then jot down every doctor you meet and what they are interested in.
          </p>
        </div>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)} className="h-10 rounded-lg bg-primary px-4 text-[13px] font-semibold text-white hover:brightness-95">
            + New folder
          </button>
        )}
      </div>

      {creating && (
        <form onSubmit={create} className="mt-5 rounded-xl border border-primary/20 bg-white p-4 shadow-sm">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <label className="block">
              <span className="text-[13px] font-semibold text-secondary">Folder name</span>
              <input
                autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
                placeholder="e.g. AIIMS visit, 25 Nov"
                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-[14px] outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="text-[13px] font-semibold text-secondary">Purpose <span className="font-normal text-gray-400">(optional)</span></span>
              <input
                value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={1000}
                placeholder="e.g. Doctors interested in a faculty tour or our next events"
                className="mt-1 h-10 w-full rounded-lg border border-gray-200 px-3 text-[14px] outline-none focus:border-primary"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => { setCreating(false); setName(''); setPurpose(''); }} className="h-9 rounded-lg border border-gray-200 px-4 text-[13px] font-semibold text-secondary">
              Cancel
            </button>
            <button type="submit" disabled={!name.trim() || saving} className="h-9 rounded-lg bg-primary px-4 text-[13px] font-semibold text-white disabled:opacity-50">
              {saving ? 'Creating...' : 'Create folder'}
            </button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>}

      {folders.length > 3 && (
        <input
          value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search folders"
          className="mt-5 h-10 w-full max-w-sm rounded-lg border border-gray-200 bg-white px-3 text-[14px] outline-none focus:border-primary"
        />
      )}

      {loading ? (
        <p className="mt-8 text-[14px] text-gray-400">Loading folders...</p>
      ) : !shown.length ? (
        <div className="mt-8 rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <p className="text-[15px] font-semibold text-secondary">{query ? 'No folder matches your search.' : 'No folders yet.'}</p>
          {!query && <p className="mt-1 text-[13px] text-gray-500">Create the first one, for example for today&apos;s hospital visit.</p>}
        </div>
      ) : (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((folder) => (
            <Link
              key={folder.id}
              href={`/admin/notes/${folder.id}`}
              className="group rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-secondary group-hover:text-primary">{folder.name}</p>
                  {folder.purpose && <p className="mt-0.5 line-clamp-2 text-[13px] text-gray-600">{folder.purpose}</p>}
                </div>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[12px] font-semibold text-gray-600">
                  {folder.noteCount} {folder.noteCount === 1 ? 'note' : 'notes'}
                </span>
              </div>
              <p className="mt-3 text-[12px] text-gray-400">Created {formatNoteTime(folder.createdAt)} by {folder.createdBy}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
