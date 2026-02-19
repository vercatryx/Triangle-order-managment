import { RoutesPage } from '@/components/routes/RoutesPage';
import { getSession } from '@/lib/session';

export default async function RoutesPageRoute() {
    const session = await getSession();
    if (!session) {
        return <div>Please log in to access routes.</div>;
    }

    return <RoutesPage />;
}
