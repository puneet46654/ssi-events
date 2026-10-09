'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { categoryOf, type EventCategoryType } from '@/lib/event-categories';
import { useRealtimeRefresh } from '@/components/realtime/RealtimeProvider';
import { UpcomingGrid, type IEvent } from '@/components/user/EventGrid';

/**
 * A category's own page (e.g. /mantram): its introduction and the events of that kind that are
 * open for registration, soonest first. Copy comes from lib/event-categories.ts.
 */
export function CategoryPage({ type }: { type: EventCategoryType }) {
  const category = categoryOf(type);
  const page = category.page;
  const [events, setEvents] = useState<IEvent[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/events', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error();
      setEvents((data.events as IEvent[])
        .filter((e) => e.eventType === type && (e.status === 'UPCOMING' || e.status === 'LIVE'))
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))));
      setError('');
    } catch {
      setError('We could not load the visits just now. Please try again.');
    }
  }, [type]);

  useEffect(() => {
    if (category.external) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, category.external]);
  useRealtimeRefresh('events', () => { void load(); });

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-8 md:px-8 md:pt-14">
      <Link href="/" className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">All events</Link>
      <h1 className="mt-4 text-[32px] font-semibold leading-tight tracking-[-0.01em] text-secondary md:text-[44px]">
        {page.title}
      </h1>
      <div className="mt-4 max-w-[62ch] space-y-3 text-[16px] leading-[1.6] text-gray-600 md:text-[18px]">
        {page.intro.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>

      {category.external ? (
        <section aria-labelledby="category-list" className="mt-10 max-w-[62ch] rounded-[22px] bg-gray-50 p-6 md:mt-14 md:p-8">
          <h2 id="category-list" className="text-[20px] font-semibold text-secondary md:text-[24px]">{page.listHeading}</h2>
          {category.external.externalUrl ? (
            <a href={category.external.externalUrl} target="_blank" rel="noopener"
              className="mt-4 inline-flex h-11 items-center rounded-full bg-primary px-6 text-[14px] font-semibold text-white">
              Go to the conference website
            </a>
          ) : (
            <p className="mt-2 text-[16px] leading-[1.6] text-gray-600">
              <span className="mb-2 block font-semibold text-secondary">Coming soon</span>
              {category.external.comingSoon}
            </p>
          )}
        </section>
      ) : (
      <section aria-labelledby="category-list" className="mt-10 md:mt-14">
        <h2 id="category-list" className="text-[20px] font-semibold text-secondary md:text-[24px]">{page.listHeading}</h2>
        <div className="mt-4">
          {error ? (
            <p role="alert" className="text-[14px] text-gray-600">
              {error}{' '}
              <button type="button" onClick={() => { void load(); }} className="font-medium text-primary underline underline-offset-4">Try again</button>
            </p>
          ) : events === null ? (
            <div aria-busy="true" aria-label="Loading" className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 md:gap-3">
              {[0, 1].map((i) => <div key={i} className="h-[108px] animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : events.length ? (
            <UpcomingGrid events={events} />
          ) : (
            <p className="max-w-[56ch] rounded-xl border border-gray-200 bg-white p-5 text-[14px] leading-[1.6] text-gray-600">{page.empty}</p>
          )}
        </div>
      </section>
      )}
    </main>
  );
}
