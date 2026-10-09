'use client';

import { calendarDate, calendarDateFormatter, eventTimeZone, zonedDate } from '@/lib/events/dates';
import { confirmBooking } from '@/lib/bookings/confirm-booking';


import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  useParams,
  useRouter,
} from 'next/navigation';

import {
  AnimatePresence,
  motion,
} from 'framer-motion';

import {
  useRealtimeRefresh,
} from '@/components/realtime/RealtimeProvider';

type SlotItem = {
  _id: string;

  startTime: string;

  endTime: string;

  capacity: number;

  bookedCount: number;

  remaining: number;

  available: boolean;

  ended?: boolean;
};

type EventDay = {
  _id: string;

  dayNumber: number;

  date: string;

  startTime: string;

  endTime: string;

  slots: SlotItem[];
};

type SlotEvent = {
  timeZone?: string;
  _id: string;

  eventName: string;

  venue: string;

  description: string;

  startDate: string;

  endDate: string;

  status:
    | 'LIVE'
    | 'UPCOMING'
    | 'COMPLETED'
    | 'CANCELLED';
  /** `open`: registration only, no time slots. `remaining` is null when there is no limit. */
  registrationMode?: 'slots' | 'open';
  remaining?: number | null;
};

type SlotsResponse = {
  success: boolean;

  error?: string;

  event?: SlotEvent;

  days?: EventDay[];
};

const EASE = [
  0.16,
  1,
  0.3,
  1,
] as const;

