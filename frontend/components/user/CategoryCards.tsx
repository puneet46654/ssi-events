'use client';

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from '@phosphor-icons/react';
import { EVENT_CATEGORIES } from '@/lib/event-categories';

type Props = {
  /** Every published event (already excludes cancelled ones). */
  events: { eventType: string; status: string }[];
  loading?: boolean;
};

/**
 * The kinds of SS Innovations event, each opening its own page (/smrsc, /mantram, /cme, /conferences).
 * A category registered elsewhere links straight to that site once its address is known.
 */
export function CategoryCards({ events, loading = false }: Props) {
  return (
    <section aria-label="Event categories" className="mb-8 md:mb-12">
      <ul className="grid gap-3 sm:grid-cols-2 md:gap-4 xl:grid-cols-4">
        {EVENT_CATEGORIES.map((category, index) => {
          const open = events.filter((e) => e.eventType === category.type && (e.status === 'UPCOMING' || e.status === 'LIVE')).length;
          const past = events.filter((e) => e.eventType === category.type && e.status === 'COMPLETED').length;
          const externalUrl = category.external?.externalUrl;
          const status = category.external
            ? (externalUrl ? 'Register on the conference website' : 'Registration link to follow')
            : category.archive
              ? open > 0 ? (open === 1 ? '1 upcoming conference' : `${open} upcoming conferences`)
                : past > 0 ? 'Past conferences' : 'No upcoming conferences'
              : open > 0 ? (open === 1 ? '1 event open for registration' : `${open} events open for registration`) : 'No events open';
          const active = category.external ? Boolean(externalUrl) : open > 0 || (Boolean(category.archive) && past > 0);
          const body = (
            <>
              <span className="relative block aspect-[16/9] overflow-hidden rounded-[16px] bg-gray-100 md:rounded-[20px]">
                <Image
                  src={category.image}
                  alt={category.imageAlt}
                  fill
                  unoptimized // already sized and compressed WebP; the optimiser only serves /logos
                  sizes="(min-width: 768px) 33vw, 100vw"
                  priority={index === 0}
                  className="object-cover transition-transform duration-500 ease-[var(--ease-ssi)] group-hover:scale-[1.02]"
                />
              </span>
              <span className="block px-1 pb-1 pt-4 md:px-2 md:pt-5">
                <span className="block text-[19px] font-semibold leading-tight tracking-[-0.02em] text-secondary md:text-[24px]">
                  {category.name}
                </span>
                <span className="mt-1 block text-[14px] leading-snug text-gray-500 md:mt-2 md:text-[15px]">
                  {category.description}
                </span>
                <span className="mt-3 flex items-center gap-1.5 text-[14px] font-medium md:mt-4 md:text-[15px]">
                  {loading && !category.external ? (
                    <span className="h-4 w-28 animate-pulse rounded-full bg-gray-200" aria-label="Loading" />
                  ) : (
                    <span className={`inline-flex items-center gap-1.5 ${active ? 'text-primary' : 'text-gray-400'}`}>
                      {status}
                      <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
                    </span>
                  )}
                </span>
              </span>
            </>
          );
          const className = 'group block h-full rounded-[22px] bg-gray-50 p-2.5 transition-[background-color,box-shadow] duration-300 ease-[var(--ease-ssi)] hover:bg-gray-100 active:scale-[0.995] md:rounded-[28px] md:p-3';
          return (
            <li key={category.type} className="ssi-rise" style={{ animationDelay: `${index * 70}ms` }}>
              {externalUrl
                ? <a href={externalUrl} target="_blank" rel="noopener" className={className}>{body}</a>
                : <Link href={category.page.path} className={className}>{body}</Link>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
