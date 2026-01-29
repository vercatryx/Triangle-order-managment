import { getPublicClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getCategories, getUpcomingOrderForClient, getActiveOrderForClient, getMealCategories, getMealItems, getClientFoodOrder, getClientMealOrder, getClientBoxOrder } from '@/lib/actions';

import { ClientPortalInterface } from '@/components/clients/ClientPortalInterface';
import { getSession } from '@/lib/session';
import { notFound, redirect } from 'next/navigation';

export default async function ClientPortalPage({ params }: { params: { id: string } }) {
    const { id } = await params;

    const session = await getSession();

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
        mealCategories,
        mealItems,
        foodOrder,
        mealOrder,
        boxOrders
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
        getMealCategories(),
        getMealItems(),
        getClientFoodOrder(id),
        getClientMealOrder(id),
        getClientBoxOrder(id)
    ]);

    if (!client) {
        notFound();
    }

    return (
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
            mealCategories={mealCategories}
            mealItems={mealItems}
            foodOrder={foodOrder}
            mealOrder={mealOrder}
            boxOrders={boxOrders}
        />
    );
}
