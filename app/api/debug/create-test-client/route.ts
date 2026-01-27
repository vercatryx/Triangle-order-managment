import { NextResponse } from 'next/server';
import { addClient, getVendors, getMealItems, getStatuses, getNavigators } from '@/lib/actions';
import { randomUUID } from 'crypto';

export async function GET() {
    try {
        // 1. Fetch dependencies
        const vendors = await getVendors();
        const mealItems = await getMealItems();
        const statuses = await getStatuses();
        const navigators = await getNavigators();
        const defaultStatusId = statuses[0]?.id || '';
        const defaultNavigatorId = navigators[0]?.id || '';

        if (vendors.length === 0 || mealItems.length === 0) {
            return NextResponse.json({ error: 'No vendors or meal items found' }, { status: 500 });
        }

        const vendor1 = vendors[0];
        // Ensure we find items associated with this vendor if possible, or just any items
        const mlItems = mealItems.slice(0, 10); // Take a pool
        let vendor1Items = mlItems.filter(i => i.vendorId === vendor1.id).slice(0, 2);

        // FALLBACK: If no specific items for this vendor, just steal some other items for testing purposes
        if (vendor1Items.length === 0) {
            vendor1Items = mlItems.slice(0, 2);
        }

        // Find breakfast items
        const breakfastItems = mealItems.filter(i => i.categoryId && i.name.toLowerCase().includes('breakfast') || true).slice(2, 4); // Use different items

        // 2. Construct Active Order
        const activeOrder: any = {
            serviceType: 'Food',
            caseId: `TEST-${randomUUID().slice(0, 4).toUpperCase()}`,
            // Generic Vendor Selection (Lunch)
            vendorSelections: [
                {
                    vendorId: vendor1.id,
                    items: vendor1Items.reduce((acc: any, item: any) => ({ ...acc, [item.id]: 2 }), {}),
                    selectedDeliveryDays: ['Monday', 'Wednesday']
                }
            ],
            // Meal Selection (Breakfast)
            mealSelections: {
                'Breakfast': {
                    vendorId: null, // No explicit vendor for meal type, relies on item default
                    items: breakfastItems.reduce((acc: any, item: any) => ({ ...acc, [item.id]: 1 }), {})
                }
            }
        };

        // 3. Create Client
        const newClient = await addClient({
            fullName: `Test Client ${randomUUID().slice(0, 4)}`,
            email: `test-${randomUUID().slice(0, 4)}@example.com`,
            address: '123 Test St',
            phoneNumber: '555-0199',
            serviceType: 'Food',
            approvedMealsPerWeek: 14,
            activeOrder: activeOrder,
            screeningTookPlace: true,
            screeningSigned: true,
            notes: 'Generated via Debug API',
            statusId: defaultStatusId,
            authorizedAmount: 150,
            endDate: new Date().toISOString(), // Use current date as placeholder
            secondaryPhoneNumber: undefined,
            navigatorId: defaultNavigatorId,
            expirationDate: undefined
        });

        return NextResponse.json({
            success: true,
            client: {
                id: newClient.id,
                name: newClient.fullName,
                order: newClient.activeOrder
            }
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
}
