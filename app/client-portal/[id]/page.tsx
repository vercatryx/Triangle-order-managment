import { getPublicClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getCategories, getUpcomingOrderForClient, getActiveOrderForClient, getMealCategories, getMealItems, getClientFoodOrder, getClientMealOrder, getClientBoxOrder } from '@/lib/actions';

import { ClientPortalInterface } from '@/components/clients/ClientPortalInterface';
import { notFound } from 'next/navigation';
import { logout } from '@/lib/auth-actions';
import { LogOut } from 'lucide-react';

export default async function ClientPortalPage({ params }: { params: { id: string } }) {
    const { id } = await params;

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
