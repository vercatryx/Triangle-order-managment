import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const clientId1 = searchParams.get('client1') || 'CLIENT-562';
        const clientId2 = searchParams.get('client2') || 'SFF Food Test';

        const { readLocalDB } = await import('@/lib/local-db');
        const db = await readLocalDB();

        // Get both clients' data
        const client1Orders = db.upcomingOrders.filter(
            o => o.client_id === clientId1 && o.status === 'scheduled'
        );
        const client2Orders = db.upcomingOrders.filter(
            o => o.client_id === clientId2 && o.status === 'scheduled'
        );

        // Get processed orders
        const { getUpcomingOrderForClientLocal } = await import('@/lib/local-db');
        const client1Processed = await getUpcomingOrderForClientLocal(clientId1);
        const client2Processed = await getUpcomingOrderForClientLocal(clientId2);

        // Compare structures
        const comparison = {
            rawOrders: {
                client1: {
                    count: client1Orders.length,
                    orders: client1Orders.map(o => ({
                        id: o.id,
                        service_type: o.service_type,
                        case_id: o.case_id,
                        delivery_day: o.delivery_day,
                        meal_type: o.meal_type,
                        total_value: o.total_value,
                        total_items: o.total_items,
                        created_at: o.created_at
                    }))
                },
                client2: {
                    count: client2Orders.length,
                    orders: client2Orders.map(o => ({
                        id: o.id,
                        service_type: o.service_type,
                        case_id: o.case_id,
                        delivery_day: o.delivery_day,
                        meal_type: o.meal_type,
                        total_value: o.total_value,
                        total_items: o.total_items,
                        created_at: o.created_at
                    }))
                }
            },
            processedOrders: {
                client1: {
                    type: typeof client1Processed,
                    isNull: client1Processed === null,
                    keys: client1Processed ? Object.keys(client1Processed) : [],
                    serviceType: (client1Processed as any)?.serviceType,
                    caseId: (client1Processed as any)?.caseId,
                    hasVendorSelections: !!(client1Processed as any)?.vendorSelections,
                    vendorSelectionsLength: (client1Processed as any)?.vendorSelections?.length,
                    vendorSelections: (client1Processed as any)?.vendorSelections
                },
                client2: {
                    type: typeof client2Processed,
                    isNull: client2Processed === null,
                    keys: client2Processed ? Object.keys(client2Processed) : [],
                    serviceType: (client2Processed as any)?.serviceType,
                    caseId: (client2Processed as any)?.caseId,
                    hasVendorSelections: !!(client2Processed as any)?.vendorSelections,
                    vendorSelectionsLength: (client2Processed as any)?.vendorSelections?.length,
                    vendorSelections: (client2Processed as any)?.vendorSelections
                }
            },
            differences: {
                rawOrderCount: client1Orders.length !== client2Orders.length,
                processedOrderType: typeof client1Processed !== typeof client2Processed,
                processedOrderIsNull: (client1Processed === null) !== (client2Processed === null),
                hasCaseId: !!(client1Processed as any)?.caseId !== !!(client2Processed as any)?.caseId,
                hasVendorSelections: !!(client1Processed as any)?.vendorSelections !== !!(client2Processed as any)?.vendorSelections,
                vendorSelectionsLength: (client1Processed as any)?.vendorSelections?.length !== (client2Processed as any)?.vendorSelections?.length
            }
        };

        return NextResponse.json({
            client1: clientId1,
            client2: clientId2,
            comparison,
            fullData: {
                client1Processed,
                client2Processed
            }
        });
    } catch (error: any) {
        console.error('[Debug API] Error:', error);
        return NextResponse.json(
            { error: error.message, stack: error.stack },
            { status: 500 }
        );
    }
}
