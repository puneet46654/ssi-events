/**
 * The three kinds of event SS Innovations runs. `type` is the stored eventType; admins choose it
 * when they create an event, and the home page groups events by it.
 */
export type EventCategoryType = 'conference' | 'mantram' | 'event';

export type EventCategory = {
  type: EventCategoryType;
  name: string;
  /** Plural form for headings, e.g. "Upcoming CME and workshops". */
  heading: string;
  description: string;
  /** Its own page (e.g. /mantram), once it has one: introduction, list heading and empty state. */
  page?: { path: string; title: string; intro: string[]; listHeading: string; empty: string };
};

export const EVENT_CATEGORIES: EventCategory[] = [
  {
    type: 'conference',
    name: 'SMRSC',
    heading: 'SMRSC',
    description: 'The SSI Multi-Specialty Robotic Surgery Conference.',
  },
  {
    type: 'mantram',
    name: 'MantraM',
    heading: 'MantraM',
    description: 'Our mobile tele-surgical unit, carrying the SSI Mantra surgical robotic system.',
    page: {
      path: '/mantram',
      title: 'SSi MantraM',
      intro: [
        'SSi MantraM is our mobile tele-surgical unit. It carries the SSI Mantra surgical robotic system to host sites, bringing robotic surgery closer to the surgeons and patients who need it.',
        'Choose a visit below and book a time slot. Your ticket is shown on screen and sent to you by email.',
      ],
      listHeading: 'Upcoming visits',
      empty: 'No MantraM visits are open for registration at present. New visits are published here as they are scheduled.',
    },
  },
  {
    type: 'event',
    name: 'CME / Workshop',
    heading: 'CME and workshops',
    description: 'Continuing medical education and hands-on workshops.',
  },
];

export function categoryOf(type: string | undefined): EventCategory {
  return EVENT_CATEGORIES.find((c) => c.type === type) ?? EVENT_CATEGORIES[2]!;
}
