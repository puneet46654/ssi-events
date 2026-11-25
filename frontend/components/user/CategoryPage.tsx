'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { categoryOf, type EventCategoryType } from '@/lib/event-categories';
import { useRealtimeRefresh } from '@/components/realtime/RealtimeProvider';
import { OpenEventCard, UpcomingGrid, type IEvent } from '@/components/user/EventGrid';

/**
 * A category's own page (e.g. /mantram): the events of that kind that are open, soonest first,
 * lead the page; the category's introduction follows as background. Copy comes from
 * lib/event-categories.ts.
 */
export function CategoryPage({ type }: { type: EventCategoryType }) {
  const category = categoryOf(type);
  const page = category.page;
  const [events, setEvents] = useState<IEvent[] | null>(null);
  const [pastEvents, setPastEvents] = useState<IEvent[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/events', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error();
      const ofType = (data.events as IEvent[]).filter((e) => e.eventType === type);
      setEvents(ofType
        .filter((e) => e.status === 'UPCOMING' || e.status === 'LIVE')
        .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))));
      setPastEvents(ofType
        .filter((e) => e.status === 'COMPLETED')
        .sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))));
      setError('');
    } catch {
      setError('Unable to load events. Please retry.');
    }
  }, [type]);

  useEffect(() => {
    if (category.external) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, category.external]);
  useRealtimeRefresh('events', () => { void load(); });

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-5 md:px-8 md:pt-8">
      <Link href="/" className="text-[13px] font-medium text-primary underline-offset-4 hover:underline">All events</Link>
      <h1 className="mt-2 text-[24px] font-semibold leading-tight tracking-[-0.01em] text-secondary md:text-[30px]">
        {page.title}
      </h1>
      <p className="mt-1 text-[14px] text-gray-500">{category.description}</p>

      {category.external ? (
        <section aria-labelledby="category-list" className="mt-6 max-w-[62ch] rounded-[22px] bg-gray-50 p-6 md:mt-8 md:p-8">
          <h2 id="category-list" className="text-[20px] font-semibold text-secondary md:text-[24px]">{page.listHeading}</h2>
          {category.external.externalUrl ? (
            <a href={category.external.externalUrl} target="_blank" rel="noopener"
              className="mt-4 inline-flex h-11 items-center rounded-full bg-primary px-6 text-[14px] font-semibold text-white">
              Go to the conference website
            </a>
          ) : (
            <p className="mt-2 text-[16px] leading-[1.6] text-gray-600">
              <span className="mb-2 block font-semibold text-secondary">Registration link to follow</span>
              {category.external.comingSoon}
            </p>
          )}
        </section>
      ) : (
      <section aria-labelledby="category-list" className="mt-6 md:mt-8">
        <h2 id="category-list" className="text-[20px] font-semibold text-secondary md:text-[24px]">
          {page.listHeading}
          {events && events.length > 0 && <span className="ml-2 text-[15px] font-medium text-gray-400 md:text-[17px]">{events.length}</span>}
        </h2>
        <div className="mt-4">
          {error ? (
            <p role="alert" className="text-[14px] text-gray-600">
              {error}{' '}
              <button type="button" onClick={() => { void load(); }} className="font-medium text-primary underline underline-offset-4">Try again</button>
            </p>
          ) : events === null ? (
            <div aria-busy="true" aria-label="Loading" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1].map((i) => <div key={i} className="h-[320px] animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : events.length ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 md:gap-5">
              {events.map((event, index) => <OpenEventCard key={event._id} event={event} index={index} />)}
            </div>
          ) : (
            <p className="max-w-[56ch] rounded-xl border border-gray-200 bg-white p-5 text-[14px] leading-[1.6] text-gray-600">{page.empty}</p>
          )}
        </div>
      </section>
      )}

      {category.archive && pastEvents.length > 0 && (
        <section aria-labelledby="category-past" className="mt-10 md:mt-14">
          <h2 id="category-past" className="text-[20px] font-semibold text-secondary md:text-[24px]">{category.archive.pastHeading}</h2>
          <div className="mt-4">
            <UpcomingGrid events={pastEvents} completed />
          </div>
        </section>
      )}

      {/* The category explained: below the events, so open events lead the page. */}
      {page.intro.length > 0 && (
        <section aria-labelledby="category-about" className="mt-12 border-t border-gray-200 pt-6 md:mt-14 md:pt-8">
          <h2 id="category-about" className="text-[16px] font-semibold text-secondary md:text-[17px]">About {page.title}</h2>
          <div className="mt-2 max-w-[72ch] space-y-2 text-[13.5px] leading-[1.65] text-gray-600 md:text-[14px]">
            {page.intro.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          </div>

          {page.steps && (
            <div className="mt-6">
              <h3 className="text-[14px] font-semibold text-secondary">{page.steps.heading}</h3>
              <ol className="mt-3 grid gap-2.5 md:grid-cols-3 md:gap-x-8">
                {page.steps.items.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/[0.08] text-[12px] font-semibold text-primary">{index + 1}</span>
                    <span className="pt-0.5 text-[13.5px] leading-[1.55] text-gray-600 md:text-[14px]">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
