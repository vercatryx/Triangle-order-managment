import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Driver Delivery' };

export default async function DeliveryLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // Allow unauthenticated access so drivers can scan QR codes without logging in
    const session = await getSession();

    if (session?.userId) {
        if (session.role === 'client') {
            redirect(`/client-portal/${session.userId}`);
        }
        if (session.role === 'vendor') {
            redirect('/vendor');
        }
        if (session.role === 'navigator') {
            redirect('/clients');
        }
    }

    return <>{children}</>;
}
