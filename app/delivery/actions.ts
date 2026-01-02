'use server';

import { uploadFile } from '@/lib/storage';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { saveDeliveryProofUrlAndProcessOrder } from '@/lib/actions';

export async function processDeliveryProof(formData: FormData) {
    const file = formData.get('file') as File;
    const orderNumber = formData.get('orderNumber') as string;

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    if (!file || !orderNumber) {
        return { success: false, error: 'Missing file or order number' };
    }

    try {
        // 1. Verify Order matches
        // The barcode contains the order NUMBER (e.g. "1001"), but we might need the UUID.
        // Let's look up the order by order_number or id.
        // In VendorDeliveryOrders.tsx line 397: `const orderNum = order.orderNumber || order.id`.

        // We try to find the order by orderNumber first, then fallback to ID?
        // Actually, let's just query for order_number.

        // 1. Verify Order matches
        let table: 'orders' | 'upcoming_orders' = 'orders';
        let proofColumn = 'delivery_proof_url';
        let foundOrder: { id: string } | null = null;

        // Try finding in orders
        const { data: orderData } = await supabaseAdmin
            .from('orders')
            .select('id')
            .eq('order_number', orderNumber)
            .maybeSingle();

        foundOrder = orderData;

        // If not found by number, try ID
        if (!foundOrder) {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(orderNumber)) {
                const { data: orderById } = await supabaseAdmin
                    .from('orders')
                    .select('id')
                    .eq('id', orderNumber)
                    .maybeSingle();
                foundOrder = orderById;
            }
        }

        // If still not found, try UPCOMING orders
        if (!foundOrder) {
            table = 'upcoming_orders';
            proofColumn = 'delivery_proof_url';

            const { data: upcomingOrder } = await supabaseAdmin
                .from('upcoming_orders')
                .select('id')
                .eq('order_number', orderNumber)
                .maybeSingle();

            foundOrder = upcomingOrder;

            // Try ID for upcoming if number failed
            if (!foundOrder) {
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (uuidRegex.test(orderNumber)) {
                    const { data: upcomingById } = await supabaseAdmin
                        .from('upcoming_orders')
                        .select('id')
                        .eq('id', orderNumber)
                        .maybeSingle();
                    foundOrder = upcomingById;
                }
            }
        }

        if (!foundOrder) {
            return { success: false, error: 'Order not found' };
        }

        const orderId = foundOrder.id;

        // 2. Upload File
        const buffer = Buffer.from(await file.arrayBuffer());
        const timestamp = Date.now();
        const extension = file.name.split('.').pop();
        const key = `proof-${orderNumber}-${timestamp}.${extension}`;

        await uploadFile(key, buffer, file.type, process.env.R2_DELIVERY_BUCKET_NAME);
        const publicUrl = `${process.env.R2_PUBLIC_URL_BASE || 'https://pub-820fa32211a14c0b8bdc7c41106bfa02.r2.dev'}/${key}`;

        // 3. Update Order in Supabase
        // For upcoming_orders, use saveDeliveryProofUrlAndProcessOrder to properly process the order
        if (table === 'upcoming_orders') {
            const result = await saveDeliveryProofUrlAndProcessOrder(orderId, 'upcoming', publicUrl);
            if (!result.success) {
                return { success: false, error: result.error || 'Failed to process order' };
            }
            revalidatePath('/admin');
            return { success: true, url: publicUrl };
        }

        // For orders table, update with billing_pending status (never 'pending' or 'delivered')
        const updateData: any = {
            delivery_proof_url: publicUrl,
            status: 'billing_pending',
            actual_delivery_date: new Date().toISOString()
        };

        const { error: updateError } = await supabaseAdmin
            .from('orders')
            .update(updateData)
            .eq('id', orderId);

        if (updateError) {
            console.error('Error updating order:', updateError);
            return { success: false, error: 'Failed to update order status' };
        }

        // Create billing record if it doesn't exist (similar to updateOrderDeliveryProof)
        const { data: orderDetails } = await supabaseAdmin
            .from('orders')
            .select('client_id, total_value, actual_delivery_date')
            .eq('id', orderId)
            .single();

        if (orderDetails) {
            const { data: client } = await supabaseAdmin
                .from('clients')
                .select('navigator_id, fullName')
                .eq('id', orderDetails.client_id)
                .single();

            const { data: existingBilling } = await supabaseAdmin
                .from('billing_records')
                .select('id')
                .eq('order_id', orderId)
                .maybeSingle();

            if (!existingBilling) {
                const billingPayload = {
                    client_id: orderDetails.client_id,
                    client_name: client?.fullName || 'Unknown Client',
                    order_id: orderId,
                    status: 'pending',
                    amount: orderDetails.total_value || 0,
                    navigator: client?.navigator_id || 'Unknown',
                    delivery_date: orderDetails.actual_delivery_date,
                    remarks: 'Auto-generated upon proof upload'
                };

                await supabaseAdmin.from('billing_records').insert([billingPayload]);
            }
        }

        revalidatePath('/admin'); // Revalidate admin views

        return { success: true, url: publicUrl };
    } catch (error: any) {
        console.error('Error processing delivery:', error);
        return { success: false, error: error.message };
    }
}
