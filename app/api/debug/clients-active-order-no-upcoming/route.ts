import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: NextRequest) {
    try {
        // Get all clients with non-empty active_order
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, full_name, service_type, active_order')
            .not('active_order', 'is', null);

        if (clientsError) {
            return NextResponse.json({ error: clientsError.message }, { status: 500 });
        }

        if (!clients || clients.length === 0) {
            return NextResponse.json({
                message: 'No clients with active_order found',
                count: 0,
                clients: []
            });
        }

        // Filter out clients with empty active_order objects
        const clientsWithActiveOrder = clients.filter(c => {
            const ao = c.active_order;
            return ao && typeof ao === 'object' && Object.keys(ao).length > 0;
        });

        if (clientsWithActiveOrder.length === 0) {
            return NextResponse.json({
                message: 'No clients with active_order found',
                count: 0,
                clients: []
            });
        }

        // Get all client IDs
        const clientIds = clientsWithActiveOrder.map(c => c.id);

        // Fetch all upcoming_orders for these clients in a single query
        const { data: allUpcomingOrders, error: uoError } = await supabase
            .from('upcoming_orders')
            .select('client_id, id, status')
            .in('client_id', clientIds)
            .eq('status', 'scheduled');

        if (uoError) {
            console.error('Error fetching upcoming_orders:', uoError);
            return NextResponse.json({ error: uoError.message }, { status: 500 });
        }

        // Create a Set of client IDs that have upcoming orders
        const clientsWithUpcomingOrders = new Set(
            (allUpcomingOrders || []).map(uo => uo.client_id)
        );

        // Find clients without upcoming_orders
        const problematicClients: any[] = [];

        for (const client of clientsWithActiveOrder) {
            // If client is not in the set, they have no upcoming orders
            if (!clientsWithUpcomingOrders.has(client.id)) {
                const activeOrder = client.active_order as any;
                problematicClients.push({
                    id: client.id,
                    full_name: client.full_name,
                    serviceType: client.service_type,
                    active_order: {
                        serviceType: activeOrder?.serviceType,
                        caseId: activeOrder?.caseId,
                        hasVendorSelections: !!(activeOrder?.vendorSelections),
                        vendorSelectionsCount: activeOrder?.vendorSelections?.length || 0,
                        hasDeliveryDayOrders: !!(activeOrder?.deliveryDayOrders),
                        deliveryDayOrdersCount: activeOrder?.deliveryDayOrders ? Object.keys(activeOrder.deliveryDayOrders).length : 0,
                        hasMealSelections: !!(activeOrder?.mealSelections),
                        mealSelectionsCount: activeOrder?.mealSelections ? Object.keys(activeOrder.mealSelections).length : 0,
                        hasItems: !!(activeOrder?.items),
                        itemsCount: activeOrder?.items ? Object.keys(activeOrder.items).length : 0
                    }
                });
            }
        }

        // Group by service type
        const byServiceType: Record<string, number> = {};
        problematicClients.forEach(c => {
            const st = c.serviceType || 'Unknown';
            byServiceType[st] = (byServiceType[st] || 0) + 1;
        });

        return NextResponse.json({
            message: `Found ${problematicClients.length} clients with active_order but no upcoming_orders`,
            count: problematicClients.length,
            breakdown_by_service_type: byServiceType,
            clients: problematicClients
        });
    } catch (error: any) {
        console.error('Error finding clients:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
