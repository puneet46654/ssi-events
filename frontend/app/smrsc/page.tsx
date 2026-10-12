import type { Metadata } from 'next';
import EventsLayout from '../events/layout';
import { CategoryPage } from '@/components/user/CategoryPage';

export const metadata: Metadata = {
  title: 'SMRSC | SS Innovations Events',
  description: 'SSI Multi-Specialty Robotic Surgery Conference. Registration is on the conference website.',
  alternates: { canonical: '/smrsc' },
};

export default function SmrscPage() {
  return (
    <EventsLayout>
      <CategoryPage type="conference" />
    </EventsLayout>
  );
}
