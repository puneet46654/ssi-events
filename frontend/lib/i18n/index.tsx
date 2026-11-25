'use client';

/*
 * Attendee-side translations: English, Simplified Chinese, Korean, Japanese.
 *
 *   const { t, intl } = useI18n();
 *   t('slots.confirmBooking')          -> "Confirm booking" in the chosen language
 *   t('tickets.statusWaitlistN', { n: 2 }) -> "Waitlist #2"
 *   new Intl.DateTimeFormat(intl, ...) -> dates in the chosen language
 *
 * Admin pages always render English: the provider forces "en" under /admin, and admin code
 * doesn't call t(). Event names and descriptions are shown as the admin typed them.
 */

import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import common from './messages/common';
import details from './messages/details';
import event from './messages/event';
import home from './messages/home';
import slots from './messages/slots';
import tickets from './messages/tickets';
import { HTML_LANG, INTL_LOCALE, isLocale, LOCALE_COOKIE, type Locale, type Messages } from './types';

export * from './types';

const NAMESPACES: Record<string, Messages> = { common, home, event, details, slots, tickets };
const STORAGE_KEY = 'ssi-lang';

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** "ns.key" in the locale, falling back to English, then to the key itself. */
function lookup(locale: Locale, key: string): string {
  const dot = key.indexOf('.');
  const ns = NAMESPACES[key.slice(0, dot)];
  const name = key.slice(dot + 1);
  return ns?.[locale]?.[name] ?? ns?.en?.[name] ?? key;
}

export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const text = lookup(locale, key);
  return vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;
}

type I18n = { locale: Locale; setLocale: (locale: Locale) => void; t: Translate; intl: string };

const english: I18n = {
  locale: 'en',
  setLocale: () => {},
  t: (key, vars) => translate('en', key, vars),
  intl: INTL_LOCALE.en,
};

const I18nContext = createContext<I18n>(english);

/** Works without a provider too (English), so shared components are safe anywhere. */
export const useI18n = () => useContext(I18nContext);

/** Saved choice, else the device language if it is one we offer, else English. */
function preferredLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch { /* storage unavailable */ }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

export function I18nProvider({ initialLocale, children }: { initialLocale?: Locale; children: ReactNode }) {
  const pathname = usePathname();
  const [chosen, setChosen] = useState<Locale>(initialLocale ?? 'en');

  // Without a saved cookie, adopt the saved/device language once the page is in the browser.
  useEffect(() => {
    if (initialLocale) return;
    const timer = window.setTimeout(() => setChosen(preferredLocale()), 0);
    return () => window.clearTimeout(timer);
  }, [initialLocale]);

  const locale: Locale = pathname.startsWith('/admin') ? 'en' : chosen;

  useEffect(() => { document.documentElement.lang = HTML_LANG[locale]; }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setChosen(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, []);

  const value = useMemo<I18n>(() => ({
    locale,
    setLocale,
    t: (key, vars) => translate(locale, key, vars),
    intl: INTL_LOCALE[locale],
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
