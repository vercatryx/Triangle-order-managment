import { verifySession } from '@/lib/session';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Vendor Portal' };

export default async function VendorPortalLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await verifySession();

    if (session.role === 'client') {
        redirect(`/client-portal/${session.userId}`);
    }

    // Navigators shouldn't be here
    if (session.role === 'navigator') {
        redirect('/clients');
    }

    // Admins might want to see this potentially, so we allow them.
    // But mainly for Vendors.

    return <>{children}</>;
}
