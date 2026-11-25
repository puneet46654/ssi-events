'use client';

/* Event cards shared by the home page catalogue and the category pages (/mantram, ...). */

import { memo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { calendarDateFormatter } from '@/lib/events/dates';
import { categoryOf } from '@/lib/event-categories';
import { useI18n } from '@/lib/i18n';

export interface IEvent {
  _id: string;

  eventName: string;

  eventType:
    | 'conference'
    | 'mantram'
    | 'event'
    | 'participation';

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

  /** `info`: listed for information only, no booking. */
  registrationMode?: 'slots' | 'open' | 'info';
}

export const EASE = [
  0.16,
  1,
  0.3,
  1,
] as const;

export function UpcomingGrid({
  events,
  completed = false,
}: {
  events:
    IEvent[];

  completed?:
    boolean;
}) {
  return (
    <div
      className="
        grid
        grid-cols-1
        gap-2.5

        sm:grid-cols-2

        xl:grid-cols-3

        md:gap-3
      "
    >
      {events.map(
        (
          event,
          index,
        ) => (
          <UpcomingEventCard
            key={
              event._id
            }
            event={
              event
            }
            index={
              index
            }
            completed={
              completed
            }
          />
        ),
      )}
    </div>
  );
}

const UpcomingEventCard = memo(function UpcomingEventCard({
  event,
  index,
  completed,
}: {
  event:
    IEvent;

  index:
    number;

  completed:
    boolean;
}) {
  const { t, intl } = useI18n();
  return (
    <motion.div
      initial={{
        opacity: 0,
        y: 6,
      }}
      whileInView={{
        opacity: 1,
        y: 0,
      }}
      viewport={{
        once: true,
      }}
      transition={{
        duration:
          0.28,

        delay:
          Math.min(
            index,
            5,
          ) * 0.025,

        ease:
          EASE,
      }}
    >
      <Link
        href={`/events/${event._id}`}
        className="
          group

          flex
          min-h-[108px]

          items-center
          gap-3

          rounded-xl

          border
          border-gray-200

          bg-white

          p-2.5

          shadow-[0_2px_10px_rgba(15,23,41,0.02)]

          transition-all
          duration-200

          hover:border-gray-300
          hover:shadow-[0_7px_20px_rgba(15,23,41,0.05)]

          md:min-h-[112px]
          md:p-3
        "
      >
        {/* THUMBNAIL */}

        <div
          className="
            relative

            h-[82px]
            w-[82px]
            shrink-0

            overflow-hidden

            rounded-lg

            bg-gray-100

            md:h-[88px]
            md:w-[88px]
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
              loading="lazy"
              sizes="90px"
              className="
                object-cover

                transition-transform
                duration-400

                group-hover:scale-[1.025]
              "
            />
          ) : (
            <EventPlaceholder
              compact
            />
          )}

          {completed && (
            <div
              className="
                absolute
                inset-0

                bg-black/15
              "
            />
          )}
        </div>

        {/* DETAILS */}

        <div
          className="
            min-w-0
            flex-1
          "
        >

          <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-primary">{event.eventType === 'event' ? t('home.cmeWorkshop') : event.eventType === 'participation' ? t('home.conferenceLabel') : categoryOf(event.eventType).cardLabel}</span>
          <h3
            className="
              mt-1

              line-clamp-2

              text-[13px]
              font-semibold

              leading-[18px]

              text-secondary

              md:text-[14px]
            "
          >
            {event.eventName}
          </h3>

          <p
            className="
              mt-1

              truncate

              text-[12px]

              text-gray-500
            "
          >
            {formatDate(
              event.startDate,
              intl,
            )}
          </p>

          <p
            className="
              mt-1

              truncate

              text-[12px]

              text-gray-400
            "
          >
            {event.description
              ?.trim() ||
              event.venue}
          </p>
        </div>

        {/* ARROW */}

        <span
          className="
            grid
            h-8
            w-8
            shrink-0

            place-items-center

            text-gray-300

            transition-colors

            group-hover:text-primary
          "
        >
          <ArrowIcon />
        </span>
      </Link>
    </motion.div>
  );
});

export function EventPlaceholder({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div
      className="
        flex
        h-full
        w-full

        items-center
        justify-center

        bg-[#F2F6F6]
      "
    >
      <span
        className="
          grid
          h-10
          w-10

          place-items-center

          rounded-lg

          border
          border-gray-200

          bg-white

          text-primary/45
        "
      >
        {compact ? (
          <EventSmallIcon />
        ) : (
          <EventIcon />
        )}
      </span>
    </div>
  );
}

export function formatDate(
  value:
    string,
  locale = 'en-GB',
) {
  const date =
    new Date(
      value,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return '';
  }

  return calendarDateFormatter(
    locale,
    {
      day:
        '2-digit',

      month:
        'short',

      year:
        'numeric',
    },
  ).format(
    date,
  );
}

export function ArrowIcon() {
  return (
    <svg
      className="h-3 w-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m9 6 6 6-6 6"
      />
    </svg>
  );
}

export function EventIcon() {
  return (
    <svg
      className="h-5 w-5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
    >
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="2"
      />

      <path
        strokeLinecap="round"
        d="M8 9h8M8 13h5"
      />
    </svg>
  );
}

export function EventSmallIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
    >
      <rect
        x="4"
        y="5"
        width="16"
        height="14"
        rx="2"
      />

      <path
        strokeLinecap="round"
        d="M8 9h8M8 13h5"
      />
    </svg>
  );
}

/* Large card with image, used for events open for registration (home page and category pages). */
export const OpenEventCard = memo(function OpenEventCard({
  event,
  index,
}: {
  event:
    IEvent;

  index:
    number;
}) {
  const { t, intl } = useI18n();
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
          <span className="block text-[12px] font-semibold uppercase tracking-[0.06em] text-primary">{event.eventType === 'event' ? t('home.cmeWorkshop') : event.eventType === 'participation' ? t('home.conferenceLabel') : categoryOf(event.eventType).cardLabel}</span>

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
                intl,
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
                {t('home.about')}
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
                  t('home.viewEventInfoFallback')}
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
                {event.registrationMode === 'info' ? t('home.informationOnly') : t('home.registrationAvailable')}
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
                {t('home.viewEvent')}

                <ArrowIcon />
              </span>
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
});

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

export function formatDateRange(
  startValue:
    string,

  endValue:
    string,
  locale = 'en-GB',
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
      locale,
    );
  }

  const startLabel =
    calendarDateFormatter(
      locale,
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
      locale,
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
