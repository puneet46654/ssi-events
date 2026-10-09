'use client';


import { ticketStorage } from '@/lib/booking-contracts';
import PendingRegistrations from '@/components/user/PendingRegistrations';
import { CategoryCards } from '@/components/user/CategoryCards';
import { ArrowIcon, EventPlaceholder, UpcomingGrid, formatDate } from '@/components/user/EventGrid';
import { categoryOf } from '@/lib/event-categories';

import { calendarDateFormatter } from '@/lib/events/dates';

import type {
  ReactNode,
} from 'react';

import Image from 'next/image';
import Link from 'next/link';

import {
  useCallback,
  useDeferredValue,
  useEffect,
  memo,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  AnimatePresence,
  motion,
} from 'framer-motion';

import {
  useRealtimeRefresh,
} from '@/components/realtime/RealtimeProvider';


/* ============================================================
   TYPES
============================================================ */

interface IEvent {
  _id: string;

  eventName: string;

  eventType:
    | 'conference'
    | 'mantram'
    | 'event';

  venue: string;

  startDate: string;

  endDate: string;

  description?: string;

  imageUrl?: string;

  status:
    | 'LIVE'
    | 'COMPLETED'
    | 'UPCOMING'
    | 'CANCELLED';
}


type EventStatusFilter =
  | 'ALL'
  | 'LIVE'
  | 'UPCOMING'
  | 'COMPLETED';

type EventTypeFilter =
  | 'ALL'
  | 'conference'
  | 'mantram'
  | 'event';

/* ============================================================
   ANIMATION
============================================================ */

const EASE = [
  0.16,
  1,
  0.3,
  1,
] as const;


/* ============================================================
   PAGE
============================================================ */

