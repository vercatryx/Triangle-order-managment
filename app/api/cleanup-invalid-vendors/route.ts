import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export interface InvalidVendorIssue {
    id: string;
    upcomingOrderId: string;
    clientId: string;
    clientName?: string;
    vendorId: string | null;
    vendorName?: string;
    isActive: boolean;
    serviceType: string;
    deliveryDay: string | null;
    itemCount: number;
    orderNumber?: number;
}

/**
 * GET - List active upcoming orders where a vendor selection references a missing or inactive vendor.
 */
export async function GET() {
    try {
        const { data: vendors, error: vErr } = await supabase
            .from('vendors')
            .select('id, name, is_active');
        if (vErr) throw vErr;
        const vendorMap = new Map<string, { name: string; is_active: boolean }>();
        for (const v of vendors || []) {
            vendorMap.set(v.id, { name: v.name || '', is_active: !!v.is_active });
        }

        const { data: upcoming, error: uErr } = await supabase
            .from('upcoming_orders')
            .select('id, client_id, service_type, delivery_day, status, order_number')
            .neq('status', 'processed');
        if (uErr) throw uErr;

        const issues: InvalidVendorIssue[] = [];
        for (const uo of upcoming || []) {
            const { data: selections, error: sErr } = await supabase
                .from('upcoming_order_vendor_selections')
                .select('id, vendor_id')
                .eq('upcoming_order_id', uo.id);
            if (sErr) throw sErr;

            for (const vs of selections || []) {
                const vid = vs.vendor_id;
                if (vid == null) continue;
                const vendor = vendorMap.get(vid);
                const missing = !vendor;
                const inactive = vendor && !vendor.is_active;
                if (!missing && !inactive) continue;

                const { count } = await supabase
                    .from('upcoming_order_items')
                    .select('id', { count: 'exact', head: true })
                    .eq('vendor_selection_id', vs.id);
                const itemCount = count ?? 0;

                issues.push({
                    id: vs.id,
                    upcomingOrderId: uo.id,
                    clientId: uo.client_id,
                    vendorId: vid,
                    vendorName: vendor?.name ?? (missing ? `Vendor ${vid} (missing)` : undefined),
                    isActive: vendor?.is_active ?? false,
                    serviceType: uo.service_type || '',
                    deliveryDay: uo.delivery_day ?? null,
                    itemCount,
                    orderNumber: uo.order_number
                });
            }
        }

        const clientIds = [...new Set(issues.map((i) => i.clientId))];
        const clientNames: Record<string, string> = {};
        if (clientIds.length > 0) {
            const { data: clients } = await supabase
                .from('clients')
                .select('id, full_name')
                .in('id', clientIds);
            for (const c of clients || []) {
                clientNames[c.id] = c.full_name || c.id;
            }
        }
        issues.forEach((i) => { i.clientName = clientNames[i.clientId]; });

        const activeVendors = (vendors || []).filter((v: { is_active?: boolean }) => v.is_active).map((v: { id: string; name?: string }) => ({ id: v.id, name: v.name || v.id }));

        return NextResponse.json({
            success: true,
            issues: issues.sort((a, b) => (a.clientName || '').localeCompare(b.clientName || '')),
            activeVendors
        });
    } catch (e: unknown) {
        console.error('cleanup-invalid-vendors GET:', e);
        return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

/**
 * POST - Fix: clear vendor or reassign. Body: { vendorSelectionId: string, action: 'clear' | 'reassign', newVendorId?: string }.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const vendorSelectionId = body.vendorSelectionId;
        const action = body.action; // 'clear' | 'reassign'
        const newVendorId = body.newVendorId;

        if (!vendorSelectionId || !action) {
            return NextResponse.json(
                { success: false, error: 'vendorSelectionId and action are required' },
                { status: 400 }
            );
        }
        if (action === 'reassign' && !newVendorId) {
            return NextResponse.json(
                { success: false, error: 'newVendorId required when action is reassign' },
                { status: 400 }
            );
        }

        const payload = action === 'clear' ? { vendor_id: null } : { vendor_id: newVendorId };
        const { error } = await supabase
            .from('upcoming_order_vendor_selections')
            .update(payload)
            .eq('id', vendorSelectionId);

        if (error) throw error;

        return NextResponse.json({
            success: true,
            message: action === 'clear' ? 'Vendor cleared' : 'Vendor reassigned'
        });
    } catch (e: unknown) {
        console.error('cleanup-invalid-vendors POST:', e);
        return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
