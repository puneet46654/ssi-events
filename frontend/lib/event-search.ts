'use client';

import { useSyncExternalStore } from 'react';

/*
 * The catalogue search lives in the site header and is kept in the URL (`/?q=`), so the header
 * and the home page share it without a provider, and a search can be linked or reloaded.
 */

const EVENT = 'ssi:event-search';

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('popstate', onChange);
  };
}

const read = () => new URLSearchParams(window.location.search).get('q') ?? '';

/** The current search text (empty on the server). */
export function useEventSearch(): string {
  return useSyncExternalStore(subscribe, read, () => '');
}

/** Replaces the search in the current URL without adding a history entry. */
export function setEventSearch(value: string) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set('q', value);
  else url.searchParams.delete('q');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  refreshEventSearch();
}

/** Re-reads the URL, e.g. after a client-side navigation that changed `?q=`. */
export function refreshEventSearch() {
  window.dispatchEvent(new Event(EVENT));
}

/** Home page link carrying a search. */
export const searchHref = (value: string) => (value.trim() ? `/?q=${encodeURIComponent(value.trim())}` : '/');
