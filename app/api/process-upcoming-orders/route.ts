import { NextRequest, NextResponse } from 'next/server';
import { processUpcomingOrders } from '@/lib/actions';

/**
 * API Route: Process upcoming orders that have reached their take effect date
 * 
 * POST /api/process-upcoming-orders
 * 
 * This endpoint should be called daily (via cron job or scheduled task)
 * to automatically move upcoming orders to the orders table when their
 * take_effect_date is reached.
 * 
 * Returns a summary of processed orders and any errors encountered.
 */
export async function POST(request: NextRequest) {
    try {
        const result = await processUpcomingOrders();

        return NextResponse.json({
            success: true,
            processed: result.processed,
            errors: result.errors,
            processedAt: new Date().toISOString()
        }, { status: 200 });

    } catch (error: any) {
        console.error('Error processing upcoming orders:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to process upcoming orders',
            processedAt: new Date().toISOString()
        }, { status: 500 });
    }
}

/**
 * GET endpoint for manual testing/debugging
 */
export async function GET(request: NextRequest) {
    try {
        const result = await processUpcomingOrders();

        return NextResponse.json({
            success: true,
            processed: result.processed,
            errors: result.errors,
            processedAt: new Date().toISOString(),
            message: `Processed ${result.processed} upcoming order(s)`
        }, { status: 200 });

    } catch (error: any) {
        console.error('Error processing upcoming orders:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to process upcoming orders',
            processedAt: new Date().toISOString()
        }, { status: 500 });
    }
}


