'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { LOCALE_NAMES, LOCALES, useI18n } from '@/lib/i18n';
import { HeaderHint } from './HeaderHint';

/** Globe button with the four languages, each written in its own script. */
export default function LanguageSwitcher({ compact = false, hint = false }: { compact?: boolean; hint?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('common.chooseLanguage')}
        className={compact
          ? 'grid h-11 w-11 shrink-0 place-items-center rounded-full text-secondary transition active:scale-95 active:bg-gray-100'
          : 'relative inline-flex h-11 items-center gap-1.5 rounded-full px-3.5 text-[15px] font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-secondary'}
      >
        <svg className="h-[19px] w-[19px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
        </svg>
        {!compact && <span>{LOCALE_NAMES[locale]}</span>}
      </button>
      <HeaderHint show={hint && !open} label={t('common.tipLanguage')} align="right" />

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label={t('common.language')}
            style={{ transformOrigin: 'top right' }}
            initial={{ opacity: 0, scale: 0.9, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: -4, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 34, mass: 0.8 }}
            className="absolute right-0 top-[calc(100%+6px)] z-[80] w-44 overflow-hidden rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg"
          >
            {LOCALES.map((code) => (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={code === locale}
                lang={code === 'zh' ? 'zh-Hans' : code}
                onClick={() => { setLocale(code); setOpen(false); }}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-[15px] transition-colors ${
                  code === locale ? 'bg-primary/[0.08] font-semibold text-primary' : 'text-secondary hover:bg-gray-50'
                }`}
              >
                {LOCALE_NAMES[code]}
                {code === locale && (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.6} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                  </svg>
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
