'use client';


import { ticketStorage } from '@/lib/booking-contracts';
import PendingRegistrations from '@/components/user/PendingRegistrations';
import { CategoryCards } from '@/components/user/CategoryCards';
import { OpenEventCard, UpcomingGrid } from '@/components/user/EventGrid';
import { categoryOf } from '@/lib/event-categories';
import { setEventSearch, useEventSearch } from '@/lib/event-search';


import type {
  ReactNode,
} from 'react';


import {
  useCallback,
  useDeferredValue,
  useEffect,
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
    | 'event'
    | 'participation';

  /** `info`: listed for information only, no booking. */
  registrationMode?: 'slots' | 'open' | 'info';

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
  | 'event'
  | 'participation';

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

  // The search box is in the site header; the text is kept in the URL (?q=).
  const search = useEventSearch();
  const setSearch = setEventSearch;

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
            'LIVE' &&
            event.registrationMode !== 'info',
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

  const upcomingParticipation =
    useMemo(
      () =>
        filteredEvents.filter(
          (event) =>
            event.eventType === 'participation' &&
            (event.status === 'UPCOMING' ||
              (event.status === 'LIVE' && event.registrationMode === 'info')),
        ),
      [filteredEvents],
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

          </div>

          {/* FILTERS */}

          <div
            className="
              relative
              mt-3
              flex
              justify-end
            "
          >
            <FilterButton
              showFilters={showFilters}
              onToggle={() => setShowFilters((current) => !current)}
              hasActiveFilters={hasActiveFilters}
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

          </div>
              <div className="flex shrink-0 items-center gap-2">
                <div className="relative">
  
                  <div
                    className="
                      relative
                    "
                  >
                    <FilterButton
              showFilters={showFilters}
              onToggle={() => setShowFilters((current) => !current)}
              hasActiveFilters={hasActiveFilters}
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
          // With no events at all, the category cards below already say none are open.
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
                    grid-cols-1
                    gap-3

                    sm:grid-cols-2

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

            {/* CONFERENCES WE ATTEND */}

            {upcomingParticipation.length > 0 && (
              <AnimatedSection>
                <SectionHeading
                  title="Conferences"
                  subtitle="Congresses and conferences where we exhibit and present"
                />

                <UpcomingGrid events={upcomingParticipation} />
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

        {/* ====================================================
            CATEGORIES: below the events, so open events lead the page
        ==================================================== */}

        <section className="mt-10 md:mt-14">
          <SectionHeading
            title="Browse by category"
            subtitle="SMRSC, MantraM, CME and workshops, and the conferences we attend"
          />
          <CategoryCards events={events} loading={loading && events.length === 0} />
        </section>
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
   FILTER BUTTON (search itself is in the site header)
============================================================ */
function FilterButton({
  showFilters,
  onToggle,
  hasActiveFilters,
}: {
  showFilters: boolean;
  onToggle: () => void;
  hasActiveFilters: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Filter events"
      aria-expanded={showFilters}
      onClick={onToggle}
      className={`relative inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-[14px] font-medium transition-all ${
        showFilters || hasActiveFilters
          ? 'border-primary/30 bg-primary/[0.06] text-primary'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50 hover:text-secondary'
      }`}
    >
      <FilterIcon />
      Filters
      {hasActiveFilters && <span className="h-[6px] w-[6px] rounded-full bg-primary" aria-label="Filters applied" />}
    </button>
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

        right-0
        top-[48px]

        z-50

        w-[400px]

        

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
              'participation',
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

/* ============================================================
   ICONS
============================================================ */

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
