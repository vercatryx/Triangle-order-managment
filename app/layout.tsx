import type { Metadata } from 'next';
import './globals.css';
import { LayoutShell } from '@/components/LayoutShell';

export const metadata: Metadata = {
  title: 'Client Food Service Admin',
  description: 'Admin portal for managing client food services.',
};

import { getSession } from '@/lib/session';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  const userName = session?.name || 'Admin';
  const userRole = session?.role || 'admin';

  // We'll add a wrapper div to push content next to sidebar
  return (
    <html lang="en">
      <body>
        <LayoutShell userName={userName} userRole={userRole}>
          {children}
        </LayoutShell>
      </body>
    </html>
  );
}
