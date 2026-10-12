import type { Metadata } from 'next';
import EventsLayout from '../events/layout';
import { CategoryPage } from '@/components/user/CategoryPage';

export const metadata: Metadata = {
  title: 'SSi MantraM | SS Innovations Events',
  description: 'Book a hands-on session with SSi MantraM, the SSi Mantra 3 surgical robotic system in a mobile unit.',
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
