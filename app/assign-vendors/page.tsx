import { AssignVendors } from '@/components/clients/AssignVendors';
import { getSession } from '@/lib/session';

export const metadata = { title: 'Assign Vendors' };

export default async function AssignVendorsPage() {
    const session = await getSession();
    const currentUser = session ? { role: session.role, id: session.userId } : null;

    return <AssignVendors currentUser={currentUser} />;
}
