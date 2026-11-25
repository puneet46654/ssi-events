'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { navigateWithTransition } from './page-transition';

/*
 * Back navigation for the attendee pages. "Back" always means the logical previous step,
 * never "whatever the browser visited before" (which may be WhatsApp or another site):
 *
 *   /events/:id/book/slots  ->  /events/:id/book  ->  /events/:id  ->  /
 *   /events/mytickets       ->  /
 *
 * When that step is the page we actually came from, the browser's own back is used, so the
 * page comes back as it was left (form values, scroll position).
 */

const PREVIOUS_KEY = 'ssievents_nav_previous';
const CURRENT_KEY = 'ssievents_nav_current';

/** The logical previous step of an attendee page. */
export function parentPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, '') || '/';
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/events\/([^/]+)\/book\/slots$/))) return `/events/${m[1]}/book`;
  if ((m = path.match(/^\/events\/([^/]+)\/book(\/.*)?$/))) return `/events/${m[1]}`;
  return '/';
}

/** Records the in-app page we came from; mounted once in the shared header. */
export function useTrackPreviousPath() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      const current = sessionStorage.getItem(CURRENT_KEY);
      if (current !== pathname) {
        if (current) sessionStorage.setItem(PREVIOUS_KEY, current);
        sessionStorage.setItem(CURRENT_KEY, pathname);
      }
    } catch { /* storage unavailable: back falls back to the logical step */ }
  }, [pathname]);
}

/** Goes to the logical previous step (or `target`), reusing browser history when it leads there. */
export function useSmartBack() {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback((target?: string) => {
    const destination = target ?? parentPath(pathname);
    let previous = '';
    try { previous = sessionStorage.getItem(PREVIOUS_KEY) || ''; } catch { /* ignore */ }
    const sameStep = (a: string, b: string) => (a.replace(/\/+$/, '') || '/') === (b.replace(/\/+$/, '') || '/')
      || ((a === '/' || a === '/events') && (b === '/' || b === '/events'));
    if (previous && sameStep(previous, destination) && window.history.length > 1) router.back(); // popstate animates it
    else navigateWithTransition(() => router.push(destination), 'back');
  }, [router, pathname]);
}
