'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminFetch as fetch } from '@/lib/admin-auth';

type WaitlistEntry = {
  bookingId: string;
  position: number;
  joinedAt: string;
  title: string;
  fullName: string;
  mobile: string;
  email: string;
  hospitalName: string;
  specialty: string;
};

type SlotChoice = { dayId: string; slotId: string; label: string; free: boolean };

type WaitlistSlot = {
  slotId: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number;
  booked: number;
  arrived: number;
  entries: WaitlistEntry[];
};

/**
 * The selected live event's waitlist, per slot in join order. When a booked attendee does not
 * arrive, staff seat the next waitlisted attendee: they become a booking, marked present.
 */
export default function WaitlistPanel({ eventId, onSeated }: { eventId: string; onSeated?: () => void }) {
  const [slots, setSlots] = useState<WaitlistSlot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState('');
  const [seating, setSeating] = useState('');
  const [notice, setNotice] = useState('');
  const [moving, setMoving] = useState('');
  const [choices, setChoices] = useState<SlotChoice[]>([]);

  const load = useCallback(async (quiet = false) => {
    if (!eventId) return;
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/admin/waitlist?eventId=${encodeURIComponent(eventId)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Unable to load the waitlist.');
      setSlots(data.slots || []);
      // Slots a waitlisted doctor can be moved to: free seats (confirm) or other full slots (wait there).
      const live = await window.fetch(`/api/events/${encodeURIComponent(eventId)}/slots?refresh=${Date.now()}`, { cache: 'no-store' })
        .then((res) => res.json()).catch(() => null);
      if (live?.success && Array.isArray(live.days)) {
        setChoices(live.days.flatMap((day: { _id: string; date: string; slots: { _id: string; startTime: string; endTime: string; remaining: number; available: boolean; waitlistOpen?: boolean }[] }) =>
          day.slots.filter((slot) => slot.available || slot.waitlistOpen).map((slot) => ({
            dayId: day._id, slotId: slot._id, free: slot.available,
            label: `${day.date.slice(0, 10)} · ${slot.startTime}–${slot.endTime} · ${slot.available ? `${slot.remaining} free` : 'full, waitlist'}`,
          }))));
      }
      setTotal(data.total || 0);
      setError('');
    } catch (err) {
      if (!quiet) setError(err instanceof Error ? err.message : 'Unable to load the waitlist.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(true); }, 10000);
    return () => { window.clearTimeout(first); window.clearInterval(interval); };
  }, [load]);

  async function seat(entry: WaitlistEntry) {
    if (seating) return;
    setSeating(entry.bookingId);
    setNotice('');
    try {
      const response = await fetch('/api/admin/waitlist/seat', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, bookingId: entry.bookingId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not seat this attendee.');
      setNotice(data.message || `${entry.fullName} seated and marked present.`);
      onSeated?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not seat this attendee.');
    } finally {
      setSeating('');
      setConfirming('');
      void load(true);
    }
  }

  async function move(entry: WaitlistEntry, value: string) {
    const target = choices.find((c) => `${c.dayId}|${c.slotId}` === value);
    if (!target || moving) return;
    setMoving(entry.bookingId);
    setNotice('');
    try {
      const response = await fetch('/api/admin/waitlist/move', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, bookingId: entry.bookingId, dayScheduleId: target.dayId, slotId: target.slotId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.success) throw new Error(data?.error || 'Could not change the slot.');
      setNotice(data.message);
      if (data.confirmed) onSeated?.();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not change the slot.');
    } finally {
      setMoving('');
      void load(true);
    }
  }

  if (!eventId) return null;

  return (
    <section className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="waitlist-heading">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="waitlist-heading" className="text-[15px] font-semibold text-secondary">Waitlist</h2>
          <p className="mt-0.5 text-[12px] text-gray-500">
            When a booked attendee does not arrive, seat the next person in that slot.
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[12px] font-semibold text-amber-800">{total} waiting</span>
      </div>

      {notice && (
        <p role="status" className="mt-3 rounded-lg bg-primary/[0.06] px-3 py-2 text-[13px] font-medium text-primary">{notice}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error} <button type="button" className="ml-2 underline" onClick={() => void load()}>Retry</button>
        </p>
      )}

      {loading && !slots.length ? (
        <p className="mt-4 text-[13px] text-gray-400">Loading waitlist...</p>
      ) : !slots.length ? (
        <p className="mt-4 text-[13px] text-gray-400">No one is on the waitlist for this event.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {slots.map((slot) => {
            const noShows = Math.max(0, slot.booked - slot.arrived);
            return (
              <div key={slot.slotId}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-[13px] font-semibold text-secondary">
                    {slot.date} · {slot.startTime}–{slot.endTime}
                  </p>
                  <p className="text-[12px] text-gray-500">
                    {slot.arrived} of {slot.booked} booked arrived · capacity {slot.capacity}
                    {noShows > 0 && <span className="text-amber-700"> · {noShows} not arrived</span>}
                  </p>
                </div>
                <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {slot.entries.map((entry) => (
                    <li key={entry.bookingId} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-[12px] font-bold text-amber-800">
                        {entry.position}
                      </span>
                      <div className="min-w-[10rem] flex-1">
                        <p className="text-[13px] font-semibold leading-snug text-secondary">
                          {[entry.title, entry.fullName].filter(Boolean).join(' ')}
                        </p>
                        <p className="text-[12px] leading-snug text-gray-500">
                          {[entry.specialty, entry.hospitalName, entry.mobile].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <select
                        aria-label={`Change slot for ${entry.fullName}`}
                        value=""
                        disabled={!!moving}
                        onChange={(e) => { void move(entry, e.target.value); }}
                        className="h-8 max-w-[11rem] shrink-0 rounded-lg border border-gray-200 bg-white px-2 text-[12px] font-semibold text-secondary"
                      >
                        <option value="">{moving === entry.bookingId ? 'Moving...' : 'Change slot'}</option>
                        {choices.filter((c) => c.slotId !== slot.slotId || c.free).map((c) => (
                          <option key={c.slotId} value={`${c.dayId}|${c.slotId}`}>{c.label}</option>
                        ))}
                      </select>
                      {confirming === entry.bookingId ? (
                        <span className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setConfirming('')}
                            className="h-8 rounded-lg border border-gray-200 px-3 text-[12px] font-semibold text-secondary hover:bg-gray-50"
                          >
                            Back
                          </button>
                          <button
                            type="button"
                            disabled={!!seating}
                            onClick={() => void seat(entry)}
                            className="h-8 rounded-lg bg-primary px-3 text-[12px] font-semibold text-white disabled:opacity-60"
                          >
                            {seating === entry.bookingId ? 'Seating...' : 'Confirm seat'}
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirming(entry.bookingId)}
                          className="h-8 shrink-0 rounded-lg border border-primary/30 px-3 text-[12px] font-semibold text-primary hover:bg-primary/[0.05]"
                        >
                          Seat & mark present
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
