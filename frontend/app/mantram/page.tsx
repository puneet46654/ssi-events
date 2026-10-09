import type { Metadata } from 'next';
import EventsLayout from '../events/layout';
import { CategoryPage } from '@/components/user/CategoryPage';

export const metadata: Metadata = {
  title: 'SSi MantraM | SS Innovations Events',
  description: 'Book a session with SSi MantraM, our mobile tele-surgical unit carrying the SSI Mantra surgical robotic system.',
  alternates: { canonical: '/mantram' },
};

// Shares the catalogue's header, footer and phone navigation.
export default function MantramPage() {
  return (
    <EventsLayout>
      <CategoryPage type="mantram" />
    </EventsLayout>
  );
}
