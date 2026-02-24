/**
 * Debug script: trace exactly what create-orders-next-week would do for a given client.
 *
 * Usage:
 *   npx tsx scripts/debug-client-order-creation.ts CLIENT-006
 *   npx tsx scripts/debug-client-order-creation.ts "JOHN DOE"
 *   npx tsx scripts/debug-client-order-creation.ts 156e860e-790b-4b6d-9ab1-568ffde26aa7
 *
 * Accepts a client ID (e.g. CLIENT-006 or UUID) or a partial name (case-insensitive).
 * Outputs a full trace of what would happen to each potential order.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, '');
            process.env[key] = value;
        }
    });
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DAY_NAME_TO_NUMBER: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6
};

function getDateForDayInWeek(weekStart: Date, dayName: string): Date | null {
    const n = DAY_NAME_TO_NUMBER[dayName];
    if (n === undefined) return null;
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + n);
    return d;
}

function getFirstDeliveryDateInWeek(weekStart: Date, deliveryDays: string[]): Date | null {
    if (!deliveryDays || deliveryDays.length === 0) return null;
    const set = new Set(deliveryDays.map(d => d.trim()));
    for (let i = 0; i < 7; i++) {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        const name = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
        if (set.has(name)) return d;
    }
    return null;
}

function vendorSelectionsToDeliveryDayOrders(vendorSelections: any[]): Record<string, { vendorSelections: any[] }> {
    const result: Record<string, { vendorSelections: any[] }> = {};
    for (const vs of vendorSelections) {
        const days = vs.selectedDeliveryDays || vs.selected_delivery_days || [];
        if (vs.itemsByDay && typeof vs.itemsByDay === 'object') {
            for (const dayName of Object.keys(vs.itemsByDay)) {
                if (!result[dayName]) result[dayName] = { vendorSelections: [] };
                result[dayName].vendorSelections.push({
                    vendorId: vs.vendorId ?? vs.vendor_id,
                    items: vs.itemsByDay[dayName],
                    itemNotes: vs.itemNotesByDay?.[dayName] ?? {}
                });
            }
        } else if (days.length > 0) {
            for (const dayName of days) {
                if (!result[dayName]) result[dayName] = { vendorSelections: [] };
                result[dayName].vendorSelections.push({
                    vendorId: vs.vendorId ?? vs.vendor_id,
                    items: vs.items || {},
                    itemNotes: vs.itemNotes || {}
                });
            }
        }
    }
    return result;
}

const INDENT = '  ';
let section = 0;

function header(text: string) {
    section++;
    console.log(`\n${'='.repeat(70)}`);
    console.log(`  ${section}. ${text}`);
    console.log('='.repeat(70));
}

function info(label: string, value: any) {
    console.log(`${INDENT}${label}: ${typeof value === 'object' ? JSON.stringify(value, null, 2).replace(/\n/g, '\n' + INDENT + ' '.repeat(label.length + 2)) : value}`);
}

function ok(msg: string) { console.log(`${INDENT}  ✓ ${msg}`); }
function warn(msg: string) { console.log(`${INDENT}  ⚠ ${msg}`); }
function fail(msg: string) { console.log(`${INDENT}  ✗ ${msg}`); }
function skip(msg: string) { console.log(`${INDENT}  — SKIP: ${msg}`); }

async function main() {
    const input = process.argv[2];
    if (!input) {
        console.error('Usage: npx tsx scripts/debug-client-order-creation.ts <CLIENT-ID or "NAME">');
        process.exit(1);
    }

    // ── Resolve client ──────────────────────────────────────────────
    header('Resolving client');
    info('Input', input);

    let client: any;
    {
        const { data: byId } = await supabase
            .from('clients')
            .select('id, full_name, status_id, service_type, parent_client_id, expiration_date, upcoming_order, approved_meals_per_week')
            .eq('id', input)
            .maybeSingle();
        if (byId) {
            client = byId;
            ok(`Found by exact ID: ${client.full_name} (${client.id})`);
        } else {
            const { data: byName } = await supabase
                .from('clients')
                .select('id, full_name, status_id, service_type, parent_client_id, expiration_date, upcoming_order, approved_meals_per_week')
                .is('parent_client_id', null)
                .ilike('full_name', `%${input}%`)
                .limit(5);
            if (byName && byName.length === 1) {
                client = byName[0];
                ok(`Found by name: ${client.full_name} (${client.id})`);
            } else if (byName && byName.length > 1) {
                console.log(`${INDENT}Multiple clients match "${input}":`);
                for (const c of byName) console.log(`${INDENT}  - ${c.full_name} (${c.id})`);
                console.error('Please narrow your search or use the exact ID.');
                process.exit(1);
            } else {
                console.error(`No client found for "${input}".`);
                process.exit(1);
            }
        }
    }

    // ── Show client data ────────────────────────────────────────────
    header('Client details');
    info('ID', client.id);
    info('Name', client.full_name);
    info('Status ID', client.status_id);
    info('Service Type (column)', client.service_type);
    info('Parent Client', client.parent_client_id ?? '(none — primary)');
    info('Expiration Date', client.expiration_date ?? '(none)');
    info('Approved Meals/Week', client.approved_meals_per_week ?? '(null)');

    header('upcoming_order (raw)');
    const uo = client.upcoming_order;
    if (!uo) {
        fail('upcoming_order is NULL — no orders would be created.');
        process.exit(0);
    }
    console.log(JSON.stringify(uo, null, 2));

    // ── Derive serviceType and data presence ────────────────────────
    header('Parsed upcoming_order fields');
    const st = (uo as any).serviceType ?? (uo as any).service_type;
    const ddo = (uo as any).deliveryDayOrders ?? (uo as any).delivery_day_orders;
    const vsel = (uo as any).vendorSelections ?? (uo as any).vendor_selections;
    const mealSel = (uo as any).mealSelections ?? (uo as any).meal_selections;
    const boxList = (uo as any).boxOrders ?? (uo as any).box_orders;
    const customProd = (uo as any).customProduct ?? (uo as any).custom_product;

    info('serviceType', st ?? '(undefined)');
    info('Has deliveryDayOrders', ddo && typeof ddo === 'object' ? `yes (${Object.keys(ddo).length} days)` : 'no');
    info('Has vendorSelections', Array.isArray(vsel) && vsel.length > 0 ? `yes (${vsel.length} entries)` : 'no');
    info('Has mealSelections', mealSel && typeof mealSel === 'object' && Object.keys(mealSel).length > 0 ? `yes (${Object.keys(mealSel).length} types)` : 'no');
    info('Has boxOrders', Array.isArray(boxList) && boxList.length > 0 ? `yes (${boxList.length} boxes)` : 'no');
    info('Has customProduct', !!customProd ? 'yes' : 'no');

    // ── Simulate work-list filtering ────────────────────────────────
    header('Work-list filtering (which phases would pick up this client)');

    const isFoodTypeCurrent = st === 'Food' || st === undefined;
    const hasFoodData = (() => {
        if (ddo && typeof ddo === 'object' && Object.keys(ddo).length > 0) return true;
        if (Array.isArray(vsel) && vsel.length > 0) return true;
        return false;
    })();
    const isMealType = st === 'Food' || st === 'Meal';
    const hasMealData = mealSel && typeof mealSel === 'object' && Object.keys(mealSel).length > 0;
    const isBoxesType = st === 'Boxes';
    const hasBoxData = Array.isArray(boxList) && boxList.length > 0;
    const isCustomType = st === 'Custom';
    const hasCustomData = !!customProd;

    console.log();
    console.log(`${INDENT}[FOOD PHASE]`);
    console.log(`${INDENT}  Current filter: serviceType === 'Food' || undefined → ${isFoodTypeCurrent}`);
    console.log(`${INDENT}  Has food data (deliveryDayOrders/vendorSelections): ${hasFoodData}`);
    if (!isFoodTypeCurrent && hasFoodData) {
        fail(`BUG: Client has food data but serviceType="${st}" → SILENTLY SKIPPED by food phase!`);
        warn('The food filter should also accept serviceType="Meal" when food data exists.');
    } else if (isFoodTypeCurrent && hasFoodData) {
        ok('Would be added to foodOrders work list.');
    } else if (isFoodTypeCurrent && !hasFoodData) {
        skip('serviceType matches but no food data — foodSkippedNoData++');
    } else {
        skip(`serviceType="${st}" — not considered for food phase.`);
    }

    console.log();
    console.log(`${INDENT}[MEAL PHASE]`);
    console.log(`${INDENT}  Current filter: serviceType === 'Food' || 'Meal' → ${isMealType}`);
    console.log(`${INDENT}  Has meal data (mealSelections): ${!!hasMealData}`);
    if (isMealType && hasMealData) {
        ok('Would be added to mealOrders work list.');
    } else if (isMealType && !hasMealData) {
        skip('serviceType matches but no mealSelections — not in meal work list.');
    } else {
        skip(`serviceType="${st}" — not considered for meal phase.`);
    }

    console.log();
    console.log(`${INDENT}[BOXES PHASE]`);
    console.log(`${INDENT}  Current filter: serviceType === 'Boxes' → ${isBoxesType}`);
    console.log(`${INDENT}  Has box data: ${!!hasBoxData}`);
    if (isBoxesType && hasBoxData) {
        ok('Would be added to boxOrders work list.');
    } else {
        skip(`serviceType="${st}" or no box data.`);
    }

    console.log();
    console.log(`${INDENT}[CUSTOM PHASE]`);
    console.log(`${INDENT}  Current filter: serviceType === 'Custom' → ${isCustomType}`);
    console.log(`${INDENT}  Has custom data: ${!!hasCustomData}`);
    if (isCustomType && hasCustomData) {
        ok('Would be added to customOrders work list.');
    } else {
        skip(`serviceType="${st}" or no custom data.`);
    }

    // ── Check eligibility ───────────────────────────────────────────
    header('Eligibility check');
    const { data: statusData } = await supabase
        .from('client_statuses')
        .select('id, name, deliveries_allowed')
        .eq('id', client.status_id)
        .maybeSingle();
    if (!statusData) {
        fail(`Status not found for ID "${client.status_id}".`);
    } else {
        info('Status', `${statusData.name} (deliveries_allowed=${statusData.deliveries_allowed})`);
        if (!statusData.deliveries_allowed) {
            fail(`Status "${statusData.name}" does NOT allow deliveries → all orders would be skipped.`);
        } else {
            ok('Status allows deliveries.');
        }
    }

    const now = new Date();
    const todayStr = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString().split('T')[0];
    if (client.expiration_date) {
        const expStr = typeof client.expiration_date === 'string'
            ? client.expiration_date.split('T')[0]
            : new Date(client.expiration_date).toISOString().split('T')[0];
        info('Expiration Date', expStr);
        if (expStr < todayStr) {
            fail(`Client expired on ${expStr} — orders would be skipped.`);
        } else {
            ok('Not expired.');
        }
    } else {
        ok('No expiration date set.');
    }

    // ── Compute target week ─────────────────────────────────────────
    header('Target week');
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const dayOfWeek = today.getDay();
    const daysUntilNextSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
    const nextWeekStart = new Date(today);
    nextWeekStart.setDate(today.getDate() + daysUntilNextSunday);
    const nextWeekEnd = new Date(nextWeekStart);
    nextWeekEnd.setDate(nextWeekStart.getDate() + 6);
    const weekStartStr = nextWeekStart.toISOString().split('T')[0];
    const weekEndStr = nextWeekEnd.toISOString().split('T')[0];
    info('Week', `${weekStartStr} to ${weekEndStr}`);

    // ── Load vendors ────────────────────────────────────────────────
    const { data: vendors } = await supabase.from('vendors').select('id, name, delivery_days, is_active');
    const vendorMap = new Map((vendors || []).map(v => [v.id, v]));

    // ── Existing orders (duplicate snapshot) ────────────────────────
    header('Existing orders for target week (duplicate snapshot)');
    const { data: existingOrders } = await supabase
        .from('orders')
        .select('id, service_type, scheduled_delivery_date')
        .eq('client_id', client.id)
        .gte('scheduled_delivery_date', weekStartStr)
        .lte('scheduled_delivery_date', weekEndStr);
    if (!existingOrders || existingOrders.length === 0) {
        ok('No existing orders for this week — no duplicates possible.');
    } else {
        warn(`Found ${existingOrders.length} existing order(s):`);
        for (const o of existingOrders) {
            console.log(`${INDENT}    ${o.service_type} on ${o.scheduled_delivery_date} (${o.id})`);
        }
        const nonBoxIds = existingOrders.filter(o => o.service_type !== 'Boxes').map(o => o.id);
        if (nonBoxIds.length > 0) {
            const { data: ovs } = await supabase
                .from('order_vendor_selections')
                .select('order_id, vendor_id')
                .in('order_id', nonBoxIds);
            if (ovs && ovs.length > 0) {
                console.log(`${INDENT}  Vendor selections on those orders:`);
                for (const row of ovs) {
                    const vName = vendorMap.get(row.vendor_id)?.name ?? row.vendor_id;
                    const o = existingOrders.find(x => x.id === row.order_id);
                    console.log(`${INDENT}    ${o?.scheduled_delivery_date} | ${o?.service_type} | ${vName}`);
                }
            }
        }
    }

    // ── Simulate food orders ────────────────────────────────────────
    if (hasFoodData) {
        header('Food order simulation');
        let delivery_day_orders: Record<string, any> = {};
        if (ddo && typeof ddo === 'object' && Object.keys(ddo).length > 0) {
            delivery_day_orders = ddo;
            ok('Using deliveryDayOrders directly.');
        } else if (Array.isArray(vsel) && vsel.length > 0) {
            const normalized = vsel.map((vs: any) => ({ ...vs, vendorId: vs.vendorId ?? vs.vendor_id }));
            delivery_day_orders = vendorSelectionsToDeliveryDayOrders(normalized);
            ok('Converted vendorSelections → deliveryDayOrders.');
        }

        info('Days', Object.keys(delivery_day_orders).join(', '));

        const { data: menuItems } = await supabase.from('menu_items').select('id, vendor_id, name, value, price_each, is_active');
        const menuItemMap = new Map((menuItems || []).map(i => [i.id, i]));

        for (const dayName of Object.keys(delivery_day_orders)) {
            const dayData = delivery_day_orders[dayName];
            const vendorSels = dayData?.vendorSelections || [];
            console.log(`\n${INDENT}  Day: ${dayName} (${vendorSels.length} vendor selection(s))`);

            const deliveryDate = getDateForDayInWeek(nextWeekStart, dayName);
            if (!deliveryDate) {
                fail(`Invalid day name "${dayName}" — no date resolved.`);
                continue;
            }
            const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
            info('Delivery Date', deliveryDateStr);

            if (deliveryDateStr < weekStartStr || deliveryDateStr > weekEndStr) {
                fail(`Date ${deliveryDateStr} outside target week.`);
                continue;
            }

            for (let i = 0; i < vendorSels.length; i++) {
                const sel = vendorSels[i];
                const vid = sel.vendorId ?? sel.vendor_id;
                const vendor = vid ? vendorMap.get(vid) : null;
                const vName = vendor?.name ?? vid ?? '(none)';
                console.log(`${INDENT}    Vendor ${i + 1}: ${vName}`);

                if (!vid) { fail('No vendorId on selection.'); continue; }
                if (!vendor) { fail(`Vendor ${vid} not found in DB.`); continue; }
                if (!vendor.is_active) { fail(`Vendor "${vName}" is inactive.`); continue; }

                const items = sel.items || {};
                const itemIds = Object.keys(items).filter(k => (items[k] ?? 0) > 0);
                const validItems = itemIds.filter(id => menuItemMap.has(id));
                const invalidItems = itemIds.filter(id => !menuItemMap.has(id));
                info('Item IDs requested', `${itemIds.length} (${validItems.length} valid, ${invalidItems.length} missing from menu_items)`);
                if (invalidItems.length > 0) {
                    warn(`Missing item IDs: ${invalidItems.join(', ')}`);
                }

                let totalValue = 0;
                for (const id of validItems) {
                    const mi = menuItemMap.get(id)!;
                    const qty = items[id];
                    totalValue += (mi.value ?? mi.price_each ?? 0) * qty;
                }
                info('Total value', `$${totalValue.toFixed(2)}`);

                if (validItems.length === 0) {
                    fail('No valid items → order would be skipped.');
                } else {
                    ok(`Order would be CREATED: Food, ${vName}, ${deliveryDateStr}, $${totalValue.toFixed(2)}`);
                }
            }
        }
    }

    // ── Simulate meal orders ────────────────────────────────────────
    if (hasMealData) {
        header('Meal order simulation');
        const mealTypes = Object.keys(mealSel);
        info('Meal types', mealTypes.join(', '));

        const { data: mealItems } = await supabase.from('breakfast_items').select('id, name, quota_value, price_each, is_active');
        const mealItemMap = new Map((mealItems || []).map(i => [i.id, i]));

        for (const mealType of mealTypes) {
            const group = mealSel[mealType];
            console.log(`\n${INDENT}  Meal type: ${mealType}`);
            const mealVendorId = group?.vendorId ?? group?.vendor_id;
            const vendor = mealVendorId ? vendorMap.get(mealVendorId) : null;
            const vName = vendor?.name ?? mealVendorId ?? '(none)';

            if (!mealVendorId) { fail('No vendorId on meal selection.'); continue; }
            if (!vendor) { fail(`Vendor ${mealVendorId} not found.`); continue; }
            if (!vendor.is_active) { fail(`Vendor "${vName}" inactive.`); continue; }

            const deliveryDate = getFirstDeliveryDateInWeek(nextWeekStart, vendor.delivery_days || []);
            if (!deliveryDate) {
                fail(`No delivery day in target week for vendor "${vName}" (days: ${(vendor.delivery_days || []).join(', ')}).`);
                continue;
            }
            const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
            info('Delivery Date', deliveryDateStr);
            if (deliveryDateStr < weekStartStr || deliveryDateStr > weekEndStr) {
                fail(`Date ${deliveryDateStr} outside target week.`);
                continue;
            }

            const items = group?.items || {};
            const itemIds = Object.keys(items).filter(k => (items[k] ?? 0) > 0);
            const validItems = itemIds.filter(id => mealItemMap.has(id));
            info('Item IDs', `${itemIds.length} total, ${validItems.length} valid in breakfast_items`);

            let totalValue = 0;
            for (const id of validItems) {
                const mi = mealItemMap.get(id)!;
                const qty = items[id];
                totalValue += (mi.quota_value ?? mi.price_each ?? 0) * qty;
            }
            info('Total value', `$${totalValue.toFixed(2)}`);

            if (validItems.length === 0) {
                fail('No valid items → order would be skipped.');
            } else {
                ok(`Order would be CREATED: Meal (${mealType}), ${vName}, ${deliveryDateStr}, $${totalValue.toFixed(2)}`);
            }
        }
    }

    // ── Simulate box orders ─────────────────────────────────────────
    if (hasBoxData) {
        header('Box order simulation');
        for (let i = 0; i < boxList.length; i++) {
            const b = boxList[i];
            const vid = b.vendorId ?? b.vendor_id;
            const vendor = vid ? vendorMap.get(vid) : null;
            console.log(`${INDENT}  Box ${i + 1}: vendor=${vendor?.name ?? vid ?? '(none)'}, qty=${b.quantity ?? 1}`);
            if (vid && vendor && !vendor.is_active) {
                fail(`Vendor "${vendor.name}" inactive.`);
            } else {
                ok('Would be created.');
            }
        }
    }

    // ── Summary ─────────────────────────────────────────────────────
    header('Summary');
    const wouldCreate: string[] = [];
    const silentSkips: string[] = [];

    if (hasFoodData && isFoodTypeCurrent) wouldCreate.push('Food');
    if (hasFoodData && !isFoodTypeCurrent) silentSkips.push(`Food (serviceType="${st}" but has food data)`);
    if (hasMealData && isMealType) wouldCreate.push('Meal');
    if (hasMealData && !isMealType) silentSkips.push(`Meal (serviceType="${st}")`);
    if (hasBoxData && isBoxesType) wouldCreate.push('Boxes');
    if (hasCustomData && isCustomType) wouldCreate.push('Custom');

    console.log(`${INDENT}Would process: ${wouldCreate.length > 0 ? wouldCreate.join(', ') : '(nothing)'}`);
    if (silentSkips.length > 0) {
        console.log(`${INDENT}SILENTLY SKIPPED (BUG): ${silentSkips.join('; ')}`);
    }

    console.log('\nDone.');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
