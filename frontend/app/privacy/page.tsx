import type { Metadata } from 'next';
import EventsLayout from '../events/layout';
import { LegalPage, type LegalSection } from '@/components/user/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy notice | SS Innovations Events',
  description: 'How SS Innovations collects and uses personal data for event registration on events.ssistudios.com.',
  alternates: { canonical: '/privacy' },
};

// Draft pending regulatory and legal review: retention period and privacy contact to be confirmed.
const SECTIONS: LegalSection[] = [
  {
    heading: 'What we collect when you register',
    items: [
      'Your title, full name, designation, specialty or department, and hospital or institution.',
      'Your mobile number, email address, country, state and city.',
      'The event and time slot you book, your booking reference, and when you check in at the venue.',
      'Ratings and comments, if you choose to give feedback.',
    ],
  },
  {
    heading: 'How we use it',
    items: [
      'To register you, issue your ticket and send it to you by email.',
      'To check you in at the venue and record attendance.',
      'To tell you about changes to your booking or to the event, including cancellation.',
      'To plan and improve our events, using attendance and feedback figures.',
    ],
    paragraphs: ['We do not sell your personal data.'],
  },
  {
    heading: 'Who can see it',
    paragraphs: [
      'Authorised SS Innovations staff who run the event. Ticket emails are copied to the event team. The site and its emails run on Amazon Web Services in the Mumbai (India) region.',
    ],
  },
  {
    heading: 'Site usage and your browser',
    paragraphs: [
      'We count page visits to understand how the site is used. Each browser is given a random identifier; we record the pages viewed, the device type and browser name, and the site you came from. This does not include your name or contact details and is deleted after 90 days.',
      'Your browser keeps your mobile number and booking reference, and a cookie that lets it open your tickets, so that you can see them on the device you booked with. Form details you type are kept only until you close the tab.',
    ],
  },
  {
    heading: 'How long we keep it',
    paragraphs: ['Registration records are kept for as long as needed to run the event and to keep our records of it.'],
  },
  {
    heading: 'Your choices',
    paragraphs: [
      'You can cancel a booking at any time before it starts from My tickets. To see, correct or delete the details we hold about you, contact SS Innovations through ssinnovations.com.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <EventsLayout>
      <LegalPage
        title="Privacy notice"
        updated="12 October 2026"
        intro="This notice explains what personal data SS Innovations collects when you register for an event on events.ssistudios.com, how we use it and the choices you have."
        sections={SECTIONS}
      />
    </EventsLayout>
  );
}
