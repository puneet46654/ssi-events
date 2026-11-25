'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { installLinkTransitions, pageRendered } from '@/lib/page-transition';
import { UserBottomNav, UserFooter, UserHeader } from './UserChrome';

/** Event page, details and time slots: one task at a time, so no tab bar; each page has its own action bar. */
export const isBookingFlow = (pathname: string) => /^\/events\/(?!mytickets(?:\/|$))[^/]+(\/book(\/slots)?)?\/?$/.test(pathname);

export default function UserFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const flow = isBookingFlow(pathname);
  useEffect(() => installLinkTransitions((href) => router.push(href)), [router]);
  // The new page is on screen: let the slide animate to it.
  useEffect(() => { pageRendered(); }, [pathname]);
  return (
    // On phones, a page's full-screen height must exclude the shared header and nav, or every page scrolls a little.
    <div
      className={`${flow ? '[--user-nav-h:0px]' : '[--user-nav-h:calc(70px+env(safe-area-inset-bottom))]'} max-md:[&>main]:min-h-[calc(100dvh-53px-env(safe-area-inset-top)-var(--user-nav-h))]`}
    >
      <UserHeader />
      {children}
      <UserFooter />
      {/* Booking flow pages: keep the footer clear of the page's fixed action bar on phones */}
      {flow && <div aria-hidden="true" className="h-[84px] md:hidden" />}
      {!flow && (
        <>
          {/* Keeps page content clear of the fixed bottom nav on mobile */}
          <div aria-hidden="true" className="h-[var(--user-nav-h)] md:hidden" />
          <UserBottomNav />
        </>
      )}
    </div>
  );
}
