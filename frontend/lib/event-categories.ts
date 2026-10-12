/**
 * The kinds of event on the site. `type` is the stored eventType; admins choose it when they
 * create an event, and the home page groups events by it. `participation` covers conferences
 * where SS Innovations exhibits or presents; these are usually information-only listings.
 */
export type EventCategoryType = 'conference' | 'mantram' | 'event' | 'participation';

export type EventCategory = {
  type: EventCategoryType;
  name: string;
  /** Shown on each event's card to say what kind of event it is, e.g. "SSi MantraM". */
  cardLabel: string;
  /** Plural form for headings, e.g. "Upcoming CME and workshops". */
  heading: string;
  description: string;
  /** Card image in /public (SSI's own library) and its description for screen readers. */
  image: string;
  imageAlt: string;
  /**
   * Its own page: list heading and empty state, then the About section below the events:
   * paragraphs and optional numbered steps.
   */
  page: {
    path: string; title: string; listHeading: string; empty: string;
    intro: string[];
    steps?: { heading: string; items: string[] };
  };
  /**
   * Registration happens on another site. Until `externalUrl` is set, the page is a
   * "registration details to follow" notice; once it is, the card links straight there.
   */
  external?: { comingSoon: string; externalUrl?: string };
  /** The page also lists past events of this kind under `pastHeading`, newest first. */
  archive?: { pastHeading: string };
};

// Product facts follow SS Innovations' published descriptions of SSi Mantra 3 and SSi MantraM.
export const EVENT_CATEGORIES: EventCategory[] = [
  {
    type: 'conference',
    name: 'SMRSC',
    cardLabel: 'SMRSC',
    heading: 'SMRSC',
    description: 'The Global SSI Multi-Specialty Robotic Surgery Conference, hosted by SS Innovations.',
    image: '/images/categories/smrsc.webp',
    imageAlt: 'Delegates in the audience at an SMRSC session',
    page: {
      path: '/smrsc',
      title: 'SMRSC',
      intro: [
        'Surgeons who operate with SSi Mantra present their clinical work across specialties, alongside sessions on telesurgery and training. SSi MantraM was unveiled at SMRSC 2025 in Gurugram.',
      ],
      listHeading: 'Registration',
      empty: '',
    },
    external: {
      comingSoon: 'Registration is on the conference website. The link will be added here when registration opens.',
    },
  },
  {
    type: 'mantram',
    name: 'MantraM',
    cardLabel: 'SSi MantraM',
    heading: 'MantraM',
    description: 'India’s first mobile tele-robotic surgery unit, bringing SSi Mantra 3 to your hospital.',
    image: '/images/categories/mantram.webp',
    imageAlt: 'The SSi MantraM mobile unit, parked with its awning extended',
    page: {
      path: '/mantram',
      title: 'SSi MantraM',
      intro: [
        'SSi MantraM brings the SSi Mantra 3 system to hospitals so that surgeons and theatre teams can work with it where they practise, and its connectivity supports telesurgery and tele-proctoring, for which SSi Mantra is approved by India’s CDSCO.',
      ],
      steps: {
        heading: 'Your visit',
        items: [
          'Book a time slot. Your QR ticket is shown on screen and sent by email.',
          'Check in at the unit up to 15 minutes before your slot.',
          'Our clinical team takes you through the system, then you take the console.',
        ],
      },
      listHeading: 'Upcoming visits',
      empty: 'No visits are open for registration.',
    },
  },
  {
    type: 'event',
    name: 'CME / Workshop',
    cardLabel: 'CME / Workshop',
    heading: 'CME and workshops',
    description: 'Structured robotic surgery training on SSi Mantra for surgeons and theatre teams.',
    image: '/images/categories/cme.webp',
    imageAlt: 'The SSI Mantra training simulator showing a simulated procedure',
    page: {
      path: '/cme',
      title: 'CME and workshops',
      intro: [
        'Hands-on training on SSi Mantra for surgeons and theatre teams: console skills with 3D 4K vision, positioning and docking the arm carts at the bedside, and specialty sessions led by surgeons who perform these procedures with the system.',
      ],
      listHeading: 'Upcoming programmes',
      empty: 'No programmes are open for registration.',
    },
  },
  {
    type: 'participation',
    name: 'Conferences',
    cardLabel: 'Conference',
    heading: 'Conferences',
    description: 'Meet our team and see SSi Mantra at surgical congresses in India and abroad.',
    image: '/images/categories/conferences.webp',
    imageAlt: '',
    page: {
      path: '/conferences',
      title: 'Conferences',
      intro: [
        'Visit our stand to see SSi Mantra working, sit at the console and talk to our clinical team. Each listing gives the dates, venue and stand, with links to the congress website and our posts from the event.',
      ],
      listHeading: 'Current and upcoming',
      empty: 'No upcoming conferences.',
    },
    archive: { pastHeading: 'Past conferences' },
  },
];

export function categoryOf(type: string | undefined): EventCategory {
  return EVENT_CATEGORIES.find((c) => c.type === type) ?? EVENT_CATEGORIES[2]!;
}
