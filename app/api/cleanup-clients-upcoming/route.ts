import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function getValidMealTypes(): Promise<string[]> {
    const { data, error } = await supabase.from('breakfast_categories').select('meal_type');
    if (error) throw error;
    return [...new Set((data || []).map((r: { meal_type: string }) => r.meal_type).filter(Boolean))].sort();
}

function isInvalidMealKey(key: string, validTypes: string[]): boolean {
    if (validTypes.includes(key)) return false;
    for (const vt of validTypes) {
        if (key.startsWith(vt + '_')) return false;
    }
    return true;
}

function isInvalidMealTypeValue(mealType: string, validTypes: string[]): boolean {
    if (!mealType) return false;
    if (validTypes.includes(mealType)) return false;
    for (const vt of validTypes) {
        if (mealType.startsWith(vt + '_')) return false;
    }
    return true;
}

export interface MealIssue {
    clientId: string;
    clientName: string;
    invalidKeys: string[];
    invalidRootMealType: string | null;
}

export interface VendorDayIssue {
    clientId: string;
    clientName: string;
    orderDeliveryDay: string;
    vendorId: string;
    vendorName: string;
    vendorSupportedDays: string[];
    serviceType: string;
    itemCount: number;
}

export interface InvalidVendorIssue {
    clientId: string;
    clientName: string;
    vendorId: string;
    vendorName?: string;
    isActive: boolean;
    where: 'deliveryDayOrders' | 'mealSelections';
    day?: string;
    mealKey?: string;
    serviceType: string;
}

export interface ItemDayIssue {
    clientId: string;
    clientName: string;
    orderDeliveryDay: string;
    vendorId: string;
    vendorName: string;
    itemId: string;
    itemName: string;
    itemAllowedDays: string[];
    quantity: number;
    serviceType: string;
}

export interface DeletedMenuItemIssue {
    clientId: string;
    clientName: string;
    orderDeliveryDay: string | null; // null when from vendorSelections.items (flat)
    vendorId: string;
    vendorName: string;
    itemId: string;
    quantity: number;
    serviceType: string;
    where: 'deliveryDayOrders' | 'vendorSelections';
}

const VAL_TOLERANCE = 0.05;
function isMeetingExactTarget(value: number, target: number): boolean {
    return Math.abs(value - target) <= VAL_TOLERANCE;
}

export interface BoxQuotaMismatch {
    boxIndex: number;
    boxTypeId: string;
    boxTypeName: string;
    categoryId: string;
    categoryName: string;
    required: number;
    actual: number;
}

export interface BoxQuotaIssue {
    clientId: string;
    clientName: string;
    mismatches: BoxQuotaMismatch[];
}

/**
 * GET - All cleanup issues from clients.upcoming_order only (no upcoming_orders table).
 */
