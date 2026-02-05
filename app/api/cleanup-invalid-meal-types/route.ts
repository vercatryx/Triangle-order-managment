import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function getValidMealTypes(): Promise<string[]> {
    const { data, error } = await supabase
        .from('breakfast_categories')
        .select('meal_type');
    if (error) throw error;
    return [...new Set((data || []).map((r: { meal_type: string }) => r.meal_type).filter(Boolean))].sort();
}

function isInvalidSelectionKey(key: string, validTypes: string[]): boolean {
    if (validTypes.includes(key)) return false;
    for (const vt of validTypes) {
        if (key.startsWith(vt + '_')) return false;
    }
    return true;
}

function isInvalidUpcomingMealType(mealType: string, validTypes: string[]): boolean {
    if (!mealType) return false;
    if (validTypes.includes(mealType)) return false;
    for (const vt of validTypes) {
        if (mealType.startsWith(vt + '_')) return false;
    }
    return true;
}

export interface ClientMealOrderIssue {
    id: string;
    clientId: string;
    clientName?: string;
    invalidKeys: string[];
}

export interface UpcomingOrderIssue {
    id: string;
    clientId: string;
    clientName?: string;
    serviceType: string;
    deliveryDay: string | null;
    currentMealType: string;
}

/**
 * GET - List invalid meal type issues (client_meal_orders with invalid keys, upcoming_orders with invalid meal_type).
 */
export async function GET() {
    try {
        const validMealTypes = await getValidMealTypes();

        const clientMealOrderIssues: ClientMealOrderIssue[] = [];
        const upcomingOrderIssues: UpcomingOrderIssue[] = [];

        const { data: mealOrders, error: mealErr } = await supabase
            .from('client_meal_orders')
            .select('id, client_id, meal_selections');
        if (mealErr) throw mealErr;

        for (const row of mealOrders || []) {
            const selections = (row.meal_selections as Record<string, unknown>) || {};
            const invalidKeys = Object.keys(selections).filter((k) => isInvalidSelectionKey(k, validMealTypes));
            if (invalidKeys.length > 0) {
                clientMealOrderIssues.push({
                    id: row.id,
                    clientId: row.client_id,
                    invalidKeys
                });
            }
        }

        // Only active orders (not yet processed)
        const { data: upcoming, error: upErr } = await supabase
            .from('upcoming_orders')
            .select('id, client_id, service_type, delivery_day, meal_type, status')
            .neq('status', 'processed');
        if (upErr) throw upErr;

        for (const row of upcoming || []) {
            const mealType = row.meal_type != null ? String(row.meal_type) : '';
            if (mealType && isInvalidUpcomingMealType(mealType, validMealTypes)) {
                upcomingOrderIssues.push({
                    id: row.id,
                    clientId: row.client_id,
                    serviceType: row.service_type || '',
                    deliveryDay: row.delivery_day ?? null,
                    currentMealType: mealType
                });
            }
        }

        const clientIds = [
            ...new Set([
                ...clientMealOrderIssues.map((i) => i.clientId),
                ...upcomingOrderIssues.map((i) => i.clientId)
            ])
        ];
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
        clientMealOrderIssues.forEach((i) => { i.clientName = clientNames[i.clientId]; });
        upcomingOrderIssues.forEach((i) => { i.clientName = clientNames[i.clientId]; });

        return NextResponse.json({
            success: true,
            validMealTypes,
            clientMealOrderIssues,
            upcomingOrderIssues
        });
    } catch (e: unknown) {
        console.error('cleanup-invalid-meal-types GET:', e);
        return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

/**
 * POST - Clean invalid meal types. Body: { clientMealOrderIds?: string[], upcomingOrderIds?: string[], cleanAll?: boolean }.
 * If cleanAll, clean all issues. Otherwise clean only the given ids.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const cleanAll = !!body.cleanAll;
        const clientMealOrderIds: string[] = Array.isArray(body.clientMealOrderIds) ? body.clientMealOrderIds : [];
        const upcomingOrderIds: string[] = Array.isArray(body.upcomingOrderIds) ? body.upcomingOrderIds : [];

        const validMealTypes = await getValidMealTypes();

        let clientMealFixed = 0;
        let upcomingFixed = 0;
        const errors: string[] = [];

        if (cleanAll || clientMealOrderIds.length > 0) {
            const { data: mealOrders, error: fetchErr } = await supabase
                .from('client_meal_orders')
                .select('id, client_id, meal_selections');
            if (fetchErr) throw fetchErr;

            const toProcess = cleanAll
                ? (mealOrders || [])
                : (mealOrders || []).filter((r: { id: string }) => clientMealOrderIds.includes(r.id));

            for (const row of toProcess) {
                const selections = (row.meal_selections as Record<string, unknown>) || {};
                const invalidKeys = Object.keys(selections).filter((k) => isInvalidSelectionKey(k, validMealTypes));
                if (invalidKeys.length === 0) continue;

                const next: Record<string, unknown> = {};
                for (const k of Object.keys(selections)) {
                    if (!invalidKeys.includes(k)) next[k] = selections[k];
                }
                const { error: upd } = await supabase
                    .from('client_meal_orders')
                    .update({ meal_selections: Object.keys(next).length ? next : null })
                    .eq('id', row.id);
                if (upd) errors.push(`client_meal_orders ${row.id}: ${upd.message}`);
                else clientMealFixed++;
            }
        }

        if (cleanAll || upcomingOrderIds.length > 0) {
            const { data: upcoming, error: fetchErr } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, meal_type')
                .neq('status', 'processed');
            if (fetchErr) throw fetchErr;

            const toProcess = cleanAll
                ? (upcoming || []).filter((r: { meal_type: string | null }) => {
                    const mt = r.meal_type != null ? String(r.meal_type) : '';
                    return mt && isInvalidUpcomingMealType(mt, validMealTypes);
                })
                : (upcoming || []).filter((r: { id: string }) => upcomingOrderIds.includes(r.id));

            for (const row of toProcess) {
                const { error: upd } = await supabase
                    .from('upcoming_orders')
                    .update({ meal_type: null })
                    .eq('id', row.id);
                if (upd) errors.push(`upcoming_orders ${row.id}: ${upd.message}`);
                else upcomingFixed++;
            }
        }

        return NextResponse.json({
            success: errors.length === 0,
            clientMealFixed,
            upcomingFixed,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (e: unknown) {
        console.error('cleanup-invalid-meal-types POST:', e);
        return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
