import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Missing Orders' };

export default async function MissingOrdersLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const session = await verifySession();

  if (session.role === 'client') {
    redirect(`/client-portal/${session.userId}`);
  }

  if (session.role === 'vendor') {
    redirect('/vendor');
  }

  return <>{children}</>;
}
