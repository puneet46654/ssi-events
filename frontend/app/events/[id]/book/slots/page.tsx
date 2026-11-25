'use client';

import { calendarDate, calendarDateFormatter, eventTimeZone, zonedDate } from '@/lib/events/dates';
import { confirmBooking } from '@/lib/bookings/confirm-booking';
import BookingStepper from '@/components/user/BookingStepper';
import { useSmartBack } from '@/lib/flow-nav';
import { navigateWithTransition } from '@/lib/page-transition';
import { readBookingDetails } from '@/lib/bookings/confirm-booking';
import { useI18n } from '@/lib/i18n';


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

  /** Full but still running: the attendee may join its waitlist. */
  waitlistOpen?: boolean;

  waitlistCount?: number;
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

  const smartBack = useSmartBack();
  const { t, intl } = useI18n();

  // Whose booking this is, shown above the slots; without details there is nothing to book with.
  const [bookingFor, setBookingFor] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const details = readBookingDetails(params.id);
      if (!details) { router.replace(`/events/${encodeURIComponent(params.id)}/book`); return; }
      setBookingFor([details.title, details.fullName].filter(Boolean).join(' '));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [params.id, router]);

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
                t('slots.unableLoad'),
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
              : t('slots.unableLoad'),
          );
        } finally {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        }
      },
      [
        eventId,
        t,
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
    if (!slot.available && !slot.waitlistOpen) {
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
      !selectedSlot || !(selectedSlot.available || selectedSlot.waitlistOpen)
    ) {
      setError(
        t('slots.selectAvailable'),
      );

      return;
    }

    // The booking is created here, then the attendee lands on My Tickets with the new ticket highlighted.
    setSubmitting(true);
    setError('');
    try {
      const booking = await confirmBooking(
        eventId,
        { dayScheduleId: selectedDay._id, slotId: selectedSlot._id },
        { waitlist: !selectedSlot.available },
      );
      navigateWithTransition(() => router.replace(`/events/mytickets?booked=${encodeURIComponent(booking.bookingId)}`));
    } catch (err) {
      // Seats may have changed while the attendee was choosing; refresh first, since loading clears errors.
      await loadSlots(true);
      setSubmitting(false);
      setSelectedSlotId('');
      setError(err instanceof Error ? err.message : t('slots.unableConfirm'));
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
        onBack={() => smartBack()}
        onRetry={() =>
          void loadSlots()
        }
      />
    );
  }

  if (event?.status === 'CANCELLED') {
    return <main className="mx-auto max-w-xl p-8 text-center"><h1 className="text-xl font-bold">{t('slots.cancelledTitle')}</h1>
      <p className="my-4">{t('slots.cancelledMsg')}</p>
      <button type="button" onClick={() => router.push('/')}>{t('slots.backToEvents')}</button></main>;
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
        onBack={() => smartBack()}
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
            setError(err instanceof Error ? err.message : t('slots.unableConfirmReg'));
          }
        }}
      />
    );
  }

  /* ============================================================
     PAGE
  ============================================================ */

  const timeZoneLabel = shortTimeZone(intl, event.timeZone);
  const joiningWaitlist = !!selectedSlot && !selectedSlot.available && !!selectedSlot.waitlistOpen;
  const anyWaitlist = !!selectedDay?.slots.some((slot) => slot.waitlistOpen);
  const confirmLabel = submitting
    ? joiningWaitlist ? t('slots.joiningWaitlist') : t('slots.bookingSlot')
    : joiningWaitlist ? t('slots.joinWaitlist')
    : availableCount === 0 && !anyWaitlist ? t('slots.noSlotsLeft')
    : t('slots.confirmBooking');

  return (
    <main className="booking-bg min-h-dvh overflow-x-hidden pb-[132px] md:pb-10">
      <div className="mx-auto w-full max-w-[1100px] px-3 pt-3 sm:px-5 sm:pt-5 lg:px-7 lg:pt-7">
        <BookingStepper step={2} onEditDetails={() => smartBack(`/events/${eventId}/book`)} />

        {bookingFor && (
          <p className="mt-2 flex items-center justify-between gap-3 px-1 text-[13px] text-gray-500">
            <span className="truncate">{t('slots.bookingFor')} <span className="font-semibold text-secondary">{bookingFor}</span></span>
            <button type="button" onClick={() => smartBack(`/events/${eventId}/book`)} className="shrink-0 font-semibold text-primary">
              {t('slots.edit')}
            </button>
          </p>
        )}

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
          className="glass mt-3 overflow-hidden rounded-[20px]"
        >
          {/* EVENT */}
          <div className="border-b border-gray-200/70 px-4 py-3.5 sm:px-6 sm:py-4 lg:px-8">
            <h1 className="font-heading text-[19px] font-bold leading-tight tracking-[-0.02em] text-secondary sm:text-[23px]">
              {event.eventName}
            </h1>
            <p className="mt-1 flex items-start gap-1.5 text-[13px] leading-5 text-gray-500">
              <span className="mt-[1px] shrink-0 text-primary"><LocationIcon /></span>
              <span>{event.venue}{timeZoneLabel && ` · ${timeZoneLabel}`}</span>
            </p>
          </div>

          <div className="px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
            {/* DATE */}
            <section>
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-[16px] font-semibold text-secondary">{t('slots.selectDate')}</h2>
                <span className="text-[13px] text-gray-400">{t(days.length === 1 ? 'slots.dayCount' : 'slots.daysCount', { n: days.length })}</span>
              </div>

              {days.length === 0 ? (
                <EmptyBlock title={t('slots.noDates')} message={t('slots.noDatesMsg')} />
              ) : (
                <div className="scrollbar-hide mt-3 flex gap-2.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
                  {days.map((day) => {
                    const active = day._id === selectedDay?._id;
                    const date = new Date(day.date);
                    return (
                      <motion.button
                        key={day._id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => handleSelectDay(day._id)}
                        whileTap={{ scale: 0.97 }}
                        className={`flex shrink-0 items-baseline gap-1.5 rounded-full border px-4 py-2 text-[14px] transition-[background-color,border-color,color,box-shadow] duration-300 ease-out ${
                          active
                            ? 'border-primary bg-primary text-white shadow-[0_8px_18px_rgba(40,63,143,0.16)]'
                            : 'border-gray-200/80 bg-white/70 text-gray-500 hover:border-primary/30 hover:bg-white'
                        }`}
                      >
                        <span className="font-medium">{calendarDateFormatter(intl, { weekday: 'short' }).format(date)}</span>
                        <span className={`text-[17px] font-bold ${active ? 'text-white' : 'text-secondary'}`}>
                          {calendarDateFormatter(intl, { day: 'numeric' }).format(date)}
                        </span>
                        <span className="font-medium">{calendarDateFormatter(intl, { month: 'short' }).format(date)}</span>
                      </motion.button>
                    );
                  })}
                </div>
              )}
            </section>

            <div className="my-4 h-px bg-gray-200/70" />

            {/* TIME */}
            <section>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[16px] font-semibold text-secondary">{t('slots.chooseTime')}</h2>
                <span className="text-[13px] text-gray-400">{t('slots.openOf', { a: availableCount, b: totalSlots })}</span>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
                <LegendItem type="available" label={t('slots.legendAvailable')} />
                <LegendItem type="selected" label={t('slots.legendSelected')} />
                {anyWaitlist && <LegendItem type="waitlist" label={t('slots.legendWaitlist')} />}
              </div>

              {!selectedDay || selectedDay.slots.length === 0 ? (
                <EmptyBlock title={t('slots.noSlots')} message={t('slots.noSlotsMsg')} />
              ) : (
                <motion.div
                  key={selectedDay._id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="mt-3.5 grid grid-cols-3 gap-2 max-[359px]:gap-1.5 sm:gap-2.5 lg:grid-cols-4 lg:gap-3"
                >
                  {selectedDay.slots.map((slot, index) => {
                    const selected = selectedSlotId === slot._id;
                    const waitlist = !slot.available && !!slot.waitlistOpen;
                    const booked = !slot.available && !waitlist;
                    return (
                      <motion.button
                        key={slot._id}
                        type="button"
                        disabled={booked}
                        aria-pressed={selected}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, ease: EASE, delay: Math.min(index, 16) * 0.02 }}
                        whileTap={booked ? undefined : { scale: 0.96 }}
                        onClick={() => handleSlotSelect(slot)}
                        className={`relative flex min-h-[58px] flex-col items-center justify-center rounded-xl border px-1.5 py-2 text-center transition-[background-color,border-color,color,box-shadow,transform] duration-300 ease-out ${
                          booked
                            ? 'cursor-not-allowed border-gray-200/70 bg-gray-100/70 text-gray-400'
                            : selected && waitlist
                              ? 'border-amber-500 bg-amber-50/90 text-amber-800 shadow-[0_6px_16px_rgba(217,119,6,0.15)]'
                            : waitlist
                              ? 'cursor-pointer border-dashed border-amber-300 bg-amber-50/50 text-secondary hover:bg-amber-50'
                            : selected
                              ? 'border-primary bg-primary/[0.06] text-primary shadow-[0_6px_16px_rgba(40,63,143,0.12)]'
                              : 'cursor-pointer border-gray-200/80 bg-white/75 text-secondary hover:-translate-y-0.5 hover:bg-white hover:border-primary/30 hover:shadow-[0_5px_14px_rgba(15,23,41,0.05)]'
                        }`}
                      >
                        <span className="whitespace-nowrap text-[12.5px] font-medium leading-5 max-[359px]:text-[11px] sm:text-[14px]">
                          {slot.startTime} – {slot.endTime}
                        </span>
                        <span
                          className={`mt-0.5 flex items-center gap-1 text-[12px] sm:text-[13px] ${
                            booked ? 'text-gray-400' : waitlist ? 'text-amber-700' : selected ? 'text-primary' : slot.remaining <= 2 ? 'text-red-500' : 'text-gray-500'
                          }`}
                        >
                          {!booked && <span className={`h-1.5 w-1.5 rounded-full ${waitlist ? 'bg-amber-500' : slot.remaining <= 2 ? 'bg-red-500' : 'bg-emerald-500'}`} />}
                          {slot.ended ? t('slots.timePassed') : booked ? t('slots.full') : waitlist ? (slot.waitlistCount ? t('slots.waitlistCount', { n: slot.waitlistCount }) : t('slots.waitlist')) : t('slots.left', { n: slot.remaining })}
                        </span>
                        {selected && (
                          <motion.span
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: "spring", stiffness: 420, damping: 24 }}
                            className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-white ring-2 ring-white"
                          >
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" d="m5 12 4 4L19 6" />
                            </svg>
                          </motion.span>
                        )}
                      </motion.button>
                    );
                  })}
                </motion.div>
              )}
            </section>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 5 }}
                  className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] font-medium leading-5 text-red-700"
                >
                  {error} <button type="button" className="ml-3 underline" onClick={() => { void loadSlots(true); }}>{t('common.retry')}</button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* DESKTOP ACTIONS */}
            <div className="mt-7 hidden items-center justify-between gap-4 md:flex">
              <button
                type="button"
                onClick={() => smartBack()}
                className="h-12 rounded-full border border-gray-300 bg-white px-6 text-sm font-semibold text-secondary transition hover:bg-gray-50"
              >
                {t('slots.backToDetails')}
              </button>
              <div className="flex items-center gap-5">
                {selectedDay && selectedSlot && (
                  <p className="text-right text-[13px] text-gray-500">
                    {formatSelectedDate(intl, selectedDay.date)}
                    <span className="block text-[16px] font-semibold text-secondary">{selectedSlot.startTime} – {selectedSlot.endTime}</span>
                  </p>
                )}
                <button
                  type="button"
                  disabled={!selectedSlot || submitting}
                  onClick={() => void handleContinue()}
                  className="btn-primary h-12 rounded-full px-8 text-[16px] font-medium text-white transition-all disabled:cursor-not-allowed disabled:bg-gray-200 disabled:bg-none disabled:text-gray-400 disabled:shadow-none"
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </motion.section>

        <p className="mx-auto mt-4 max-w-xl px-3 text-center text-[12px] leading-4 text-gray-400">
          {t('slots.availabilityNote')}
        </p>
      </div>

      {/* MOBILE ACTION: the chosen time, then Back to details + Confirm. No tab bar here. */}
      <div className="vt-bottom glass-bar fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2.5 md:hidden">
        <div className="mx-auto w-full max-w-[500px]">
          <div className="mb-2 flex min-h-[20px] items-baseline justify-between gap-2 px-1">
            {selectedDay && selectedSlot ? (
              <motion.p key={selectedSlot._id} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: EASE }} className="truncate text-[13px] text-gray-500">
                {formatSelectedDate(intl, selectedDay.date)} · <span className="text-[15px] font-semibold text-secondary">{selectedSlot.startTime} – {selectedSlot.endTime}</span>
                {joiningWaitlist && <span className="font-semibold text-amber-700"> · {selectedSlot.waitlistCount ? t('slots.waitlistAhead', { n: selectedSlot.waitlistCount }) : t('slots.waitlist')}</span>}
              </motion.p>
            ) : (
              <p className="text-[13px] text-gray-500">{t('slots.pickSlot')}</p>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => smartBack(`/events/${eventId}/book`)}
              className="flex h-12 shrink-0 items-center gap-1 rounded-full border border-gray-200/80 bg-white/80 pl-3 pr-4 text-[14px] font-semibold text-secondary shadow-[inset_0_1px_0_rgba(255,255,255,1)] transition active:scale-95"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6" />
              </svg>
              {t('slots.details')}
            </button>
            <button
              type="button"
              disabled={!selectedSlot || submitting}
              onClick={() => void handleContinue()}
              className="btn-primary flex h-12 min-w-0 flex-1 items-center justify-center rounded-full px-4 text-[16px] font-medium text-white transition-all active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-gray-200 disabled:bg-none disabled:text-gray-400 disabled:shadow-none"
            >
              <span className="truncate">{confirmLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ============================================================
   LEGEND
============================================================ */

function LegendItem({ type, label }: { type: 'available' | 'selected' | 'booked' | 'waitlist'; label: string }) {
  const mark =
    type === 'booked'
      ? 'h-3 w-3 rounded-[3px] border border-gray-300 bg-white'
      : type === 'waitlist'
      ? 'h-3 w-3 rounded-[3px] border border-dashed border-amber-400 bg-amber-50'
      : `h-2 w-2 rounded-full ${type === 'available' ? 'bg-emerald-500' : 'bg-primary'}`;
  return (
    <div className="flex items-center gap-1.5">
      <span className={mark} />
      <span className="text-[13px] text-gray-500">{label}</span>
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
  const { t } = useI18n();
  return (
    <main
      className="
        min-h-dvh
        bg-transparent
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
            {t('slots.unavailableTitle')}
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
              {t('common.goBack')}
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
              {t('common.tryAgain')}
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

function formatSelectedDate(intl: string, value: string) {
  return calendarDateFormatter(intl, { weekday: 'short', day: 'numeric', month: 'short' })
    .format(new Date(value))
    .replace(',', '');
}

/** Short zone name for the venue line, e.g. Asia/Kolkata -> IST. */
function shortTimeZone(intl: string, timeZone?: string) {
  try {
    return new Intl.DateTimeFormat(intl, { timeZone: eventTimeZone(timeZone), timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
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
        bg-transparent
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
  const { t, intl } = useI18n();
  const format = calendarDateFormatter(intl, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const start = format.format(new Date(event.startDate)), end = format.format(new Date(event.endDate));
  const full = event.remaining === 0;
  const closed = event.status === 'COMPLETED' || event.status === 'CANCELLED';
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-16 pt-8 md:pt-14">
      <h1 className="text-[26px] font-semibold leading-tight text-secondary md:text-[32px]">{t('slots.confirmRegTitle')}</h1>
      <p className="mt-3 text-[16px] leading-[1.6] text-gray-600">
        {t(start === end ? 'slots.openIntroDay' : 'slots.openIntroAny')}
      </p>
      <dl className="mt-6 space-y-3 rounded-[18px] bg-gray-50 p-5 text-[15px]">
        <div><dt className="text-gray-500">{t('slots.event')}</dt><dd className="font-semibold text-secondary">{event.eventName}</dd></div>
        <div><dt className="text-gray-500">{t(start === end ? 'slots.date' : 'slots.dates')}</dt><dd className="font-semibold text-secondary">{start === end ? start : t('slots.dateRange', { start, end })}</dd></div>
        <div><dt className="text-gray-500">{t('slots.venue')}</dt><dd className="font-semibold text-secondary">{event.venue}</dd></div>
        {typeof event.remaining === 'number' && !full && (
          <div><dt className="text-gray-500">{t('slots.placesRemaining')}</dt><dd className="font-semibold text-secondary">{event.remaining}</dd></div>
        )}
      </dl>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-[14px] text-red-700">{error}</p>}
      {full && !closed && <p className="mt-4 text-[15px] font-medium text-gray-700">{t('slots.regFull')}</p>}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={onConfirm}
          disabled={submitting || full || closed}
          className="btn-primary h-12 flex-1 rounded-full text-[16px] font-medium text-white disabled:opacity-60"
        >
          {submitting ? t('slots.confirming') : t('slots.confirmRegistration')}
        </button>
        <button type="button" onClick={onBack} className="h-12 flex-1 rounded-full border border-gray-200 text-[16px] font-medium text-secondary">
          {t('slots.back')}
        </button>
      </div>
    </main>
  );
}

