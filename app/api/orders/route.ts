import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 1000;

/** Map UI sort key to DB column; client name sort uses created_at as proxy unless we add an RPC */
const SORT_COLUMN: Record<string, string> = {
    order_number: 'order_number',
    clientName: 'created_at',
    service_type: 'service_type',
    status: 'status',
    deliveryDate: 'scheduled_delivery_date',
    items: 'created_at',
    vendors: 'created_at',
    created_at: 'created_at'
};

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
        const pageSize = Math.min(
            PAGE_SIZE_MAX,
            Math.max(1, parseInt(searchParams.get('pageSize') || String(PAGE_SIZE_DEFAULT), 10))
        );
        const search = (searchParams.get('search') || '').trim();
        const statusFilter = searchParams.get('status') || 'all';
        const creationIdParam = searchParams.get('creationId') || '';
        const creationId = creationIdParam.trim() ? parseInt(creationIdParam, 10) : null;
        const deliveryDateFrom = (searchParams.get('deliveryDateFrom') || '').trim(); // YYYY-MM-DD
        const deliveryDateTo = (searchParams.get('deliveryDateTo') || '').trim(); // YYYY-MM-DD
        const sortBy = searchParams.get('sortBy') || 'created_at';
        const sortDirection = (searchParams.get('sortDirection') || 'desc') as 'asc' | 'desc';

        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!serviceRoleKey) {
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }
        const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
            auth: { persistSession: false }
        });

        // Resolve search once (client ids + escaped term) for both data and count
        let searchClientIds: string[] = [];
        let searchEscaped = '';
        if (search.length > 0) {
            const { data: clients } = await db
                .from('clients')
                .select('id')
                .ilike('full_name', `%${search}%`);
            searchClientIds = (clients || []).map((c: any) => c.id);
            searchEscaped = search.replace(/%/g, '\\%').replace(/\\/g, '\\\\');
        }

        // Base query: orders for Orders tab.
        // When searching: include all orders (billing_pending, null delivery date) so search can find them.
        // When not searching: exclude billing_pending and require scheduled_delivery_date.
        let query = db
            .from('orders')
            .select('*, clients(full_name)', { count: 'exact' });

        if (search.length === 0) {
            query = query.neq('status', 'billing_pending').not('scheduled_delivery_date', 'is', null);
        } else {
            const orderNumLike = `order_number_text.ilike.%${searchEscaped}%`;
            if (searchClientIds.length > 0) {
                query = query.or(`client_id.in.(${searchClientIds.join(',')}),${orderNumLike}`);
            } else {
                query = query.ilike('order_number_text', `%${searchEscaped}%`);
            }
        }

        if (statusFilter !== 'all') {
            query = query.eq('status', statusFilter);
        }
        if (creationId !== null && !Number.isNaN(creationId)) {
            query = query.eq('creation_id', creationId);
        }
        if (deliveryDateFrom) {
            query = query.gte('scheduled_delivery_date', deliveryDateFrom);
        }
        if (deliveryDateTo) {
            query = query.lte('scheduled_delivery_date', deliveryDateTo);
        }

        const orderColumn = SORT_COLUMN[sortBy] || 'created_at';
        query = query.order(orderColumn, { ascending: sortDirection === 'asc' });

        const from = (page - 1) * pageSize;
        const to = from + pageSize - 1;

        // Separate count query (head: true) so total is accurate and not capped by range/response limits
        let countQuery = db.from('orders').select('id', { count: 'exact', head: true });
        if (search.length === 0) {
            countQuery = countQuery.neq('status', 'billing_pending').not('scheduled_delivery_date', 'is', null);
        } else {
            const orderNumLike = `order_number_text.ilike.%${searchEscaped}%`;
            if (searchClientIds.length > 0) {
                countQuery = countQuery.or(`client_id.in.(${searchClientIds.join(',')}),${orderNumLike}`);
            } else {
                countQuery = countQuery.ilike('order_number_text', `%${searchEscaped}%`);
            }
        }
        if (statusFilter !== 'all') countQuery = countQuery.eq('status', statusFilter);
        if (creationId !== null && !Number.isNaN(creationId)) countQuery = countQuery.eq('creation_id', creationId);
        if (deliveryDateFrom) countQuery = countQuery.gte('scheduled_delivery_date', deliveryDateFrom);
        if (deliveryDateTo) countQuery = countQuery.lte('scheduled_delivery_date', deliveryDateTo);
        const { count: totalCount } = await countQuery;

        const { data: orders, error } = await query.range(from, to);

        if (error) {
            console.error('[API orders]', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const list = orders || [];
        const count = totalCount ?? 0;
        const orderIds = list.map((o: any) => o.id);
        const vendorNamesByOrderId = new Map<string, string[]>();

        if (orderIds.length > 0) {
            const BATCH = 200;
            const ovsBatches: { order_id: string; vendor_id: string | null }[] = [];
            const obsBatches: { order_id: string; vendor_id: string | null }[] = [];
            for (let i = 0; i < orderIds.length; i += BATCH) {
                const batch = orderIds.slice(i, i + BATCH);
                const [ovsRes, obsRes] = await Promise.all([
                    db.from('order_vendor_selections').select('order_id, vendor_id').in('order_id', batch),
                    db.from('order_box_selections').select('order_id, vendor_id').in('order_id', batch)
                ]);
                ovsBatches.push(...(ovsRes.data || []));
                obsBatches.push(...(obsRes.data || []));
            }
            const allVendorIds = new Set<string>();
            ovsBatches.forEach((r: any) => { if (r.vendor_id) allVendorIds.add(r.vendor_id); });
            obsBatches.forEach((r: any) => { if (r.vendor_id) allVendorIds.add(r.vendor_id); });
            for (const o of list) {
                if (o.service_type === 'Equipment' && o.notes) {
                    try {
                        const notes = typeof o.notes === 'string' ? JSON.parse(o.notes) : o.notes;
                        const vid = notes?.vendorId ?? notes?.vendor_id;
                        if (vid) allVendorIds.add(vid);
                    } catch (_) { /* ignore */ }
                }
            }
            const vendorById = new Map<string, string>();
            if (allVendorIds.size > 0) {
                const { data: vendors } = await db.from('vendors').select('id, name').in('id', Array.from(allVendorIds));
                (vendors || []).forEach((v: any) => vendorById.set(v.id, v.name));
            }
            const addVendor = (orderId: string, vendorId: string | null) => {
                if (!orderId) return;
                const name = vendorId ? (vendorById.get(vendorId) ?? 'Unknown') : 'Unknown';
                const existing = vendorNamesByOrderId.get(orderId) || [];
                if (!existing.includes(name)) existing.push(name);
                vendorNamesByOrderId.set(orderId, existing);
            };
            ovsBatches.forEach((r: any) => addVendor(r.order_id, r.vendor_id));
            obsBatches.forEach((r: any) => addVendor(r.order_id, r.vendor_id));
            for (const o of list) {
                if (o.service_type === 'Equipment' && o.notes) {
                    try {
                        const notes = typeof o.notes === 'string' ? JSON.parse(o.notes) : o.notes;
                        const vid = notes?.vendorId ?? notes?.vendor_id;
                        if (vid) addVendor(o.id, vid);
                    } catch (_) { /* ignore */ }
                }
            }
        }

        const total = count ?? 0;
        const enriched = list.map((o: any) => {
            let vendorNames = vendorNamesByOrderId.get(o.id) || [];
            if (vendorNames.length === 0) vendorNames = ['Unknown'];
            return {
                ...o,
                clientName: o.clients?.full_name || 'Unknown',
                status: o.status || 'pending',
                scheduled_delivery_date: o.scheduled_delivery_date || null,
                vendorNames: vendorNames.sort()
            };
        });

        return NextResponse.json({ orders: enriched, total });
    } catch (err: any) {
        console.error('[API orders]', err);
        return NextResponse.json(
            { error: err?.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
