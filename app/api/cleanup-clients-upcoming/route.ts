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

        const { data: clients, error: cErr } = await supabase
            .from('clients')
            .select('id, full_name, upcoming_order')
            .not('upcoming_order', 'is', null);
        if (cErr) throw cErr;

        const mealIssues: MealIssue[] = [];
        const vendorDayIssues: VendorDayIssue[] = [];
        const invalidVendorIssues: InvalidVendorIssue[] = [];

        for (const client of clients || []) {
            const uo = client.upcoming_order as Record<string, unknown> | null;
            if (!uo || typeof uo !== 'object') continue;
            const clientName = (client.full_name as string) || client.id;
            const st = (uo.serviceType as string) || 'Food';

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
        }

        const activeVendors = (vendors || []).filter((v) => v.is_active).map((v) => ({ id: v.id, name: v.name || v.id }));

        return NextResponse.json({
            success: true,
            validMealTypes,
            mealIssues,
            vendorDayIssues,
            invalidVendorIssues,
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
            const ddo = (updated.deliveryDayOrders as Record<string, { vendorSelections?: unknown[] }>) || {};
            const dayData = ddo[oldDay];
            if (!dayData?.vendorSelections) {
                return NextResponse.json({ success: false, error: 'Order day not found' }, { status: 400 });
            }
            const selections = [...(dayData.vendorSelections || [])];
            const toMove = vendorId ? selections.filter((s: { vendorId?: string }) => s.vendorId === vendorId) : selections;
            const toKeep = vendorId ? selections.filter((s: { vendorId?: string }) => s.vendorId !== vendorId) : [];

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
            (nextDdo[newDay].vendorSelections as unknown[]).push(...toMove);
            updated.deliveryDayOrders = nextDdo;
            const { error: updErr } = await supabase
                .from('clients')
                .update({ upcoming_order: updated, updated_at: new Date().toISOString() })
                .eq('id', clientId);
            if (updErr) throw updErr;
            return NextResponse.json({ success: true, message: `Moved to ${newDay}.` });
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
