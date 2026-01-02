import { getPublicClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getCategories, getUpcomingOrderForClient, getActiveOrderForClient, getPreviousOrdersForClient } from '@/lib/actions';
import { ClientPortalInterface } from '@/components/clients/ClientPortalInterface';
import { notFound } from 'next/navigation';

export default async function ClientPortalPage({ params }: { params: { id: string } }) {
    const { id } = await params;

    // Fetch all data in parallel
    const [
        client,
        statuses,
        navigators,
        vendors,
        menuItems,
        boxTypes,
        categories,
        upcomingOrder,
        activeOrder,
        previousOrders
    ] = await Promise.all([
        getPublicClient(id),
        getStatuses(),
        getNavigators(),
        getVendors(),
        getMenuItems(),
        getBoxTypes(),
        getCategories(),
        getUpcomingOrderForClient(id),
        getActiveOrderForClient(id),
        getPreviousOrdersForClient(id)
    ]);

    if (!client) {
        notFound();
    }

    // Debug: Log what we're passing to the component
    if (upcomingOrder && (upcomingOrder as any).serviceType === 'Boxes') {
        console.log('[ClientPortalPage] Upcoming order data being passed:', {
            serviceType: (upcomingOrder as any).serviceType,
            hasItems: !!(upcomingOrder as any).items,
            itemsCount: (upcomingOrder as any).items ? Object.keys((upcomingOrder as any).items).length : 0,
            items: (upcomingOrder as any).items,
            fullUpcomingOrder: JSON.stringify(upcomingOrder, null, 2).substring(0, 500)
        });
    }

    return (
        <div style={{ padding: '20px' }}>
            <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: 32, height: 32, background: 'var(--primary)', borderRadius: '8px' }} />
                <h1 style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>Client Portal</h1>
            </div>

            <div style={{ marginBottom: '30px' }}>
                <h1 style={{ fontSize: '2rem', marginBottom: '10px' }}>Hello, {client.fullName}</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Manage your service and orders below.</p>
            </div>

            <ClientPortalInterface
                client={client}
                statuses={statuses}
                navigators={navigators}
                vendors={vendors}
                menuItems={menuItems}
                boxTypes={boxTypes}
                categories={categories}
                upcomingOrder={upcomingOrder}
                activeOrder={activeOrder}
                previousOrders={previousOrders}
            />
        </div>
    );
}
