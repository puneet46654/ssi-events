'use client';

/*
 * iOS-style page transitions using the browser's View Transitions API.
 * Forward: the new page slides in from the right while the old one drifts left and dims.
 * Back: the reverse. Header and tab bar keep their own names, so they stay put.
 * Browsers without the API (or "Reduce motion") navigate instantly, as before.
 */

type Direction = 'forward' | 'back';
let finishPending: (() => void) | null = null;

const supported = () =>
  typeof document !== 'undefined'
  && 'startViewTransition' in document
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Called by the frame when the new page has rendered: lets the transition animate to it. */
export function pageRendered() {
  const done = finishPending;
  finishPending = null;
  done?.();
}

/** Runs a navigation inside a view transition. */
export function navigateWithTransition(navigate: () => void, direction: Direction = 'forward') {
  if (!supported()) { navigate(); return; }
  document.documentElement.dataset.navDir = direction;
  finishPending?.();
  (document as Document & { startViewTransition: (cb: () => Promise<void>) => unknown }).startViewTransition(() => new Promise<void>((resolve) => {
    finishPending = resolve;
    navigate();
    // Never hold the screen frozen if the page takes long or the path doesn't change.
    window.setTimeout(() => { if (finishPending === resolve) pageRendered(); }, 900);
  }));
}

/** Same-origin link clicks become transitioned navigations (capture phase, before next/link). */
export function installLinkTransitions(push: (href: string) => void): () => void {
  const onClick = (event: MouseEvent) => {
    if (!supported() || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!link || link.target || link.hasAttribute('download') || link.dataset.noTransition !== undefined) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.search === window.location.search) return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;
    event.preventDefault();
    const goingUp = url.pathname.length < window.location.pathname.length && window.location.pathname.startsWith(url.pathname);
    navigateWithTransition(() => push(url.pathname + url.search + url.hash), goingUp || url.pathname === '/' ? 'back' : 'forward');
  };
  // The phone/browser Back (and Forward) buttons. The Navigation API announces them before the
  // page changes, so the old page can still be captured; the router then renders the new one.
  type NavEvent = Event & { navigationType?: string; destination?: { url: string } };
  const navigation = (window as Window & { navigation?: EventTarget }).navigation;
  const onTraverse = (event: Event) => {
    const e = event as NavEvent;
    if (!supported() || e.navigationType !== 'traverse' || !e.destination) return;
    const to = new URL(e.destination.url);
    if (to.origin !== window.location.origin || to.pathname === window.location.pathname) return; // e.g. closing a sheet
    if (to.pathname.startsWith('/admin')) return;
    const goingUp = to.pathname.length < window.location.pathname.length || to.pathname === '/';
    navigateWithTransition(() => { /* the router renders the history entry */ }, goingUp ? 'back' : 'forward');
  };
  document.addEventListener('click', onClick, true);
  navigation?.addEventListener('navigate', onTraverse);
  return () => { document.removeEventListener('click', onClick, true); navigation?.removeEventListener('navigate', onTraverse); };
}
