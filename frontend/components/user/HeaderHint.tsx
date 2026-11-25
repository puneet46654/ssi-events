'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const SHOW_MS = 2500;

/**
 * Every time the home page or My tickets is opened, point out the feedback button for 2.5 s.
 * Any tap dismisses it early.
 */
export function useFeedbackHint(): boolean {
  const pathname = usePathname();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!['/', '/events', '/events/mytickets'].includes(pathname)) return;
    const timers = [
      window.setTimeout(() => setShow(true), 600), // after the page has settled
      window.setTimeout(() => setShow(false), 600 + SHOW_MS),
    ];
    const dismiss = () => setShow(false);
    window.addEventListener('pointerdown', dismiss, { once: true });
    return () => { timers.forEach((id) => window.clearTimeout(id)); window.removeEventListener('pointerdown', dismiss); };
  }, [pathname]);
  return show;
}

/** A small speech bubble under its button (right-anchored, so it never leaves the screen), with a pulse ring. */
export function HeaderHint({ show, label }: { show: boolean; label: string }) {
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
            transition={{ duration: 1.2, repeat: 1, ease: 'easeOut' }}
          />
          <motion.span
            role="status"
            className="pointer-events-none absolute right-0 top-[calc(100%+10px)] z-[90] whitespace-nowrap rounded-2xl bg-secondary px-3 py-2 text-[12.5px] font-semibold text-white shadow-[0_10px_28px_-8px_rgba(15,23,41,0.5)]"
            style={{ transformOrigin: 'top right' }}
            initial={{ opacity: 0, y: -6, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.94, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 460, damping: 26 }}
          >
            <span aria-hidden="true" className="absolute -top-1.5 right-4 h-3 w-3 rotate-45 rounded-[2px] bg-secondary" />
            <span className="relative">{label}</span>
          </motion.span>
        </>
      )}
    </AnimatePresence>
  );
}
