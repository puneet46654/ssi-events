/** First-party analytics helpers: anonymous page views and API timings, no personal data. */

const ID_IN_PATH = /[0-9A-HJKMNP-TV-Z]{26}/g; // event IDs are ULIDs

export const ANALYTICS_TTL_SECONDS = 90 * 24 * 60 * 60;
export const PRESENCE_TTL_SECONDS = 120;
/** A tab that has not reported for this long counts as closed (the browser reports every 20 s). */
export const ONLINE_WINDOW_MS = 45_000;

/** Groups paths by shape (/events/01JA…/book → /events/:id/book). The home page is "/", also served as /events. */
export function normalizePath(path: string): string {
  const clean = (path.split('?')[0] || '/').replace(ID_IN_PATH, ':id').slice(0, 200) || '/';
  return clean === '/events' ? '/' : clean;
}

/** The event a public page or API call belongs to, if any. */
export function eventIdFromPath(path: string): string | undefined {
  return /\/events\/([0-9A-HJKMNP-TV-Z]{26})(?:\/|$|\?)/.exec(path)?.[1];
}

export function isBot(userAgent: string): boolean {
  return /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|uptime|monitor/i.test(userAgent);
}

export function describeAgent(userAgent: string) {
  const ua = userAgent || '';
  const device = /ipad|tablet/i.test(ua) ? 'Tablet' : /mobi|android|iphone/i.test(ua) ? 'Mobile' : 'Desktop';
  const browser = /edg\//i.test(ua) ? 'Edge'
    : /opr\/|opera/i.test(ua) ? 'Opera'
    : /samsungbrowser/i.test(ua) ? 'Samsung Internet'
    : /chrome|crios/i.test(ua) ? 'Chrome'
    : /firefox|fxios/i.test(ua) ? 'Firefox'
    : /safari/i.test(ua) ? 'Safari' : 'Other';
  const os = /windows/i.test(ua) ? 'Windows'
    : /android/i.test(ua) ? 'Android'
    : /iphone|ipad|ios/i.test(ua) ? 'iOS'
    : /mac os/i.test(ua) ? 'macOS'
    : /linux/i.test(ua) ? 'Linux' : 'Other';
  return { device, browser, os };
}

/** Host of an external referrer; visits from within the site are not referrals. */
export function referrerHost(referrer: unknown, ownHost: string): string | undefined {
  if (typeof referrer !== 'string' || !referrer) return undefined;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, '');
    return host && host !== ownHost.replace(/^www\./, '') ? host : undefined;
  } catch {
    return undefined;
  }
}

const PAGE_NAMES: Record<string, string> = {
  '/': 'Events list',
  '/events/mytickets': 'My Tickets',
  '/smrsc': 'SMRSC page',
  '/mantram': 'MantraM page',
  '/cme': 'CME and workshops page',
};

/** A readable name for a normalized path, using the event's name where there is one. */
export function pageLabel(path: string, eventName = 'Event'): string {
  if (PAGE_NAMES[path]) return PAGE_NAMES[path]!;
  if (path === '/events/:id') return eventName;
  if (path === '/events/:id/book') return `${eventName} · registration form`;
  if (path === '/events/:id/book/slots') return `${eventName} · choosing a slot`;
  if (path === '/events/:id/book/confirm') return `${eventName} · confirming`;
  return path;
}
