import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyRetellSignature } from '../_lib/verify-retell';

export async function GET(request: NextRequest) {
    const signature = request.headers.get('x-retell-signature');
    const rawBody = await request.text().catch(() => '');
    if (signature && !verifyRetellSignature(rawBody, signature)) {
        return NextResponse.json({ success: false, error: 'unauthorized', message: 'Invalid signature' }, { status: 401 });
    }
    const clientId = request.nextUrl.searchParams.get('client_id') ?? '';
    if (!clientId.trim()) {
        return NextResponse.json({ success: false, error: 'missing_client_id', message: 'client_id is required.' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, order_number, status, scheduled_delivery_date, service_type')
        .eq('client_id', clientId.trim())
        .order('scheduled_delivery_date', { ascending: false });

    if (ordersError) {
        return NextResponse.json({ success: false, error: 'database_error', message: 'Failed to load orders.' }, { status: 500 });
    }
    const orderList = orders ?? [];
    const result: Array<{
        order_number: number;
        status: string;
        scheduled_delivery_date: string | null;
        service_type: string;
        summary: string;
        items: Array<{ name: string; quantity: number; vendor: string }>;
    }> = [];

    for (const ord of orderList) {
        const { data: vsList } = await supabase
            .from('order_vendor_selections')
            .select('id, vendor_id')
            .eq('order_id', ord.id);
        const vendorIds = (vsList ?? []).map((v: any) => v.vendor_id).filter(Boolean);
        const { data: vendors } = await supabase.from('vendors').select('id, name').in('id', vendorIds);
        const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name ?? '']));

        const itemRows: Array<{ name: string; quantity: number; vendor: string }> = [];
        let summaryParts: string[] = [];
        for (const vs of vsList ?? []) {
            const { data: oiList } = await supabase
                .from('order_items')
                .select('menu_item_id, quantity')
                .eq('vendor_selection_id', vs.id);
            const vendorName = vendorMap.get(vs.vendor_id) ?? 'Vendor';
            let count = 0;
            const names: string[] = [];
            for (const oi of oiList ?? []) {
                if (oi.menu_item_id) {
                    const { data: mi } = await supabase.from('menu_items').select('name').eq('id', oi.menu_item_id).single();
                    const name = (mi as any)?.name ?? 'Item';
                    const qty = Number(oi.quantity) || 0;
                    itemRows.push({ name, quantity: qty, vendor: vendorName });
                    count += qty;
                    names.push(name);
                }
            }
            if (count > 0) summaryParts.push(`${count} items from ${vendorName}`);
        }
        const summary = summaryParts.length > 0 ? summaryParts.join(', ') : 'No items';
        result.push({
            order_number: Number(ord.order_number) || 0,
            status: (ord.status ?? 'pending').toString(),
            scheduled_delivery_date: ord.scheduled_delivery_date ? String(ord.scheduled_delivery_date) : null,
            service_type: (ord.service_type ?? '').toString(),
            summary,
            items: itemRows
        });
    }

    return NextResponse.json({ success: true, orders: result });
}
