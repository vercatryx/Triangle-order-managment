/**
 * Temporary script to debug why CLIENT-1485 is not showing on Needs Attention.
 * Runs the same logic as ClientList needs-attention view and prints each check.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

const envLocalPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
} else {
    dotenv.config();
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const CLIENT_ID = 'CLIENT-1485';

function mapClientFromDB(c: any) {
    return {
        id: c.id,
        fullName: c.full_name,
        statusId: c.status_id || '',
        serviceType: c.service_type,
        authorizedAmount: c.authorized_amount ?? null,
        expirationDate: c.expiration_date || null,
        upcomingOrder: c.upcoming_order ?? undefined,
        mealOrder: undefined
    };
}

async function main() {
    console.log('=== Why is', CLIENT_ID, 'not on Needs Attention? ===\n');

    // 1. Fetch client
    const { data: clientRow, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', CLIENT_ID)
        .single();

    if (clientError || !clientRow) {
        console.error('Client fetch error:', clientError?.message || 'No data');
        return;
    }

    const c = mapClientFromDB(clientRow);
    console.log('--- Client ---');
    console.log('ID:', c.id);
    console.log('Name:', c.fullName);
    console.log('statusId:', c.statusId);
    console.log('serviceType:', c.serviceType);
    console.log('authorizedAmount:', c.authorizedAmount);
    console.log('expirationDate:', c.expirationDate);
    console.log('upcoming_order present:', !!clientRow.upcoming_order);
    if (clientRow.upcoming_order) {
        const uo = clientRow.upcoming_order as any;
        console.log('  upcoming_order.serviceType:', uo.serviceType);
        console.log('  upcoming_order.boxOrders count:', uo.boxOrders?.length ?? 0);
        if (uo.boxOrders?.length) {
            uo.boxOrders.forEach((b: any, i: number) => {
                console.log(`  boxOrders[${i}]: boxTypeId=${b.boxTypeId}, vendorId=${b.vendorId || '(empty)'}, items keys=${Object.keys(b.items || {}).length}`);
            });
        }
        console.log('  upcoming_order.mealSelections:', uo.mealSelections ? Object.keys(uo.mealSelections) : 'none');
    }
    console.log('');

    // 2. Fetch statuses
    const { data: statusesRows } = await supabase.from('client_statuses').select('*');
    const statuses = statusesRows || [];
    const status = statuses.find((s: any) => s.id === c.statusId);
    const isEligible = status ? !!status.deliveries_allowed : false;

    console.log('--- Eligibility ---');
    console.log('status name:', status?.name);
    console.log('deliveries_allowed:', status?.deliveries_allowed);
    console.log('isEligible:', isEligible);
    if (!isEligible) {
        console.log('\n>>> REASON: Client is NOT ELIGIBLE (status does not allow deliveries). Needs Attention only shows eligible clients.');
        return;
    }
    console.log('');

    // 3. Fetch box_types for vendor fallback
    const { data: boxTypesRows } = await supabase.from('box_types').select('*');
    const boxTypes = (boxTypesRows || []).map((b: any) => ({
        id: b.id,
        vendorId: b.vendor_id
    }));

    // 4. Fetch client_box_orders (DB table) - UI may not use this for needs-attention!
    const { data: boxOrdersDb } = await supabase
        .from('client_box_orders')
        .select('*')
        .eq('client_id', CLIENT_ID);

    console.log('--- Box orders (client_box_orders table) ---');
    console.log('Count:', boxOrdersDb?.length ?? 0);
    if (boxOrdersDb?.length) {
        boxOrdersDb.forEach((b: any, i: number) => {
            console.log(`  [${i}] box_type_id=${b.box_type_id}, vendor_id=${b.vendor_id || '(null)'}, items keys=${Object.keys(b.items || {}).length}`);
        });
    }
    console.log('');

    // 5. Same sources as UI: upcomingOrder from client, detailsCache.boxOrders = [] in batch
    const activeBoxOrders = c.upcomingOrder?.boxOrders || [];
    const cachedBoxOrders: any[] = []; // getBatchClientDetails returns boxOrders: []
    const allBoxOrders = activeBoxOrders.length > 0 ? activeBoxOrders : cachedBoxOrders;

    console.log('--- allBoxOrders (used by Needs Attention) ---');
    console.log('From upcoming_order.boxOrders:', activeBoxOrders.length);
    console.log('From detailsCache.boxOrders (always [] in batch):', cachedBoxOrders.length);
    console.log('allBoxOrders length:', allBoxOrders.length);
    console.log('');

    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Run each check exactly like ClientList
    let boxesNeedsVendor = false;
    if (c.serviceType === 'Boxes') {
        const clientDetails = { boxOrders: cachedBoxOrders }; // In UI detailsCache[id].boxOrders is []
        const boxOrders = clientDetails.boxOrders || [];
        if (boxOrders.length === 0) {
            boxesNeedsVendor = true;
        } else {
            boxesNeedsVendor = boxOrders.some((boxOrder: any) => {
                if (boxOrder.vendorId) return false;
                const box = boxTypes.find((b: any) => b.id === boxOrder.boxTypeId);
                return !box?.vendorId;
            });
        }
    }

    let expirationInCurrentMonth = false;
    if (c.expirationDate) {
        const expDate = new Date(c.expirationDate);
        expirationInCurrentMonth = expDate >= firstDayOfMonth && expDate <= lastDayOfMonth;
    }

    const boxesLowOrNoAmount = c.serviceType === 'Boxes' && (c.authorizedAmount === null || c.authorizedAmount === undefined || c.authorizedAmount < 584);
    const foodLowOrNoAmount = c.serviceType === 'Food' && (c.authorizedAmount === null || c.authorizedAmount === undefined || c.authorizedAmount < 1344);

    const mealSelections = (c as any).mealOrder?.mealSelections || c.upcomingOrder?.mealSelections;
    let mealNeedsVendor = false;
    if (mealSelections) {
        const mealTypes = Object.keys(mealSelections);
        if (mealTypes.length > 0) {
            mealNeedsVendor = mealTypes.some((type: string) => !mealSelections[type].vendorId);
        }
    }

    let boxOrderNeedsVendor = false;
    if (allBoxOrders.length > 0) {
        boxOrderNeedsVendor = allBoxOrders.some((boxOrder: any) => {
            if (boxOrder.vendorId) return false;
            const box = boxTypes.find((b: any) => b.id === boxOrder.boxTypeId);
            return !box?.vendorId;
        });
    }

    let boxClientItemsSelectedNoVendor = false;
    if (c.serviceType === 'Boxes' && allBoxOrders.length > 0) {
        boxClientItemsSelectedNoVendor = allBoxOrders.some((boxOrder: any) => {
            const hasItemsSelected = Object.keys(boxOrder.items || {}).length > 0;
            if (!hasItemsSelected) return false;
            if (boxOrder.vendorId) return false;
            const box = boxTypes.find((b: any) => b.id === boxOrder.boxTypeId);
            return !box?.vendorId;
        });
    }

    const matchesView = boxesNeedsVendor || expirationInCurrentMonth || boxesLowOrNoAmount || foodLowOrNoAmount || mealNeedsVendor || boxOrderNeedsVendor || boxClientItemsSelectedNoVendor;

    console.log('--- Needs Attention checks (same as ClientList) ---');
    console.log('1. boxesNeedsVendor (Boxes + no/empty boxOrders or any missing vendor):', boxesNeedsVendor);
    console.log('2. expirationInCurrentMonth:', expirationInCurrentMonth);
    console.log('3. boxesLowOrNoAmount (Boxes + auth < 584 or null):', boxesLowOrNoAmount);
    console.log('4. foodLowOrNoAmount (Food + auth < 1344 or null):', foodLowOrNoAmount);
    console.log('5. mealNeedsVendor:', mealNeedsVendor);
    console.log('6. boxOrderNeedsVendor (any box order no vendor):', boxOrderNeedsVendor);
    console.log('7. boxClientItemsSelectedNoVendor (Boxes + items selected but no vendor):', boxClientItemsSelectedNoVendor);
    console.log('');
    console.log('>>> matchesView (would show in Needs Attention):', matchesView);

    if (!matchesView) {
        console.log('\n>>> REASON: None of the 7 conditions are true.');
        if (c.serviceType === 'Boxes' && (boxOrdersDb?.length ?? 0) > 0 && allBoxOrders.length === 0) {
            console.log('\n*** LIKELY CAUSE: Box orders exist in client_box_orders table but clients.upcoming_order.boxOrders is empty or missing. The UI only uses clients.upcoming_order (and detailsCache.boxOrders which is always []). So this client is invisible to Needs Attention until upcoming_order contains the box orders.');
        }
    }
}

main();
