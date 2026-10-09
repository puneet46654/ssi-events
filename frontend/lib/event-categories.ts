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
  /** Card image in /public (SSI's own library) and its description for screen readers. */
  image: string;
  imageAlt: string;
  /** Its own page: introduction, list heading and empty state. */
  page: { path: string; title: string; intro: string[]; listHeading: string; empty: string };
  /**
   * Registration happens on another site. Until `externalUrl` is set, the page is a
   * "coming soon" notice; once it is, the card links straight there.
   */
  external?: { comingSoon: string; externalUrl?: string };
};

export const EVENT_CATEGORIES: EventCategory[] = [
  {
    type: 'conference',
    name: 'SMRSC',
    heading: 'SMRSC',
    description: 'The SSI Multi-Specialty Robotic Surgery Conference.',
    image: '/images/categories/smrsc.webp',
    imageAlt: 'Delegates in the audience at an SMRSC session',
    page: {
      path: '/smrsc',
      title: 'SMRSC',
      intro: [
        'The SSI Multi-Specialty Robotic Surgery Conference brings together surgeons from across specialties to share clinical experience with robotic surgery.',
      ],
      listHeading: 'Registration',
      empty: '',
    },
    external: {
      comingSoon: 'Registration for SMRSC will open on the conference website. We will publish the link here as soon as it is available.',
    },
  },
  {
    type: 'mantram',
    name: 'MantraM',
    heading: 'MantraM',
    description: 'Our mobile tele-surgical unit, carrying the SSI Mantra surgical robotic system.',
    image: '/images/categories/mantram.webp',
    imageAlt: 'The SSi MantraM mobile unit, parked with its awning extended',
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
    image: '/images/categories/cme.webp',
    imageAlt: 'The SSI Mantra training simulator showing a simulated procedure',
    page: {
      path: '/cme',
      title: 'CME and workshops',
      intro: [
        'Our continuing medical education programmes and hands-on workshops give surgeons and clinical teams structured experience with robotic surgery.',
        'Choose a programme below and book a time slot. Your ticket is shown on screen and sent to you by email.',
      ],
      listHeading: 'Upcoming programmes',
      empty: 'No CME programmes or workshops are open for registration at present. New programmes are published here as they are scheduled.',
    },
  },
];

export function categoryOf(type: string | undefined): EventCategory {
  return EVENT_CATEGORIES.find((c) => c.type === type) ?? EVENT_CATEGORIES[2]!;
}
