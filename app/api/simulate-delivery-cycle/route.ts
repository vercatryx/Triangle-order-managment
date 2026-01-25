import { getSession } from '@/lib/session';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCurrentTime } from '@/lib/time';
// Imports removed to prevent RLS issues with anonymous client
// import { getMenuItems, getVendors... } from '@/lib/actions';
import {
    getDaysUntilDelivery,
    isWithinCutoff,
    DAY_NAME_TO_NUMBER,
    getNextDeliveryDateForDay
} from '@/lib/order-dates';
import { sendSchedulingReport } from '@/lib/email-report';
import { AppSettings, Vendor } from '@/lib/types';
import * as XLSX from 'xlsx';

// Initialize Supabase Admin Client to bypass RLS
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
    // PUBLIC ACCESS ENABLED (Per User Request)
    console.log('[Unified Scheduling] Starting execution... (Public Trigger)');

    // --- 0. Setup Reporting ---
    const report = {
        totalCreated: 0,
        breakdown: { Food: 0, Meal: 0, Boxes: 0, Custom: 0 },
        unexpectedFailures: [] as { clientName: string, orderType: string, date: string, reason: string }[]
    };

    const clientStatusMap = new Map<string, {
        clientName: string,
        foodStatus: string,
        mealStatus: string,
        boxStatus: string,
        customStatus: string,
        summary: string,
        vendor: string,
        orderCreated: boolean,
        scheduledDeliveryDate: string | null
    }>();

    function setClientStatus(clientId: string, type: 'food' | 'meal' | 'box' | 'custom', status: string) {
        const entry = clientStatusMap.get(clientId);
        if (entry) {
            if (type === 'food') entry.foodStatus = status;
            else if (type === 'meal') entry.mealStatus = status;
            else if (type === 'box') entry.boxStatus = status;
            else if (type === 'custom') entry.customStatus = status;
        }
    }

    function appendClientSummary(clientId: string, text: string) {
        const entry = clientStatusMap.get(clientId);
        if (entry) {
            entry.summary = entry.summary ? `${entry.summary}; ${text}` : text;
        }
    }

    function logUnexpected(clientName: string, type: string, date: string, reason: string) {
        // Reduced log noise - only log full errors if needed really
        // console.error(`[Unexpected Failure] ${clientName} | ${type} | ${reason}`);
        report.unexpectedFailures.push({ clientName, orderType: type, date, reason });
    }

    try {
        // --- 1. Load Global Context (Optimized) ---
        const currentTime = await getCurrentTime();
        const today = new Date(currentTime);
        today.setHours(0, 0, 0, 0);

        // Fetch Reference Data (Optimized Selects)
        const [
            vendorsRes,
            statusesRes,
            menuItemsRes,
            mealItemsRes
        ] = await Promise.all([
            supabase.from('vendors').select('id, name, email, service_type, delivery_days, delivery_frequency, is_active, minimum_meals, cutoff_hours'),
            supabase.from('client_statuses').select('id, name, is_system_default, deliveries_allowed'),
            // Only fetch fields needed for pricing/validation
            supabase.from('menu_items').select('id, vendor_id, name, value, price_each, is_active, category_id, minimum_order, image_url, sort_order'),
            supabase.from('breakfast_items').select('id, category_id, name, quota_value, price_each, is_active, vendor_id, image_url, sort_order')
        ]);

        const allVendors = (vendorsRes.data || []).map((v: any) => ({
            id: v.id,
            name: v.name,
            email: v.email || null,
            serviceTypes: (v.service_type || '').split(',').map((s: string) => s.trim()).filter(Boolean),
            deliveryDays: v.delivery_days || [],
            allowsMultipleDeliveries: v.delivery_frequency === 'Multiple',
            isActive: v.is_active,
            minimumMeals: v.minimum_meals ?? 0,
            cutoffDays: v.cutoff_hours ?? 0
        }));

        const allStatuses = (statusesRes.data || []).map((s: any) => ({
            id: s.id,
            name: s.name,
            isSystemDefault: s.is_system_default,
            deliveriesAllowed: s.deliveries_allowed
        }));

        const allMenuItems = (menuItemsRes.data || []).map((i: any) => ({
            id: i.id,
            vendorId: i.vendor_id,
            name: i.name,
            value: i.value,
            priceEach: i.price_each ?? undefined,
            isActive: i.is_active,
            categoryId: i.category_id,
            minimumOrder: i.minimum_order ?? 0,
            imageUrl: i.image_url || null,
            itemType: 'menu'
        }));

        const allMealItems = (mealItemsRes.data || []).map((i: any) => ({
            id: i.id,
            categoryId: i.category_id,
            name: i.name,
            value: i.quota_value,
            quotaValue: i.quota_value,
            priceEach: i.price_each ?? undefined,
            isActive: i.is_active,
            vendorId: i.vendor_id,
            imageUrl: i.image_url || null,
            itemType: 'meal'
        }));

        const { data: settingsData } = await supabase.from('app_settings').select('*').single();
        const settings = settingsData as any;
        const reportEmail = settings?.report_email || 'admin@example.com';

        // Fetch box types for summary
        const { data: boxTypesRes } = await supabase.from('box_types').select('id, name');
        const allBoxTypes = (boxTypesRes || []).map((bt: any) => ({
            id: bt.id,
            name: bt.name
        }));

        // Optimized Maps for O(1) Lookup
        const statusMap = new Map(allStatuses.map(s => [s.id, s]));
        const vendorMap = new Map(allVendors.map(v => [v.id, v]));
        const menuItemMap = new Map(allMenuItems.map(i => [i.id, i]));
        const mealItemMap = new Map(allMealItems.map(i => [i.id, i]));
        const boxTypeMap = new Map(allBoxTypes.map(bt => [bt.id, bt.name]));

        // Fetch Clients (Optimized Select) - Exclude dependents
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, full_name, status_id, service_type, parent_client_id')
            .is('parent_client_id', null); // Exclude dependents

        if (clientsError) throw new Error(`Failed to fetch clients: ${clientsError.message}`);
        const clientMap = new Map(clients.map(c => [c.id, c]));

        // Initialize clientStatusMap for Excel report with detailed reasons
        for (const client of clients) {
            const status = statusMap.get(client.status_id);
            const deliveriesAllowed = status?.deliveriesAllowed ?? false;
            const statusName = status?.name || 'Unknown Status';
            
            // Build detailed reason for deliveries not allowed
            const noDeliveryReason = !deliveriesAllowed 
                ? `Status "${statusName}" does not allow deliveries` 
                : null;
            
            // More descriptive initial statuses
            const getFoodStatus = () => {
                if (noDeliveryReason) return noDeliveryReason;
                if (client.service_type !== 'Food') return `Client type is ${client.service_type}, not Food`;
                return 'No upcoming food orders scheduled';
            };
            
            const getMealStatus = () => {
                if (noDeliveryReason) return noDeliveryReason;
                if (client.service_type !== 'Food' && client.service_type !== 'Meal') return `Client type is ${client.service_type}, not Meal`;
                return 'No upcoming meal orders scheduled';
            };
            
            const getBoxStatus = () => {
                if (noDeliveryReason) return noDeliveryReason;
                if (client.service_type !== 'Boxes') return `Client type is ${client.service_type}, not Boxes`;
                return 'No upcoming box orders scheduled';
            };
            
            const getCustomStatus = () => {
                if (noDeliveryReason) return noDeliveryReason;
                if (client.service_type !== 'Custom') return `Client type is ${client.service_type}, not Custom`;
                return 'No upcoming custom orders scheduled';
            };
            
            clientStatusMap.set(client.id, {
                clientName: client.full_name,
                foodStatus: getFoodStatus(),
                mealStatus: getMealStatus(),
                boxStatus: getBoxStatus(),
                customStatus: getCustomStatus(),
                summary: '',
                vendor: 'no vendor set',
                orderCreated: false,
                scheduledDeliveryDate: null
            });
        }

        // Build summary from the same data sources that order creation uses
        // 1. Fetch client_food_orders, client_meal_orders, client_box_orders
        const { data: foodOrdersForSummary } = await supabase.from('client_food_orders').select('*');
        const { data: mealOrdersForSummary } = await supabase.from('client_meal_orders').select('*');
        const { data: boxOrdersForSummary } = await supabase.from('client_box_orders').select('*');
        const { data: allUpcomingOrders } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('service_type', 'Custom');
        
        // Process Food Orders for summary
        if (foodOrdersForSummary && foodOrdersForSummary.length > 0) {
            for (const fo of foodOrdersForSummary) {
                const entry = clientStatusMap.get(fo.client_id);
                if (!entry) continue;
                
                const dayOrders = typeof fo.delivery_day_orders === 'string'
                    ? JSON.parse(fo.delivery_day_orders)
                    : fo.delivery_day_orders;
                
                if (!dayOrders) continue;
                
                const summaries: string[] = [];
                for (const dayName of Object.keys(dayOrders)) {
                    const vendorSelections = dayOrders[dayName].vendorSelections || [];
                    for (const sel of vendorSelections) {
                        if (!sel.vendorId) continue;
                        const vendor = vendorMap.get(sel.vendorId);
                        if (!vendor) continue;
                        const vendorName = vendor.name;
                        
                        const itemDetails: string[] = [];
                        if (sel.items) {
                            for (const [itemId, qty] of Object.entries(sel.items)) {
                                const q = Number(qty);
                                if (q > 0) {
                                    const mItem = menuItemMap.get(itemId) || mealItemMap.get(itemId);
                                    if (mItem) {
                                        const price = mItem.priceEach || mItem.value || 0;
                                        itemDetails.push(`${q}x ${mItem.name} ($${(price * q).toFixed(2)})`);
                                    }
                                }
                            }
                        }
                        
                        // Track vendor (use first vendor found)
                        const entry = clientStatusMap.get(fo.client_id);
                        if (entry && entry.vendor === 'no vendor set') {
                            entry.vendor = vendorName;
                        }
                        
                        if (itemDetails.length > 0) {
                            summaries.push(`Food: ${itemDetails.join(', ')} (${dayName})`);
                        } else {
                            summaries.push(`Food: No items specified (${dayName})`);
                        }
                    }
                }
                
                if (summaries.length > 0) {
                    entry.summary = summaries.join(' | ');
                }
            }
        }
        
        // Process Meal Orders for summary
        if (mealOrdersForSummary && mealOrdersForSummary.length > 0) {
            for (const mo of mealOrdersForSummary) {
                const entry = clientStatusMap.get(mo.client_id);
                if (!entry) continue;
                
                const rawSelections = typeof mo.meal_selections === 'string'
                    ? JSON.parse(mo.meal_selections)
                    : mo.meal_selections;
                
                if (!rawSelections) continue;
                
                const summaries: string[] = [];
                for (const [mealType, group] of Object.entries(rawSelections)) {
                    const groupData = group as any;
                    if (!groupData.vendorId) continue;
                    const vendor = vendorMap.get(groupData.vendorId);
                    if (!vendor) continue;
                    const vendorName = vendor.name;
                    
                    const itemDetails: string[] = [];
                    if (groupData.items) {
                        for (const [itemId, qty] of Object.entries(groupData.items)) {
                            const q = Number(qty);
                            if (q > 0) {
                                const mItem = mealItemMap.get(itemId) || menuItemMap.get(itemId);
                                if (mItem) {
                                    const price = mItem.priceEach || mItem.value || 0;
                                    itemDetails.push(`${q}x ${mItem.name} ($${(price * q).toFixed(2)})`);
                                }
                            }
                        }
                    }
                    
                    // Track vendor (use first vendor found)
                    const entry = clientStatusMap.get(mo.client_id);
                    if (entry && entry.vendor === 'no vendor set') {
                        entry.vendor = vendorName;
                    }
                    
                    if (itemDetails.length > 0) {
                        summaries.push(`Meal (${mealType}): ${itemDetails.join(', ')}`);
                    } else {
                        summaries.push(`Meal (${mealType}): No items specified`);
                    }
                }
                
                if (summaries.length > 0) {
                    entry.summary = entry.summary ? `${entry.summary} | ${summaries.join(' | ')}` : summaries.join(' | ');
                }
            }
        }
        
        // Process Box Orders for summary
        if (boxOrdersForSummary && boxOrdersForSummary.length > 0) {
            for (const bo of boxOrdersForSummary) {
                const entry = clientStatusMap.get(bo.client_id);
                if (!entry) continue;
                
                const vendor = vendorMap.get(bo.vendor_id);
                if (!vendor) continue;
                const vendorName = vendor.name;
                
                const boxType = boxTypeMap.get(bo.box_type_id) || 'Standard Box';
                const qty = bo.quantity || 1;
                
                let boxValue = 0;
                if (bo.items) {
                    const itemsObj = typeof bo.items === 'string' ? JSON.parse(bo.items) : bo.items;
                    for (const [id, qty] of Object.entries(itemsObj)) {
                        const m = allMenuItems.find(x => x.id === id);
                        if (m) boxValue += (m.priceEach || m.value || 0) * Number(qty);
                    }
                }
                const totalBoxValue = boxValue * qty;
                
                // Track vendor
                if (entry.vendor === 'no vendor set') {
                    entry.vendor = vendorName;
                }
                
                const boxSummary = `Boxes: ${qty}x ${boxType} ($${totalBoxValue.toFixed(2)})`;
                entry.summary = entry.summary ? `${entry.summary} | ${boxSummary}` : boxSummary;
            }
        }
        
        // Process Custom Orders (from upcoming_orders)
        if (allUpcomingOrders && allUpcomingOrders.length > 0) {
            // Fetch vendor selections for upcoming orders
            const upcomingOrderIds = allUpcomingOrders.map((uo: any) => uo.id);
            const { data: upcomingVendorSelections } = await supabase
                .from('upcoming_order_vendor_selections')
                .select('*')
                .in('upcoming_order_id', upcomingOrderIds);
            
            // Fetch items for upcoming orders
            const vendorSelectionIds = (upcomingVendorSelections || []).map((vs: any) => vs.id);
            const { data: upcomingItems } = vendorSelectionIds.length > 0
                ? await supabase
                    .from('upcoming_order_items')
                    .select('*')
                    .in('upcoming_order_vendor_selection_id', vendorSelectionIds)
                : { data: [] };
            
            // Fetch box selections for upcoming orders
            const { data: upcomingBoxSelections } = await supabase
                .from('upcoming_order_box_selections')
                .select('*')
                .in('upcoming_order_id', upcomingOrderIds);
            
            // Fetch menu items and meal items for item names
            const menuItemIds = (upcomingItems || [])
                .filter((item: any) => item.menu_item_id)
                .map((item: any) => item.menu_item_id);
            const mealItemIds = (upcomingItems || [])
                .filter((item: any) => item.meal_item_id)
                .map((item: any) => item.meal_item_id);
            
            const { data: menuItemsForSummary } = menuItemIds.length > 0
                ? await supabase.from('menu_items').select('id, name').in('id', menuItemIds)
                : { data: [] };
            const { data: mealItemsForSummary } = mealItemIds.length > 0
                ? await supabase.from('breakfast_items').select('id, name').in('id', mealItemIds)
                : { data: [] };
            
            const menuItemMap = new Map((menuItemsForSummary || []).map((mi: any) => [mi.id, mi.name]));
            const mealItemMap = new Map((mealItemsForSummary || []).map((mi: any) => [mi.id, mi.name]));
            
            // Note: boxTypeMap is already defined earlier in the code
            
            // Build summary for each client
            for (const upcomingOrder of allUpcomingOrders) {
                const clientId = upcomingOrder.client_id;
                const entry = clientStatusMap.get(clientId);
                if (!entry) continue;
                
                const summaries: string[] = [];
                
                // Get vendor selections for this order
                const orderVendorSelections = (upcomingVendorSelections || []).filter(
                    (vs: any) => vs.upcoming_order_id === upcomingOrder.id
                );
                
                // Get box selections for this order
                const orderBoxSelections = (upcomingBoxSelections || []).filter(
                    (bs: any) => bs.upcoming_order_id === upcomingOrder.id
                );
                
                // Process vendor-based orders (Food/Meal)
                if (orderVendorSelections.length > 0) {
                    for (const vs of orderVendorSelections) {
                        const vendor = vendorMap.get(vs.vendor_id);
                        const vendorName = vendor?.name || 'Unknown Vendor';
                        const orderItems = (upcomingItems || []).filter(
                            (item: any) => item.upcoming_order_vendor_selection_id === vs.id
                        );
                        
                        const itemDetails: string[] = [];
                        for (const item of orderItems) {
                            let itemName = item.custom_name || 'Custom Item';
                            if (item.menu_item_id) {
                                itemName = menuItemMap.get(item.menu_item_id) || itemName;
                            } else if (item.meal_item_id) {
                                itemName = mealItemMap.get(item.meal_item_id) || itemName;
                            }
                            const qty = item.quantity || 1;
                            const price = item.total_value || item.unit_value || 0;
                            itemDetails.push(`${qty}x ${itemName} ($${price.toFixed(2)})`);
                        }
                        
                        if (itemDetails.length > 0) {
                            summaries.push(`${upcomingOrder.service_type} - ${vendorName}: ${itemDetails.join(', ')}`);
                        } else {
                            summaries.push(`${upcomingOrder.service_type} - ${vendorName}: No items specified`);
                        }
                    }
                }
                
                // Process box orders
                if (orderBoxSelections.length > 0) {
                    for (const bs of orderBoxSelections) {
                        const vendor = vendorMap.get(bs.vendor_id);
                        const vendorName = vendor?.name || 'Unknown Vendor';
                        const boxTypeName = boxTypeMap.get(bs.box_type_id) || 'Standard Box';
                        const qty = bs.quantity || 1;
                        const totalValue = bs.total_value || 0;
                        // Track vendor
                        if (entry && entry.vendor === 'no vendor set') {
                            entry.vendor = vendorName;
                        }
                        
                        summaries.push(`Boxes: ${qty}x ${boxTypeName} ($${totalValue.toFixed(2)})`);
                    }
                }
                
                // Process custom orders
                if (upcomingOrder.service_type === 'Custom' && orderVendorSelections.length > 0) {
                    const vs = orderVendorSelections[0];
                    const vendor = vendorMap.get(vs.vendor_id);
                    const vendorName = vendor?.name || 'Unknown Vendor';
                    const customItems = (upcomingItems || []).filter(
                        (item: any) => item.upcoming_order_vendor_selection_id === vs.id
                    );
                    
                    const customDetails: string[] = [];
                    for (const item of customItems) {
                        const itemName = item.custom_name || item.notes || 'Custom Item';
                        const qty = item.quantity || 1;
                        const price = item.total_value || item.unit_value || 0;
                        customDetails.push(`${qty}x ${itemName} ($${price.toFixed(2)})`);
                    }
                    
                    // Track vendor
                    if (entry && entry.vendor === 'no vendor set') {
                        entry.vendor = vendorName;
                    }
                    
                    const deliveryDayText = upcomingOrder.delivery_day ? ` (${upcomingOrder.delivery_day})` : '';
                    if (customDetails.length > 0) {
                        summaries.push(`Custom: ${customDetails.join(', ')}${deliveryDayText}`);
                    } else if (upcomingOrder.notes) {
                        summaries.push(`Custom: ${upcomingOrder.notes}${deliveryDayText}`);
                    }
                }
                
                // Update summary - combine all order details
                if (summaries.length > 0) {
                    entry.summary = entry.summary ? `${entry.summary} | ${summaries.join(' | ')}` : summaries.join(' | ');
                }
            }
        }

        // Get Max Order Number
        const { data: maxOrderData } = await supabase
            .from('orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .maybeSingle();
        let nextOrderNumber = Math.max(100000, (maxOrderData?.order_number || 0) + 1);

        // --- 2. Order Processing Helpers ---

        // Helper: Check Client Eligibility (Global Rule)
        function isClientEligible(clientId: string): boolean {
            const client = clientMap.get(clientId);
            if (!client) return false;
            const status = statusMap.get(client.status_id);
            return status?.deliveriesAllowed ?? false;
        }

        // Helper: Create Order Record
        async function createOrder(
            clientId: string,
            serviceType: 'Food' | 'Meal' | 'Boxes' | 'Custom',
            deliveryDate: Date,
            itemsData: any,
            vendorId: string | null,
            totalValue: number,
            totalItems: number,
            notes: string | null,
            caseId: string | undefined, // Fixed type
            assignedOrderNumber: number // Must pass valid number!
        ) {
            try {
                const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
                const { data: newOrder, error: orderErr } = await supabase
                    .from('orders')
                    .insert({
                        client_id: clientId,
                        service_type: serviceType,
                        status: 'scheduled',
                        scheduled_delivery_date: deliveryDateStr,
                        total_value: totalValue,
                        total_items: totalItems,
                        order_number: assignedOrderNumber,
                        created_at: currentTime.toISOString(),
                        last_updated: currentTime.toISOString(),
                        notes: notes,
                        case_id: caseId || `CASE-${Date.now()}`
                    })
                    .select()
                    .single();

                if (orderErr) throw orderErr;

                // Track Stats
                report.totalCreated++;
                if (serviceType === 'Food') report.breakdown.Food++;
                else if (serviceType === 'Meal') report.breakdown.Meal++;
                else if (serviceType === 'Boxes') report.breakdown.Boxes++;
                else if (serviceType === 'Custom') report.breakdown.Custom++;

                return newOrder;
            } catch (err: any) {
                const client = clientMap.get(clientId);
                logUnexpected(client?.full_name || clientId, serviceType, deliveryDate.toISOString(), `Create Order Failed: ${err.message}`);
                return null;
            }
        }

        // Batch Processing Helper
        async function processBatch<T>(items: T[], fn: (item: T) => Promise<void>, batchSize = 15) {
            for (let i = 0; i < items.length; i += batchSize) {
                const chunk = items.slice(i, i + batchSize);
                await Promise.all(chunk.map(fn));
            }
        }

        // --- 3. Process FOOD Orders ---
        // --- 3. Process FOOD Orders (Parallelized) ---
        const { data: foodOrders } = await supabase.from('client_food_orders').select('*');
        if (foodOrders) {
            await processBatch(foodOrders, async (fo) => {
                if (!isClientEligible(fo.client_id)) return;
                const client = clientMap.get(fo.client_id);
                if (client?.service_type !== 'Food') return;

                const dayOrders = typeof fo.delivery_day_orders === 'string'
                    ? JSON.parse(fo.delivery_day_orders)
                    : fo.delivery_day_orders;

                if (!dayOrders) return;

                for (const dayName of Object.keys(dayOrders)) {
                    const vendorSelections = dayOrders[dayName].vendorSelections || [];
                    for (const sel of vendorSelections) {
                        if (!sel.vendorId) continue;
                        const vendor = vendorMap.get(sel.vendorId);
                        if (!vendor) continue;

                        const cutoff = vendor.cutoffDays || 0;
                        const targetDate = new Date(today);
                        targetDate.setDate(today.getDate() + cutoff);
                        const targetDayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });

                        if (targetDayName !== dayName) {
                            setClientStatus(fo.client_id, 'food', `Not today's target (Next delivery: ${dayName})`);
                            continue; // Not today's target
                        }

                        const deliveryDate = targetDate;

                        // Check for duplicates
                        // NOTE: In parallel processing, strictly relying on DB state for 'exists' check is race-prone 
                        // if multiple threads target the SAME client+date.
                        // However, we are iterating unique Client configurations. 
                        // A single client is processed in one thread (one item in foodOrders array).
                        // So no race condition for the same client.

                        const { count } = await supabase
                            .from('orders')
                            .select('*', { count: 'exact', head: true })
                            .eq('client_id', fo.client_id)
                            .eq('scheduled_delivery_date', deliveryDate.toISOString().split('T')[0])
                            .eq('service_type', 'Food');

                        let isDuplicate = false;
                        if (count && count > 0) {
                            const { data: existingOrders } = await supabase
                                .from('orders')
                                .select('id')
                                .eq('client_id', fo.client_id)
                                .eq('scheduled_delivery_date', deliveryDate.toISOString().split('T')[0])
                                .eq('service_type', 'Food');

                            if (existingOrders && existingOrders.length > 0) {
                                const { count: vendorCount } = await supabase
                                    .from('order_vendor_selections')
                                    .select('*', { count: 'exact', head: true })
                                    .in('order_id', existingOrders.map(o => o.id))
                                    .eq('vendor_id', sel.vendorId);

                                if (vendorCount && vendorCount > 0) isDuplicate = true;
                            }
                        }

                        if (isDuplicate) {
                            setClientStatus(fo.client_id, 'food', `Duplicate order already exists for ${deliveryDate.toISOString().split('T')[0]}`);
                            continue;
                        }

                        // Create Food Order
                        let itemsTotal = 0;
                        let valueTotal = 0;
                        const itemsList = [];

                        if (sel.items) {
                            for (const [itemId, qty] of Object.entries(sel.items)) {
                                const q = Number(qty);
                                if (q > 0) {
                                    // Map Optimization
                                    const mItem = menuItemMap.get(itemId) || mealItemMap.get(itemId);
                                    if (mItem) {
                                        const price = mItem.priceEach || mItem.value || 0;
                                        itemsTotal += q;
                                        valueTotal += price * q;
                                        itemsList.push({
                                            menu_item_id: itemId,
                                            quantity: q,
                                            unit_value: price,
                                            total_value: price * q,
                                            notes: sel.itemNotes?.[itemId] || null
                                        });
                                    }
                                }
                            }
                        }

                        if (itemsList.length === 0) continue;

                        // Atomic Order Number
                        const assignedId = nextOrderNumber++;

                        const newOrder = await createOrder(
                            fo.client_id,
                            'Food',
                            deliveryDate,
                            null,
                            null,
                            valueTotal,
                            itemsTotal,
                            (fo as any).notes || null,
                            fo.case_id,
                            assignedId
                        );

                        if (newOrder) {
                            // Update status to show order was created
                            setClientStatus(fo.client_id, 'food', `Order created for ${vendor.name} on ${deliveryDate.toISOString().split('T')[0]}`);
                            
                            // Track vendor and order creation info
                            const entry = clientStatusMap.get(fo.client_id);
                            if (entry) {
                                entry.vendor = vendor.name;
                                entry.orderCreated = true;
                                entry.scheduledDeliveryDate = newOrder.scheduled_delivery_date || deliveryDate.toISOString().split('T')[0];
                            }
                            
                            const { data: vs } = await supabase.from('order_vendor_selections').insert({
                                order_id: newOrder.id,
                                vendor_id: sel.vendorId
                            }).select().single();

                            if (vs) {
                                const itemsPayload = itemsList.map(i => ({
                                    ...i,
                                    vendor_selection_id: vs.id,
                                    order_id: newOrder.id
                                }));
                                await supabase.from('order_items').insert(itemsPayload);
                            }
                        }
                    }
                }
            });
        }

        // --- 4. Process MEAL / BOX Orders ---
        // Logic: "Evaluated EVERY time... At most ONE per week."
        // Delivery Date: Start Today -> Apply Cutoff -> Find earliest vendor day.

        async function processPeriodicOrder(
            template: any,
            type: 'Meal' | 'Boxes',
            templateItemsHelper: (t: any) => any
        ) {
            if (!isClientEligible(template.client_id)) return;
            const client = clientMap.get(template.client_id);

            // Type check: Meal applies to Food clients too. Boxes applies to Boxes clients.
            if (type === 'Boxes' && client?.service_type !== 'Boxes') return;
            if (type === 'Meal' && (client?.service_type !== 'Food' && client?.service_type !== 'Meal')) return;

            // Vendor Assignment Check
            const vendorId = template.vendor_id || (templateItemsHelper(template)?.vendorId); // Extract vendor

            // For Meal, vendor might be inside selections structure.
            // Let's normalize extraction.
            let targetVendorId = vendorId;
            let selections = null;

            if (type === 'Meal') {
                selections = typeof template.meal_selections === 'string' ? JSON.parse(template.meal_selections) : template.meal_selections;
                // Identify PRIMARY vendor (some meals might differ, but typically one main delivery?)
                // Actually spec says: "Start from today, Apply cutoff, Select earliest vendor delivery day".
                // We should process per Vendor if multiple? 
                // "Meal orders are evaluated EVERY time... At most ONE Meal order may be created per client per week."
                // This implies a SINGLE aggregated order or single main delivery.
                // Current UI/Logic suggests Meal Orders are usually one vendor or aggregated.
                // Let's assume one main Vendor for delivery calculation.
                // If multiple vendors, it gets complex. Let's find the FIRST valid vendor in selections.

                if (selections) {
                    for (const k of Object.keys(selections)) {
                        if (selections[k].vendorId) {
                            targetVendorId = selections[k].vendorId;
                            break;
                        }
                    }
                }
            } else {
                // For boxes, vendor_id is on the record
                targetVendorId = template.vendor_id;
            }

            if (!targetVendorId) return; // Expected Skip (No Vendor)
            const vendor = vendorMap.get(targetVendorId);
            if (!vendor) return;

            // Date Calculation
            // 1. Start Today. 2. Apply Cutoff.
            const cutoff = vendor.cutoffDays || 0;
            const minDate = new Date(today);
            minDate.setDate(today.getDate() + cutoff);

            // 3. Select earliest vendor delivery day AFTER (or equal) minDate
            const validDays = vendor.deliveryDays || []; // ["Monday", ...]
            if (validDays.length === 0) return;

            let candidateDate: Date | null = null;
            // Scan next 7 days from minDate to find match
            for (let i = 0; i < 7; i++) {
                const d = new Date(minDate);
                d.setDate(minDate.getDate() + i);
                const dName = d.toLocaleDateString('en-US', { weekday: 'long' });
                if (validDays.includes(dName)) {
                    candidateDate = d;
                    break;
                }
            }

            if (!candidateDate) return; // No valid day found (weird)

            // Weekly Limit Check
            // "If Meal order exists for a week (by delivery date)..."
            // We check the WEEK of candidateDate.
            const cDate = new Date(candidateDate);
            const dayNum = cDate.getDay(); // 0 Sun
            const weekStart = new Date(cDate);
            weekStart.setDate(cDate.getDate() - dayNum); // Sunday
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6); // Saturday

            const startStr = weekStart.toISOString().split('T')[0];
            const endStr = weekEnd.toISOString().split('T')[0];

            const { count } = await supabase
                .from('orders')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', template.client_id)
                .eq('service_type', type) // 'Meal' or 'Boxes'
                .gte('scheduled_delivery_date', startStr)
                .lte('scheduled_delivery_date', endStr);

            if (count && count > 0) {
                setClientStatus(template.client_id, type.toLowerCase() as 'meal' | 'box', `Weekly limit reached - order already exists for this week`);
                return; // Expected Skip (Weekly Limit)
            }

            // Special Check: Is TODAY the correct day to generate this?
            // "Meal orders are evaluated EVERY time." 
            // "At most ONE...".
            // If we are 5 days before delivery, and limit not reached, we create it.
            // If we are 1 day before (and meets cutoff), we create it.
            // Basically, as soon as we CAN create it (meeting cutoff), we should?
            // Spec doesn't strictly say "Create on Cutoff Day". 
            // It says "Start from today... apply cutoff... select earliest".
            // This implies dynamic targeting. 
            // BUT, if we create it today for delivery in 3 days. 
            // Tomorrow, we run again. Weekly limit prevents duplicate.
            // So this logic is sound: Create ASAP.

            // Wait, "Creation Rule (Food): STRICT SINGLE-DAY WINDOW".
            // "Meal Orders... Creation Frequency: Evaluated EVERY time."
            // This suggests JIT or Earliest Possible?
            // If we assume "Earliest Possible" that respects Cutoff.

            // Let's create it.

            // Prepare Items
            let itemsTotal = 0;
            let valueTotal = 0;
            // ... (Logic to extract items similar to Food but specific to Box/Meal structure)

            // Execute Creation
            if (type === 'Boxes') {
                // Box Logic
                const boxItems = template.items; // { id: qty } (already parsed if object)
                let boxValue = 0;
                if (boxItems) {
                    // Check if boxItems is string, parse if needed (though supabase returns jsonb as object)
                    const itemsObj = typeof boxItems === 'string' ? JSON.parse(boxItems) : boxItems;
                    for (const [id, qty] of Object.entries(itemsObj)) {
                        const m = allMenuItems.find(x => x.id === id);
                        if (m) boxValue += (m.priceEach || m.value || 0) * Number(qty);
                    }
                }
                const totalBoxValue = boxValue * (template.quantity || 1);

                const newOrder = await createOrder(
                    template.client_id,
                    'Boxes',
                    candidateDate,
                    null,
                    targetVendorId,
                    totalBoxValue,
                    template.quantity || 1,
                    (template as any).notes || null,
                    template.case_id,
                    nextOrderNumber++
                );

                if (newOrder) {
                    // Update status
                    const vendor = vendorMap.get(targetVendorId);
                    setClientStatus(template.client_id, 'box', `Order created for ${vendor?.name || 'vendor'} on ${candidateDate.toISOString().split('T')[0]}`);
                    
                    // Track vendor and order creation info
                    const entry = clientStatusMap.get(template.client_id);
                    if (entry && vendor) {
                        if (entry.vendor === 'no vendor set') {
                            entry.vendor = vendor.name;
                        }
                        entry.orderCreated = true;
                        entry.scheduledDeliveryDate = newOrder.scheduled_delivery_date || candidateDate.toISOString().split('T')[0];
                    }
                    
                    // Box Selection
                    // Ensure box_type_id is null if it's an empty string or undefined
                    const boxTypeId = template.box_type_id && template.box_type_id !== '' ? template.box_type_id : null;

                    const { error: boxSelError } = await supabase.from('order_box_selections').insert({
                        order_id: newOrder.id,
                        vendor_id: targetVendorId,
                        box_type_id: boxTypeId,
                        quantity: template.quantity,
                        unit_value: boxValue,
                        total_value: totalBoxValue,
                        items: template.items
                    });

                    if (boxSelError) {
                        console.error(`[Unified Scheduling] Failed to create box selection for order ${newOrder.id}:`, boxSelError);
                    }
                }

            } else {
                // Meal Logic
                // Structure: template.meal_selections (JSON) -> { "Breakfast": { vendorId: "...", items: {...} } }
                const rawSelections = typeof template.meal_selections === 'string'
                    ? JSON.parse(template.meal_selections)
                    : template.meal_selections;

                if (!rawSelections) return;

                // 1. Create Order Shell FIRST (We need ID to link items)
                const newOrder = await createOrder(
                    template.client_id,
                    'Meal',
                    candidateDate,
                    null,
                    null, // No single vendor
                    0, // Value calc later
                    0, // Items calc later
                    (template as any).notes || null,
                    template.case_id,
                    nextOrderNumber++
                );

                if (newOrder) {
                    // Update status
                    setClientStatus(template.client_id, 'meal', `Order created on ${candidateDate.toISOString().split('T')[0]}`);
                    
                    // Track vendor and order creation info
                    const entry = clientStatusMap.get(template.client_id);
                    if (entry && targetVendorId) {
                        const vendor = vendorMap.get(targetVendorId);
                        if (vendor) {
                            if (entry.vendor === 'no vendor set') {
                                entry.vendor = vendor.name;
                            }
                        }
                        entry.orderCreated = true;
                        entry.scheduledDeliveryDate = newOrder.scheduled_delivery_date || candidateDate.toISOString().split('T')[0];
                    }
                    
                    let orderTotalValue = 0;
                    let orderTotalItems = 0;

                    // Group by Vendor to create VendorSelections
                    // Map <VendorId, { items: [], notes: {} }>
                    const vendorGroups = new Map<string, any>();

                    for (const [mealType, conf] of Object.entries(rawSelections)) {
                        const c = conf as any;
                        if (!c.vendorId) continue;

                        if (!vendorGroups.has(c.vendorId)) {
                            vendorGroups.set(c.vendorId, { items: {}, notes: {} });
                        }
                        const group = vendorGroups.get(c.vendorId);

                        // Merge items
                        if (c.items) {
                            for (const [itemId, qty] of Object.entries(c.items)) {
                                const q = Number(qty);
                                if (q > 0) {
                                    group.items[itemId] = (group.items[itemId] || 0) + q;
                                    if (c.itemNotes && c.itemNotes[itemId]) {
                                        group.notes[itemId] = c.itemNotes[itemId];
                                    }
                                }
                            }
                        }
                    }

                    // Process Groups
                    for (const [vId, group] of vendorGroups.entries()) {
                        // Create Vendor Selection
                        const { data: vs, error: vsError } = await supabase.from('order_vendor_selections').insert({
                            order_id: newOrder.id,
                            vendor_id: vId
                        }).select().single();

                        if (vsError || !vs) {
                            console.error(`[Unified Scheduling] Failed to create VS for Meal Order ${newOrder.id}`, vsError);
                            continue;
                        }

                        // Insert Items
                        for (const [itemId, qty] of Object.entries(group.items)) {
                            const q = Number(qty);
                            const mItem = allMealItems.find(i => i.id === itemId) || allMenuItems.find(i => i.id === itemId);
                            const price = mItem?.priceEach || mItem?.value || 0;
                            const total = price * q;

                            await supabase.from('order_items').insert({
                                order_id: newOrder.id,
                                vendor_selection_id: vs.id,
                                menu_item_id: itemId,
                                quantity: q,
                                unit_value: price,
                                total_value: total,
                                notes: group.notes[itemId] || null
                            });

                            orderTotalValue += total;
                            orderTotalItems += q;
                        }
                    }

                    // Update Order Totals
                    await supabase.from('orders').update({
                        total_value: orderTotalValue,
                        total_items: orderTotalItems
                    }).eq('id', newOrder.id);
                }
            }
        }

        // Execute Meal/Box Processing (Batched)
        const { data: mealOrders } = await supabase.from('client_meal_orders').select('*');
        if (mealOrders) {
            await processBatch(mealOrders, (mo) => processPeriodicOrder(mo, 'Meal', (t) => null));
        }

        const { data: boxOrders } = await supabase.from('client_box_orders').select('*');
        if (boxOrders) {
            await processBatch(boxOrders, (bo) => processPeriodicOrder(bo, 'Boxes', (t) => ({ vendorId: t.vendor_id })));
        }

        // --- 5. Process CUSTOM Orders (Parallelized) ---
        // console.log('[Unified Scheduling] Starting Custom Order Processing...'); 
        const { data: customOrders } = await supabase.from('upcoming_orders').select('*').eq('service_type', 'Custom');

        if (customOrders) {
            await processBatch(customOrders, async (co) => {
                if (!isClientEligible(co.client_id)) return;

                if (!co.delivery_day) return;

                const { data: vs } = await supabase
                    .from('upcoming_order_vendor_selections')
                    .select('id, vendor_id')
                    .eq('upcoming_order_id', co.id)
                    .single();

                const vendorId = vs?.vendor_id;
                if (!vendorId) return;

                const vendor = vendorMap.get(vendorId);
                const cutoff = vendor?.cutoffDays || 0;

                const targetDate = new Date(today);
                targetDate.setDate(today.getDate() + cutoff);
                const targetDayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });

                if (targetDayName !== co.delivery_day) return;

                const deliveryDate = targetDate;

                // Weekly Limit Check
                const cDate = new Date(deliveryDate);
                const dayNum = cDate.getDay();
                const weekStart = new Date(cDate);
                weekStart.setDate(cDate.getDate() - dayNum);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);

                const { count } = await supabase
                    .from('orders')
                    .select('*', { count: 'exact', head: true })
                    .eq('client_id', co.client_id)
                    .eq('service_type', 'Custom')
                    .gte('scheduled_delivery_date', weekStart.toISOString().split('T')[0])
                    .lte('scheduled_delivery_date', weekEnd.toISOString().split('T')[0]);

                if (count && count > 0) {
                    setClientStatus(co.client_id, 'custom', `Weekly limit reached - custom order already exists for this week`);
                    return;
                }

                const assignedId = nextOrderNumber++;
                const newOrder = await createOrder(
                    co.client_id,
                    'Custom',
                    deliveryDate,
                    null,
                    vendorId,
                    co.total_value,
                    1,
                    co.notes,
                    co.case_id,
                    assignedId
                );

                if (newOrder) {
                    // Update status
                    setClientStatus(co.client_id, 'custom', `Order created for ${vendor?.name || 'vendor'} on ${deliveryDate.toISOString().split('T')[0]}`);
                    
                    // Track vendor and order creation info
                    const entry = clientStatusMap.get(co.client_id);
                    if (entry && vendor) {
                        if (entry.vendor === 'no vendor set') {
                            entry.vendor = vendor.name;
                        }
                        entry.orderCreated = true;
                        entry.scheduledDeliveryDate = newOrder.scheduled_delivery_date || deliveryDate.toISOString().split('T')[0];
                    }
                    
                    const { data: newVs } = await supabase.from('order_vendor_selections').insert({
                        order_id: newOrder.id,
                        vendor_id: vendorId
                    }).select().single();

                    if (newVs) {
                        const upcomingVsId = vs?.id;
                        if (upcomingVsId) {
                            const { data: upcomingItems } = await supabase
                                .from('upcoming_order_items')
                                .select('*')
                                .eq('upcoming_order_vendor_selection_id', upcomingVsId);

                            if (upcomingItems && upcomingItems.length > 0) {
                                for (const uItem of upcomingItems) {
                                    const itemName = uItem.custom_name || uItem.notes || 'Custom Item';
                                    const itemPrice = uItem.custom_price || uItem.total_value || 0;

                                    await supabase.from('order_items').insert({
                                        order_id: newOrder.id,
                                        vendor_selection_id: newVs.id,
                                        menu_item_id: null,
                                        custom_name: itemName,
                                        custom_price: itemPrice,
                                        quantity: uItem.quantity || 1,
                                        unit_value: itemPrice,
                                        total_value: (itemPrice * (uItem.quantity || 1)),
                                        notes: uItem.notes
                                    });
                                }
                            } else {
                                const rawItemName = co.custom_name || co.notes || 'Custom Item';
                                const itemNames = rawItemName.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);

                                if (itemNames.length > 0) {
                                    const totalOrderValue = co.total_value || 0;
                                    const pricePerItem = totalOrderValue / itemNames.length;

                                    for (const name of itemNames) {
                                        await supabase.from('order_items').insert({
                                            order_id: newOrder.id,
                                            vendor_selection_id: newVs.id,
                                            menu_item_id: null,
                                            custom_name: name,
                                            custom_price: pricePerItem,
                                            quantity: 1,
                                            unit_value: pricePerItem,
                                            total_value: pricePerItem,
                                            notes: null
                                        });
                                    }
                                } else {
                                    await supabase.from('order_items').insert({
                                        order_id: newOrder.id,
                                        vendor_selection_id: newVs.id,
                                        menu_item_id: null,
                                        custom_name: 'Custom Item',
                                        custom_price: co.total_value,
                                        quantity: 1,
                                        unit_value: co.total_value,
                                        total_value: co.total_value,
                                        notes: co.notes
                                    });
                                }
                            }
                        }
                    }
                }
            });
        } else {
            // console.log('[Custom Debug] No custom orders passed filter.');
        }

        // --- 6. Generate Excel Report and Send Email ---
        console.log('[Unified Scheduling] Complete. Generating Excel and sending report...');

        // Generate Excel Report
        const excelReportData = Array.from(clientStatusMap.values()).map(entry => ({
            'Customer Name': entry.clientName,
            'Order Created': entry.orderCreated ? 'Yes' : 'No',
            'Scheduled Delivery Date': entry.scheduledDeliveryDate ? new Date(entry.scheduledDeliveryDate).toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-',
            'Vendor': entry.vendor,
            'Summary': entry.summary || 'No upcoming orders',
            'Food Orders': entry.foodStatus,
            'Meal Orders': entry.mealStatus,
            'Box Orders': entry.boxStatus,
            'Custom Orders': entry.customStatus || 'No upcoming custom orders scheduled'
        }));

        const worksheet = XLSX.utils.json_to_sheet(excelReportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Order Statuses');

        // Set column widths for better readability
        const wscols = [
            { wch: 30 }, // Customer Name
            { wch: 12 }, // Order Created
            { wch: 15 }, // Created Date
            { wch: 20 }, // Vendor
            { wch: 80 }, // Summary (wider for vendor/item details)
            { wch: 40 }, // Food Orders
            { wch: 40 }, // Meal Orders
            { wch: 40 }, // Box Orders
            { wch: 40 }  // Custom Orders
        ];
        worksheet['!cols'] = wscols;

        const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        const excelAttachment = {
            filename: `Order_Scheduling_Report_${currentTime.toISOString().split('T')[0]}.xlsx`,
            content: excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };

        const emailResult = await sendSchedulingReport(report, reportEmail, [excelAttachment]);

        // --- 7. Return Result ---
        return NextResponse.json({
            success: true,
            reportEmail: reportEmail,
            emailProvider: emailResult?.provider || null,
            report
        });

    } catch (error: any) {
        console.error('[Unified Scheduling] Critical Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
