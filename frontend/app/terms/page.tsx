import type { Metadata } from 'next';
import EventsLayout from '../events/layout';
import { LegalPage, type LegalSection } from '@/components/user/LegalPage';

export const metadata: Metadata = {
  title: 'Event terms | SS Innovations Events',
  description: 'Terms for registering for and attending SS Innovations events.',
  alternates: { canonical: '/terms' },
};

// Draft pending regulatory and legal review.
const SECTIONS: LegalSection[] = [
  {
    heading: 'Registration',
    items: [
      'Our events are intended for healthcare professionals and invited guests.',
      'Register once, in your own name, with accurate details.',
      'Places are limited and confirmed only when you receive your ticket.',
    ],
  },
  {
    heading: 'Your ticket',
    items: [
      'Your QR ticket is personal and cannot be transferred.',
      'Show it at the venue. Check-in opens 15 minutes before your time slot.',
      'If you arrive outside your slot, staff may move you to another slot with free seats; this cannot be guaranteed.',
    ],
  },
  {
    heading: 'Changing or cancelling your booking',
    paragraphs: [
      'You can reschedule or cancel from My tickets before your slot starts and before you have checked in. For events without time slots you can cancel until the event ends. Please cancel if you cannot attend, so that your place can go to someone else.',
    ],
  },
  {
    heading: 'Changes to events',
    paragraphs: [
      'We may need to change the schedule, venue or programme of an event, or cancel it. If that affects your booking, we will email you at the address you registered with.',
    ],
  },
  {
    heading: 'At the event',
    items: [
      'Follow the instructions of SS Innovations staff, particularly around the surgical robotic system and its equipment.',
      'Hands-on time on the system is supervised and offered at the discretion of our clinical team.',
      'Photographs and video may be taken at events for SS Innovations communications. Tell our staff if you prefer not to be included.',
    ],
  },
  {
    heading: 'Product information',
    paragraphs: [
      'SSi Mantra and SSi MantraM are not available in all countries. Availability and approved uses depend on local regulatory approval. Information at our events and on this site is for healthcare professionals and is not medical advice.',
    ],
  },
];

export default function TermsPage() {
  return (
    <EventsLayout>
      <LegalPage
        title="Event terms"
        updated="12 October 2026"
        intro="These terms apply when you register for and attend an SS Innovations event booked through events.ssistudios.com."
        sections={SECTIONS}
      />
    </EventsLayout>
  );
}