export async function GET() {
    try {
        const validMealTypes = await getValidMealTypes();
        const { data: vendors, error: vErr } = await supabase
            .from('vendors')
            .select('id, name, delivery_days, is_active');
        if (vErr) throw vErr;
        const vendorMap = new Map<string, { name: string; days: string[]; is_active: boolean }>();
        for (const v of vendors || []) {
            vendorMap.set(v.id, {
                name: v.name || '',
                days: Array.isArray(v.delivery_days) ? v.delivery_days : (v.delivery_days ? [v.delivery_days] : []),
                is_active: !!v.is_active
            });
        }

        const { data: menuItems, error: miErr } = await supabase
            .from('menu_items')
            .select('id, name, delivery_days, vendor_id, category_id, quota_value');
        if (miErr) throw miErr;
        const menuItemMap = new Map<string, { name: string; delivery_days: string[] | null; vendor_id: string | null; category_id: string | null; quota_value: number }>();
        for (const mi of menuItems || []) {
            const days = mi.delivery_days;
            const dayList = Array.isArray(days) && days.length > 0 ? days : null;
            menuItemMap.set(mi.id, {
                name: (mi.name as string) || mi.id,
                delivery_days: dayList,
                vendor_id: (mi.vendor_id as string) || null,
                category_id: (mi.category_id as string) || null,
                quota_value: typeof mi.quota_value === 'number' ? mi.quota_value : parseFloat(String(mi.quota_value || 1)) || 1
            });
        }

        // Box quota definitions: table may not exist in all environments (clients.upcoming_order is source of truth for order data)
        let quotasByBoxType = new Map<string, { categoryId: string; targetValue: number }[]>();
        let categoryMap = new Map<string, string>();
        let boxTypeNameMap = new Map<string, string>();
        const { data: boxQuotas, error: bqErr } = await supabase.from('box_quotas').select('id, box_type_id, category_id, target_value');
        if (bqErr) {
            console.warn('cleanup-clients-upcoming: box_quotas not available:', bqErr.message, '- skipping box quota mismatch checks');
        } else {
            for (const q of boxQuotas || []) {
                const list = quotasByBoxType.get(q.box_type_id) || [];
                list.push({ categoryId: q.category_id, targetValue: Number(q.target_value) || 0 });
                quotasByBoxType.set(q.box_type_id, list);
            }
        }

        const { data: categories, error: catErr } = await supabase.from('item_categories').select('id, name, set_value');
        if (catErr) throw catErr;
        const categorySetValue = new Map<string, number>(); // categoryId -> required value (when no box_quotas)
        for (const c of categories || []) {
            categoryMap.set(c.id, (c.name as string) || c.id);
            const sv = c.set_value;
            if (sv != null && (typeof sv === 'number' ? sv >= 0 : Number(sv) >= 0)) {
                categorySetValue.set(c.id, Number(sv));
            }
        }

        const { data: boxTypes, error: btErr } = await supabase.from('box_types').select('id, name');
        if (btErr) throw btErr;
        for (const bt of boxTypes || []) {
            boxTypeNameMap.set(bt.id, (bt.name as string) || bt.id);
        }

        const { data: clients, error: cErr } = await supabase
            .from('clients')
            .select('id, full_name, upcoming_order')
            .not('upcoming_order', 'is', null);
        if (cErr) throw cErr;

        const mealIssues: MealIssue[] = [];
        const vendorDayIssues: VendorDayIssue[] = [];
        const invalidVendorIssues: InvalidVendorIssue[] = [];
        const itemDayIssues: ItemDayIssue[] = [];
        const deletedMenuItemIssues: DeletedMenuItemIssue[] = [];
        const boxQuotaIssues: BoxQuotaIssue[] = [];

        for (const client of clients || []) {
            const uo = client.upcoming_order as Record<string, unknown> | null;
            if (!uo || typeof uo !== 'object') continue;
            const clientName = (client.full_name as string) || client.id;
            const st = ((uo.serviceType ?? (uo as any).service_type) as string) || 'Food';

            // 1) Invalid meal types: mealSelections keys + root mealType
            if (uo.mealSelections && typeof uo.mealSelections === 'object') {
                const sel = uo.mealSelections as Record<string, unknown>;
                const invalidKeys = Object.keys(sel).filter((k) => isInvalidMealKey(k, validMealTypes));
                const rootMealType = uo.mealType != null ? String(uo.mealType) : null;
                const invalidRoot = rootMealType && isInvalidMealTypeValue(rootMealType, validMealTypes) ? rootMealType : null;
                if (invalidKeys.length > 0 || invalidRoot) {
                    mealIssues.push({
                        clientId: client.id,
                        clientName,
                        invalidKeys,
                        invalidRootMealType: invalidRoot
                    });
                }
            } else if (uo.mealType != null && isInvalidMealTypeValue(String(uo.mealType), validMealTypes)) {
                mealIssues.push({
                    clientId: client.id,
                    clientName,
                    invalidKeys: [],
                    invalidRootMealType: String(uo.mealType)
                });
            }

            // 2) Vendor day mismatch + 3) Invalid vendor from deliveryDayOrders
            const ddo = uo.deliveryDayOrders as Record<string, { vendorSelections?: { vendorId?: string; items?: Record<string, number> }[] }> | undefined;
            if (ddo && typeof ddo === 'object') {
                for (const [day, dayData] of Object.entries(ddo)) {
                    const selections = dayData?.vendorSelections;
                    if (!Array.isArray(selections)) continue;
                    for (const vs of selections) {
                        const vid = vs.vendorId;
                        if (!vid) continue;
                        const vendor = vendorMap.get(vid);
                        if (!vendor) {
                            invalidVendorIssues.push({
                                clientId: client.id,
                                clientName,
                                vendorId: vid,
                                vendorName: `Vendor ${vid} (missing)`,
                                isActive: false,
                                where: 'deliveryDayOrders',
                                day,
                                serviceType: st
                            });
                            continue;
                        }
                        if (!vendor.is_active) {
                            invalidVendorIssues.push({
                                clientId: client.id,
                                clientName,
                                vendorId: vid,
                                vendorName: vendor.name,
                                isActive: false,
                                where: 'deliveryDayOrders',
                                day,
                                serviceType: st
                            });
                        }
                        if (vendor.days.length > 0 && !vendor.days.includes(day)) {
                            const itemCount = Object.values(vs.items || {}).filter((q) => Number(q) > 0).length;
                            vendorDayIssues.push({
                                clientId: client.id,
                                clientName,
                                orderDeliveryDay: day,
                                vendorId: vid,
                                vendorName: vendor.name,
                                vendorSupportedDays: vendor.days,
                                serviceType: st,
                                itemCount
                            });
                        }
                        // Item-on-disallowed-day + Deleted menu item
                        const items = vs.items && typeof vs.items === 'object' ? vs.items : {};
                        for (const [itemId, qty] of Object.entries(items)) {
                            const q = Number(qty);
                            if (q <= 0) continue;
                            const mi = menuItemMap.get(itemId);
                            if (!mi) {
                                deletedMenuItemIssues.push({
                                    clientId: client.id,
                                    clientName,
                                    orderDeliveryDay: day,
                                    vendorId: vid,
                                    vendorName: vendor.name,
                                    itemId,
                                    quantity: q,
                                    serviceType: st,
                                    where: 'deliveryDayOrders'
                                });
                                continue;
                            }
                            if (mi.vendor_id !== vid) continue; // item must belong to this vendor
                            const allowed = mi.delivery_days;
                            if (!allowed || allowed.length === 0) continue; // no restriction = allowed every day
                            if (allowed.includes(day)) continue; // this day is allowed
                            itemDayIssues.push({
                                clientId: client.id,
                                clientName,
                                orderDeliveryDay: day,
                                vendorId: vid,
                                vendorName: vendor.name,
                                itemId,
                                itemName: mi.name,
                                itemAllowedDays: allowed,
                                quantity: q,
                                serviceType: st
                            });
                        }
                    }
                }
            }

            // 2b) Item-on-disallowed-day from vendorSelections + itemsByDay (when deliveryDayOrders not used)
            const vsel = uo.vendorSelections as { vendorId?: string; itemsByDay?: Record<string, Record<string, number>> }[] | undefined;
            if (Array.isArray(vsel) && (!ddo || typeof ddo !== 'object' || Object.keys(ddo).length === 0)) {
                for (const vs of vsel) {
                    const vid = vs.vendorId;
                    if (!vid) continue;
                    const vendor = vendorMap.get(vid);
                    if (!vendor) continue;
                    if (!vendor.is_active) continue;
                    const itemsByDay = vs.itemsByDay && typeof vs.itemsByDay === 'object' ? vs.itemsByDay : {};
                    for (const [day, dayItems] of Object.entries(itemsByDay)) {
                        if (!dayItems || typeof dayItems !== 'object') continue;
                        for (const [itemId, qty] of Object.entries(dayItems)) {
                            const q = Number(qty);
                            if (q <= 0) continue;
                            const mi = menuItemMap.get(itemId);
                            if (!mi) {
                                deletedMenuItemIssues.push({
                                    clientId: client.id,
                                    clientName,
                                    orderDeliveryDay: day,
                                    vendorId: vid,
                                    vendorName: vendor.name,
                                    itemId,
                                    quantity: q,
                                    serviceType: st,
                                    where: 'vendorSelections'
                                });
                                continue;
                            }
                            if (mi.vendor_id !== vid) continue;
                            const allowed = mi.delivery_days;
                            if (!allowed || allowed.length === 0) continue;
                            if (allowed.includes(day)) continue;
                            itemDayIssues.push({
                                clientId: client.id,
                                clientName,
                                orderDeliveryDay: day,
                                vendorId: vid,
                                vendorName: vendor.name,
                                itemId,
                                itemName: mi.name,
                                itemAllowedDays: allowed,
                                quantity: q,
                                serviceType: st
                            });
                        }
                    }
                }
            }

            // 3) Invalid vendor from mealSelections
            if (uo.mealSelections && typeof uo.mealSelections === 'object') {
                const sel = uo.mealSelections as Record<string, { vendorId?: string }>;
                for (const [mealKey, data] of Object.entries(sel)) {
                    const vid = data?.vendorId;
                    if (!vid) continue;
                    const vendor = vendorMap.get(vid);
                    if (!vendor) {
                        invalidVendorIssues.push({
                            clientId: client.id,
                            clientName,
                            vendorId: vid,
                            vendorName: `Vendor ${vid} (missing)`,
                            isActive: false,
                            where: 'mealSelections',
                            mealKey,
                            serviceType: st
                        });
                    } else if (!vendor.is_active) {
                        invalidVendorIssues.push({
                            clientId: client.id,
                            clientName,
                            vendorId: vid,
                            vendorName: vendor.name,
                            isActive: false,
                            where: 'mealSelections',
                            mealKey,
                            serviceType: st
                        });
                    }
                }
            }

            // 6) Box clients with category quota mismatch (required vs actual)
            // Read from clients.upcoming_order only; support both camelCase and snake_case, and legacy single-box at root
            let rawBoxOrders = (uo.boxOrders ?? uo.box_orders) as { boxTypeId?: string; box_type_id?: string; quantity?: number; items?: Record<string, number | { quantity?: number }> }[] | undefined;
            if (st === 'Boxes' && !rawBoxOrders?.length && (uo.boxTypeId ?? (uo as any).box_type_id)) {
                rawBoxOrders = [{
                    boxTypeId: (uo.boxTypeId ?? (uo as any).box_type_id) as string,
                    quantity: (uo.boxQuantity ?? (uo as any).box_quantity ?? 1) as number,
                    items: ((uo as any).items || {}) as Record<string, number>
                }];
            }
            if (st === 'Boxes' && rawBoxOrders && Array.isArray(rawBoxOrders) && rawBoxOrders.length > 0) {
                const mismatches: BoxQuotaMismatch[] = [];
                for (let boxIndex = 0; boxIndex < rawBoxOrders.length; boxIndex++) {
                    const box = rawBoxOrders[boxIndex];
                    const boxTypeId = (box.boxTypeId ?? box.box_type_id) || '';
                    const boxQuantity = Math.max(1, Number(box.quantity) || 1);
                    const boxTypeName = boxTypeNameMap.get(boxTypeId) || boxTypeId;
                    const items = box.items && typeof box.items === 'object' ? box.items : {};

                    // Required values: from box_quotas (per box type) or from item_categories.set_value when box_quotas missing/empty
                    const quotas = quotasByBoxType.get(boxTypeId) || [];
                    const categoriesToCheck: { categoryId: string; requiredPerUnit: number }[] = [];
                    if (quotas.length > 0) {
                        for (const q of quotas) {
                            categoriesToCheck.push({ categoryId: q.categoryId, requiredPerUnit: q.targetValue });
                        }
                    } else {
                        for (const [categoryId, setVal] of categorySetValue.entries()) {
                            categoriesToCheck.push({ categoryId, requiredPerUnit: setVal });
                        }
                    }

                    for (const { categoryId, requiredPerUnit } of categoriesToCheck) {
                        const required = requiredPerUnit * boxQuantity; // match ClientProfile: targetValue * boxQty
                        let categoryQuotaValue = 0;
                        for (const [itemId, val] of Object.entries(items)) {
                            const qty = typeof val === 'object' && val != null && 'quantity' in val ? Number((val as { quantity?: number }).quantity) || 0 : Number(val) || 0;
                            if (qty <= 0) continue;
                            const mi = menuItemMap.get(itemId);
                            if (!mi || mi.category_id !== categoryId) continue;
                            if (mi.vendor_id != null && mi.vendor_id !== '') continue; // only box items (universal)
                            categoryQuotaValue += qty * (mi.quota_value ?? 1);
                        }
                        if (!isMeetingExactTarget(categoryQuotaValue, required)) {
                            mismatches.push({
                                boxIndex,
                                boxTypeId,
                                boxTypeName,
                                categoryId,
                                categoryName: categoryMap.get(categoryId) || categoryId,
                                required,
                                actual: categoryQuotaValue
                            });
                        }
                    }
                }
                // Only show if at least one category has non-zero selection (don't list when all categories are zero)
                const hasNonZeroSelection = mismatches.some((m) => m.actual > 0);
                if (mismatches.length > 0 && hasNonZeroSelection) {
                    boxQuotaIssues.push({ clientId: client.id, clientName, mismatches });
                }
            }
        }

        const activeVendors = (vendors || []).filter((v) => v.is_active).map((v) => ({ id: v.id, name: v.name || v.id }));

        return NextResponse.json({
            success: true,
            validMealTypes,
            mealIssues,
            vendorDayIssues,
            invalidVendorIssues,
            itemDayIssues,
            deletedMenuItemIssues,
            boxQuotaIssues,
            activeVendors
        });
    } catch (e: unknown) {
        console.error('cleanup-clients-upcoming GET:', e);
        return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
            { status: 500 }
        );
    }
}

