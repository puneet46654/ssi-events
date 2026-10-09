import type { Metadata } from 'next';
import EventsLayout from '../events/layout';
import { CategoryPage } from '@/components/user/CategoryPage';

export const metadata: Metadata = {
  title: 'CME and workshops | SS Innovations Events',
  description: 'Continuing medical education programmes and hands-on workshops in robotic surgery by SS Innovations.',
  alternates: { canonical: '/cme' },
};

export default function CmePage() {
  return (
    <EventsLayout>
      <CategoryPage type="event" />
    </EventsLayout>
  );
}
