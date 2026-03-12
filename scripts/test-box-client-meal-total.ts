/**
 * Test script to verify the "Upcoming order meal total" calculation for box clients.
 * 
 * Bug: The old code summed itemPoints * qty * boxQty for every item inside each box,
 * inflating the total (e.g. 27 instead of 1 for BELLA EIZAK).
 * Fix: For Boxes, the total should be the number of boxes (sum of box quantities).
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function itemPoints(item: { value?: number; quota_value?: number } | undefined): number {
    if (!item) return 0;
    const v = Number(item.value ?? 0);
    const q = Number(item.quota_value ?? 0);
    return v > 0 ? v : (q || 0);
}

function computeOLD(
    upcomingOrder: any,
    menuItemMap: Map<string, { value?: number; quota_value?: number }>,
    mealItemMap: Map<string, { value?: number; quota_value?: number }>
): number | '' {
    if (!upcomingOrder || typeof upcomingOrder !== 'object') return '';
    const st = upcomingOrder.serviceType;
    if (st !== 'Boxes') return '';

    let total = 0;
    const boxOrders = upcomingOrder.boxOrders;
    if (Array.isArray(boxOrders)) {
        for (const bo of boxOrders) {
            const boxQty = Number(bo.quantity ?? 1) || 1;
            const items = bo.items;
            if (items && typeof items === 'object') {
                for (const [itemId, qty] of Object.entries(items as Record<string, unknown>)) {
                    const q = Number(qty);
                    if (q <= 0) continue;
                    const item = menuItemMap.get(itemId) ?? mealItemMap.get(itemId);
                    total += itemPoints(item) * q * boxQty;
                }
            }
        }
    }
    return total;
}

function computeNEW(upcomingOrder: any): number | '' {
    if (!upcomingOrder || typeof upcomingOrder !== 'object') return '';
    const st = upcomingOrder.serviceType;
    if (st !== 'Boxes') return '';

    let total = 0;
    const boxOrders = upcomingOrder.boxOrders;
    if (Array.isArray(boxOrders)) {
        for (const bo of boxOrders) {
            const boxQty = Number(bo.quantity ?? 1) || 1;
            total += boxQty;
        }
    }
    return total;
}

async function main() {
    console.log('=== Test: Box Client Upcoming Order Meal Total ===\n');

    const [{ data: menuItems }, { data: mealItems }] = await Promise.all([
        supabase.from('menu_items').select('id, value, quota_value'),
        supabase.from('breakfast_items').select('id, quota_value')
    ]);

    const menuItemMap = new Map<string, { value?: number; quota_value?: number }>();
    for (const mi of menuItems ?? []) {
        menuItemMap.set(mi.id, { value: mi.value, quota_value: mi.quota_value });
    }
    const mealItemMap = new Map<string, { value?: number; quota_value?: number }>();
    for (const mi of mealItems ?? []) {
        mealItemMap.set(mi.id, { value: undefined, quota_value: mi.quota_value });
    }

    // 1. Find BELLA EIZAK specifically
    const { data: bellaResults } = await supabase
        .from('clients')
        .select('id, full_name, service_type, approved_meals_per_week, upcoming_order')
        .ilike('full_name', '%BELLA%EIZAK%');

    if (!bellaResults || bellaResults.length === 0) {
        // Try broader search
        const { data: eizakResults } = await supabase
            .from('clients')
            .select('id, full_name, service_type, approved_meals_per_week, upcoming_order')
            .ilike('full_name', '%EIZAK%');

        if (!eizakResults || eizakResults.length === 0) {
            console.log('WARNING: Could not find BELLA EIZAK or any EIZAK client.\n');
        } else {
            console.log(`Found ${eizakResults.length} EIZAK client(s):\n`);
            for (const c of eizakResults) {
                testClient(c, menuItemMap, mealItemMap);
            }
        }
    } else {
        console.log(`Found ${bellaResults.length} BELLA EIZAK client(s):\n`);
        for (const c of bellaResults) {
            testClient(c, menuItemMap, mealItemMap);
        }
    }

    // 2. Test ALL box clients for comparison
    console.log('\n=== All Box Clients ===\n');
    const { data: boxClients } = await supabase
        .from('clients')
        .select('id, full_name, service_type, approved_meals_per_week, upcoming_order')
        .eq('service_type', 'Boxes')
        .order('full_name');

    if (!boxClients || boxClients.length === 0) {
        // Also check upcoming_order serviceType since service_type on client record might differ
        const { data: allClients } = await supabase
            .from('clients')
            .select('id, full_name, service_type, approved_meals_per_week, upcoming_order')
            .not('upcoming_order', 'is', null)
            .order('full_name');

        const boxFromUpcoming = (allClients ?? []).filter(
            c => c.upcoming_order && typeof c.upcoming_order === 'object' && (c.upcoming_order as any).serviceType === 'Boxes'
        );

        if (boxFromUpcoming.length === 0) {
            console.log('No box clients found in the database.\n');
        } else {
            console.log(`Found ${boxFromUpcoming.length} clients with Boxes serviceType in upcoming_order:\n`);
            let discrepancies = 0;
            for (const c of boxFromUpcoming) {
                const hasBug = testClient(c, menuItemMap, mealItemMap);
                if (hasBug) discrepancies++;
            }
            printSummary(boxFromUpcoming.length, discrepancies);
        }
    } else {
        console.log(`Found ${boxClients.length} box clients:\n`);
        let discrepancies = 0;
        for (const c of boxClients) {
            const hasBug = testClient(c, menuItemMap, mealItemMap);
            if (hasBug) discrepancies++;
        }
        printSummary(boxClients.length, discrepancies);
    }
}

function testClient(
    c: any,
    menuItemMap: Map<string, { value?: number; quota_value?: number }>,
    mealItemMap: Map<string, { value?: number; quota_value?: number }>
): boolean {
    const uo = c.upcoming_order;
    const oldVal = computeOLD(uo, menuItemMap, mealItemMap);
    const newVal = computeNEW(uo);
    const hasBug = oldVal !== newVal && oldVal !== '' && newVal !== '';

    const boxOrders = uo?.boxOrders;
    const numBoxEntries = Array.isArray(boxOrders) ? boxOrders.length : 0;
    const totalItemsInBoxes = Array.isArray(boxOrders)
        ? boxOrders.reduce((sum: number, bo: any) => {
            const items = bo.items;
            if (!items || typeof items !== 'object') return sum;
            return sum + Object.values(items).reduce((s: number, q: any) => s + (Number(q) || 0), 0);
        }, 0)
        : 0;

    const marker = hasBug ? ' *** BUG ***' : '';
    console.log(`  ${c.full_name} (id: ${c.id})`);
    console.log(`    service_type: ${c.service_type}`);
    console.log(`    approved_meals_per_week: ${c.approved_meals_per_week}`);
    console.log(`    upcoming_order serviceType: ${uo?.serviceType ?? '(none)'}`);
    console.log(`    boxOrders count: ${numBoxEntries}`);
    console.log(`    total individual items in boxes: ${totalItemsInBoxes}`);
    console.log(`    OLD calculation (buggy):  ${oldVal}${marker}`);
    console.log(`    NEW calculation (fixed):  ${newVal}`);
    if (hasBug) {
        console.log(`    >>> DISCREPANCY: Old showed ${oldVal}, should be ${newVal}`);
    }
    console.log('');
    return hasBug;
}

function printSummary(total: number, discrepancies: number) {
    console.log('=== SUMMARY ===');
    console.log(`Total box clients tested: ${total}`);
    console.log(`Clients with discrepancy (old vs new): ${discrepancies}`);
    if (discrepancies === 0) {
        console.log('All box clients would show the same value with old and new logic.');
        console.log('(This could mean their boxes have no items yet, or items have 0 points.)');
    } else {
        console.log(`${discrepancies} client(s) were affected by the bug.`);
        console.log('The NEW calculation correctly counts boxes, not item points.');
    }
    console.log('');
}

main().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
