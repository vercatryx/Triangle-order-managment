import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';

export const metadata: Metadata = {
  title: 'Client Food Service Admin',
  description: 'Admin portal for managing client food services.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // We'll add a wrapper div to push content next to sidebar
  return (
    <html lang="en">
      <body>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <Sidebar />
          <main style={{
            flex: 1,
            marginLeft: '260px', /* Match sidebar width */
            padding: '2rem',
            backgroundColor: 'var(--bg-app)'
          }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
