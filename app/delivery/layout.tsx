import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function DeliveryLayout({
    children,
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

    if (session.role === 'navigator') {
        redirect('/clients');
    }

    return <>{children}</>;
}
