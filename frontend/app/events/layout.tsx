import UserFrame from '@/components/user/UserFrame';

export default function EventsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <UserFrame>{children}</UserFrame>;
}
