'use client';

import { ArrowRight, Certificate, ChalkboardTeacher, UsersThree, type Icon } from '@phosphor-icons/react';
import { EVENT_CATEGORIES, type EventCategoryType } from '@/lib/event-categories';

const ICONS: Record<EventCategoryType, Icon> = {
  conference: UsersThree,
  mantram: ChalkboardTeacher,
  event: Certificate,
};

type Props = {
  /** Every published event (already excludes cancelled ones). */
  events: { eventType: string; status: string }[];
  active: EventCategoryType | 'ALL';
  onSelect: (type: EventCategoryType | 'ALL') => void;
  loading?: boolean;
};

/**
 * The three kinds of SS Innovations event. Choosing one filters the list below; choosing it again
 * shows every event. Categories with nothing open say "Coming soon".
 */
export function CategoryCards({ events, active, onSelect, loading = false }: Props) {
  function choose(type: EventCategoryType) {
    const next = active === type ? 'ALL' : type;
    onSelect(next);
    // On phones the list sits below the cards: bring it into view.
    if (next !== 'ALL' && window.matchMedia('(max-width: 767px)').matches) {
      requestAnimationFrame(() => document.getElementById('event-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  return (
    <section aria-label="Event categories" className="mb-8 md:mb-12">
      <ul className="grid gap-3 md:grid-cols-3">
        {EVENT_CATEGORIES.map((category, index) => {
          const Glyph = ICONS[category.type];
          const open = events.filter((e) => e.eventType === category.type && (e.status === 'UPCOMING' || e.status === 'LIVE')).length;
          const selected = active === category.type;
          return (
            <li key={category.type} className="ssi-rise" style={{ animationDelay: `${index * 70}ms` }}>
              <button
                type="button"
                onClick={() => choose(category.type)}
                aria-pressed={selected}
                className={`group relative flex h-full w-full items-center gap-4 rounded-[22px] p-4 text-left transition-[background-color,box-shadow,transform] duration-300 ease-[var(--ease-ssi)] active:scale-[0.99] md:flex-col md:items-start md:gap-0 md:rounded-[28px] md:p-7 ${
                  selected
                    ? 'bg-white shadow-[0_12px_40px_rgba(40,63,143,0.12)] [background:linear-gradient(#fff,#fff)_padding-box,var(--ssi-gradient-45)_border-box] border-[1.5px] border-transparent'
                    : 'border-[1.5px] border-transparent bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-primary shadow-[0_1px_2px_rgba(15,23,41,0.06)] md:mb-10 md:h-14 md:w-14">
                  <Glyph size={26} weight="regular" aria-hidden="true" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-[19px] font-semibold leading-tight tracking-[-0.02em] text-secondary md:text-[26px]">
                    {category.name}
                  </span>
                  <span className="mt-1 block text-[14px] leading-snug text-gray-500 md:mt-2 md:text-[16px]">
                    {category.description}
                  </span>
                  <span className="mt-2 flex items-center gap-1.5 text-[14px] font-medium md:mt-6 md:text-[15px]">
                    {loading ? (
                      <span className="h-4 w-28 animate-pulse rounded-full bg-gray-200" aria-label="Loading" />
                    ) : open > 0 ? (
                      <span className="inline-flex items-center gap-1.5 text-primary">
                        {open === 1 ? '1 event open for registration' : `${open} events open for registration`}
                        <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-0.5" aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="text-gray-400">Coming soon</span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {active !== 'ALL' && (
        <p className="mt-3 text-[14px] text-gray-500">
          Showing {EVENT_CATEGORIES.find((c) => c.type === active)?.heading}.{' '}
          <button type="button" onClick={() => onSelect('ALL')} className="font-medium text-primary underline-offset-4 hover:underline">
            Show all events
          </button>
        </p>
      )}
    </section>
  );
}
