import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const clientId = searchParams.get('clientId') || 'CLIENT-562';
        const compareClientId = searchParams.get('compareWith');

        const { readLocalDB } = await import('@/lib/local-db');
        const db = await readLocalDB();

        // Get CLIENT-562's upcoming orders
        const clientOrders = db.upcomingOrders.filter(
            o => o.client_id === clientId && o.status === 'scheduled'
        );

        // Get vendor selections
        const vendorSelections = db.upcomingOrderVendorSelections.filter(
            vs => clientOrders.some(o => o.id === vs.upcoming_order_id)
        );

        // Get items
        const items = db.upcomingOrderItems.filter(
            item => clientOrders.some(o => o.id === item.upcoming_order_id) ||
                    vendorSelections.some(vs => vs.id === item.vendor_selection_id)
        );

        // Get box selections
        const boxSelections = db.upcomingOrderBoxSelections.filter(
            bs => clientOrders.some(o => o.id === bs.upcoming_order_id)
        );

        // Try to get what getUpcomingOrderForClientLocal returns
        const { getUpcomingOrderForClientLocal } = await import('@/lib/local-db');
        const processedOrder = await getUpcomingOrderForClientLocal(clientId);

        // Compare with another client if provided
        let compareData = null;
        if (compareClientId) {
            const compareOrders = db.upcomingOrders.filter(
                o => o.client_id === compareClientId && o.status === 'scheduled'
            );
            const compareProcessed = await getUpcomingOrderForClientLocal(compareClientId);
            
            compareData = {
                rawOrders: compareOrders,
                processedOrder: compareProcessed
            };
        }

        return NextResponse.json({
            clientId,
            rawData: {
                orders: clientOrders,
                vendorSelections,
                items,
                boxSelections
            },
            processedOrder,
            comparison: compareData,
            analysis: {
                orderCount: clientOrders.length,
                hasVendorSelections: vendorSelections.length > 0,
                hasItems: items.length > 0,
                hasBoxSelections: boxSelections.length > 0,
                processedOrderType: typeof processedOrder,
                processedOrderIsNull: processedOrder === null,
                processedOrderKeys: processedOrder ? Object.keys(processedOrder) : [],
                processedOrderHasCaseId: processedOrder?.caseId ? true : false,
                processedOrderHasVendorSelections: processedOrder?.vendorSelections ? true : false,
                processedOrderVendorSelectionsLength: processedOrder?.vendorSelections?.length || 0
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
