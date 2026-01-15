import { NavigatorHistory } from '@/components/navigators/NavigatorHistory';
import { getSession } from '@/lib/session';
import { getStatuses } from '@/lib/actions';
import { redirect } from 'next/navigation';

export default async function NavigatorHistoryPage() {
    const session = await getSession();

    if (!session) {
        redirect('/login');
    }

    // Only navigators can access this page
    if (session.role !== 'navigator') {
        redirect('/clients');
    }

    const statuses = await getStatuses();

    return <NavigatorHistory navigatorId={session.userId} statuses={statuses} />;
}













