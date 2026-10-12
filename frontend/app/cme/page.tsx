import type { Metadata } from 'next';
import EventsLayout from '../events/layout';
import { CategoryPage } from '@/components/user/CategoryPage';

export const metadata: Metadata = {
  title: 'CME and workshops | SS Innovations Events',
  description: 'Hands-on robotic surgery training on SSi Mantra for surgeons and theatre teams.',
  alternates: { canonical: '/cme' },
};

export default function CmePage() {
  return (
    <EventsLayout>
      <CategoryPage type="event" />
    </EventsLayout>
  );
}
