import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

/** Format Date as YYYY-MM-DD (calendar date, no TZ). */
function formatDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Get the Sunday and Saturday of the week containing the given date (YYYY-MM-DD).
 * Week is Sun–Sat; uses calendar date so timezone does not change the week.
 */
function getWeekBounds(dateStr: string): { weekStart: string; weekEnd: string } {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const day = date.getDay(); // 0 = Sunday, 6 = Saturday
    const sunday = new Date(date);
    sunday.setDate(date.getDate() - day);
    const saturday = new Date(sunday);
    saturday.setDate(sunday.getDate() + 6);
    return { weekStart: formatDate(sunday), weekEnd: formatDate(saturday) };
}

export interface CustomOrderInWeek {
    id: string;
    client_id: string;
    clientName: string;
    order_number: number | null;
    scheduled_delivery_date: string | null;
    status: string;
    total_value: number;
    notes: string | null;
    created_at: string;
}

/** One row: a client who has 2+ custom orders in the same week; includes both (or all) orders. */
export interface ClientWithMultipleCustomOrdersInWeek {
    client_id: string;
    clientName: string;
    orders: CustomOrderInWeek[];
}

export interface WeekWithMultipleCustomOrders {
    weekStart: string;
    weekEnd: string;
    /** Only clients who have at least 2 custom orders in this week; each row shows both order numbers. */
    clientRows: ClientWithMultipleCustomOrdersInWeek[];
}

/**
 * GET - Clients who have 2+ custom orders in the same week (Sun–Sat). One row per client per week, showing both order numbers.
 */
export async function GET() {
    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('id, client_id, order_number, scheduled_delivery_date, status, total_value, notes, created_at')
            .eq('service_type', 'Custom')
            .not('scheduled_delivery_date', 'is', null)
            .order('scheduled_delivery_date', { ascending: true })
            .order('created_at', { ascending: true });

        if (error) {
            console.error('cleanup-custom-orders-week GET:', error);
            return NextResponse.json({ success: false, error: error.message }, { status: 500 });
        }

        const list = orders || [];
        const clientIds = [...new Set(list.map((o: any) => o.client_id).filter(Boolean))];
        let clientNames: Record<string, string> = {};
        if (clientIds.length > 0) {
            const { data: clients } = await supabase
                .from('clients')
                .select('id, full_name')
                .in('id', clientIds);
            clientNames = (clients || []).reduce((acc: Record<string, string>, c: any) => {
                acc[c.id] = c.full_name || c.id;
                return acc;
            }, {});
        }

        const mapOrder = (o: any): CustomOrderInWeek => ({
            id: o.id,
            client_id: o.client_id,
            clientName: clientNames[o.client_id] ?? o.client_id,
            order_number: o.order_number ?? null,
            scheduled_delivery_date: o.scheduled_delivery_date,
            status: o.status ?? 'pending',
            total_value: Number(o.total_value) ?? 0,
            notes: o.notes ?? null,
            created_at: o.created_at
        });

        // Group by week (Sun–Sat), then by client within each week
        const byWeek = new Map<string, Map<string, any[]>>();
        for (const o of list) {
            const { weekStart } = getWeekBounds(o.scheduled_delivery_date);
            if (!byWeek.has(weekStart)) byWeek.set(weekStart, new Map());
            const weekMap = byWeek.get(weekStart)!;
            const cid = o.client_id;
            if (!weekMap.has(cid)) weekMap.set(cid, []);
            weekMap.get(cid)!.push(o);
        }

        // Only include clients who have 2+ custom orders in that week; one row per client with both order numbers
        const result: WeekWithMultipleCustomOrders[] = [];
        for (const [weekStart, clientToOrders] of byWeek.entries()) {
            const { weekEnd } = getWeekBounds(weekStart);
            const clientRows: ClientWithMultipleCustomOrdersInWeek[] = [];
            for (const [clientId, ordersInWeek] of clientToOrders.entries()) {
                if (ordersInWeek.length < 2) continue; // client must have at least 2 custom orders in this week
                clientRows.push({
                    client_id: clientId,
                    clientName: clientNames[clientId] ?? clientId,
                    orders: ordersInWeek.map(mapOrder)
                });
            }
            if (clientRows.length === 0) continue;
            clientRows.sort((a, b) => a.clientName.localeCompare(b.clientName));
            result.push({ weekStart, weekEnd, clientRows });
        }
        result.sort((a, b) => b.weekStart.localeCompare(a.weekStart));

        return NextResponse.json({
            success: true,
            weeksWithMultipleCustomOrders: result
        });
    } catch (e) {
        console.error('cleanup-custom-orders-week GET:', e);
        return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
