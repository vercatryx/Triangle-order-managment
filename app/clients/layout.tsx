import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function ClientsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await verifySession();

    if (session.role === 'client') {
        redirect(`/client-portal/${session.userId}`);
    }

    // Clients route is for Admins and Navigators.
    if (session.role === 'vendor') {
        redirect('/vendor');
    }

    return <>{children}</>;
}
