/** Keep every digit, including the international dialing code. Never match on suffixes. */
export function normalizePhone(value: unknown): string {
  if (typeof value !== 'string' || !/^\+?[\d\s()-]+$/.test(value.trim())) return '';
  return value.replace(/\D/g, '');
}

/** Full international number as digits: `+44 20…` as typed, or calling code + local number. */
export function phoneIdentity(mobile: unknown, callingCode: unknown = ''): string {
  const number = normalizePhone(mobile);
  if (!number) return '';
  if (typeof mobile === 'string' && mobile.trim().startsWith('+')) return number;
  const prefix = callingCode ? normalizePhone(callingCode) : '';
  if (callingCode && !prefix) return '';
  return prefix + number;
}

export function isValidPhone(mobile: unknown, callingCode: unknown = ''): boolean {
  return /^[1-9]\d{6,14}$/.test(phoneIdentity(mobile, callingCode));
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isValidEmail(value: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizeEmail(value));
}
