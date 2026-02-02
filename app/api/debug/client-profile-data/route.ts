import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    try {
        const searchParams = request.nextUrl.searchParams;
        const clientId = searchParams.get('clientId') || 'CLIENT-562';

        // Get what getClientProfileData returns
        const { getClientProfileData } = await import('@/lib/actions');
        const profileData = await getClientProfileData(clientId);

        // Also get what getUpcomingOrderForClientLocal returns directly
        const { getUpcomingOrderForClientLocal } = await import('@/lib/local-db');
        const upcomingOrderDirect = await getUpcomingOrderForClientLocal(clientId);

    // Get what getActiveOrderForClientLocal returns
        const { getActiveOrderForClientLocal } = await import('@/lib/local-db');
        const activeOrderDirect = await getActiveOrderForClientLocal(clientId);

        return NextResponse.json({
            clientId,
            profileData: {
                hasClient: !!profileData?.client,
                clientId: profileData?.client?.id,
                hasActiveOrder: !!profileData?.activeOrder,
                hasUpcomingOrder: !!profileData?.upcomingOrder,
                activeOrderType: typeof profileData?.activeOrder,
                upcomingOrderType: typeof profileData?.upcomingOrder,
                activeOrderKeys: profileData?.activeOrder ? Object.keys(profileData.activeOrder) : [],
                upcomingOrderKeys: profileData?.upcomingOrder ? Object.keys(profileData.upcomingOrder) : [],
                upcomingOrderServiceType: (profileData?.upcomingOrder as any)?.serviceType,
                upcomingOrderCaseId: (profileData?.upcomingOrder as any)?.caseId,
                upcomingOrderVendorSelections: (profileData?.upcomingOrder as any)?.vendorSelections,
                upcomingOrderVendorSelectionsLength: (profileData?.upcomingOrder as any)?.vendorSelections?.length,
                fullProfileData: profileData
            },
            directCalls: {
                upcomingOrder: {
                    result: upcomingOrderDirect,
                    type: typeof upcomingOrderDirect,
                    isNull: upcomingOrderDirect === null,
                    keys: upcomingOrderDirect ? Object.keys(upcomingOrderDirect) : [],
                    serviceType: (upcomingOrderDirect as any)?.serviceType,
                    caseId: (upcomingOrderDirect as any)?.caseId,
                    vendorSelections: (upcomingOrderDirect as any)?.vendorSelections,
                    vendorSelectionsLength: (upcomingOrderDirect as any)?.vendorSelections?.length
                },
                activeOrder: {
                    result: activeOrderDirect,
                    type: typeof activeOrderDirect,
                    isNull: activeOrderDirect === null
                }
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
