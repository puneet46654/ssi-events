'use client';

import { useEffect, useState } from 'react';
import { useDialog } from '@/lib/use-dialog';
import { useI18n } from '@/lib/i18n';

const DONE_KEY = 'ssi-app-feedback-done';
const LABELS = ['', 'tickets.fbPoor', 'tickets.fbFair', 'tickets.fbGood', 'tickets.fbVeryGood', 'tickets.fbExcellent'];

function rememberDone() {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* Storage is optional. */ }
}

/** Whether this device already rated the app; checks the server once so a cleared browser does not ask twice. */
export function useAppFeedbackDone() {
  const [done, setDone] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      try { if (localStorage.getItem(DONE_KEY)) { setDone(true); return; } } catch { /* Ask the server. */ }
      fetch('/api/feedback', { cache: 'no-store' })
        .then(response => response.json())
        .then(data => { if (!alive) return; if (data?.submitted) rememberDone(); setDone(!!data?.submitted); })
        .catch(() => { if (alive) setDone(false); });
    }, 0);
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);
  return [done, () => setDone(true)] as const;
}

/** Star rating with an optional comment. One submission per device. */
export function AppFeedbackForm({ onDone, compact = false }: { onDone?: () => void; compact?: boolean }) {
  const { t } = useI18n();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function submit() {
    if (!rating || state !== 'idle') return;
    setState('sending');
    setError('');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, message }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok && !data?.duplicate) throw new Error(data?.error || t('tickets.fbErrSend'));
      rememberDone();
      setState('sent');
      window.setTimeout(() => onDone?.(), 1800);
    } catch (err) {
      setState('idle');
      setError(err instanceof Error ? err.message : t('tickets.fbErrSend'));
    }
  }

  if (state === 'sent') {
    return <p role="status" className="py-2 text-center text-[14px] font-semibold text-primary">{t('tickets.fbThanks')}</p>;
  }

  const shown = hover || rating;
  return (
    <div>
      <p className={`font-semibold text-secondary ${compact ? 'text-[14px]' : 'text-[16px]'}`}>{t('tickets.fbQuestion')}</p>
      <div className="mt-3 flex items-center gap-1" role="radiogroup" aria-label={t('tickets.fbRating')} onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map(star => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={rating === star}
            aria-label={t(star > 1 ? 'tickets.fbStars' : 'tickets.fbStar', { n: star })}
            onClick={() => setRating(star)}
            onMouseEnter={() => setHover(star)}
            className="rounded p-0.5 text-[30px] leading-none transition-transform hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            <span aria-hidden="true" className={star <= shown ? 'text-amber-400' : 'text-gray-300'}>★</span>
          </button>
        ))}
        <span className="ml-2 text-[12px] font-medium text-gray-500">{LABELS[shown] ? t(LABELS[shown]) : ''}</span>
      </div>
      {rating > 0 && (
        <>
          <textarea
            value={message}
            onChange={event => setMessage(event.target.value.slice(0, 500))}
            rows={compact ? 2 : 3}
            placeholder={t('tickets.fbPlaceholder')}
            aria-label={t('tickets.fbComments')}
            className="mt-3 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-[13px] outline-none focus:border-primary/40"
          />
          {error && <p className="mt-2 text-[12px] text-red-600">{error}</p>}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={state === 'sending'}
            className="mt-3 h-10 rounded-lg bg-primary px-5 text-[12px] font-semibold text-white disabled:opacity-60"
          >
            {state === 'sending' ? t('tickets.fbSending') : t('tickets.fbSubmit')}
          </button>
        </>
      )}
    </div>
  );
}

/** The same form in a dialog, for the Feedback buttons in the header and menu. */
export function AppFeedbackDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useDialog(true, onClose, t('tickets.fbDialog'));
  const [done] = useAppFeedbackDone();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div {...dialog} className="relative w-full max-w-sm rounded-2xl bg-white p-6" onClick={event => event.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label={t('tickets.fbClose')} className="absolute right-3 top-2 text-[22px] leading-none text-gray-400 hover:text-gray-600">×</button>
        {done ? (
          <p className="py-2 pr-6 text-[14px] text-gray-600">{t('tickets.fbAlready')}</p>
        ) : done === false ? (
          <AppFeedbackForm onDone={onClose} />
        ) : (
          <p className="py-2 text-[13px] text-gray-500">{t('common.loading')}</p>
        )}
      </div>
    </div>
  );
}
