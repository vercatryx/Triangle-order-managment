import { ClientList } from '@/components/clients/ClientList';
import { getSession } from '@/lib/session';

export const metadata = { title: 'Clients' };

export default async function ClientsPage() {
    const session = await getSession();
    const currentUser = session ? { role: session.role, id: session.userId } : null;

    return <ClientList currentUser={currentUser} />;
}
