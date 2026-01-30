import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // verifySession redirects to /login if not authenticated
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

    // Explicitly allow 'admin' and 'super-admin'
    // If there were other roles, we might want to handle them, but for now this covers the known roles.

    return <>{children}</>;
}