export default function EventsPage() {

  /* ==========================================================
     TRACK PAGE VIEW
  ========================================================== */


  /* ==========================================================
     EVENTS
  ========================================================== */

  const [
    events,
    setEvents,
  ] = useState<IEvent[]>(
    [],
  );

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  /* ==========================================================
     SEARCH + FILTERS
  ========================================================== */

  const [
    search,
    setSearch,
  ] = useState('');

  const deferredSearch =
    useDeferredValue(search);

  const [
    showFilters,
    setShowFilters,
  ] = useState(false);

  const [
    statusFilter,
    setStatusFilter,
  ] =
    useState<EventStatusFilter>(
      'ALL',
    );

  const [
    typeFilter,
    setTypeFilter,
  ] =
    useState<EventTypeFilter>(
      'ALL',
    );


  /* ==========================================================
     LOAD EVENTS
  ========================================================== */

  const [loadError, setLoadError] = useState('');
  const eventRequest = useRef<AbortController | null>(null);
  const fetchEvents =
    useCallback(
      async (
        showInitialLoading =
          true,
      ) => {
        eventRequest.current?.abort();
        const controller = new AbortController(); eventRequest.current = controller;
        if (
          showInitialLoading
        ) {
          setLoading(
            true,
          );
        } else {
          setRefreshing(
            true,
          );
        }

        try {
          const response =
            await fetch(
            showInitialLoading
              ? '/api/events'
              : `/api/events?refresh=${Date.now()}`,
            {
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
              method:
                'GET',

              cache:
                showInitialLoading
                  ? 'default'
                  : 'no-store',
            },
          );

          const data =
            await response.json();

          if (controller.signal.aborted) return;
          if (
            !response.ok ||
            !data.success
          ) {
            throw new Error(
              data.error ||
                'Failed to fetch events.',
            );
          }

          setLoadError('');
          setEvents(
            Array.isArray(
              data.events,
            )
              ? data.events.filter((event: IEvent) => event.status !== 'CANCELLED')
              : [],
          );

          try {
            window.sessionStorage.setItem(
              ticketStorage.events,
              JSON.stringify(
                Array.isArray(
                  data.events,
                )
                  ? data.events.filter((event: IEvent) => event.status !== 'CANCELLED')
                  : [],
              ),
            );
          } catch (error) {
            console.error(
              'Unable to cache events:',
              error,
            );
          }
        } catch (
          error
        ) {
          if (controller.signal.aborted) return;
          console.error(
            'Failed to fetch events:',
            error,
          );

          setLoadError(error instanceof Error ? error.message : 'Unable to load events. Please retry.');
        } finally {
          if (!controller.signal.aborted) {
          setLoading(
            false,
          );

          setRefreshing(
            false,
          );
          }
        }
      },
      [],
    );

  useEffect(() => {
    const timers: number[] = [];
    let hasCachedEvents =
      false;

    try {
      const cached =
        window.sessionStorage.getItem(
          ticketStorage.events,
        );

      if (cached) {
        const parsed =
          JSON.parse(cached);

        if (
          Array.isArray(parsed)
        ) {
          timers.push(window.setTimeout(() => {
            setEvents((parsed as IEvent[]).filter(event => event.status !== 'CANCELLED'));
            setLoading(false);
          }, 0));
          hasCachedEvents = true;
        }
      }
    } catch (error) {
      console.error(
        'Unable to restore cached events:',
        error,
      );
    }

    timers.push(window.setTimeout(() => {
      void fetchEvents(
        !hasCachedEvents,
      );
    }, 0));
    return () => { timers.forEach(clearTimeout); eventRequest.current?.abort(); };
  }, [
    fetchEvents,
  ]);

  useRealtimeRefresh(
    'events',
    () => {
      void fetchEvents(
        false,
      );
    },
  );

  /* ==========================================================
     FILTERING
  ========================================================== */

  const hasActiveFilters =
    statusFilter !==
      'ALL' ||
    typeFilter !==
      'ALL';

  const hasSearch =
    search.trim().length >
    0;

  const filteredEvents =
    useMemo(() => {
      const query =
        deferredSearch
          .trim()
          .toLowerCase();

      return events.filter(
        (
          event,
        ) => {
          const matchesSearch =
            !query ||
            [
              event.eventName,
              event.eventType,
              event.venue,
              event.description ||
                '',
            ].some(
              (
                value,
              ) =>
                value
                  .toLowerCase()
                  .includes(
                    query,
                  ),
            );

          const matchesStatus =
            statusFilter ===
              'ALL' ||
            event.status ===
              statusFilter;

          const matchesType =
            typeFilter ===
              'ALL' ||
            event.eventType ===
              typeFilter;

          return (
            matchesSearch &&
            matchesStatus &&
            matchesType
          );
        },
      );
    }, [
      events,
      deferredSearch,
      statusFilter,
      typeFilter,
    ]);

  const liveEvents =
    useMemo(
      () =>
        filteredEvents.filter(
          (
            event,
          ) =>
            event.status ===
            'LIVE',
        ),
      [
        filteredEvents,
      ],
    );

  const upcomingConferences =
    useMemo(
      () =>
        filteredEvents.filter(
          (
            event,
          ) =>
            event.status ===
              'UPCOMING' &&
            event.eventType ===
              'conference',
        ),
      [
        filteredEvents,
      ],
    );

  const upcomingMantram =
    useMemo(
      () =>
        filteredEvents.filter(
          (
            event,
          ) =>
            event.status ===
              'UPCOMING' &&
            event.eventType ===
              'mantram',
        ),
      [
        filteredEvents,
      ],
    );

  const upcomingEvents =
    useMemo(
      () =>
        filteredEvents.filter(
          (
            event,
          ) =>
            event.status ===
              'UPCOMING' &&
            event.eventType ===
              'event',
        ),
      [
        filteredEvents,
      ],
    );

  const completedEvents =
    useMemo(
      () =>
        filteredEvents.filter(
          (
            event,
          ) =>
            event.status ===
            'COMPLETED',
        ),
      [
        filteredEvents,
      ],
    );

  /* ==========================================================
     FILTER ACTIONS
  ========================================================== */

  function clearFilters() {
    setStatusFilter(
      'ALL',
    );

    setTypeFilter(
      'ALL',
    );
  }

  function resetAll() {
    setSearch('');

    clearFilters();

    setShowFilters(
      false,
    );
  }


  /* ==========================================================
     PAGE
  ========================================================== */

  return (
    <div
            className="
        min-h-dvh
        bg-white
        pb-[76px]
        md:pb-0
      "
    >
      {/* ======================================================
          MOBILE INTRO
      ====================================================== */}

      <section
        className="
          relative
          top-0
          z-50

          border-b
          border-gray-200/80

          bg-white

          px-4
          pb-3
          pt-[max(10px,env(safe-area-inset-top))]

          backdrop-blur-xl

          md:hidden
        "
      >
        <div
          className="
            mx-auto
            max-w-[520px]
          "
        >
          {/* TITLE */}

          <div
            className="
              mt-4
            "
          >
            <h1
              className="
                                font-heading
                text-[32px]
                font-semibold
                leading-[1.05]
                tracking-[-0.025em]
                text-secondary
              "
            >
              <span className="ssi-highlight">SS Innovations</span> events
            </h1>

            <p
              className="
                                mt-2
                text-[16px]
                leading-[1.5]
                text-gray-500
              "
            >
              Register for our conferences and CME
              programmes, or book a session with
              SSi MantraM.
            </p>
          </div>

          {/* SEARCH */}

          <div
            className="
              relative
              mt-3
            "
          >
            <SearchBar
              value={
                search
              }
              onChange={
                setSearch
              }
              mobile
              showFilters={
                showFilters
              }
              onToggleFilters={() =>
                setShowFilters(
                  (
                    current,
                  ) =>
                    !current,
                )
              }
              hasActiveFilters={
                hasActiveFilters
              }
            />

            <AnimatePresence>
              {showFilters && (
                <MobileFilterPanel
                  statusFilter={
                    statusFilter
                  }
                  typeFilter={
                    typeFilter
                  }
                  setStatusFilter={
                    setStatusFilter
                  }
                  setTypeFilter={
                    setTypeFilter
                  }
                  clearFilters={
                    clearFilters
                  }
                  hasActiveFilters={
                    hasActiveFilters
                  }
                  onClose={() =>
                    setShowFilters(
                      false,
                    )
                  }
                />
              )}
            </AnimatePresence>
          </div>
        </div>
      </section>

      {/* ======================================================
          CONTENT
      ====================================================== */}

      <main
        className="
          mx-auto

          w-full
          max-w-[1200px]

          px-4
          py-5

          sm:px-5

          md:px-6
          md:py-8
        "
      >
        <PendingRegistrations />

        {/* ====================================================
            DESKTOP INTRO
        ==================================================== */}

        <section
          className="
            hidden
            md:flex
            md:items-end
            md:justify-between
            md:gap-6
          "
        >
          <div
            className="
              max-w-[680px]
            "
          >
            <h1
              className="
                                font-heading
                text-[46px]
                font-semibold
                leading-[1.08]
                tracking-[-0.028em]
                text-secondary
                lg:text-[56px]
              "
            >
              <span className="ssi-highlight">SS Innovations</span> events
            </h1>

            <p
              className="
                mt-3
                max-w-[46ch]
                text-[19px]
                leading-[1.5]
                text-gray-500
              "
            >
              Register for our conferences and CME programmes, or book a session with SSi MantraM.
            </p>
          </div>
              <div className="flex w-full max-w-[600px] items-center gap-2">
                <div className="relative min-w-0 flex-1">
  
                  <div
                    className="
                      relative
                    "
                  >
                    <SearchBar
                      value={
                        search
                      }
                      onChange={
                        setSearch
                      }
                      showFilters={
                        showFilters
                      }
                      onToggleFilters={() =>
                        setShowFilters(
                          (
                            current,
                          ) =>
                            !current,
                        )
                      }
                      hasActiveFilters={
                        hasActiveFilters
                      }
                    />
  
                    <AnimatePresence>
                      {showFilters && (
                        <DesktopFilterPanel
                          statusFilter={
                            statusFilter
                          }
                          typeFilter={
                            typeFilter
                          }
                          setStatusFilter={
                            setStatusFilter
                          }
                          setTypeFilter={
                            setTypeFilter
                          }
                          clearFilters={
                            clearFilters
                          }
                          hasActiveFilters={
                            hasActiveFilters
                          }
                          onClose={() =>
                            setShowFilters(
                              false,
                            )
                          }
                        />
                      )}
                    </AnimatePresence>
                  </div>
                </div>
                    <button
                      type="button"
                      aria-label="Refresh events"
                      disabled={
                        refreshing
                      }
                      onClick={() =>
                        void fetchEvents(
                          false,
                        )
                      }
                      className="
                        grid
                        h-10
                        w-10
        
                        place-items-center
        
                        rounded-lg
        
                        border
                        border-gray-200
        
                        bg-white
        
                        text-gray-500
        
                        transition-all
                        duration-150
        
                        hover:border-gray-300
                        hover:bg-gray-50
                        hover:text-secondary
        
                        focus:outline-none
                        focus-visible:ring-2
                        focus-visible:ring-primary/15
                        disabled:cursor-not-allowed
                        disabled:opacity-50
                      "
                    >
                      <RefreshIcon
                        spinning={
                          refreshing
                        }
                      />
                    </button>
          </div>
        </section>

        <div className="mt-1 md:mt-10">
          <CategoryCards events={events} loading={loading && events.length === 0} />
        </div>
        <div id="event-results" className="scroll-mt-[calc(72px+env(safe-area-inset-top))]" />

        {/* ====================================================
            ACTIVE FILTERS
        ==================================================== */}

        <AnimatePresence>
          {(hasActiveFilters ||
            hasSearch) && (
            <motion.div
              initial={{
                opacity: 0,
                y: -5,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              exit={{
                opacity: 0,
                y: -5,
              }}
              className="
                mt-4

                flex
                flex-wrap
                items-center
                gap-1.5

                md:mt-6
              "
            >
              {hasSearch && (
                <FilterTag
                  label={`Search: ${search}`}
                  onRemove={() =>
                    setSearch('')
                  }
                />
              )}

              {statusFilter !==
                'ALL' && (
                <FilterTag
                  label={formatStatus(
                    statusFilter,
                  )}
                  onRemove={() =>
                    setStatusFilter(
                      'ALL',
                    )
                  }
                />
              )}

              {typeFilter !==
                'ALL' && (
                <FilterTag
                  label={formatType(
                    typeFilter,
                  )}
                  onRemove={() =>
                    setTypeFilter(
                      'ALL',
                    )
                  }
                />
              )}

              <button
                type="button"
                onClick={
                  resetAll
                }
                className="
                  ml-1

                  text-[12px]
                  font-semibold

                  text-gray-400

                  transition-colors

                  hover:text-secondary
                "
              >
                Clear all
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ====================================================
            LOADING
        ==================================================== */}

        {loadError && <div role="alert" className="my-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">
          {loadError} <button type="button" className="ml-3 underline" onClick={() => { void fetchEvents(false); }}>Try again</button>
        </div>}
        {loading ? (
          <div
            className="
              mt-5

              md:mt-8
            "
          >
            <LoadingState />
          </div>
        ) : loadError && events.length === 0 ? null
          // With no events at all, the category cards already say "Coming soon".
          : events.length === 0 ? null
          : filteredEvents.length ===
          0 ? (
          /* ==================================================
             FILTERS RETURNED NOTHING
          ================================================== */

          <div
            className="
              mt-4

              md:mt-8
            "
          >
            <NoMatchingEvents
              clearAll={
                resetAll
              }
            />
          </div>
        ) : (
          /* ==================================================
             EVENT SECTIONS
          ================================================== */

          <motion.div
            key={`${search}-${statusFilter}-${typeFilter}`}
            initial={{
              opacity: 0,
              y: 6,
            }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            transition={{
              duration:
                0.28,

              ease:
                EASE,
            }}
            className="
              mt-5
              space-y-8

              md:mt-8
              md:space-y-10
            "
          >
            {/* OPEN */}

            {liveEvents.length >
              0 && (
              <AnimatedSection>
                <SectionHeading
                  title="Open for Registration"
                  subtitle="Events currently accepting registrations"
                />

                <div
                  className="
                    grid
                    grid-cols-2
                    gap-3

                    min-[520px]:grid-cols-2

                    md:gap-5
                  "
                >
                  {liveEvents.map(
                    (
                      event,
                      index,
                    ) => (
                      <OpenEventCard
                        key={
                          event._id
                        }
                        event={
                          event
                        }
                        index={
                          index
                        }
                      />
                    ),
                  )}
                </div>
              </AnimatedSection>
            )}

            {/* CONFERENCES */}

            {upcomingConferences.length >
              0 && (
              <AnimatedSection>
                <SectionHeading
                                    title="SMRSC"
                  subtitle="The SSI Multi-Specialty Robotic Surgery Conference"
                />

                <UpcomingGrid
                  events={
                    upcomingConferences
                  }
                />
              </AnimatedSection>
            )}

            {/* MANTRAM */}

            {upcomingMantram.length >
              0 && (
              <AnimatedSection>
                <SectionHeading
                                    title="MantraM"
                  subtitle="Upcoming MantraM visits"
                />

                <UpcomingGrid
                  events={
                    upcomingMantram
                  }
                />
              </AnimatedSection>
            )}

            {/* OTHER */}

            {upcomingEvents.length >
              0 && (
              <AnimatedSection>
                <SectionHeading
                                    title="CME and workshops"
                  subtitle="Continuing medical education and hands-on workshops"
                />

                <UpcomingGrid
                  events={
                    upcomingEvents
                  }
                />
              </AnimatedSection>
            )}

            {/* COMPLETED */}

            {completedEvents.length >
              0 &&
              statusFilter ===
                'COMPLETED' && (
                <AnimatedSection>
                  <SectionHeading
                    title="Completed Events"
                    subtitle="Previously concluded programmes"
                  />

                  <UpcomingGrid
                    events={
                      completedEvents
                    }
                    completed
                  />
                </AnimatedSection>
              )}
          </motion.div>
        )}
      </main>

      {/* ======================================================
          MOBILE BOTTOM NAVIGATION

          Tickets remain here.
          They are removed only from the top header.
      ====================================================== */}


    </div>
  );
}

/* ============================================================
   BRAND
============================================================ */

/* ============================================================
   SEARCH BAR
============================================================ */

function SearchBar({
  value,
  onChange,
  mobile = false,
  showFilters,
  onToggleFilters,
  hasActiveFilters,
}: {
  value: string;

  onChange:
    (
      value:
        string,
    ) => void;

  mobile?: boolean;

  showFilters: boolean;

  onToggleFilters:
    () => void;

  hasActiveFilters:
    boolean;
}) {
  return (
    <div
      className="
        relative
        w-full
      "
    >
      <span
        className="
          pointer-events-none

          absolute
          left-3.5
          top-1/2

          -translate-y-1/2

          text-gray-400
        "
      >
        <SearchIcon />
      </span>

      <input aria-label="Search events, venue or type"
        type="search"
        value={
          value
        }
        onChange={(
          event,
        ) =>
          onChange(
            event.target.value,
          )
        }
        placeholder={
          mobile
            ? 'Search events...'
            : 'Search events, venue or type...'
        }
        className={`
          w-full

          rounded-lg

          border
          border-gray-200

          bg-white

          pl-10
          pr-12

          text-secondary

          outline-none

          transition-all
          duration-150

          placeholder:text-gray-400

          hover:border-gray-300

          focus:border-primary/40
          focus:ring-2
          focus:ring-primary/10

          ${
            mobile
              ? 'h-11 text-[12px]'
              : 'h-10 text-[13px]'
          }
        `}
      />

      <button
        type="button"
        aria-label="Filter events"
        aria-expanded={
          showFilters
        }
        onClick={
          onToggleFilters
        }
        className={`
          absolute
          right-1.5
          top-1/2

          grid
          h-8
          w-8

          -translate-y-1/2

          place-items-center

          rounded-md

          transition-all

          ${
            showFilters ||
            hasActiveFilters
              ? `
                  bg-primary/[0.08]
                  text-primary
                `
              : `
                  text-gray-400

                  hover:bg-gray-100
                  hover:text-secondary
                `
          }
        `}
      >
        <FilterIcon />

        {hasActiveFilters && (
          <span
            className="
              absolute
              right-[4px]
              top-[4px]

              h-[5px]
              w-[5px]

              rounded-full

              bg-primary
            "
          />
        )}
      </button>
    </div>
  );
}

/* ============================================================
   FILTER TYPES
============================================================ */

interface FilterPanelProps {
  statusFilter:
    EventStatusFilter;

  typeFilter:
    EventTypeFilter;

  setStatusFilter:
    (
      value:
        EventStatusFilter,
    ) => void;

  setTypeFilter:
    (
      value:
        EventTypeFilter,
    ) => void;

  clearFilters:
    () => void;

  hasActiveFilters:
    boolean;

  onClose:
    () => void;
}

/* ============================================================
   MOBILE FILTER PANEL
============================================================ */

function MobileFilterPanel(
  props:
    FilterPanelProps,
) {
  return (
    <motion.div
      initial={{
        opacity: 0,
        y: -5,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      exit={{
        opacity: 0,
        y: -5,
      }}
      transition={{
        duration: 0.16,
      }}
      className="
        absolute

        inset-x-0
        top-[50px]

        z-[70]

        rounded-xl

        border
        border-gray-200

        bg-white

        p-3.5

        shadow-[0_18px_42px_rgba(15,23,41,0.15)]
      "
    >
      <FilterContents
        {...props}
      />
    </motion.div>
  );
}

/* ============================================================
   DESKTOP FILTER PANEL
============================================================ */

function DesktopFilterPanel(
  props:
    FilterPanelProps,
) {
  return (
    <motion.div
      initial={{
        opacity: 0,
        y: -5,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      exit={{
        opacity: 0,
        y: -5,
      }}
      transition={{
        duration: 0.16,
      }}
      className="
        absolute

        left-1/2
        top-[48px]

        z-50

        w-[400px]

        -translate-x-1/2

        rounded-xl

        border
        border-gray-200

        bg-white

        p-4

        shadow-[0_18px_45px_rgba(15,23,41,0.14)]
      "
    >
      <FilterContents
        {...props}
      />
    </motion.div>
  );
}

/* ============================================================
   FILTER CONTENT
============================================================ */

function FilterContents({
  statusFilter,
  typeFilter,
  setStatusFilter,
  setTypeFilter,
  clearFilters,
  hasActiveFilters,
  onClose,
}: FilterPanelProps) {
  return (
    <>
      <div
        className="
          flex
          items-start
          justify-between
          gap-3
        "
      >
        <div>
          <h3
            className="
              text-[12px]
              font-semibold

              text-secondary
            "
          >
            Filter events
          </h3>

          <p
            className="
              mt-0.5

              text-[12px]

              text-gray-400
            "
          >
            Refine the events shown below.
          </p>
        </div>

        <button
          type="button"
          aria-label="Close filters"
          onClick={
            onClose
          }
          className="
            grid
            h-8
            w-8

            place-items-center

            rounded-lg

            text-gray-400

            transition

            hover:bg-gray-100
            hover:text-secondary
          "
        >
          <CloseIcon />
        </button>
      </div>

      {/* STATUS */}

      <div
        className="
          mt-4
        "
      >
        <FilterLabel>
          Status
        </FilterLabel>

        <div
          className="
            mt-2

            flex
            flex-wrap
            gap-1.5
          "
        >
          {(
            [
              'ALL',
              'LIVE',
              'UPCOMING',
              'COMPLETED',
            ] as EventStatusFilter[]
          ).map(
            (
              value,
            ) => (
              <FilterChoice
                key={
                  value
                }
                selected={
                  statusFilter ===
                  value
                }
                label={formatStatus(
                  value,
                )}
                onClick={() =>
                  setStatusFilter(
                    value,
                  )
                }
              />
            ),
          )}
        </div>
      </div>

      {/* EVENT TYPE */}

      <div
        className="
          mt-4
        "
      >
        <FilterLabel>
          Category
        </FilterLabel>

        <div
          className="
            mt-2

            flex
            flex-wrap
            gap-1.5
          "
        >
          {(
            [
              'ALL',
              'conference',
              'mantram',
              'event',
            ] as EventTypeFilter[]
          ).map(
            (
              value,
            ) => (
              <FilterChoice
                key={
                  value
                }
                selected={
                  typeFilter ===
                  value
                }
                label={formatType(
                  value,
                )}
                onClick={() =>
                  setTypeFilter(
                    value,
                  )
                }
              />
            ),
          )}
        </div>
      </div>

      {/* FOOTER */}

      <div
        className="
          mt-4

          flex
          items-center
          justify-between

          border-t
          border-gray-100

          pt-3
        "
      >
        <button
          type="button"
          onClick={
            clearFilters
          }
          disabled={
            !hasActiveFilters
          }
          className="
            text-[12px]
            font-semibold

            text-gray-400

            transition-colors

            hover:text-secondary

            disabled:opacity-40
          "
        >
          Clear filters
        </button>

        <button
          type="button"
          onClick={
            onClose
          }
          className="
            h-8

            rounded-lg

            bg-primary

            px-4

            text-[12px]
            font-semibold

            text-white

            transition-colors

            hover:bg-primary-dark
          "
        >
          Apply
        </button>
      </div>
    </>
  );
}

/* ============================================================
   FILTER LABEL
============================================================ */

function FilterLabel({
  children,
}: {
  children:
    ReactNode;
}) {
  return (
    <p
      className="
        text-[12px]
        font-bold

        uppercase

        tracking-[0.08em]

        text-gray-400
      "
    >
      {children}
    </p>
  );
}

/* ============================================================
   FILTER CHOICE
============================================================ */

function FilterChoice({
  selected,
  label,
  onClick,
}: {
  selected:
    boolean;

  label:
    string;

  onClick:
    () => void;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`
        min-h-[34px]

        rounded-lg

        border

        px-3

        text-[12px]
        font-semibold

        transition-all

        ${
          selected
            ? `
                border-primary/25
                bg-primary/[0.07]
                text-primary
              `
            : `
                border-gray-200
                bg-white
                text-gray-500

                hover:border-gray-300
                hover:text-secondary
              `
        }
      `}
    >
      {label}
    </button>
  );
}

/* ============================================================
   ACTIVE FILTER TAG
============================================================ */

function FilterTag({
  label,
  onRemove,
}: {
  label:
    string;

  onRemove:
    () => void;
}) {
  return (
    <motion.span
      layout
      initial={{
        opacity: 0,
        scale: 0.96,
      }}
      animate={{
        opacity: 1,
        scale: 1,
      }}
      className="
        inline-flex
        max-w-full

        items-center
        gap-1.5

        rounded-full

        border
        border-gray-200

        bg-white

        px-2.5
        py-1.5

        text-[12px]
        font-medium

        text-secondary
      "
    >
      <span
        className="
          max-w-[210px]
          truncate
        "
      >
        {label}
      </span>

      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={
          onRemove
        }
        className="
          grid
          h-4
          w-4
          shrink-0

          place-items-center

          rounded-full

          text-gray-400

          hover:bg-gray-100
          hover:text-secondary
        "
      >
        ×
      </button>
    </motion.span>
  );
}

/* ============================================================
   SECTION
============================================================ */

function AnimatedSection({
  children,
}: {
  children:
    ReactNode;
}) {
  return (
    <motion.section
      initial={{
        opacity: 0,
        y: 8,
      }}
      whileInView={{
        opacity: 1,
        y: 0,
      }}
      viewport={{
        once: true,
        amount: 0.04,
      }}
      transition={{
        duration: 0.35,
        ease: EASE,
      }}
    >
      {children}
    </motion.section>
  );
}

/* ============================================================
   SECTION HEADING
============================================================ */

function SectionHeading({
  title,
  subtitle,
}: {
  title:
    string;

  subtitle?:
    string;
}) {
  return (
    <div
      className="
        mb-3

        md:mb-4
      "
    >
      <h2
        className="
                      font-heading
            text-[22px]
            font-semibold
            tracking-[-0.02em]
            text-secondary
            md:text-[28px]
        "
      >
        {title}
      </h2>

      {subtitle && (
        <p
          className="
                          mt-1
              text-[14px]
              text-gray-500
              md:text-[16px]
          "
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

/* ============================================================
   OPEN EVENT CARD
============================================================ */

const OpenEventCard = memo(function OpenEventCard({
  event,
  index,
}: {
  event:
    IEvent;

  index:
    number;
}) {
  return (
    <motion.div
      initial={{
        opacity: 0,
        y: 8,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      transition={{
        duration:
          0.32,

        delay:
          index *
          0.035,

        ease:
          EASE,
      }}
      className="
        h-full
      "
    >
      <Link
        href={`/events/${event._id}`}
        className="
          group

          flex
          h-full
          flex-col

          overflow-hidden

          rounded-xl

          border
          border-gray-200

          bg-white

          shadow-[0_3px_12px_rgba(15,23,41,0.025)]

          transition-all
          duration-200

          hover:border-gray-300
          hover:shadow-[0_8px_24px_rgba(15,23,41,0.055)]
        "
      >
        {/* IMAGE */}

        <div
          className="
            relative

            aspect-[16/8.5]

            overflow-hidden

            bg-gray-100

            sm:aspect-[16/8]

            md:aspect-[16/7.4]
          "
        >
          {event.imageUrl ? (
            <Image
              src={
                event.imageUrl
              }
              alt={
                event.eventName
              }
              fill
              unoptimized
              loading={
                index < 2
                  ? 'eager'
                  : 'lazy'
              }
              sizes="
                (max-width: 520px) 100vw,
                (max-width: 768px) 50vw,
                45vw
              "
              className="
                object-cover

                transition-transform
                duration-500

                group-hover:scale-[1.02]
              "
            />
          ) : (
            <EventPlaceholder />
          )}
        </div>

        {/* CONTENT */}

        <div
          className="
            flex
            flex-1
            flex-col

            p-3.5

            md:p-4
          "
        >
          {/* TYPE */}

          {/* NAME */}

          <h3
            className="
              mt-1

              line-clamp-2

              font-heading

              text-[15px]
              font-semibold

              leading-5

              text-secondary

              md:text-[16px]
            "
          >
            {event.eventName}
          </h3>

          {/* META */}

          <div
            className="
              mt-2.5

              space-y-1.5
            "
          >
            <MetaRow
              type="location"
              value={
                event.venue
              }
            />

            <MetaRow
              type="date"
              value={formatDateRange(
                event.startDate,
                event.endDate,
              )}
            />
          </div>

          {/* ABOUT

              This replaces the old booked/remaining capacity bar.
          */}

          <div
            className="
              mt-3

              border-t
              border-gray-100

              pt-3
            "
          >
            <div
              className="
                flex
                min-w-0
                items-baseline
                gap-2
              "
            >
              <span
                className="
                  shrink-0

                  text-[12px]
                  font-semibold

                  text-secondary
                "
              >
                About
              </span>

              <p
                className="
                  min-w-0
                  flex-1

                  truncate

                  text-[12px]
                  leading-4

                  text-gray-500

                  md:text-[13px]
                "
              >
                {event.description
                  ?.trim() ||
                  'View event information, schedule and registration details.'}
              </p>
            </div>
          </div>

          {/* ACTION */}

          <div
            className="
              mt-auto
              pt-3
            "
          >
            <div
              className="
                flex
                items-center
                justify-between

                border-t
                border-gray-100

                pt-3
              "
            >
              <span
                className="
                  text-[12px]
                  font-medium

                  text-gray-400
                "
              >
                Registration available
              </span>

              <span
                className="
                  inline-flex
                  items-center
                  gap-1.5

                  text-[12px]
                  font-semibold

                  text-primary

                  transition-colors

                  group-hover:text-primary-dark
                "
              >
                View event

                <ArrowIcon />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
});

/* ============================================================
   UPCOMING GRID
============================================================ */

/* ============================================================
   UPCOMING CARD
============================================================ */

/* ============================================================
   EMPTY STATE
============================================================ */

function NoMatchingEvents({
  clearAll,
}: {
  clearAll:
    () => void;
}) {
  return (
    <motion.section
      initial={{
        opacity: 0,
        y: 6,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      className="
        rounded-xl

        border
        border-gray-200

        bg-white

        px-5
        py-10

        text-center

        shadow-[0_3px_14px_rgba(15,23,41,0.02)]
      "
    >
      <span
        className="
          mx-auto

          grid
          h-10
          w-10

          place-items-center

          rounded-lg

          bg-gray-50

          text-gray-400
        "
      >
        <SearchLargeIcon />
      </span>

      <h2
        className="
          mt-3

          text-[14px]
          font-semibold

          text-secondary
        "
      >
        No matching events
      </h2>

      <p
        className="
          mx-auto
          mt-1

          max-w-[350px]

          text-[12px]
          leading-5

          text-gray-500
        "
      >
        Try another search or clear
        the current filters.
      </p>

      <button
        type="button"
        onClick={
          clearAll
        }
        className="
          mt-4

          h-9

          rounded-lg

          border
          border-gray-200

          bg-white

          px-4

          text-[12px]
          font-semibold

          text-secondary

          transition-colors

          hover:bg-gray-50
        "
      >
        Clear Search & Filters
      </button>
    </motion.section>
  );
}

/* ============================================================
   LOADING
============================================================ */

function LoadingState() {
  return (
    <div
      className="
        space-y-8
      "
    >
      <section>
        <div
          className="
            h-5
            w-40

            animate-pulse

            rounded

            bg-gray-100
          "
        />

        <div
          className="
            mt-3

            grid
            grid-cols-1
            gap-3

            min-[520px]:grid-cols-2

            md:gap-5
          "
        >
          {Array.from({
            length: 2,
          }).map(
            (
              _,
              index,
            ) => (
              <div
                key={
                  index
                }
                className="
                  overflow-hidden

                  rounded-xl

                  border
                  border-gray-200

                  bg-white
                "
              >
                <div
                  className="
                    aspect-[16/8]

                    animate-pulse

                    bg-gray-100
                  "
                />

                <div
                  className="
                    p-4
                  "
                >
                  <div
                    className="
                      h-3
                      w-20

                      animate-pulse

                      rounded

                      bg-gray-100
                    "
                  />

                  <div
                    className="
                      mt-2

                      h-4
                      w-3/4

                      animate-pulse

                      rounded

                      bg-gray-100
                    "
                  />

                  <div
                    className="
                      mt-3

                      h-3
                      w-1/2

                      animate-pulse

                      rounded

                      bg-gray-100
                    "
                  />

                  <div
                    className="
                      mt-4

                      h-9

                      animate-pulse

                      rounded-lg

                      bg-gray-50
                    "
                  />
                </div>
              </div>
            ),
          )}
        </div>
      </section>
    </div>
  );
}

/* ============================================================
   META ROW
============================================================ */

function MetaRow({
  type,
  value,
}: {
  type:
    | 'location'
    | 'date';

  value:
    string;
}) {
  return (
    <div
      className="
        flex
        min-w-0
        items-center
        gap-1.5

        text-gray-500
      "
    >
      {type ===
      'location' ? (
        <LocationIcon />
      ) : (
        <CalendarIcon />
      )}

      <span
        className="
          truncate

          text-[12px]

          md:text-[12px]
        "
      >
        {value}
      </span>
    </div>
  );
}

/* ============================================================
   MOBILE NAV ITEM
============================================================ */

/* ============================================================
   PLACEHOLDER
============================================================ */

/* ============================================================
   FORMATTERS
============================================================ */

function formatStatus(
  value:
    EventStatusFilter,
) {
  if (
    value ===
    'ALL'
  ) {
    return 'All';
  }

  if (
    value ===
    'UPCOMING'
  ) {
    return 'Upcoming';
  }

  if (
    value ===
    'COMPLETED'
  ) {
    return 'Completed';
  }

  return 'Open';
}

function formatType(
  value:
    EventTypeFilter |
    IEvent['eventType'],
) {
  return value === 'ALL' ? 'All' : categoryOf(value).name;
}

function formatDateRange(
  startValue:
    string,

  endValue:
    string,
) {
  const start =
    new Date(
      startValue,
    );

  const end =
    new Date(
      endValue,
    );

  if (
    Number.isNaN(
      start.getTime(),
    )
  ) {
    return '';
  }

  if (
    Number.isNaN(
      end.getTime(),
    ) ||
    start.toDateString() ===
      end.toDateString()
  ) {
    return formatDate(
      startValue,
    );
  }

  const startLabel =
    calendarDateFormatter(
      'en-GB',
      {
        day:
          '2-digit',

        month:
          'short',
      },
    ).format(
      start,
    );

  const endLabel =
    calendarDateFormatter(
      'en-GB',
      {
        day:
          '2-digit',

        month:
          'short',

        year:
          'numeric',
      },
    ).format(
      end,
    );

  return `${startLabel} – ${endLabel}`;
}

/* ============================================================
   ICONS
============================================================ */

function SearchIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.9}
    >
      <circle
        cx="11"
        cy="11"
        r="6.5"
      />

      <path
        strokeLinecap="round"
        d="m16 16 4 4"
      />
    </svg>
  );
}

function SearchLargeIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <circle
        cx="11"
        cy="11"
        r="6.5"
      />

      <path
        strokeLinecap="round"
        d="m16 16 4 4"
      />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        strokeLinecap="round"
        d="M4 6h16M7 12h10M10 18h4"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        d="M6 6l12 12M18 6 6 18"
      />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21s6-5.2 6-11a6 6 0 10-12 0c0 5.8 6 11 6 11Z"
      />

      <circle
        cx="12"
        cy="10"
        r="2"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        strokeLinecap="round"
        d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 011 1v14H4V6a1 1 0 011-1Z"
      />
    </svg>
  );
}

function RefreshIcon({
  spinning,
}: {
  spinning:
    boolean;
}) {
  return (
    <svg
      className={`
        h-4
        w-4

        ${
          spinning
            ? 'animate-spin'
            : ''
        }
      `}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.9}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 11a8 8 0 10-2.35 5.65M20 4v7h-7"
      />
    </svg>
  );
}
