'use server';

import { uploadFile } from '@/lib/storage';
import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

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
        let table = 'orders';
        let proofColumn = 'delivery_proof_url';

        // Try finding in orders
        let { data: order, error: findError } = await supabaseAdmin
            .from('orders')
            .select('id')
            .eq('order_number', orderNumber)
            .maybeSingle();

        // If not found by number, try ID
        if (!order) {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(orderNumber)) {
                const { data: orderById } = await supabaseAdmin
                    .from('orders')
                    .select('id')
                    .eq('id', orderNumber)
                    .maybeSingle();
                order = orderById;
            }
        }

        // If still not found, try UPCOMING orders
        if (!order) {
            table = 'upcoming_orders';
            proofColumn = 'delivery_proof_url';

            const { data: upcomingOrder } = await supabaseAdmin
                .from('upcoming_orders')
                .select('id')
                .eq('order_number', orderNumber)
                .maybeSingle();

            order = upcomingOrder;

            // Try ID for upcoming if number failed
            if (!order) {
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (uuidRegex.test(orderNumber)) {
                    const { data: upcomingById } = await supabaseAdmin
                        .from('upcoming_orders')
                        .select('id')
                        .eq('id', orderNumber)
                        .maybeSingle();
                    order = upcomingById;
                }
            }
        }

        if (!order) {
            return { success: false, error: 'Order not found' };
        }

        const orderId = order.id;

        // 2. Upload File
        const buffer = Buffer.from(await file.arrayBuffer());
        const timestamp = Date.now();
        const extension = file.name.split('.').pop();
        const key = `proof-${orderNumber}-${timestamp}.${extension}`;

        await uploadFile(key, buffer, file.type, process.env.R2_DELIVERY_BUCKET_NAME);
        const publicUrl = `${process.env.R2_PUBLIC_URL_BASE || 'https://pub-820fa32211a14c0b8bdc7c41106bfa02.r2.dev'}/${key}`;

        // 3. Update Order in Supabase
        const updateData: any = {};
        updateData[proofColumn] = publicUrl;

        // Only set status to delivered if it makes sense for the table? 
        // For orders: yes. For upcoming: maybe 'completed' or stays scheduled but with proof?
        // Let's assume delivered/completed status update for both for now to indicate success.
        if (table === 'orders') {
            updateData.status = 'delivered';
        }
        // For upcoming_orders, we might not want to change status to 'delivered' if that status doesn't exist.
        // upcoming_orders usually has 'scheduled', 'processed'. 
        // Let's just update the proof URL for upcoming orders for now to be safe, or check status constraints.

        const { error: updateError } = await supabaseAdmin
            .from(table)
            .update(updateData)
            .eq('id', orderId);

        if (updateError) {
            console.error('Error updating order:', updateError);
            return { success: false, error: 'Failed to update order status' };
        }

        revalidatePath('/admin'); // Revalidate admin views

        return { success: true, url: publicUrl };
    } catch (error: any) {
        console.error('Error processing delivery:', error);
        return { success: false, error: error.message };
    }
}
