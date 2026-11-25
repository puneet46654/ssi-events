'use client';

import { useEffect, useRef } from 'react';

/**
 * While `open`, the phone's Back button (or browser Back) closes the sheet/dialog instead of
 * leaving the page, as people expect from a bottom sheet. Closing it any other way removes the
 * extra history entry again, so Back afterwards still leaves the page normally.
 */
export function useBackCloses(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ ...(window.history.state ?? {}), ssiSheet: true }, '');
    let closedByBack = false;
    const onPop = () => { closedByBack = true; closeRef.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (!closedByBack && window.history.state?.ssiSheet) window.history.back();
    };
  }, [open]);
}
