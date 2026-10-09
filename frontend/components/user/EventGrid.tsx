'use client';

/* Event cards shared by the home page catalogue and the category pages (/mantram, ...). */

import { memo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { calendarDateFormatter } from '@/lib/events/dates';

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