export default function TimeSlotsPage() {
  const params =
    useParams<{
      id: string;
    }>();

  const router =
    useRouter();

  const eventId =
    params.id;

  const [
    event,
    setEvent,
  ] =
    useState<SlotEvent | null>(
      null,
    );

  const [
    days,
    setDays,
  ] =
    useState<EventDay[]>([]);

  const [
    selectedDayId,
    setSelectedDayId,
  ] =
    useState('');

  const [
    selectedSlotId,
    setSelectedSlotId,
  ] =
    useState('');

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState('');
  const [submitting, setSubmitting] = useState(false);

  const slotsRequest = useRef<AbortController | null>(null);

  /* ============================================================
     LOAD REAL DATABASE SLOTS
  ============================================================ */

  const loadSlots =
    useCallback(
      async (
        silent = false,
      ) => {
        if (
          !eventId
        ) {
          return;
        }

        slotsRequest.current?.abort();
        const controller = new AbortController(); slotsRequest.current = controller;

        if (!silent) {
          setLoading(true);
        }

        setError('');

        try {
          const response =
            await fetch(
              `/api/events/${encodeURIComponent(
                eventId,
              )}/slots?refresh=${Date.now()}`,
              {
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
                method:
                  'GET',

                cache:
                  'no-store',

                headers: {
                  'Cache-Control':
                    'no-cache',
                },
              },
            );

          const data =
            (await response.json()) as
              SlotsResponse;

          if (controller.signal.aborted) return;
          if (response.status === 404) { setEvent(null); setDays([]); }
          if (
            !response.ok ||
            !data.success ||
            !data.event
          ) {
            throw new Error(
              data.error ||
                'Unable to load time slots.',
            );
          }

          const nextDays =
            Array.isArray(
              data.days,
            )
              ? data.days
              : [];

          setEvent(
            data.event,
          );

          setDays(
            nextDays,
          );

          setSelectedDayId(
            (current) => {
              if (
                current &&
                nextDays.some(
                  (day) =>
                    day._id ===
                    current,
                )
              ) {
                return current;
              }

              // Default to today's event day, then the first day with an open slot.
              const today = zonedDate(new Date(), eventTimeZone(data.event?.timeZone));

              return (
                nextDays.find((day) => calendarDate(day.date) === today)?._id ||
                nextDays.find((day) => day.slots.some((slot) => slot.available))?._id ||
                nextDays[0]?._id ||
                ''
              );
            },
          );

          setSelectedSlotId(
            (current) => {
              if (!current) {
                return '';
              }

              const stillAvailable =
                nextDays.some(
                  (day) =>
                    day.slots.some(
                      (slot) =>
                        slot._id ===
                          current &&
                        slot.available,
                    ),
                );

              return stillAvailable
                ? current
                : '';
            },
          );
        } catch (
          error: unknown
        ) {
          if (controller.signal.aborted) return;
          console.error(
            'Time slot loading error:',
            error,
          );

          setError(
            error instanceof Error
              ? error.message
              : 'Unable to load time slots.',
          );
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        }
      },
      [
        eventId,
      ],
    );

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSlots(); }, 0);
    return () => { clearTimeout(timer); slotsRequest.current?.abort(); };
  }, [
    loadSlots,
  ]);

  /* ============================================================
     REALTIME REFRESH
  ============================================================ */

  useRealtimeRefresh(
    'events',
    (change) => {
      if (
        !change.id ||
        change.id ===
          eventId
      ) {
        void loadSlots(
          true,
        );
      }
    },
  );

  useRealtimeRefresh(
    'bookings',
    (change) => {
      if (
        !change.id ||
        change.id === eventId
      ) {
        void loadSlots(true);
      }
    },
  );

  /* ============================================================
     DERIVED STATE
  ============================================================ */

  const selectedDay =
    useMemo(
      () =>
        days.find(
          (day) =>
            day._id ===
            selectedDayId,
        ) ||
        days[0] ||
        null,
      [
        days,
        selectedDayId,
      ],
    );

  const selectedSlot =
    useMemo(
      () =>
        selectedDay?.slots.find(
          (slot) =>
            slot._id ===
            selectedSlotId,
        ) || null,
      [
        selectedDay,
        selectedSlotId,
      ],
    );

  const availableCount =
    useMemo(
      () =>
        selectedDay?.slots.filter(
          (slot) =>
            slot.available,
        ).length || 0,
      [
        selectedDay,
      ],
    );

  const totalSlots =
    selectedDay?.slots
      .length || 0;

  /* ============================================================
     ACTIONS
  ============================================================ */

  function handleSelectDay(
    dayId: string,
  ) {
    setSelectedDayId(
      dayId,
    );

    setSelectedSlotId('');

    setError('');
  }

  function handleSlotSelect(
    slot: SlotItem,
  ) {
    if (
      !slot.available
    ) {
      return;
    }

    setSelectedSlotId(
      slot._id,
    );

    setError('');
  }

  async function handleContinue() {
    if (submitting) return;
    if (
      event?.status === 'CANCELLED' || !selectedDay ||
      !selectedSlot || !selectedSlot.available
    ) {
      setError(
        'Please select an available time slot.',
      );

      return;
    }

    // The booking is created here, then the attendee lands on My Tickets with the new ticket highlighted.
    setSubmitting(true);
    setError('');
    try {
      const booking = await confirmBooking(eventId, { dayScheduleId: selectedDay._id, slotId: selectedSlot._id });
      router.replace(`/events/mytickets?booked=${encodeURIComponent(booking.bookingId)}`);
    } catch (err) {
      // Seats may have changed while the attendee was choosing; refresh first, since loading clears errors.
      await loadSlots(true);
      setSubmitting(false);
      setSelectedSlotId('');
      setError(err instanceof Error ? err.message : 'Unable to confirm booking. Please retry.');
    }
  }

  /* ============================================================
     LOADING
  ============================================================ */

  if (loading) {
    return (
      <SlotsLoading />
    );
  }

  /* ============================================================
     ERROR
  ============================================================ */

  if (
    error &&
    !event
  ) {
    return (
      <SlotsError
        message={
          error
        }
        onBack={() =>
          router.back()
        }
        onRetry={() =>
          void loadSlots()
        }
      />
    );
  }

  if (event?.status === 'CANCELLED') {
    return <main className="mx-auto max-w-xl p-8 text-center"><h1 className="text-xl font-bold">Event cancelled</h1>
      <p className="my-4">Bookings are closed. Existing tickets are not valid for admission.</p>
      <button type="button" onClick={() => router.push('/')}>Back to events</button></main>;
  }

  if (!event) {
    return null;
  }

  if (event.registrationMode === 'open') {
    return (
      <OpenRegistration
        event={event}
        submitting={submitting}
        error={error}
        onBack={() => router.back()}
        onConfirm={async () => {
          if (submitting) return;
          setSubmitting(true);
          setError('');
          try {
            const booking = await confirmBooking(eventId, { dayScheduleId: '', slotId: '' });
            router.replace(`/events/mytickets?booked=${encodeURIComponent(booking.bookingId)}`);
          } catch (err) {
            await loadSlots(true);
            setSubmitting(false);
            setError(err instanceof Error ? err.message : 'Unable to confirm your registration. Please retry.');
          }
        }}
      />
    );
  }

  /* ============================================================
     PAGE
  ============================================================ */

  return (
    <main
      className="
        min-h-dvh
        overflow-x-hidden
        bg-[#F7F9FB]

        pb-[168px]

        md:pb-10
      "
    >
      {/* STEP (the shared header holds back and brand) */}
      <div className="max-md:hidden">
        <div
          className="
            border-t
            border-gray-200/60

            bg-white/40
          "
        >
          <div
            className="
              mx-auto
              flex
              h-9
              w-full
              max-w-[1100px]

              items-center
              justify-center

              px-4
            "
          >
            <p
              className="
                truncate

                text-[12px]
                font-medium

                text-gray-500

                sm:text-[13px]
              "
            >
              Select a date and available time for{' '}
              <span
                className="
                  font-semibold
                  text-secondary
                "
              >
                {event.eventName}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* =====================================================
          CONTENT
      ===================================================== */}

      <div
        className="
          mx-auto
          w-full
          max-w-[1100px]

          px-3
          pt-4

          sm:px-5
          sm:pt-5

          lg:px-7
          lg:pt-7
        "
      >
        <motion.section
          initial={{
            opacity: 0,
            y: 10,
          }}
          animate={{
            opacity: 1,
            y: 0,
          }}
          transition={{
            duration:
              0.4,
            ease: EASE,
          }}
          className="
            overflow-hidden

            rounded-[18px]

            border
            border-gray-200

            bg-white

            shadow-[0_8px_28px_rgba(15,23,41,0.05)]

            sm:rounded-[20px]
          "
        >
          {/* =================================================
              EVENT OVERVIEW
          ================================================= */}

          <div
            className="
              border-b
              border-gray-200

              px-4
              py-5

              sm:px-6
              sm:py-6

              lg:px-8
              lg:py-7
            "
          >
            <div
              className="
                grid
                gap-5

                md:grid-cols-[minmax(0,1fr)_220px]
                md:items-start
                md:gap-8
              "
            >
              <div
                className="
                  min-w-0
                "
              >
                <div
                  className="
                    flex
                    flex-wrap
                    items-center
                    gap-2
                  "
                >
                  <span
                    className="
                      text-[12px]
                      font-semibold
                      uppercase

                      tracking-[0.08em]

                      text-gray-400
                    "
                  >
                    Choose a time slot
                  </span>

                  <StatusBadge
                    status={
                      event.status
                    }
                  />
                </div>

                <h1
                  className="
                    mt-2

                    max-w-[700px]

                    font-heading

                    text-[24px]
                    font-bold

                    leading-[1.15]

                    tracking-[-0.03em]

                    text-secondary

                    sm:text-[28px]

                    lg:text-[31px]
                  "
                >
                  {event.eventName}
                </h1>
                <p className="mt-1 text-xs text-gray-500">All event times: {eventTimeZone(event.timeZone)}</p>

                <div
                  className="
                    mt-3

                    flex
                    items-start
                    gap-1.5

                    text-[12px]
                    leading-5

                    text-gray-500

                    sm:text-[13px]
                  "
                >
                  <span
                    className="
                      mt-[2px]
                      shrink-0

                      text-primary
                    "
                  >
                    <LocationIcon />
                  </span>

                  <span>
                    {
                      event.venue
                    }
                  </span>
                </div>

                {event.description && (
                  <p
                    className="
                      mt-3

                      max-w-2xl

                      line-clamp-2

                      text-[12px]
                      leading-5

                      text-gray-500

                      sm:text-[13px]
                    "
                  >
                    {
                      event.description
                    }
                  </p>
                )}
              </div>

              {/* DESKTOP STEP SUMMARY */}

              <div
                className="
                  hidden

                  rounded-xl

                  border
                  border-gray-200

                  bg-[#FAFBFC]

                  p-4

                  md:block
                "
              >
                <p
                  className="
                    text-[12px]
                    font-semibold
                    uppercase

                    tracking-[0.06em]

                    text-gray-400
                  "
                >
                  Booking step
                </p>

                <p
                  className="
                    mt-1.5

                    text-[15px]
                    font-semibold

                    text-secondary
                  "
                >
                  Choose your time
                </p>

                <p
                  className="
                    mt-1

                    text-[13px]
                    leading-5

                    text-gray-500
                  "
                >
                  Select an event date,
                  then choose one
                  available slot.
                </p>
              </div>
            </div>
          </div>

          {/* =================================================
              BODY
          ================================================= */}

          <div
            className="
              px-4
              py-5

              sm:px-6
              sm:py-6

              lg:px-8
              lg:py-7
            "
          >
            {/* =================================================
                DATE SECTION
            ================================================= */}

            <section>
              <div
                className="
                  flex
                  items-end
                  justify-between

                  gap-4
                "
              >
                <div>
                  <p
                    className="
                      text-[12px]
                      font-semibold
                      uppercase

                      tracking-[0.07em]

                      text-gray-400
                    "
                  >
                    Step 1
                  </p>

                  <h2
                    className="
                      mt-1

                      text-[15px]
                      font-semibold

                      text-secondary

                      sm:text-[16px]
                    "
                  >
                    Select a date
                  </h2>
                </div>

                <span
                  className="
                    text-[12px]
                    font-medium

                    text-gray-400
                  "
                >
                  {days.length}{' '}
                  {days.length ===
                  1
                    ? 'day'
                    : 'days'}
                </span>
              </div>

              {days.length ===
              0 ? (
                <EmptyBlock
                  title="No event dates available"
                  message="The schedule for this event has not been configured yet."
                />
              ) : (
                <div
                  className="
                    mt-3

                    flex
                    gap-2.5

                    overflow-x-auto

                    pb-1

                    scrollbar-hide

                    sm:flex-wrap
                    sm:overflow-visible
                  "
                >
                  {days.map(
                    (day) => {
                      const active =
                        day._id ===
                        selectedDay?._id;

                      const date =
                        new Date(
                          day.date,
                        );

                      return (
                        <motion.button
                          key={
                            day._id
                          }
                          type="button"
                          onClick={() =>
                            handleSelectDay(
                              day._id,
                            )
                          }
                          whileTap={{
                            scale:
                              0.97,
                          }}
                          className={`
                            min-w-[92px]
                            shrink-0

                            rounded-xl

                            border

                            px-3
                            py-3

                            text-center

                            transition-all
                            duration-200

                            sm:min-w-[104px]

                            ${
                              active
                                ? `
                                  border-primary
                                  bg-primary
                                  text-white

                                  shadow-[0_8px_18px_rgba(40,63,143,0.14)]
                                `
                                : `
                                  border-gray-200
                                  bg-white
                                  text-secondary

                                  hover:border-primary/30
                                  hover:bg-primary/[0.025]
                                `
                            }
                          `}
                        >
                          <span
                            className={`
                              block

                              text-[12px]
                              font-semibold
                              uppercase

                              tracking-[0.05em]

                              ${
                                active
                                  ? 'text-white/75'
                                  : 'text-gray-400'
                              }
                            `}
                          >
                            {calendarDateFormatter(
                              'en-IN',
                              {
                                weekday:
                                  'short',
                              },
                            ).format(
                              date,
                            )}
                          </span>

                          <span
                            className="
                              mt-1
                              block

                              text-[20px]
                              font-bold

                              leading-none
                            "
                          >
                            {calendarDateFormatter(
                              'en-IN',
                              {
                                day:
                                  '2-digit',
                              },
                            ).format(
                              date,
                            )}
                          </span>

                          <span
                            className={`
                              mt-1
                              block

                              text-[12px]
                              font-medium

                              ${
                                active
                                  ? 'text-white/80'
                                  : 'text-gray-500'
                              }
                            `}
                          >
                            {calendarDateFormatter(
                              'en-IN',
                              {
                                month:
                                  'short',
                                year:
                                  'numeric',
                              },
                            ).format(
                              date,
                            )}
                          </span>
                        </motion.button>
                      );
                    },
                  )}
                </div>
              )}
            </section>

            <div
              className="
                my-6
                h-px
                bg-gray-200
              "
            />

            {/* =================================================
                SLOT SECTION
            ================================================= */}

            <section>
              <div
                className="
                  flex
                  items-end
                  justify-between

                  gap-3
                "
              >
                <div>
                  <p
                    className="
                      text-[12px]
                      font-semibold
                      uppercase

                      tracking-[0.07em]

                      text-gray-400
                    "
                  >
                    Step 2
                  </p>

                  <h2
                    className="
                      mt-1

                      text-[15px]
                      font-semibold

                      text-secondary

                      sm:text-[16px]
                    "
                  >
                    Choose a time
                  </h2>
                </div>

                <div
                  className="
                    shrink-0

                    text-right
                  "
                >
                  <p
                    className="
                      text-[13px]
                      font-semibold

                      text-secondary
                    "
                  >
                    {availableCount}{' '}
                    available
                  </p>

                  <p
                    className="
                      mt-0.5

                      text-[12px]

                      text-gray-400
                    "
                  >
                    of{' '}
                    {
                      totalSlots
                    }{' '}
                    total
                  </p>
                </div>
              </div>

              {/* LEGEND */}

              <div
                className="
                  mt-3

                  flex
                  flex-wrap
                  items-center

                  gap-x-4
                  gap-y-2
                "
              >
                <LegendItem
                  type="available"
                  label="Available"
                />

                <LegendItem
                  type="selected"
                  label="Selected"
                />

                <LegendItem
                  type="booked"
                  label="Booked"
                />
              </div>

              {!selectedDay ||
              selectedDay.slots
                .length === 0 ? (
                <EmptyBlock
                  title="No time slots available"
                  message="There are currently no time slots configured for the selected date."
                />
              ) : (
                <div
                  className="
                    mt-4

                    grid
                    grid-cols-2

                    gap-2.5

                    sm:grid-cols-3

                    lg:grid-cols-4
                    lg:gap-3
                  "
                >
                  {selectedDay.slots.map(
                    (
                      slot,
                    ) => {
                      const selected =
                        selectedSlotId ===
                        slot._id;

                      const booked =
                        !slot.available;

                      return (
                        <motion.button
                          key={
                            slot._id
                          }
                          type="button"
                          disabled={
                            booked
                          }
                          whileTap={
                            booked
                              ? undefined
                              : {
                                  scale:
                                    0.98,
                                }
                          }
                          onClick={() =>
                            handleSlotSelect(
                              slot,
                            )
                          }
                          className={`
                            relative

                            flex
                            min-h-[62px]

                            flex-col

                            items-center
                            justify-center

                            rounded-xl

                            border

                            px-2.5
                            py-2.5

                            text-center

                            transition-all
                            duration-200

                            ${
                              booked
                                ? `
                                  cursor-not-allowed

                                  border-gray-200

                                  bg-gray-100

                                  text-gray-400
                                `
                                : selected
                                  ? `
                                    border-primary

                                    bg-primary/[0.07]

                                    text-primary

                                    shadow-[inset_0_0_0_1px_rgba(40,63,143,0.10)]
                                  `
                                  : `
                                    cursor-pointer

                                    border-gray-200

                                    bg-white

                                    text-secondary

                                    hover:-translate-y-0.5
                                    hover:border-primary/30
                                    hover:bg-primary/[0.02]
                                    hover:shadow-[0_5px_14px_rgba(15,23,41,0.05)]
                                  `
                            }
                          `}
                        >
                          <span
                            className="
                              text-[12px]
                              font-semibold

                              leading-5

                              sm:text-[13px]
                            "
                          >
                            {
                              slot.startTime
                            }
                            {' – '}
                            {
                              slot.endTime
                            }
                          </span>

                          <span
                            className={`
                              mt-0.5

                              text-[12px]
                              font-medium

                              ${
                                booked
                                  ? 'text-gray-400'
                                  : selected
                                    ? 'text-primary'
                                    : slot.remaining <=
                                        2
                                      ? 'text-red-500'
                                      : 'text-gray-400'
                              }
                            `}
                          >
                            {slot.ended
                              ? 'Time passed'
                              : booked
                              ? 'Fully booked'
                              : `${slot.remaining} ${
                                  slot.remaining ===
                                  1
                                    ? 'place'
                                    : 'places'
                                } left`}
                          </span>

                          {selected && (
                            <span
                              className="
                                absolute
                                right-2
                                top-2

                                grid
                                h-4
                                w-4

                                place-items-center

                                rounded-full

                                bg-primary

                                text-white
                              "
                            >
                              <svg
                                className="
                                  h-2.5
                                  w-2.5
                                "
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={3}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="m5 12 4 4L19 6"
                                />
                              </svg>
                            </span>
                          )}
                        </motion.button>
                      );
                    },
                  )}
                </div>
              )}
            </section>

            {/* =================================================
                SELECTED SUMMARY
            ================================================= */}

            <AnimatePresence>
              {selectedDay &&
                selectedSlot && (
                  <motion.div
                    initial={{
                      opacity: 0,
                      y: 8,
                      height: 0,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      height:
                        'auto',
                    }}
                    exit={{
                      opacity: 0,
                      y: 6,
                      height: 0,
                    }}
                    transition={{
                      duration:
                        0.28,
                      ease: EASE,
                    }}
                    className="
                      overflow-hidden
                    "
                  >
                    <div
                      className="
                        mt-6

                        rounded-xl

                        border
                        border-primary/20

                        bg-primary/[0.035]

                        px-4
                        py-3.5
                      "
                    >
                      <div
                        className="
                          flex
                          items-start

                          gap-3
                        "
                      >
                        <div
                          className="
                            mt-0.5

                            grid
                            h-8
                            w-8

                            shrink-0

                            place-items-center

                            rounded-lg

                            bg-primary/10

                            text-primary
                          "
                        >
                          <svg
                            className="
                              h-4
                              w-4
                            "
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m5 12 4 4L19 6"
                            />
                          </svg>
                        </div>

                        <div
                          className="
                            min-w-0
                          "
                        >
                          <p
                            className="
                              text-[12px]
                              font-semibold
                              uppercase

                              tracking-[0.05em]

                              text-gray-400
                            "
                          >
                            Selected appointment
                          </p>

                          <p
                            className="
                              mt-1

                              text-[13px]
                              font-semibold

                              text-secondary
                            "
                          >
                            {formatSelectedDate(
                              selectedDay.date,
                            )}
                          </p>

                          <p
                            className="
                              mt-0.5

                              text-[12px]

                              text-gray-500
                            "
                          >
                            {
                              selectedSlot.startTime
                            }
                            {' – '}
                            {
                              selectedSlot.endTime
                            }
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
            </AnimatePresence>

            {/* ERROR */}

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{
                    opacity: 0,
                    y: 5,
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                  }}
                  exit={{
                    opacity: 0,
                    y: 5,
                  }}
                  className="
                    mt-4

                    rounded-xl

                    border
                    border-red-200

                    bg-red-50

                    px-3.5
                    py-3

                    text-[13px]
                    font-medium
                    leading-5

                    text-red-700

                    sm:text-xs
                  "
                >
                  {error} <button type="button" className="ml-3 underline" onClick={() => { void loadSlots(true); }}>Retry</button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* =================================================
                DESKTOP ACTIONS
            ================================================= */}

            <div
              className="
                mt-7

                hidden

                grid-cols-2

                gap-3

                md:grid
              "
            >
              <button
                type="button"
                onClick={() =>
                  router.back()
                }
                className="
                  flex
                  h-12
                  items-center
                  justify-center

                  rounded-xl

                  border
                  border-gray-300

                  bg-white

                  text-sm
                  font-semibold

                  text-secondary

                  transition-all
                  duration-200

                  hover:border-primary/25
                  hover:bg-gray-50

                  active:scale-[0.995]
                "
              >
                Back to Details
              </button>

              <button
                type="button"
                disabled={!selectedSlot || submitting}
                onClick={() => void handleContinue()}
                className="
                  flex
                  h-12
                  items-center
                  justify-center

                  btn-primary rounded-full text-[16px] font-medium text-white disabled:bg-none

                  transition-all
                  duration-200

                  hover:brightness-95

                  active:scale-[0.995]

                  disabled:cursor-not-allowed
                  disabled:bg-gray-200
                  disabled:text-gray-400
                  disabled:shadow-none
                "
              >
                {submitting ? 'Booking your slot...' : availableCount === 0 ? 'No slots left for this date' : 'Confirm booking'}
              </button>
            </div>
          </div>
        </motion.section>

        <p
          className="
            mx-auto
            mt-4
            max-w-xl

            px-3

            text-center

            text-[12px]
            leading-4

            text-gray-400

            sm:text-[12px]
          "
        >
          Slot availability may change until the booking is confirmed.
        </p>
      </div>

      {/* =====================================================
          MOBILE STICKY FOOTER
      ===================================================== */}

      <div
        className="
          fixed
          inset-x-0
          bottom-0 max-md:bottom-[var(--user-nav-h)]
          z-50

          border-t
          border-gray-200/80

          bg-white/95

          px-4

          pb-[max(12px,env(safe-area-inset-bottom))]
          pt-3

          shadow-[0_-8px_24px_rgba(15,23,41,0.06)]

          backdrop-blur-xl

          md:hidden
        "
      >
        <div
          className="
            mx-auto
            w-full
            max-w-[500px]
          "
        >
          {selectedDay &&
            selectedSlot && (
              <div
                className="
                  mb-2.5

                  flex
                  items-center
                  justify-between

                  gap-3
                "
              >
                <div
                  className="
                    min-w-0
                  "
                >
                  <p
                    className="
                      truncate

                      text-[12px]
                      font-medium

                      text-gray-400
                    "
                  >
                    Selected
                  </p>

                  <p
                    className="
                      truncate

                      text-[13px]
                      font-semibold

                      text-secondary
                    "
                  >
                    {formatSelectedDate(
                      selectedDay.date,
                    )}
                    {' · '}
                    {
                      selectedSlot.startTime
                    }
                    {' – '}
                    {
                      selectedSlot.endTime
                    }
                  </p>
                </div>

                <span
                  className="
                    shrink-0

                    rounded-full

                    bg-primary/10

                    px-2
                    py-1

                    text-[12px]
                    font-semibold

                    text-primary
                  "
                >
                  Selected
                </span>
              </div>
            )}

          <button
            type="button"
            disabled={!selectedSlot || submitting}
                onClick={() => void handleContinue()}
            className="
              flex
              h-12
              w-full

              items-center
              justify-center

              btn-primary rounded-full text-[16px] font-medium text-white disabled:bg-none

              transition-all

              active:scale-[0.995]

              disabled:cursor-not-allowed
              disabled:bg-gray-200
              disabled:text-gray-400
              disabled:shadow-none
            "
          >
            {submitting ? 'Booking your slot...' : availableCount === 0 ? 'No slots left for this date' : 'Confirm booking'}
          </button>

          <button
            type="button"
            onClick={() =>
              router.back()
            }
            className="
              mt-2

              flex
              h-10
              w-full

              items-center
              justify-center

              text-[12px]
              font-semibold

              text-gray-500

              transition

              hover:text-secondary
            "
          >
            Back to Details
          </button>
        </div>
      </div>
    </main>
  );
}

