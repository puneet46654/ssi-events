'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppFeedbackDialog } from '@/components/user/AppFeedback';
import { refreshEventSearch, searchHref, setEventSearch, useEventSearch } from '@/lib/event-search';

/*
 * One header and (on phones) bottom nav for every user-side page,
 * so the frame never changes while moving through the booking flow.
 * Pages render only their own content below the header.
 */

// The event catalogue is the home page (`/`); `/events` permanently redirects there, but the page is
// prerendered under /events (the rewrite target), so both count as home when rendering.
const HOME_PAGES = ['/', '/events'];
const ROOT_PAGES = [...HOME_PAGES, '/events/mytickets'];

// Desktop navigation: medium-weight links; the active page carries the insignia-gradient underline.
const NAV = 'relative inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-medium transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30';
const NAV_IDLE = 'text-gray-600 hover:bg-gray-50 hover:text-secondary';
const NAV_ACTIVE = 'text-secondary after:absolute after:inset-x-4 after:-bottom-[13px] after:h-[2px] after:rounded-full after:bg-[image:var(--ssi-gradient-90)]';
const ROUND = 'grid shrink-0 place-items-center rounded-full text-secondary transition active:scale-95';

function useChrome() {
  const pathname = usePathname();
  const router = useRouter();
  const onTickets = pathname.startsWith('/events/mytickets');
  return {
    onTickets,
    onEvents: !onTickets,
    showBack: !ROOT_PAGES.includes(pathname),
    isEventDetails: /^\/events\/[^/]+$/.test(pathname) && !ROOT_PAGES.includes(pathname),
    goBack() {
      if (window.history.length > 1) router.back();
      else router.push('/');
    },
  };
}

function useShare() {
  const [shared, setShared] = useState(false);
  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: document.title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } catch {
      // User cancelled the share sheet.
    }
  }
  return { shared, share };
}

/**
 * Event search in the header. On the home page it filters the list as you type; elsewhere,
 * Enter opens the home page with the search applied.
 */
