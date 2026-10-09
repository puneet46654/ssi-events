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
    description: 'MantraM programmes hosted by SS Innovations.',
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