/* ============================================================
   STATUS BADGE
============================================================ */

function StatusBadge({
  status,
}: {
  status:
    SlotEvent['status'];
}) {
  return (
    <span
      className={`
        inline-flex
        items-center
        gap-1.5

        rounded-full

        px-2
        py-1

        text-[12px]
        font-bold
        uppercase

        tracking-[0.06em]

        ${
          status ===
          'LIVE'
            ? `
              bg-[rgba(25,204,106,0.12)]
              text-[#15935A]
            `
            : status ===
                'UPCOMING'
              ? `
                bg-primary/[0.07]
                text-primary
              `
              : `
                bg-gray-100
                text-gray-500
              `
        }
      `}
    >
      {status ===
        'LIVE' && (
        <span
          className="
            h-1.5
            w-1.5

            rounded-full

            bg-[#19CC6A]
          "
        />
      )}

      {status}
    </span>
  );
}

/* ============================================================
   LEGEND
============================================================ */

function LegendItem({
  type,
  label,
}: {
  type:
    | 'available'
    | 'selected'
    | 'booked';

  label: string;
}) {
  return (
    <div
      className="
        flex
        items-center
        gap-1.5
      "
    >
      <span
        className={`
          h-2
          w-2

          rounded-full

          ${
            type ===
            'available'
              ? 'bg-gray-300'
              : type ===
                  'selected'
                ? 'bg-primary'
                : 'bg-gray-400'
          }
        `}
      />

      <span
        className="
          text-[12px]
          font-medium

          text-gray-500

          sm:text-[12px]
        "
      >
        {label}
      </span>
    </div>
  );
}

/* ============================================================
   EMPTY BLOCK
============================================================ */

function EmptyBlock({
  title,
  message,
}: {
  title: string;

  message: string;
}) {
  return (
    <div
      className="
        mt-4

        rounded-xl

        border
        border-dashed
        border-gray-200

        bg-[#FAFBFC]

        px-4
        py-7

        text-center
      "
    >
      <div
        className="
          mx-auto

          grid
          h-9
          w-9

          place-items-center

          rounded-full

          bg-white

          text-gray-400

          shadow-sm
        "
      >
        <svg
          className="
            h-4
            w-4
          "
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <circle
            cx="12"
            cy="12"
            r="8"
          />

          <path
            strokeLinecap="round"
            d="M12 8v4l2.5 1.5"
          />
        </svg>
      </div>

      <p
        className="
          mt-3

          text-[13px]
          font-semibold

          text-secondary
        "
      >
        {title}
      </p>

      <p
        className="
          mx-auto
          mt-1

          max-w-sm

          text-[13px]
          leading-5

          text-gray-500
        "
      >
        {message}
      </p>
    </div>
  );
}

/* ============================================================
   ERROR PAGE
============================================================ */

function SlotsError({
  message,
  onBack,
  onRetry,
}: {
  message: string;

  onBack:
    () => void;

  onRetry:
    () => void;
}) {
  return (
    <main
      className="
        min-h-dvh
        bg-[#F7F9FB]
      "
    >

      <div
        className="
          flex

          min-h-[calc(100dvh-64px)]

          items-center
          justify-center

          px-4
          py-10
        "
      >
        <div
          className="
            w-full
            max-w-[410px]

            rounded-2xl

            border
            border-gray-200

            bg-white

            p-6

            text-center

            shadow-[0_12px_35px_rgba(15,23,41,0.06)]
          "
        >
          <div
            className="
              mx-auto

              grid
              h-11
              w-11

              place-items-center

              rounded-full

              bg-gray-50

              text-gray-400
            "
          >
            <svg
              className="
                h-5
                w-5
              "
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <circle
                cx="12"
                cy="12"
                r="8"
              />

              <path
                strokeLinecap="round"
                d="M12 8v4"
              />

              <circle
                cx="12"
                cy="16"
                r=".8"
                fill="currentColor"
                stroke="none"
              />
            </svg>
          </div>

          <h1
            className="
              mt-4

              text-lg
              font-bold

              text-secondary
            "
          >
            Time slots unavailable
          </h1>

          <p
            className="
              mt-2

              text-[13px]
              leading-6

              text-gray-500
            "
          >
            {message}
          </p>

          <div
            className="
              mt-5

              grid
              grid-cols-2

              gap-2.5
            "
          >
            <button
              type="button"
              onClick={
                onBack
              }
              className="
                h-11

                rounded-xl

                border
                border-gray-200

                bg-white

                text-sm
                font-semibold

                text-secondary

                transition

                hover:bg-gray-50
              "
            >
              Go back
            </button>

            <button
              type="button"
              onClick={
                onRetry
              }
              className="
                h-11

                rounded-xl

                bg-primary

                text-sm
                font-semibold

                text-white

                transition

                hover:brightness-95
              "
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ============================================================
   SIMPLE HEADER
============================================================ */

/* ============================================================
   DATE FORMAT
============================================================ */

function formatSelectedDate(
  value: string,
) {
  return calendarDateFormatter(
    'en-IN',
    {
      weekday:
        'short',

      day:
        '2-digit',

      month:
        'short',

      year:
        'numeric',
    },
  ).format(
    new Date(
      value,
    ),
  );
}

/* ============================================================
   LOCATION ICON
============================================================ */

function LocationIcon() {
  return (
    <svg
      className="
        h-4
        w-4
      "
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.9}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 21s6-5.686 6-11a6 6 0 10-12 0c0 5.314 6 11 6 11z"
      />

      <circle
        cx="12"
        cy="10"
        r="2"
      />
    </svg>
  );
}

/* ============================================================
   LOADING
============================================================ */

function SlotsLoading() {
  return (
    <main
      className="
        min-h-dvh
        bg-[#F7F9FB]
      "
    >

      <div
        className="
          mx-auto
          w-full
          max-w-[1100px]

          px-3
          py-4

          sm:px-5
          sm:py-5

          lg:px-7
          lg:py-7
        "
      >
        <div
          className="
            overflow-hidden

            rounded-[18px]

            border
            border-gray-200

            bg-white

            shadow-[0_8px_28px_rgba(15,23,41,0.05)]
          "
        >
          <div
            className="
              border-b
              border-gray-200

              px-4
              py-5

              sm:px-6
              sm:py-6
            "
          >
            <div
              className="
                h-3
                w-24

                animate-pulse

                rounded

                bg-gray-100
              "
            />

            <div
              className="
                mt-3

                h-7
                w-[300px]
                max-w-[80%]

                animate-pulse

                rounded

                bg-gray-200
              "
            />

            <div
              className="
                mt-3

                h-4
                w-[220px]

                animate-pulse

                rounded

                bg-gray-100
              "
            />
          </div>

          <div
            className="
              px-4
              py-5

              sm:px-6
              sm:py-6
            "
          >
            <div
              className="
                h-4
                w-28

                animate-pulse

                rounded

                bg-gray-100
              "
            />

            <div
              className="
                mt-4

                flex
                gap-2.5
              "
            >
              {Array.from({
                length: 4,
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
                      h-[72px]
                      w-[96px]

                      animate-pulse

                      rounded-xl

                      bg-gray-100
                    "
                  />
                ),
              )}
            </div>

            <div
              className="
                my-6
                h-px
                bg-gray-200
              "
            />
            <div
              className="
                h-4
                w-32

                animate-pulse

                rounded

                bg-gray-100
              "
            />
            <div
              className="
                mt-4

                grid
                grid-cols-2

                gap-2.5

                sm:grid-cols-3

                lg:grid-cols-4
              "
            >
              {Array.from({
                length: 8,
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
                      h-[62px]

                      animate-pulse

                      rounded-xl

                      bg-gray-100
                    "
                  />
                ),
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/** Registration-only events: no slot to choose, just confirm the registration. */
function OpenRegistration({ event, submitting, error, onBack, onConfirm }: {
  event: SlotEvent; submitting: boolean; error: string; onBack: () => void; onConfirm: () => void;
}) {
  const format = calendarDateFormatter('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const start = format.format(new Date(event.startDate)), end = format.format(new Date(event.endDate));
  const full = event.remaining === 0;
  const closed = event.status === 'COMPLETED' || event.status === 'CANCELLED';
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-8 md:pt-14">
      <h1 className="text-[26px] font-semibold leading-tight text-secondary md:text-[32px]">Confirm your registration</h1>
      <p className="mt-3 text-[16px] leading-[1.6] text-gray-600">
        This event does not use time slots. Once you confirm, your ticket with its QR code is shown on screen and sent to you by email. Present it at the venue on {start === end ? 'the day' : 'any day of the event'}.
      </p>
      <dl className="mt-6 space-y-3 rounded-[18px] bg-gray-50 p-5 text-[15px]">
        <div><dt className="text-gray-500">Event</dt><dd className="font-semibold text-secondary">{event.eventName}</dd></div>
        <div><dt className="text-gray-500">{start === end ? 'Date' : 'Dates'}</dt><dd className="font-semibold text-secondary">{start === end ? start : `${start} to ${end}`}</dd></div>
        <div><dt className="text-gray-500">Venue</dt><dd className="font-semibold text-secondary">{event.venue}</dd></div>
        {typeof event.remaining === 'number' && !full && (
          <div><dt className="text-gray-500">Places remaining</dt><dd className="font-semibold text-secondary">{event.remaining}</dd></div>
        )}
      </dl>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-[14px] text-red-700">{error}</p>}
      {full && !closed && <p className="mt-4 text-[15px] font-medium text-gray-700">Registration for this event is full.</p>}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting || full || closed}
          className="btn-primary h-12 flex-1 rounded-full text-[16px] font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Confirming…' : 'Confirm registration'}
        </button>
        <button type="button" onClick={onBack} className="h-12 flex-1 rounded-full border border-gray-200 text-[16px] font-medium text-secondary">
          Back
        </button>
      </div>
    </main>
  );
}

