import { getPublicClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getCategories, getUpcomingOrderForClient, getActiveOrderForClient, getMealCategories, getMealItems } from '@/lib/actions';

import { ClientPortalInterface } from '@/components/clients/ClientPortalInterface';
import { getSession } from '@/lib/session';
import { notFound, redirect } from 'next/navigation';
import { getClient } from '@/lib/actions-read';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const client = await getClient(id);
  return { title: client?.fullName ? `My Orders — ${client.fullName}` : 'Client Portal' };
}

export default async function ClientPortalPage({ params }: { params: Promise<{ id: string }> }) {
    console.log('[ClientPortalPage] START - Server Component Render');
    try {
        const { id } = await params;
        console.log('[ClientPortalPage] Client ID:', id);

        const session = await getSession();
        console.log('[ClientPortalPage] Session:', { userId: session?.userId, role: session?.role });

    // Require session for client portal
    if (!session?.userId) {
        redirect('/login');
    }

    // Clients may only view their own portal; staff (admin, super-admin, navigator) may view any client
    if (session.role === 'client') {
        if (session.userId !== id) {
            redirect(`/client-portal/${session.userId}`);
        }
    } else if (session.role === 'vendor') {
        redirect('/vendor');
    }

        // Fetch all data in parallel - matching ClientProfile pattern
        console.log('[ClientPortalPage] Fetching data in parallel...');
        const [
            client,
            statuses,
            navigators,
            vendors,
            menuItemsRaw,
            boxTypes,
            categories,
            upcomingOrder,
            activeOrder,
            mealCategories,
            mealItemsRaw
        ] = await Promise.all([
            getPublicClient(id),
            getStatuses(),
            getNavigators(),
            getVendors(),
            getMenuItems({ includeInactive: true }),
            getBoxTypes(),
            getCategories(),
            getUpcomingOrderForClient(id),
            getActiveOrderForClient(id),
            getMealCategories(),
            getMealItems()
        ]);

        const menuItemsCountAll = menuItemsRaw?.length ?? 0;
        const menuItemsCountActive = menuItemsRaw?.filter((m: { isActive?: boolean }) => m.isActive === true).length ?? 0;
        console.log('[ClientPortalPage] menuItems: total=', menuItemsCountAll, 'active=', menuItemsCountActive);
        const mealItemsCountAll = mealItemsRaw?.length ?? 0;
        const mealItemsCountActive = mealItemsRaw?.filter((m: { isActive?: boolean }) => m.isActive === true).length ?? 0;
        console.log('[ClientPortalPage] mealItems: total=', mealItemsCountAll, 'active=', mealItemsCountActive);

        const menuItems = menuItemsRaw ?? [];
        const mealItems = mealItemsRaw ?? [];

        console.log('[ClientPortalPage] Data fetched:', {
            client: client?.id,
            statuses: statuses?.length,
            navigators: navigators?.length,
            vendors: vendors?.length,
            menuItems: menuItems?.length,
            boxTypes: boxTypes?.length,
            categories: categories?.length,
            hasUpcomingOrder: !!upcomingOrder,
            hasActiveOrder: !!activeOrder,
            mealCategories: mealCategories?.length,
            mealItems: mealItems?.length
        });

        if (!client) {
            console.error('[ClientPortalPage] Client not found');
            notFound();
        }

        const activeVendors = vendors.filter((v: { isActive?: boolean }) => v.isActive === true);

        console.log('[ClientPortalPage] Rendering ClientPortalInterface');
        return (
            <ClientPortalInterface
                client={client}
                statuses={statuses}
                navigators={navigators}
                vendors={activeVendors}
                menuItems={menuItems}
                boxTypes={boxTypes}
                categories={categories}
                upcomingOrder={upcomingOrder}
                activeOrder={activeOrder}
                mealCategories={mealCategories}
                mealItems={mealItems}
                foodOrder={null}
                mealOrder={null}
                boxOrders={[]}
            />
        );
    } catch (error: any) {
        console.error('[ClientPortalPage] FATAL ERROR:', error);
        console.error('[ClientPortalPage] Error message:', error?.message);
        console.error('[ClientPortalPage] Error stack:', error?.stack);
        console.error('[ClientPortalPage] Error details:', JSON.stringify(error, null, 2));
        throw error;
    }
}
