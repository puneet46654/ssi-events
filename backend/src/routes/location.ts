import { error, json } from '../http.js';
import type { Handler } from '../router.js';

// Country codes, flags and states almost never change: browsers keep them an hour, CloudFront a day.
const CACHE = { 'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' };
const SOURCE = 'https://countriesnow.space/api/v0.1/countries';

function isoToFlag(iso2: string): string {
  return iso2.length === 2 ? [...iso2.toUpperCase()].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join('') : '🌐';
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/** GET /api/location/countries — `{ name, iso2, callingCode, flag }`, alphabetical. */
export const countries: Handler = async () => {
  try {
    const codes = await fetchJson(`${SOURCE}/codes`);
    const list = (Array.isArray(codes?.data) ? codes.data : [])
      .map((c: { name?: string; code?: string; dial_code?: string }) => ({
        name: c.name?.trim() || '', iso2: c.code?.trim().toUpperCase() || '', callingCode: c.dial_code?.trim() || '',
      }))
      .filter((c: { name: string; iso2: string; callingCode: string }) => c.name && c.iso2 && c.callingCode)
      .map((c: { name: string; iso2: string; callingCode: string }) => ({ ...c, flag: isoToFlag(c.iso2) }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    return json(200, { success: true, countries: list }, CACHE);
  } catch (err) {
    console.error('Country list unavailable', err);
    return error(502, 'The country list is temporarily unavailable. Please retry.');
  }
};

/** GET /api/location/states?country=<name> — `{ name, code }`, alphabetical. */
export const states: Handler = async (req) => {
  const country = (req.query.country || '').trim();
  if (!country || country.length > 100) return error(400, 'Country is required.');
  try {
    const data = await fetchJson(`${SOURCE}/states`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ country }),
    });
    const list = (Array.isArray(data?.data?.states) ? data.data.states : [])
      .filter((s: { name?: string }) => s.name)
      .map((s: { name: string; state_code?: string }) => ({ name: s.name.trim(), code: s.state_code || '' }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
    return json(200, { success: true, states: list }, CACHE);
  } catch (err) {
    console.error('State list unavailable', err);
    return error(502, 'The state list is temporarily unavailable. Please retry.');
  }
};
