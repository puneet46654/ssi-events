'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const SHOW_MS = 2500;

/**
 * On arriving at the home page, point out the language button, then the feedback button (2.5 s each),
 * every time the home page is opened. Any tap dismisses it early.
 */
export type HintStep = 'language' | 'feedback' | null;

/** One at a time, never overlapping: language for 2.5 s, then feedback for 2.5 s. */
export function useHeaderHints(): HintStep {
  const pathname = usePathname();
  const [step, setStep] = useState<HintStep>(null);
  useEffect(() => {
    if (pathname !== '/' && pathname !== '/events') return;
    const timers = [
      window.setTimeout(() => setStep('language'), 600), // after the page has settled
      window.setTimeout(() => setStep(null), 600 + SHOW_MS), // a short gap so the first bubble leaves before the next arrives
      window.setTimeout(() => setStep('feedback'), 600 + SHOW_MS + 250),
      window.setTimeout(() => setStep(null), 600 + SHOW_MS * 2 + 250),
    ];
    const dismiss = () => setStep(null);
    window.addEventListener('pointerdown', dismiss, { once: true });
    return () => { timers.forEach((id) => window.clearTimeout(id)); window.removeEventListener('pointerdown', dismiss); };
  }, [pathname]);
  return step;
}

/** A small speech bubble under its button, with a soft pulse ring around the button. */
export function HeaderHint({ show, label, align = 'center', delay = 0 }: { show: boolean; label: string; align?: 'center' | 'right'; delay?: number }) {
  return (
    <AnimatePresence>
      {show && (
        <>
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-primary/50"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0, 1, 0], scale: [0.8, 1.25, 1.45] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, repeat: 1, delay, ease: 'easeOut' }}
          />
          <motion.span
            role="status"
            className={`pointer-events-none absolute top-[calc(100%+10px)] z-[90] whitespace-nowrap rounded-2xl bg-secondary px-3 py-2 text-[12.5px] font-semibold text-white shadow-[0_10px_28px_-8px_rgba(15,23,41,0.5)] ${
              align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2'
            }`}
            style={{ transformOrigin: align === 'right' ? 'top right' : 'top center' }}
            initial={{ opacity: 0, y: -6, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.94, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 460, damping: 26, delay }}
          >
            <span
              aria-hidden="true"
              className={`absolute -top-1.5 h-3 w-3 rotate-45 rounded-[2px] bg-secondary ${align === 'right' ? 'right-4' : 'left-1/2 -translate-x-1/2'}`}
            />
            <span className="relative">{label}</span>
          </motion.span>
        </>
      )}
    </AnimatePresence>
  );
}
