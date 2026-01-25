import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * API Route: Update order billing status and billing notes
 * 
 * POST /api/update-order-billing-status
 * 
 * This endpoint updates multiple orders with:
 * - New billing status (billing_successful or billing_failed)
 * - Optional billing notes
 * 
 * Request body:
 * {
 *   "orderIds": ["uuid1", "uuid2", ...],
 *   "status": "billing_successful" | "billing_failed",
 *   "billingNotes": "optional notes string"
 * }
 * 
 * No authentication required (as per user request)
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { orderIds, status, billingNotes } = body;

        // Validate required fields
        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'orderIds is required and must be a non-empty array'
            }, { status: 400 });
        }

        if (!status || (status !== 'billing_successful' && status !== 'billing_failed')) {
            return NextResponse.json({
                success: false,
                error: 'status is required and must be either "billing_successful" or "billing_failed"'
            }, { status: 400 });
        }

        // Prepare update data
        const updateData: any = {
            status: status
        };

        // Add billing_notes if provided
        if (billingNotes !== undefined && billingNotes !== null) {
            updateData.billing_notes = billingNotes;
        }

        // Update all orders
        const { data: updatedOrders, error } = await supabase
            .from('orders')
            .update(updateData)
            .in('id', orderIds)
            .select('id, status, billing_notes');

        if (error) {
            console.error('Error updating orders:', error);
            return NextResponse.json({
                success: false,
                error: error.message || 'Failed to update orders'
            }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            updated: updatedOrders?.length || 0,
            orderIds: orderIds,
            status: status,
            billingNotes: billingNotes || null,
            updatedOrders: updatedOrders,
            updatedAt: new Date().toISOString()
        }, { status: 200 });

    } catch (error: any) {
        console.error('Error updating order billing status:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to update order billing status',
            updatedAt: new Date().toISOString()
        }, { status: 500 });
    }
}