function HeaderSearch({ className = '', autoFocus = false, onSubmitted }: { className?: string; autoFocus?: boolean; onSubmitted?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const onHome = HOME_PAGES.includes(pathname);
  const query = useEventSearch();
  const [draft, setDraft] = useState('');
  const value = onHome ? query : draft;
  // The header outlives page changes: read the search again once a navigation has updated the URL.
  useEffect(refreshEventSearch, [pathname]);
  return (
    <form
      role="search"
      className={`relative ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!onHome) router.push(searchHref(draft));
        (document.activeElement as HTMLElement | null)?.blur();
        onSubmitted?.();
      }}
    >
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"><SearchIcon /></span>
      <input
        type="search"
        aria-label="Search events"
        placeholder="Search events, venue or type"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => (onHome ? setEventSearch(e.target.value) : setDraft(e.target.value))}
        className="h-10 w-full rounded-full border border-gray-200 bg-gray-50 pl-10 pr-4 text-[14px] text-secondary outline-none transition-colors placeholder:text-gray-400 hover:border-gray-300 focus:border-primary/40 focus:bg-white focus:ring-2 focus:ring-primary/10"
      />
    </form>
  );
}

export function UserHeader() {
  const chrome = useChrome();
  const { shared, share } = useShare();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const shareLabel = shared ? 'Link copied' : 'Share this event';

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl md:pt-0">
        {/* Phones */}
        <div className="mx-auto flex h-14 max-w-[560px] items-center gap-2 px-4 md:hidden">
          {chrome.showBack && (
            <button type="button" onClick={chrome.goBack} aria-label="Go back" className={`-ml-2 h-11 w-11 active:bg-gray-100 ${ROUND}`}>
              <BackIcon />
            </button>
          )}
          <Brand compact />
          <div className="ml-auto flex items-center gap-1">
            <button type="button" onClick={() => setSearchOpen((open) => !open)} aria-label="Search events" aria-expanded={searchOpen}
              className={`h-11 w-11 active:bg-gray-100 ${ROUND} ${searchOpen ? 'bg-gray-100' : ''}`}>
              <SearchIcon />
            </button>
            {chrome.isEventDetails && (
              <button type="button" onClick={() => void share()} aria-label={shareLabel} className={`h-11 w-11 active:bg-gray-100 ${ROUND}`}>
                <ShareIcon done={shared} />
              </button>
            )}
            <button type="button" onClick={() => setFeedbackOpen(true)} aria-label="Feedback" className={`-mr-2 h-11 w-11 active:bg-gray-100 ${ROUND}`}>
              <FeedbackIcon />
            </button>
          </div>
        </div>

        {searchOpen && (
          <div className="mx-auto max-w-[560px] px-4 pb-3 md:hidden">
            <HeaderSearch autoFocus onSubmitted={() => setSearchOpen(false)} />
          </div>
        )}

        {/* Tablets and desktops */}
        <div className="mx-auto hidden h-[72px] w-full max-w-[1200px] items-center justify-between gap-6 px-6 md:flex">
          <div className="flex items-center gap-3">
            {chrome.showBack && (
              <button type="button" onClick={chrome.goBack} aria-label="Go back"
                className={`group h-11 w-11 bg-gray-50 hover:bg-gray-100 ${ROUND}`}>
                <BackIcon />
              </button>
            )}
            <Brand />
          </div>
          <HeaderSearch className="min-w-0 max-w-[380px] flex-1" />
          <nav aria-label="Main" className="flex items-center gap-1">
            {chrome.isEventDetails && (
              <button type="button" onClick={() => void share()} className={`${NAV} ${NAV_IDLE}`}>
                <ShareIcon done={shared} />
                {shared ? 'Link copied' : 'Share'}
              </button>
            )}
            <Link href="/" aria-current={chrome.onEvents ? 'page' : undefined} className={`${NAV} ${chrome.onEvents ? NAV_ACTIVE : NAV_IDLE}`}>
              Events
            </Link>
            <Link href="/events/mytickets" aria-current={chrome.onTickets ? 'page' : undefined} className={`${NAV} ${chrome.onTickets ? NAV_ACTIVE : NAV_IDLE}`}>
              My tickets
            </Link>
            <button type="button" onClick={() => setFeedbackOpen(true)} className={`${NAV} ${NAV_IDLE}`}>
              Feedback
            </button>
          </nav>
        </div>
      </header>
      {feedbackOpen && <AppFeedbackDialog onClose={() => setFeedbackOpen(false)} />}
    </>
  );
}

// Explicit colour: the global link style would otherwise turn these blue on the dark band.
const FOOTER_LINK = 'text-[#B8C0CF] transition-colors hover:text-white';
const FOOTER_LINKS: { heading: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  { heading: 'Events', links: [
    { label: 'All events', href: '/' },
    { label: 'SMRSC', href: '/smrsc' },
    { label: 'SSi MantraM', href: '/mantram' },
    { label: 'CME and workshops', href: '/cme' },
    { label: 'Conferences', href: '/conferences' },
  ] },
  { heading: 'Attendees', links: [
    { label: 'My tickets', href: '/events/mytickets' },
    { label: 'Event terms', href: '/terms' },
    { label: 'Privacy notice', href: '/privacy' },
  ] },
  { heading: 'SS Innovations', links: [
    { label: 'ssinnovations.com', href: 'https://ssinnovations.com', external: true },
  ] },
];

/**
 * Every page closes on the dark band, as on the SS Innovations website: site map, the
 * regulatory notice (draft pending regulatory review) and the copyright line.
 */
export function UserFooter() {
  const pathname = usePathname();
  // The booking form and time-slot pages end at their action bar: no dark footer to scroll into.
  if (/^\/events\/[^/]+\/book(\/slots)?\/?$/.test(pathname)) return null;
  return (
    <footer className="relative mt-16 bg-[#0B1120] text-[#B8C0CF] before:absolute before:inset-x-0 before:top-0 before:h-[2px] before:bg-[image:var(--ssi-gradient-90)]">
      <div className="mx-auto max-w-[1200px] px-5 pb-8 pt-10 md:px-6 md:pt-12">
        <div className="grid gap-8 md:grid-cols-[1.3fr_1fr_1fr_1fr]">
          <div className="flex items-center gap-3 self-start">
            <Image src="/logos/ssii-logo-white.png" alt="SS Innovations" width={520} height={227} className="h-8 w-auto" />
            <span className="h-6 w-px bg-white/20" aria-hidden="true" />
            <span className="text-[17px] font-medium tracking-[-0.01em] text-white">Events</span>
          </div>
          {FOOTER_LINKS.map((group) => (
            <nav key={group.heading} aria-label={group.heading}>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-white">{group.heading}</h2>
              <ul className="mt-3 space-y-2 text-[14px]">
                {group.links.map((link) => (
                  <li key={link.href}>
                    {link.external
                      ? <a href={link.href} className={FOOTER_LINK}>{link.label}</a>
                      : <Link href={link.href} className={FOOTER_LINK}>{link.label}</Link>}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-10 border-t border-white/10 pt-6 text-[12.5px] leading-[1.6] text-[#8C95A8]">
          <p className="max-w-[90ch]">
            Information on this site is intended for healthcare professionals. SSi Mantra and SSi MantraM are not available in all countries; availability and approved uses depend on local regulatory approval.
          </p>
          <p className="mt-3">© {new Date().getFullYear()} SS Innovations · Developed by SSI Maya</p>
        </div>
      </div>
    </footer>
  );
}

export function UserBottomNav() {
  const { onTickets } = useChrome();

  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 grid h-[var(--user-nav-h)] grid-cols-2 border-t border-gray-200 bg-white/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
      <NavItem href="/" label="Events" active={!onTickets}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 10.5 12 3l9 7.5M5 9.5V20h5v-6h4v6h5V9.5" />
      </NavItem>
      <NavItem href="/events/mytickets" label="My tickets" active={onTickets}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V7Zm10-2v12" />
      </NavItem>
    </nav>
  );
}

/** The SSii logo followed by the product name, separated by a hairline. */
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" aria-label="SS Innovations Events, home" className="inline-flex min-w-0 items-center gap-2.5 rounded-lg transition-opacity hover:opacity-80">
      <Image src="/logos/ssii-logo.png" alt="SS Innovations" width={520} height={227} priority
        className={`w-auto shrink-0 ${compact ? 'h-7' : 'h-8'}`} />
      <span className={`w-px shrink-0 bg-gray-200 ${compact ? 'h-5' : 'h-6'}`} aria-hidden="true" />
      <span className={`font-medium tracking-[-0.012em] text-secondary ${compact ? 'text-[17px]' : 'text-[19px]'}`}>Events</span>
    </Link>
  );
}

function NavItem({
  href,
  label,
  active,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`relative flex flex-col items-center justify-center gap-1 text-[12px] font-medium transition-colors active:bg-gray-50 ${
        active ? 'text-primary before:absolute before:top-0 before:h-[2px] before:w-10 before:rounded-full before:bg-[image:var(--ssi-gradient-90)]' : 'text-gray-500'
      }`}
    >
      <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
        {children}
      </svg>
      {label}
    </Link>
  );
}

function BackIcon() {
  return (
    <svg className="h-[18px] w-[18px] transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ShareIcon({ done }: { done: boolean }) {
  return done ? (
    <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
    </svg>
  ) : (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0-12 4 4m-4-4L8 7M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path strokeLinecap="round" d="m16 16 4 4" />
    </svg>
  );
}

function FeedbackIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 3v-3H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      <path strokeLinecap="round" d="M8 9h8M8 13h5" />
    </svg>
  );
}
