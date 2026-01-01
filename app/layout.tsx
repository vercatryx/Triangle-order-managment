import type { Metadata } from 'next';
import './globals.css';
import { LayoutShell } from '@/components/LayoutShell';
import { TimeProvider } from '@/lib/time-context';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/session';

export const metadata: Metadata = {
  title: 'Client Food Service Admin',
  description: 'Admin portal for managing client food services.',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const userName = session?.name || 'Admin';
  const userRole = session?.role || 'admin';

  const cookieStore = await cookies();
  const fakeTimeCookie = cookieStore.get('x-fake-time');
  const initialFakeTime = fakeTimeCookie?.value || null;

  return (
    <html lang="en">
      <body>
        <TimeProvider initialFakeTime={initialFakeTime}>
          <LayoutShell userName={userName} userRole={userRole}>
            {children}
          </LayoutShell>
        </TimeProvider>
      </body>
    </html>
  );
}
