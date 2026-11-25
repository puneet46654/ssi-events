export const LOCALES = ['en', 'zh', 'ko', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];

/** One namespace's strings per language. Keys are flat ("bookNow"); `{name}` marks a variable. */
export type Messages = Record<Locale, Record<string, string>>;

/** Native names, shown in the language menu. */
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', zh: '中文', ko: '한국어', ja: '日本語' };

/** BCP 47 tags for dates, times and numbers (Intl). */
export const INTL_LOCALE: Record<Locale, string> = { en: 'en-IN', zh: 'zh-CN', ko: 'ko-KR', ja: 'ja-JP' };

/** `<html lang>` values. */
export const HTML_LANG: Record<Locale, string> = { en: 'en', zh: 'zh-Hans', ko: 'ko', ja: 'ja' };

export const LOCALE_COOKIE = 'ssi_lang';

export const isLocale = (value: unknown): value is Locale => typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