/**
 * POST - Fix issues by updating clients.upcoming_order only.
 * Body: { fix: 'meal' | 'vendorDay' | 'invalidVendor', clientId, ... }
 */
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const fix = body.fix;
        const clientId = body.clientId;
        if (!clientId) {
            return NextResponse.json({ success: false, error: 'clientId required' }, { status: 400 });
        }

        const { data: client, error: fetchErr } = await supabase
            .from('clients')
            .select('upcoming_order')
            .eq('id', clientId)
            .single();
        if (fetchErr || !client) {
            return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
        }
        const uo = (client.upcoming_order as Record<string, unknown>) || {};
        const updated = { ...uo };

        if (fix === 'meal') {
            const removeMealSelectionKeys: string[] = Array.isArray(body.removeMealSelectionKeys) ? body.removeMealSelectionKeys : [];
            const clearMealType = !!body.clearMealType;
            if (updated.mealSelections && typeof updated.mealSelections === 'object' && removeMealSelectionKeys.length > 0) {
                const sel = { ...(updated.mealSelections as Record<string, unknown>) };
                removeMealSelectionKeys.forEach((k) => delete sel[k]);
                updated.mealSelections = Object.keys(sel).length > 0 ? sel : undefined;
            }
            if (clearMealType) updated.mealType = null;
            const { error: updErr } = await supabase
                .from('clients')
                .update({ upcoming_order: updated, updated_at: new Date().toISOString() })
                .eq('id', clientId);
            if (updErr) throw updErr;
            return NextResponse.json({ success: true, message: 'Meal cleanup applied.' });
        }

        if (fix === 'vendorDay') {
            const oldDay = body.oldDay;
            const newDay = body.newDay;
            const vendorId = body.vendorId;
            if (!oldDay || !newDay) {
                return NextResponse.json({ success: false, error: 'oldDay and newDay required' }, { status: 400 });
            }
            type VendorSel = { vendorId?: string };
            const ddo = (updated.deliveryDayOrders as Record<string, { vendorSelections?: VendorSel[] }>) || {};
            const dayData = ddo[oldDay];
            if (!dayData?.vendorSelections) {
                return NextResponse.json({ success: false, error: 'Order day not found' }, { status: 400 });
            }
            const selections: VendorSel[] = [...(dayData.vendorSelections || [])];
            const toMove = vendorId ? selections.filter((s) => s.vendorId === vendorId) : selections;
            const toKeep = vendorId ? selections.filter((s) => s.vendorId !== vendorId) : [];

            if (toMove.length === 0) {
                return NextResponse.json({ success: false, error: 'No selection to move' }, { status: 400 });
            }

            if (oldDay === newDay) {
                return NextResponse.json({ success: true, message: 'No change.' });
            }

            const nextDdo = { ...ddo };
            if (toKeep.length > 0) nextDdo[oldDay] = { vendorSelections: toKeep };
            else delete nextDdo[oldDay];
            if (!nextDdo[newDay]) nextDdo[newDay] = { vendorSelections: [] };
            nextDdo[newDay].vendorSelections!.push(...toMove);
            updated.deliveryDayOrders = nextDdo;
            const { error: updErr } = await supabase
                .from('clients')
                .update({ upcoming_order: updated, updated_at: new Date().toISOString() })
                .eq('id', clientId);
            if (updErr) throw updErr;
            return NextResponse.json({ success: true, message: `Moved to ${newDay}.` });
        }

        if (fix === 'itemDay') {
            const oldDay = body.oldDay;
            const newDay = body.newDay;
            const vendorId = body.vendorId;
            const itemId = body.itemId;
            if (!oldDay || !newDay || !vendorId || !itemId) {
                return NextResponse.json({ success: false, error: 'oldDay, newDay, vendorId and itemId required' }, { status: 400 });
            }
            const ddo = (updated.deliveryDayOrders as Record<string, { vendorSelections?: { vendorId?: string; items?: Record<string, number>; itemNotes?: Record<string, string> }[] }>) || {};
            const oldDayData = ddo[oldDay];
            if (!oldDayData?.vendorSelections) {
                return NextResponse.json({ success: false, error: 'Order day not found' }, { status: 400 });
            }
            const oldSelections = oldDayData.vendorSelections;
            const vsIndex = oldSelections.findIndex((s: { vendorId?: string }) => s.vendorId === vendorId);
            if (vsIndex === -1) {
                return NextResponse.json({ success: false, error: 'Vendor selection not found on that day' }, { status: 400 });
            }
            const vs = oldSelections[vsIndex];
            const items = { ...(vs.items || {}) };
            const itemNotes = { ...(vs.itemNotes || {}) };
            const quantity = Number(items[itemId]) || 0;
            const note = itemNotes[itemId];
            if (quantity <= 0) {
                return NextResponse.json({ success: false, error: 'Item not found or zero quantity' }, { status: 400 });
            }
            delete items[itemId];
            delete itemNotes[itemId];
            const nextDdo = { ...ddo };
            const newOldSelections = [...oldSelections];
            if (Object.keys(items).length > 0 || Object.keys(itemNotes).length > 0) {
                newOldSelections[vsIndex] = { ...vs, items, itemNotes };
            } else {
                newOldSelections.splice(vsIndex, 1);
            }
            if (newOldSelections.length > 0) nextDdo[oldDay] = { vendorSelections: newOldSelections };
            else delete nextDdo[oldDay];

            if (!nextDdo[newDay]) nextDdo[newDay] = { vendorSelections: [] };
            const newDaySelections = [...(nextDdo[newDay].vendorSelections || [])];
            const existingNewVs = newDaySelections.findIndex((s: { vendorId?: string }) => s.vendorId === vendorId);
            if (existingNewVs >= 0) {
                const ex = newDaySelections[existingNewVs];
                const exItems = { ...(ex.items || {}), [itemId]: (ex.items?.[itemId] || 0) + quantity };
                const exNotes = { ...(ex.itemNotes || {}) };
                if (note) exNotes[itemId] = note;
                newDaySelections[existingNewVs] = { ...ex, items: exItems, itemNotes: exNotes };
            } else {
                newDaySelections.push({
                    vendorId,
                    items: { [itemId]: quantity },
                    itemNotes: note ? { [itemId]: note } : {}
                });
            }
            nextDdo[newDay] = { vendorSelections: newDaySelections };
            updated.deliveryDayOrders = nextDdo;
            const { error: updErr } = await supabase
                .from('clients')
                .update({ upcoming_order: updated, updated_at: new Date().toISOString() })
                .eq('id', clientId);
            if (updErr) throw updErr;
            return NextResponse.json({ success: true, message: `Item moved to ${newDay}.` });
        }

        if (fix === 'deletedItem') {
            const vendorId = body.vendorId;
            const itemId = body.itemId;
            const orderDeliveryDay = body.orderDeliveryDay as string | null;
            const where = body.where as 'deliveryDayOrders' | 'vendorSelections';
            if (!vendorId || !itemId || !where) {
                return NextResponse.json({ success: false, error: 'vendorId, itemId and where required' }, { status: 400 });
            }
            if (where === 'deliveryDayOrders') {
                if (!orderDeliveryDay) {
                    return NextResponse.json({ success: false, error: 'orderDeliveryDay required for deliveryDayOrders' }, { status: 400 });
                }
                const ddo = (updated.deliveryDayOrders as Record<string, { vendorSelections?: { vendorId?: string; items?: Record<string, number>; itemNotes?: Record<string, string> }[] }>) || {};
                const dayData = ddo[orderDeliveryDay];
                if (!dayData?.vendorSelections) {
                    return NextResponse.json({ success: false, error: 'Order day not found' }, { status: 400 });
                }
                let changed = false;
                for (const vs of dayData.vendorSelections) {
                    if (vs.vendorId !== vendorId) continue;
                    const items = { ...(vs.items || {}) };
                    const itemNotes = { ...(vs.itemNotes || {}) };
                    if (itemId in items || itemId in itemNotes) {
                        delete items[itemId];
                        delete itemNotes[itemId];
                        (vs as any).items = Object.keys(items).length > 0 ? items : undefined;
                        (vs as any).itemNotes = Object.keys(itemNotes).length > 0 ? itemNotes : undefined;
                        changed = true;
                        break;
                    }
                }
                if (changed) updated.deliveryDayOrders = ddo;
            } else {
                // vendorSelections with itemsByDay
                const vsel = (updated.vendorSelections as { vendorId?: string; itemsByDay?: Record<string, Record<string, number>>; itemNotesByDay?: Record<string, Record<string, string>> }[]) || [];
                const day = orderDeliveryDay ?? null;
                for (const vs of vsel) {
                    if (vs.vendorId !== vendorId) continue;
                    const itemsByDay = vs.itemsByDay && typeof vs.itemsByDay === 'object' ? { ...vs.itemsByDay } : {};
                    const itemNotesByDay = vs.itemNotesByDay && typeof vs.itemNotesByDay === 'object' ? { ...vs.itemNotesByDay } : {};
                    if (day && itemsByDay[day]) {
                        const dayItems = { ...itemsByDay[day] };
                        if (itemId in dayItems) {
                            delete dayItems[itemId];
                            if (Object.keys(dayItems).length > 0) itemsByDay[day] = dayItems;
                            else delete itemsByDay[day];
                            (vs as any).itemsByDay = Object.keys(itemsByDay).length > 0 ? itemsByDay : undefined;
                            if (itemNotesByDay[day]) {
                                const dayNotes = { ...itemNotesByDay[day] };
                                delete dayNotes[itemId];
                                if (Object.keys(dayNotes).length > 0) itemNotesByDay[day] = dayNotes;
                                else delete itemNotesByDay[day];
                                (vs as any).itemNotesByDay = Object.keys(itemNotesByDay).length > 0 ? itemNotesByDay : undefined;
                            }
                            break;
                        }
                    }
                }
                updated.vendorSelections = vsel;
            }
            const { error: updErr } = await supabase
                .from('clients')
                .update({ upcoming_order: updated, updated_at: new Date().toISOString() })
                .eq('id', clientId);
            if (updErr) throw updErr;
            return NextResponse.json({ success: true, message: 'Deleted item removed from order.' });
        }

        if (fix === 'invalidVendor') {
            const vendorId = body.vendorId;
            const action = body.action; // 'clear' | 'reassign'
            const newVendorId = body.newVendorId;
            const where = body.where;
            const day = body.day;
            const mealKey = body.mealKey;
            if (!vendorId || !action) {
                return NextResponse.json({ success: false, error: 'vendorId and action required' }, { status: 400 });
            }
            if (action === 'reassign' && !newVendorId) {
                return NextResponse.json({ success: false, error: 'newVendorId required for reassign' }, { status: 400 });
            }
            const setTo = action === 'clear' ? null : newVendorId;

            if (where === 'deliveryDayOrders' && day) {
                const ddo = (updated.deliveryDayOrders as Record<string, { vendorSelections?: { vendorId?: string }[] }>) || {};
                const dayData = ddo[day];
                if (dayData?.vendorSelections) {
                    for (const vs of dayData.vendorSelections) {
                        if (vs.vendorId === vendorId) vs.vendorId = setTo as unknown as string;
                    }
                    updated.deliveryDayOrders = ddo;
                }
            } else if (where === 'mealSelections' && mealKey) {
                const sel = (updated.mealSelections as Record<string, { vendorId?: string }>) || {};
                if (sel[mealKey] && sel[mealKey].vendorId === vendorId) {
                    sel[mealKey].vendorId = setTo as unknown as string;
                    updated.mealSelections = sel;
                }
            } else {
                return NextResponse.json({ success: false, error: 'where and day/mealKey required' }, { status: 400 });
            }
            const { error: updErr } = await supabase
                .from('clients')
                .update({ upcoming_order: updated, updated_at: new Date().toISOString() })
                .eq('id', clientId);
            if (updErr) throw updErr;
            return NextResponse.json({ success: true, message: action === 'clear' ? 'Vendor cleared.' : 'Vendor reassigned.' });
        }

        return NextResponse.json({ success: false, error: 'Unknown fix type' }, { status: 400 });
    } catch (e: unknown) {
        console.error('cleanup-clients-upcoming POST:', e);
        return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
