import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function OrdersLayout({
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

    // Navigators usually don't need access to raw orders list, but if they do, we can relax this.
    // For now, strict to Admin.
    if (session.role === 'navigator') {
        redirect('/clients');
    }

    return <>{children}</>;
}
