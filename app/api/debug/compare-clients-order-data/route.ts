import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function getClientOrderData(clientId: string) {
    // Get client
    const { data: client, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();

    if (clientError || !client) {
        return { error: clientError?.message || 'Client not found', client: null };
    }

    const result: any = {
        client: {
            id: client.id,
            full_name: client.full_name,
            serviceType: client.serviceType,
            active_order: client.active_order
        },
        upcoming_orders: [],
        analysis: {
            total_upcoming_orders: 0,
            orders_with_vendor_selections: 0,
            orders_without_vendor_selections: 0,
            total_vendor_selections: 0,
            total_items: 0,
            orphaned_items: 0
        }
    };

    // Get upcoming orders
    const { data: upcomingOrders, error: uoError } = await supabase
        .from('upcoming_orders')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'scheduled')
        .order('created_at', { ascending: false });

    if (uoError) {
        result.error = uoError.message;
        return result;
    }

    result.analysis.total_upcoming_orders = upcomingOrders?.length || 0;

    if (!upcomingOrders || upcomingOrders.length === 0) {
        return result;
    }

    for (const order of upcomingOrders) {
        const orderData: any = {
            id: order.id,
            service_type: order.service_type,
            status: order.status,
            case_id: order.case_id,
            delivery_day: order.delivery_day,
            meal_type: order.meal_type,
            total_value: order.total_value,
            total_items: order.total_items,
            created_at: order.created_at,
            vendor_selections: [],
            all_items: [],
            orphaned_items: []
        };

        // Get vendor selections
        const { data: vendorSelections, error: vsError } = await supabase
            .from('upcoming_order_vendor_selections')
            .select('*')
            .eq('upcoming_order_id', order.id);

        if (!vsError && vendorSelections) {
            result.analysis.total_vendor_selections += vendorSelections.length;
            
            if (vendorSelections.length > 0) {
                result.analysis.orders_with_vendor_selections++;
            } else {
                result.analysis.orders_without_vendor_selections++;
            }

            for (const vs of vendorSelections) {
                const vsData: any = {
                    id: vs.id,
                    vendor_id: vs.vendor_id,
                    items: []
                };

                // Get items for this VS
                const { data: items, error: itemsError } = await supabase
                    .from('upcoming_order_items')
                    .select('*')
                    .eq('vendor_selection_id', vs.id);

                if (!itemsError && items) {
                    vsData.items = items;
                    result.analysis.total_items += items.length;
                }

                orderData.vendor_selections.push(vsData);
            }
        } else {
            result.analysis.orders_without_vendor_selections++;
        }

        // Get all items for this order (including orphaned)
        const { data: allItems, error: allItemsError } = await supabase
            .from('upcoming_order_items')
            .select('*')
            .eq('upcoming_order_id', order.id);

        if (!allItemsError && allItems) {
            orderData.all_items = allItems;
            orderData.orphaned_items = allItems.filter((item: any) => !item.vendor_selection_id);
            result.analysis.orphaned_items += orderData.orphaned_items.length;
        }

        result.upcoming_orders.push(orderData);
    }

    return result;
}

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const clientId1 = searchParams.get('client1') || 'CLIENT-523'; // Working client
        const clientId2 = searchParams.get('client2'); // RIVKA MULLER (to be found)

        // First, find RIVKA MULLER if client2 not provided
        let rivkaClientId: string | null = clientId2;
        if (!rivkaClientId) {
            const { data: clients } = await supabase
                .from('clients')
                .select('id, full_name')
                .or('full_name.ilike.%RIVKA%,full_name.ilike.%MULLER%')
                .limit(1);

            if (clients && clients.length > 0) {
                rivkaClientId = clients[0].id;
            } else {
                return NextResponse.json({
                    error: 'RIVKA MULLER not found. Please provide client2 parameter.',
                    suggestion: 'Search for clients with RIVKA or MULLER in their name'
                }, { status: 404 });
            }
        }

        // Ensure rivkaClientId is not null before proceeding
        if (!rivkaClientId) {
            return NextResponse.json({
                error: 'Client ID is required'
            }, { status: 400 });
        }

        // Get data for both clients
        const [client1Data, client2Data] = await Promise.all([
            getClientOrderData(clientId1),
            getClientOrderData(rivkaClientId)
        ]);

        // Compare and identify differences
        const comparison: any = {
            working_client: {
                id: clientId1,
                data: client1Data
            },
            problematic_client: {
                id: rivkaClientId,
                data: client2Data
            },
            differences: {
                structure_differences: [],
                data_issues: []
            }
        };

        // Compare structures
        if (client1Data.upcoming_orders.length !== client2Data.upcoming_orders.length) {
            comparison.differences.structure_differences.push({
                type: 'order_count',
                working: client1Data.upcoming_orders.length,
                problematic: client2Data.upcoming_orders.length
            });
        }

        // Compare each order
        const workingOrder = client1Data.upcoming_orders[0];
        const problematicOrder = client2Data.upcoming_orders[0];

        if (workingOrder && problematicOrder) {
            // Compare vendor selections
            if (workingOrder.vendor_selections.length !== problematicOrder.vendor_selections.length) {
                comparison.differences.structure_differences.push({
                    type: 'vendor_selections_count',
                    working: workingOrder.vendor_selections.length,
                    problematic: problematicOrder.vendor_selections.length,
                    issue: problematicOrder.vendor_selections.length === 0 ? 'NO VENDOR SELECTIONS - This is the problem!' : 'Different count'
                });
            }

            // Check for orphaned items
            if (problematicOrder.orphaned_items.length > 0) {
                comparison.differences.data_issues.push({
                    type: 'orphaned_items',
                    count: problematicOrder.orphaned_items.length,
                    description: 'Items exist but are not linked to any vendor selection',
                    items: problematicOrder.orphaned_items.slice(0, 5)
                });
            }

            // Compare items structure
            const workingItemsCount = workingOrder.vendor_selections.reduce((sum: number, vs: any) => sum + vs.items.length, 0);
            const problematicItemsCount = problematicOrder.vendor_selections.reduce((sum: number, vs: any) => sum + vs.items.length, 0);
            const problematicAllItemsCount = problematicOrder.all_items.length;

            if (problematicAllItemsCount > 0 && problematicItemsCount === 0) {
                comparison.differences.data_issues.push({
                    type: 'items_not_linked',
                    description: 'Items exist in database but are not linked to vendor selections',
                    all_items_count: problematicAllItemsCount,
                    linked_items_count: problematicItemsCount
                });
            }

            // Compare vendor_id values
            const workingVendorIds = workingOrder.vendor_selections.map((vs: any) => vs.vendor_id).filter(Boolean);
            const problematicVendorIds = problematicOrder.vendor_selections.map((vs: any) => vs.vendor_id).filter(Boolean);

            if (workingVendorIds.length > 0 && problematicVendorIds.length === 0 && problematicOrder.vendor_selections.length > 0) {
                comparison.differences.data_issues.push({
                    type: 'null_vendor_ids',
                    description: 'Vendor selections exist but all have NULL vendor_id',
                    count: problematicOrder.vendor_selections.length
                });
            }
        }

        // Add recommendations
        comparison.recommendations = [];
        
        if (comparison.differences.data_issues.some((issue: any) => issue.type === 'orphaned_items' || issue.type === 'items_not_linked')) {
            comparison.recommendations.push({
                type: 'fix_orphaned_items',
                action: 'Link orphaned items to vendor selections or create vendor selections for them',
                priority: 'HIGH'
            });
        }

        if (comparison.differences.structure_differences.some((diff: any) => diff.type === 'vendor_selections_count' && diff.issue?.includes('NO VENDOR SELECTIONS'))) {
            comparison.recommendations.push({
                type: 'create_vendor_selections',
                action: 'Create vendor selections for the order. If vendor is unknown, use NULL vendor_id.',
                priority: 'CRITICAL'
            });
        }

        if (comparison.differences.data_issues.some((issue: any) => issue.type === 'null_vendor_ids')) {
            comparison.recommendations.push({
                type: 'update_vendor_ids',
                action: 'Update vendor selections to have proper vendor_id values, or ensure code handles NULL vendor_id correctly',
                priority: 'MEDIUM'
            });
        }

        return NextResponse.json(comparison, { status: 200 });
    } catch (error: any) {
        console.error('Error comparing clients:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
