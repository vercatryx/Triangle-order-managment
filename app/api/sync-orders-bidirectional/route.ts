import { NextRequest, NextResponse } from 'next/server';
import { syncAllOrdersBidirectional } from '@/lib/sync-orders-bidirectional';

export async function POST(request: NextRequest) {
    try {
        console.log('[API] Starting bidirectional order sync...');
        
        const results = await syncAllOrdersBidirectional();

        const summary = {
            total: results.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            active_order_to_upcoming: results.filter(r => r.direction === 'active_order_to_upcoming').length,
            upcoming_to_active_order: results.filter(r => r.direction === 'upcoming_to_active_order').length,
            already_synced: results.filter(r => r.direction === 'both').length
        };

        return NextResponse.json({
            message: 'Bidirectional sync completed',
            summary,
            results: results.filter(r => !r.success || r.direction !== 'both') // Only show actions taken
        });
    } catch (error: any) {
        console.error('[API] Error in bidirectional sync:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET(request: NextRequest) {
    return NextResponse.json({
        message: 'Use POST to run the bidirectional sync',
        endpoint: '/api/sync-orders-bidirectional',
        method: 'POST'
    });
}
