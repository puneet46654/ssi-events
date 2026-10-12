import type { Metadata } from 'next';
import EventsLayout from '../events/layout';
import { CategoryPage } from '@/components/user/CategoryPage';

export const metadata: Metadata = {
  title: 'Conferences | SS Innovations Events',
  description: 'Surgical congresses where SS Innovations is exhibiting SSi Mantra, with dates, venue and stand.',
  alternates: { canonical: '/conferences' },
};

// Shares the catalogue's header, footer and phone navigation.
export default function ConferencesPage() {
  return (
    <EventsLayout>
      <CategoryPage type="participation" />
    </EventsLayout>
  );
}
