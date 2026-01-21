import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentTime } from '@/lib/time';
import { sendEmail } from '@/lib/email';

// Initialize Supabase Admin Client to bypass RLS
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
    try {
        // 1. Get Today's Date
        const today = await getCurrentTime();
        const todayStr = today.toISOString().split('T')[0];

        console.log(`[Public API] Fetching vendors with orders for ${todayStr}`);

        // 2. Query Orders for Today
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('id, service_type')
            .eq('scheduled_delivery_date', todayStr);

        if (ordersError) {
            console.error('Error fetching today\'s orders:', ordersError);
            return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
        }

        if (!orders || orders.length === 0) {
            return NextResponse.json([]);
        }

        const orderIds = orders.map(o => o.id);

        // 3. Find unique vendor IDs associated with these orders and count them
        // Multiple tables might hold vendor selections depending on service type
        const [vendorSelectionsRes, boxSelectionsRes] = await Promise.all([
            supabase.from('order_vendor_selections').select('vendor_id, order_id').in('order_id', orderIds),
            supabase.from('order_box_selections').select('vendor_id, order_id').in('order_id', orderIds)
        ]);

        const vendorCounts = new Map<string, Set<string>>();

        const addOrderToVendor = (vendorId: string | null, orderId: string) => {
            if (!vendorId) return;
            if (!vendorCounts.has(vendorId)) {
                vendorCounts.set(vendorId, new Set());
            }
            vendorCounts.get(vendorId)!.add(orderId);
        };

        if (vendorSelectionsRes.data) {
            vendorSelectionsRes.data.forEach(vs => {
                addOrderToVendor(vs.vendor_id, vs.order_id);
            });
        }

        if (boxSelectionsRes.data) {
            boxSelectionsRes.data.forEach(bs => {
                addOrderToVendor(bs.vendor_id, bs.order_id);
            });
        }

        // Handle Equipment service type
        const equipmentOrders = orders.filter(o => o.service_type === 'Equipment');
        if (equipmentOrders.length > 0) {
            const { data: equipmentDetails } = await supabase
                .from('orders')
                .select('id, notes')
                .in('id', equipmentOrders.map(o => o.id));

            if (equipmentDetails) {
                equipmentDetails.forEach(o => {
                    try {
                        const notes = JSON.parse(o.notes || '{}');
                        if (notes.vendorId) addOrderToVendor(notes.vendorId, o.id);
                    } catch (e) { }
                });
            }
        }

        if (vendorCounts.size === 0) {
            return NextResponse.json([]);
        }

        // 4. Fetch Vendor Details
        const { data: vendors, error: vendorsError } = await supabase
            .from('vendors')
            .select('id, name, email, isActive:is_active')
            .in('id', Array.from(vendorCounts.keys()))
            .eq('is_active', true);

        if (vendorsError) {
            console.error('Error fetching vendor details:', vendorsError);
            return NextResponse.json({ error: 'Failed to fetch vendors' }, { status: 500 });
        }

        const vendorsWithCounts = (vendors || []).map(v => ({
            ...v,
            orderCount: vendorCounts.get(v.id)?.size || 0
        }));

        // 5. Send Emails
        console.log(`[Public API] Identified ${vendorsWithCounts.length} vendors to notify.`);

        // Get Settings for Debug Report
        const { data: settingsData } = await supabase.from('app_settings').select('*').single();
        const settings = settingsData as any;
        const debugEmail = settings?.report_email || 'dh@vercatryx.com';

        const emailResults: any[] = [];

        for (const vendor of vendorsWithCounts) {
            if (!vendor.email) {
                console.warn(`[Public API] Vendor ${vendor.name} has no email address. Skipping.`);
                emailResults.push({ vendor: vendor.name, success: false, error: 'No email address', provider: 'none' });
                continue;
            }

            const subject = `You have ${vendor.orderCount} order${vendor.orderCount > 1 ? 's' : ''} scheduled for today`;
            const html = `
                <div style="font-family: sans-serif; line-height: 1.5; color: #333;">
                    <h2>Hello ${vendor.name},</h2>
                    <p>This is an automated notification from Triangle Square System.</p>
                    <p>You have <strong>${vendor.orderCount}</strong> order${vendor.orderCount > 1 ? 's' : ''} scheduled for delivery today (<strong>${todayStr}</strong>).</p>
                    <p>Please check your vendor portal for details.</p>
                    <br>
                    <p>Best regards,<br>Triangle Square Team</p>
                </div>
            `;

            const result = await sendEmail({
                to: vendor.email,
                subject,
                html
            });

            console.log(`[Public API] Email to ${vendor.name} (${vendor.email}): ${result.success ? 'Success' : 'Failed'} (${result.provider || 'unknown'})`);
            emailResults.push({
                vendor: vendor.name,
                email: vendor.email,
                orderCount: vendor.orderCount,
                success: result.success,
                error: result.error,
                provider: result.provider
            });
        }

        // 6. Send Summary Report to Debug Email
        if (debugEmail) {
            const summarySubject = `Public API Task: Vendor Notifications Summary - ${todayStr}`;
            const summaryHtml = `
                <div style="font-family: sans-serif; line-height: 1.5; color: #333;">
                    <h2>Vendor Notification Summary</h2>
                    <p><strong>Date:</strong> ${today.toLocaleString()}</p>
                    <p><strong>Total Vendors Notified:</strong> ${vendorsWithCounts.length}</p>
                    
                    <table border="1" cellpadding="8" style="border-collapse: collapse; width: 100%; margin-top: 20px;">
                        <thead style="background-color: #f2f2f2;">
                            <tr>
                                <th>Vendor</th>
                                <th>Email</th>
                                <th>Orders</th>
                                <th>Status</th>
                                <th>Provider</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${emailResults.map(r => `
                                <tr>
                                    <td>${r.vendor}</td>
                                    <td>${r.email || 'N/A'}</td>
                                    <td>${r.orderCount || 0}</td>
                                    <td style="color: ${r.success ? 'green' : 'red'};">${r.success ? 'Sent' : 'Failed'}${r.error ? ` (${r.error})` : ''}</td>
                                    <td>${r.provider || 'N/A'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;

            const summaryResult = await sendEmail({
                to: debugEmail,
                subject: summarySubject,
                html: summaryHtml
            });

            console.log(`[Public API] Summary email to ${debugEmail}: ${summaryResult.success ? 'Success' : 'Failed'} (${summaryResult.provider || 'unknown'})`);
        }

        return NextResponse.json({
            vendors: vendorsWithCounts,
            notifications: emailResults
        });

    } catch (error: any) {
        console.error('Public Vendors API Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
