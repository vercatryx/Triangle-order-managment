'use server';

import { getCurrentTime } from './time';
import { revalidatePath } from 'next/cache';
import * as React from 'react';
const cacheFn = React.cache;
import { supabase } from './supabase';
import { ClientStatus, Vendor, MenuItem, BoxType, AppSettings, Navigator, Nutritionist, ClientProfile, DeliveryRecord, ItemCategory, BoxQuota, ServiceType, Equipment, ClientFoodOrder, ClientMealOrder, ClientBoxOrder } from './types';
import { uploadFile, deleteFile } from './storage';
import { randomUUID } from 'crypto';
import { getSession } from './session';
import { createClient } from '@supabase/supabase-js';
import { roundCurrency } from './utils';
import { mapClientFromDB, handleError } from './client-mappers';
import { processVendorOrderDetails } from './actions';

function mapVendorRow(v: { id: string; name: string; email: string | null; service_type: string; delivery_days: string[]; delivery_frequency: string; is_active: boolean; minimum_meals: number | null; cutoff_hours: number | null }) {
    return {
        id: v.id,
        name: v.name,
        email: v.email || null,
        serviceTypes: (v.service_type || '').split(',').map((s: string) => s.trim()).filter(Boolean) as ServiceType[],
        deliveryDays: v.delivery_days || [],
        allowsMultipleDeliveries: v.delivery_frequency === 'Multiple',
        isActive: v.is_active,
        minimumMeals: v.minimum_meals ?? 0,
        cutoffDays: v.cutoff_hours ?? 0
    };
}

export const getStatuses = cacheFn(async function () {
    try {
        const { data, error } = await supabase
            .from('client_statuses')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;
        if (!data) return [];

        return data.map((s: any) => ({
            id: s.id,
            name: s.name,
            isSystemDefault: s.is_system_default ?? false,
            deliveriesAllowed: s.deliveries_allowed ?? true,
            requiresUnitsOnChange: s.requires_units_on_change ?? false
        }));
    } catch (e) {
        console.error('Error fetching statuses:', e);
        return [];
    }
});

export const getVendors = cacheFn(async function () {
    try {
        const { data: vendors, error: vendorsError } = await supabase
            .from('vendors')
            .select('*');

        if (vendorsError) throw vendorsError;
        if (!vendors) return [];

        // Fetch vendor locations in batch (SPEED OPTIMIZATION)
        const { data: vendorLocations, error: vlError } = await supabase
            .from('vendor_locations')
            .select('*, locations(*)');

        if (vlError) throw vlError;

        // Create a map of vendor locations
        const locationMap = new Map<string, any[]>();
        (vendorLocations || []).forEach((vl: any) => {
            if (!locationMap.has(vl.vendor_id)) {
                locationMap.set(vl.vendor_id, []);
            }
            locationMap.get(vl.vendor_id)!.push({
                id: vl.id,
                vendorId: vl.vendor_id,
                locationId: vl.location_id,
                name: vl.locations?.name ?? 'Unknown'
            });
        });

        return vendors.map((v: any) => ({
            ...mapVendorRow(v),
            locations: locationMap.get(v.id) || []
        }));
    } catch (e) {
        console.error('Error fetching vendors:', e);
        return [];
    }
});

export async function getVendor(id: string) {
    try {
        const { data, error } = await supabase
            .from('vendors')
            .select('*')
            .eq('id', id)
            .single();

        if (error || !data) return null;
        return mapVendorRow(data);
    } catch (e) {
        console.error('Error fetching vendor:', e);
        return null;
    }
}

export async function getGlobalLocations() {
    const { data, error } = await supabase
        .from('locations')
        .select('*')
        .order('name');

    if (error) {
        console.error('Error fetching global locations:', error);
        return [];
    }

    return data.map((l: any) => ({
        id: l.id,
        name: l.name
    }));
}

export async function getVendorLocations(vendorId: string) {
    const { data, error } = await supabase
        .from('vendor_locations')
        .select(`
            id,
            vendor_id,
            location_id,
            locations (
                name
            )
        `)
        .eq('vendor_id', vendorId);

    if (error) {
        console.error('Error fetching vendor locations:', error);
        return [];
    }

    return data.map((l: any) => ({
        id: l.id,
        vendorId: l.vendor_id,
        locationId: l.location_id,
        name: l.locations?.name || 'Unknown'
    }));
}

export const getMenuItems = cacheFn(async function () {
    const { data, error } = await supabase.from('menu_items')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
    if (error) return [];
    return data.map((i: any) => ({
        id: i.id,
        vendorId: i.vendor_id,
        name: i.name,
        value: i.value,
        priceEach: i.price_each ?? undefined,
        isActive: i.is_active,
        categoryId: i.category_id,
        quotaValue: i.quota_value,
        minimumOrder: i.minimum_order ?? 0,
        imageUrl: i.image_url || null,
        sortOrder: i.sort_order ?? 0,
        itemType: 'menu'
    }));
});

export async function getCategories() {
    const { data, error } = await supabase.from('item_categories').select('*').order('sort_order', { ascending: true }).order('name');
    if (error) return [];
    return data.map((c: any) => ({
        id: c.id,
        name: c.name,
        setValue: c.set_value ?? undefined,
        sortOrder: c.sort_order ?? 0
    }));
}

export async function getMealCategories() {
    const { data, error } = await supabase.from('breakfast_categories').select('*').order('sort_order', { ascending: true }).order('name');
    if (error) return [];
    return data.map((c: any) => ({
        id: c.id,
        name: c.name,
        mealType: c.meal_type || 'Breakfast', // Default to Breakfast if missing, though schema enforces it
        setValue: c.set_value ?? undefined
    }));
}

export async function getMealItems() {
    const { data, error } = await supabase.from('breakfast_items')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
    if (error) return [];
    return data.map((i: any) => ({
        id: i.id,
        categoryId: i.category_id,
        name: i.name,
        value: i.quota_value, // Map quota_value to standardized 'value' property
        quotaValue: i.quota_value,
        priceEach: i.price_each ?? undefined,
        isActive: i.is_active,
        vendorId: i.vendor_id,
        imageUrl: i.image_url || null,
        sortOrder: i.sort_order ?? 0,
        itemType: 'meal'
    }));
}

export async function getEquipment() {
    const { data, error } = await supabase.from('equipment').select('*').order('name');
    if (error) return [];
    return data.map((e: any) => ({
        id: e.id,
        name: e.name,
        price: parseFloat(e.price),
        vendorId: e.vendor_id || null
    }));
}

export async function getBoxQuotas(boxTypeId: string) {
    const { data, error } = await supabase.from('box_quotas').select('*').eq('box_type_id', boxTypeId);
    if (error) return [];
    return data.map((q: any) => ({
        id: q.id,
        boxTypeId: q.box_type_id,
        categoryId: q.category_id,
        targetValue: q.target_value
    }));
}

export const getBoxTypes = cacheFn(async function () {
    const { data, error } = await supabase.from('box_types').select('*');
    if (error) return [];
    return data.map((b: any) => ({
        id: b.id,
        name: b.name,
        vendorId: b.vendor_id ?? null,
        isActive: b.is_active,
        priceEach: b.price_each ?? undefined
    }));
});

export async function getSettings() {
    const { data, error } = await supabase.from('app_settings').select('*').single();
    if (error || !data) return { weeklyCutoffDay: 'Friday', weeklyCutoffTime: '17:00', reportEmail: '' };

    return {
        weeklyCutoffDay: data.weekly_cutoff_day,
        weeklyCutoffTime: data.weekly_cutoff_time,
        reportEmail: data.report_email || '',
        enablePasswordlessLogin: data.enable_passwordless_login
    };
}

export async function getNavigators() {
    const { data, error } = await supabase.from('navigators').select('*');
    if (error) return [];
    return data.map((n: any) => ({
        id: n.id,
        name: n.name,
        email: n.email || null,
        isActive: n.is_active
    }));
}

export async function getNutritionists() {
    const { data, error } = await supabase.from('nutritionists').select('*').order('created_at', { ascending: true });
    if (error) return [];
    return data.map((n: any) => ({
        id: n.id,
        name: n.name,
        email: n.email || null
    }));
}

export async function getClients() {
    const { data, error } = await supabase.from('clients').select('*');
    if (error) return [];
    return data.map(mapClientFromDB);
}

export async function getClientsLight() {
    const { data, error } = await supabase.from('clients').select('id, full_name, parent_client_id').order('full_name');
    if (error) return [];
    return data.map((c: any) => ({
        id: c.id,
        fullName: c.full_name,
        parentClientId: c.parent_client_id
    }));
}

export const getClient = cacheFn(async function (id: string) {
    const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return mapClientFromDB(data);
});

export async function checkClientNameExists(fullName: string, excludeId?: string): Promise<boolean> {
    if (!fullName || !fullName.trim()) return false;

    let query = supabase
        .from('clients')
        .select('id')
        .ilike('full_name', fullName.trim());

    if (excludeId) {
        query = query.neq('id', excludeId);
    }

    const { data, error } = await query;
    if (error) {
        console.error('Error checking client name:', error);
        return false;
    }

    return (data?.length || 0) > 0;
}

export async function getPublicClient(id: string) {
    if (!id) return undefined;

    // Use Service Role if available to bypass RLS for this specific public view
    let supabaseClient = supabase;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
        supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
            auth: { persistSession: false }
        });
    }

    const { data, error } = await supabaseClient.from('clients').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return mapClientFromDB(data);
}

export async function getRegularClients() {
    // Get all clients that are not dependents (parent_client_id is NULL)
    // If the column doesn't exist yet (migration not run), return all clients
    const { data, error } = await supabase
        .from('clients')
        .select('*')
        .is('parent_client_id', null)
        .order('full_name');

    if (error) {
        // If error (e.g., column doesn't exist), fall back to getting all clients
        // This handles the case where the migration hasn't been run yet
        const { data: allData, error: allError } = await supabase
            .from('clients')
            .select('*')
            .order('full_name');

        if (allError) return [];
        return allData.map(mapClientFromDB);
    }

    return data.map(mapClientFromDB);
}

export async function getDependentsByParentId(parentClientId: string) {
    try {
        const { data, error } = await supabase
            .from('clients')
            .select('*')
            .eq('parent_client_id', parentClientId)
            .order('full_name');

        if (error) {
            // If the column doesn't exist, return empty array
            if (error.code === '42703') {
                return [];
            }
            handleError(error);
        }
        if (!data) return [];
        return data.map(mapClientFromDB);
    } catch (e) {
        console.error("Error in getDependentsByParentId:", e);
        return [];
    }
}

export async function getClientHistory(clientId: string) {
    const { data, error } = await supabase
        .from('delivery_history')
        .select('*')
        .eq('client_id', clientId)
        .order('delivery_date', { ascending: false });

    if (error) return [];

    return data.map((d: any) => ({
        id: d.id,
        clientId: d.client_id,
        vendorId: d.vendor_id,
        serviceType: d.service_type,
        deliveryDate: d.delivery_date,
        itemsSummary: d.items_summary,
        proofOfDeliveryImage: d.proof_of_delivery_image,
        createdAt: d.created_at
    }));
}

export async function getOrderHistory(clientId: string) {
    if (!clientId) return [];

    // Attempt with timestamp first
    let result = await supabase
        .from('order_history')
        .select('*')
        .eq('client_id', clientId)
        .order('timestamp', { ascending: false });

    // Fallback if timestamp column doesn't exist or other error
    if (result.error) {
        result = await supabase
            .from('order_history')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });
    }

    if (result.error) {
        console.error('Error fetching order history:', result.error);
        return [];
    }

    const data = result.data;
    console.log(`[history] getOrderHistory fetched for ${clientId}`, { count: data?.length || 0, data });
    if (!data || data.length === 0) return [];

    return data.map((d: any) => ({
        id: d.id,
        clientId: d.client_id || d.clientId,
        who: d.who,
        summary: d.summary,
        timestamp: d.timestamp || d.created_at || new Date().toISOString()
    }));
}

export async function getCompletedOrdersWithDeliveryProof(clientId: string) {
    if (!clientId) return [];

    const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('client_id', clientId)
        .neq('proof_of_delivery_image', null)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching completed orders with proof:', error);
        return [];
    }

    if (!data || data.length === 0) return [];

    // Fetch reference data once
    const [menuItems, vendors, boxTypes] = await Promise.all([
        getMenuItems(),
        getVendors(),
        getBoxTypes()
    ]);

    const orders = await Promise.all(
        data.map(async (orderData: any) => {
            let orderDetails: any = undefined;

            if (orderData.service_type === 'Food') {
                console.log(`[getCompletedOrdersWithDeliveryProof] Processing Food order ${orderData.id}`);
                const { data: vendorSelections } = await supabase
                    .from('order_vendor_selections')
                    .select('*')
                    .eq('order_id', orderData.id);

                console.log(`[getCompletedOrdersWithDeliveryProof] Found ${vendorSelections?.length || 0} vendor selections for order ${orderData.id}`);

                if (vendorSelections && vendorSelections.length > 0) {
                    const vendorSelectionsWithItems = await Promise.all(
                        vendorSelections.map(async (vs: any) => {
                            console.log(`[getCompletedOrdersWithDeliveryProof] Processing vendor selection ${vs.id} for vendor ${vs.vendor_id}`);
                            const { data: items } = await supabase
                                .from('order_items')
                                .select('*')
                                .eq('vendor_selection_id', vs.id);

                            console.log(`[getCompletedOrdersWithDeliveryProof] Found ${items?.length || 0} items for vendor selection ${vs.id}`, items);

                            const vendor = vendors.find(v => v.id === vs.vendor_id);
                            const itemsWithDetails = (items || []).map((item: any) => {
                                // Skip total items (menu_item_id is null)
                                if (item.menu_item_id === null) {
                                    console.log(`[getCompletedOrdersWithDeliveryProof] Skipping total item with null menu_item_id:`, item);
                                    return null;
                                }
                                const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                console.log(`[getCompletedOrdersWithDeliveryProof] Processing item:`, {
                                    itemId: item.id,
                                    menuItemId: item.menu_item_id,
                                    menuItemName: menuItem?.name,
                                    storedUnitValue: item.unit_value,
                                    storedTotalValue: item.total_value,
                                    quantity: item.quantity,
                                    menuItemPriceEach: menuItem?.priceEach,
                                    menuItemValue: menuItem?.value
                                });

                                const itemPrice = menuItem?.priceEach ?? parseFloat(item.unit_value || '0');
                                const quantity = item.quantity;
                                // Always recalculate from price and quantity, don't trust stored total_value
                                const itemTotal = itemPrice * quantity;

                                console.log(`[getCompletedOrdersWithDeliveryProof] Calculated item total: ${itemPrice} * ${quantity} = ${itemTotal}`);

                                return {
                                    id: item.id,
                                    menuItemId: item.menu_item_id,
                                    menuItemName: menuItem?.name || 'Unknown Item',
                                    quantity: quantity,
                                    unitValue: itemPrice,
                                    totalValue: itemTotal
                                };
                            }).filter(item => item !== null);

                            console.log(`[getCompletedOrdersWithDeliveryProof] Vendor ${vs.vendor_id} has ${itemsWithDetails.length} valid items`);

                            return {
                                vendorId: vs.vendor_id,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                items: itemsWithDetails
                            };
                        })
                    );

                    // Calculate total by summing all items from all vendor selections
                    let calculatedTotal = 0;
                    console.log(`[getCompletedOrdersWithDeliveryProof] Starting total calculation across ${vendorSelectionsWithItems.length} vendor selections`);
                    for (const vs of vendorSelectionsWithItems) {
                        console.log(`[getCompletedOrdersWithDeliveryProof] Processing vendor ${vs.vendorName} with ${vs.items.length} items`);
                        for (const item of vs.items) {
                            console.log(`[getCompletedOrdersWithDeliveryProof] Adding item ${item.menuItemName}: ${item.totalValue} to total (current total: ${calculatedTotal})`);
                            calculatedTotal += item.totalValue;
                            console.log(`[getCompletedOrdersWithDeliveryProof] New total: ${calculatedTotal}`);
                        }
                    }

                    console.log(`[getCompletedOrdersWithDeliveryProof] Final calculated total: ${calculatedTotal}`);
                    console.log(`[getCompletedOrdersWithDeliveryProof] Stored order total_value from DB: ${orderData.total_value}`);

                    // Always use calculated total (sum of all items)
                    const finalTotal = calculatedTotal;
                    console.log(`[getCompletedOrdersWithDeliveryProof] Using finalTotal: ${finalTotal}`);

                    orderDetails = {
                        serviceType: orderData.service_type,
                        vendorSelections: vendorSelectionsWithItems,
                        totalItems: orderData.total_items,
                        totalValue: finalTotal
                    };
                    console.log(`[getCompletedOrdersWithDeliveryProof] Set orderDetails.totalValue to: ${finalTotal}`);
                }
            } else if (orderData.service_type === 'Boxes') {
                const { data: boxSelection } = await supabase
                    .from('order_box_selections')
                    .select('*')
                    .eq('order_id', orderData.id)
                    .maybeSingle();

                if (boxSelection) {
                    const vendor = vendors.find(v => v.id === boxSelection.vendor_id);
                    const boxType = boxTypes.find(bt => bt.id === boxSelection.box_type_id);
                    const boxTotalValue = boxSelection.total_value
                        ? parseFloat(boxSelection.total_value)
                        : parseFloat(orderData.total_value || 0);

                    orderDetails = {
                        serviceType: orderData.service_type,
                        vendorId: boxSelection.vendor_id,
                        vendorName: vendor?.name || 'Unknown Vendor',
                        boxTypeId: boxSelection.box_type_id,
                        boxTypeName: boxType?.name || 'Unknown Box Type',
                        boxQuantity: boxSelection.quantity,
                        totalValue: boxTotalValue
                    };
                }
            } else {
                orderDetails = {
                    serviceType: orderData.service_type,
                    totalValue: parseFloat(orderData.total_value || 0),
                    notes: orderData.notes
                };
            }

            const returnValue = {
                id: orderData.id,
                clientId: orderData.client_id,
                serviceType: orderData.service_type,
                caseId: orderData.case_id,
                status: orderData.status,
                scheduledDeliveryDate: orderData.scheduled_delivery_date,
                actualDeliveryDate: orderData.actual_delivery_date,
                deliveryProofUrl: orderData.proof_of_delivery_image || '',
                totalValue: parseFloat(orderData.total_value || 0),
                totalItems: orderData.total_items,
                notes: orderData.notes,
                createdAt: orderData.created_at,
                lastUpdated: orderData.updated_at,
                updatedBy: orderData.updated_by,
                orderNumber: orderData.order_number,
                orderDetails: orderDetails
            };

            console.log(`[getCompletedOrdersWithDeliveryProof] Returning order ${orderData.id}:`, {
                totalValue: returnValue.totalValue,
                orderDetailsTotalValue: returnValue.orderDetails?.totalValue,
                orderDetails: returnValue.orderDetails
            });

            return returnValue;
        })
    );

    return orders;
}

export async function getBillingHistory(clientId: string) {
    if (!clientId) return [];

    const { data, error } = await supabase
        .from('billing_records')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching billing history:', error);
        return [];
    }

    // Fetch reference data once for all orders
    const [menuItems, vendors, boxTypes] = await Promise.all([
        getMenuItems(),
        getVendors(),
        getBoxTypes()
    ]);

    // Fetch order details separately if order_id exists
    const billingRecords = data || [];
    const recordsWithOrderData = await Promise.all(
        billingRecords.map(async (d: any) => {
            let deliveryDate: string | undefined = undefined;
            let orderDetails: any = undefined;

            if (d.order_id) {
                const { data: orderData, error: orderError } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('id', d.order_id)
                    .single();

                if (!orderError && orderData) {
                    // Prefer actual_delivery_date, fallback to scheduled_delivery_date
                    deliveryDate = orderData.actual_delivery_date || orderData.scheduled_delivery_date || undefined;

                    // Build order details based on service type
                    if (orderData.service_type === 'Food') {
                        console.log(`[getBillingHistory] Processing Food order ${orderData.id}`);
                        // Fetch vendor selections and items
                        const { data: vendorSelections } = await supabase
                            .from('order_vendor_selections')
                            .select('*')
                            .eq('order_id', d.order_id);

                        console.log(`[getBillingHistory] Found ${vendorSelections?.length || 0} vendor selections for order ${orderData.id}`);

                        if (vendorSelections && vendorSelections.length > 0) {
                            const vendorSelectionsWithItems = await Promise.all(
                                vendorSelections.map(async (vs: any) => {
                                    console.log(`[getBillingHistory] Processing vendor selection ${vs.id} for vendor ${vs.vendor_id}`);
                                    const { data: items } = await supabase
                                        .from('order_items')
                                        .select('*')
                                        .eq('vendor_selection_id', vs.id);

                                    console.log(`[getBillingHistory] Found ${items?.length || 0} items for vendor selection ${vs.id}`, items);

                                    const vendor = vendors.find(v => v.id === vs.vendor_id);
                                    const itemsWithDetails = (items || []).map((item: any) => {
                                        // Skip total items (menu_item_id is null)
                                        if (item.menu_item_id === null) {
                                            console.log(`[getBillingHistory] Skipping total item with null menu_item_id:`, item);
                                            return null;
                                        }
                                        const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                        console.log(`[getBillingHistory] Processing item:`, {
                                            itemId: item.id,
                                            menuItemId: item.menu_item_id,
                                            menuItemName: menuItem?.name,
                                            storedUnitValue: item.unit_value,
                                            storedTotalValue: item.total_value,
                                            quantity: item.quantity,
                                            menuItemPriceEach: menuItem?.priceEach,
                                            menuItemValue: menuItem?.value
                                        });

                                        // Use priceEach if available, otherwise fall back to stored unit_value
                                        const itemPrice = menuItem?.priceEach ?? parseFloat(item.unit_value || '0');
                                        const quantity = item.quantity;
                                        // Always recalculate from price and quantity, don't trust stored total_value
                                        const itemTotal = itemPrice * quantity;

                                        console.log(`[getBillingHistory] Calculated item total: ${itemPrice} * ${quantity} = ${itemTotal}`);

                                        return {
                                            id: item.id,
                                            menuItemId: item.menu_item_id,
                                            menuItemName: menuItem?.name || 'Unknown Item',
                                            quantity: quantity,
                                            unitValue: itemPrice,
                                            totalValue: itemTotal
                                        };
                                    }).filter(item => item !== null);

                                    console.log(`[getBillingHistory] Vendor ${vs.vendor_id} has ${itemsWithDetails.length} valid items`);

                                    return {
                                        vendorId: vs.vendor_id,
                                        vendorName: vendor?.name || 'Unknown Vendor',
                                        items: itemsWithDetails
                                    };
                                })
                            );

                            // Calculate total by summing all items from all vendor selections
                            let calculatedTotal = 0;
                            console.log(`[getBillingHistory] Starting total calculation across ${vendorSelectionsWithItems.length} vendor selections`);
                            for (const vs of vendorSelectionsWithItems) {
                                console.log(`[getBillingHistory] Processing vendor ${vs.vendorName} with ${vs.items.length} items`);
                                for (const item of vs.items) {
                                    console.log(`[getBillingHistory] Adding item ${item.menuItemName}: ${item.totalValue} to total (current total: ${calculatedTotal})`);
                                    calculatedTotal += item.totalValue;
                                    console.log(`[getBillingHistory] New total: ${calculatedTotal}`);
                                }
                            }

                            console.log(`[getBillingHistory] Final calculated total: ${calculatedTotal}`);
                            console.log(`[getBillingHistory] Stored order total_value from DB: ${orderData.total_value}`);

                            // Always use calculated total (sum of all items)
                            const finalTotal = calculatedTotal;
                            console.log(`[getBillingHistory] Using finalTotal: ${finalTotal}`);

                            orderDetails = {
                                serviceType: orderData.service_type,
                                vendorSelections: vendorSelectionsWithItems,
                                totalItems: orderData.total_items,
                                totalValue: finalTotal
                            };
                            console.log(`[getBillingHistory] Set orderDetails.totalValue to: ${finalTotal}`);
                        }
                    } else if (orderData.service_type === 'Boxes') {
                        // Fetch box selection
                        const { data: boxSelection } = await supabase
                            .from('order_box_selections')
                            .select('*')
                            .eq('order_id', d.order_id)
                            .maybeSingle();

                        if (boxSelection) {
                            const vendor = vendors.find(v => v.id === boxSelection.vendor_id);
                            const boxType = boxTypes.find(bt => bt.id === boxSelection.box_type_id);
                            // Prefer stored total_value from box selection, fallback to order total_value
                            const boxTotalValue = boxSelection.total_value
                                ? parseFloat(boxSelection.total_value)
                                : parseFloat(orderData.total_value || 0);

                            orderDetails = {
                                serviceType: orderData.service_type,
                                vendorId: boxSelection.vendor_id,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                boxTypeId: boxSelection.box_type_id,
                                boxTypeName: boxType?.name || 'Unknown Box Type',
                                boxQuantity: boxSelection.quantity,
                                totalValue: boxTotalValue
                            };
                        }
                    } else {
                        // For other service types, just include basic info
                        orderDetails = {
                            serviceType: orderData.service_type,
                            totalValue: parseFloat(orderData.total_value || 0),
                            notes: orderData.notes
                        };
                    }
                }
            }

            // Calculate amount from order items if order details exist
            let calculatedAmount = d.amount; // Default to stored amount

            if (orderDetails) {
                if (orderDetails.serviceType === 'Food' && orderDetails.vendorSelections) {
                    // Sum all item totalValues from all vendor selections
                    calculatedAmount = orderDetails.vendorSelections.reduce((sum: number, vs: any) => {
                        return sum + (vs.items || []).reduce((itemSum: number, item: any) => {
                            return itemSum + (item.totalValue || 0);
                        }, 0);
                    }, 0);
                } else if (orderDetails.totalValue !== undefined) {
                    // For Boxes and other service types, use the totalValue
                    calculatedAmount = orderDetails.totalValue;
                }
            }

            return {
                id: d.id,
                clientId: d.client_id,
                clientName: d.client_name,
                status: d.status,
                remarks: d.remarks,
                navigator: d.navigator,
                amount: calculatedAmount,
                createdAt: d.created_at,
                date: d.date || new Date(d.created_at).toLocaleDateString(),
                method: d.method || 'N/A',
                orderId: d.order_id || undefined,
                deliveryDate: deliveryDate,
                orderDetails: orderDetails
            };
        })
    );

    return recordsWithOrderData;
}

export async function getBillingOrders() {
    // Get orders with billing_pending status
    const { data: pendingOrders, error: pendingError } = await supabase
        .from('orders')
        .select(`
            *,
            clients (
                full_name
            )
        `)
        .eq('status', 'billing_pending')
        .order('created_at', { ascending: false });

    if (pendingError) {
        console.error('Error fetching billing pending orders:', pendingError);
    }

    // Get billing records with status "success" and their associated orders
    const { data: billingRecords, error: billingError } = await supabase
        .from('billing_records')
        .select(`
            order_id,
            status
        `)
        .eq('status', 'success');

    if (billingError) {
        console.error('Error fetching billing records:', billingError);
    }

    const successfulOrderIds = new Set((billingRecords || []).map((br: any) => br.order_id).filter(Boolean));

    // Get orders that have successful billing records
    let successfulOrders: any[] = [];
    if (successfulOrderIds.size > 0) {
        const { data: orders, error: successError } = await supabase
            .from('orders')
            .select(`
                *,
                clients (
                    full_name
                )
            `)
            .in('id', Array.from(successfulOrderIds))
            .order('created_at', { ascending: false });

        if (!successError && orders) {
            successfulOrders = orders;
        }
    }

    // Combine and map orders
    const allOrders = [
        ...((pendingOrders || []).map((o: any) => ({
            ...o,
            clientName: o.clients?.full_name || 'Unknown',
            amount: o.total_value || 0,
            billingStatus: 'billing_pending' as const
        }))),
        ...(successfulOrders.map((o: any) => ({
            ...o,
            clientName: o.clients?.full_name || 'Unknown',
            amount: o.total_value || 0,
            billingStatus: 'billing_successful' as const
        })))
    ];

    // Remove duplicates (in case an order is both pending and has a successful record - prioritize successful)
    const orderMap = new Map();
    for (const order of allOrders) {
        if (!orderMap.has(order.id) || order.billingStatus === 'billing_successful') {
            orderMap.set(order.id, order);
        }
    }

    return Array.from(orderMap.values()).sort((a, b) => {
        const dateA = new Date(a.created_at || 0).getTime();
        const dateB = new Date(b.created_at || 0).getTime();
        return dateB - dateA;
    });
}

export async function getAllBillingRecords() {
    // First, ensure all orders with billing_pending status have billing records
    const { data: billingPendingOrders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('status', 'billing_pending');

    if (!ordersError && billingPendingOrders) {
        // For each billing_pending order, check if billing record exists
        for (const order of billingPendingOrders) {
            const { data: existingBilling } = await supabase
                .from('billing_records')
                .select('id')
                .eq('order_id', order.id)
                .maybeSingle();

            if (!existingBilling) {
                // Fetch client to get navigator and name
                const { data: client } = await supabase
                    .from('clients')
                    .select('navigator_id, full_name')
                    .eq('id', order.client_id)
                    .single();

                if (client) {
                    // Create billing record for this order
                    const billingPayload = {
                        client_id: order.client_id,
                        client_name: client.full_name || 'Unknown Client',
                        order_id: order.id,
                        status: 'pending',
                        amount: order.total_value || 0,
                        navigator: client.navigator_id || 'Unknown',
                        delivery_date: order.actual_delivery_date || order.scheduled_delivery_date,
                        remarks: 'Auto-generated for billing_pending order'
                    };

                    await supabase.from('billing_records').insert([billingPayload]);
                }
            }
        }
    }

    // Now fetch all billing records
    const { data, error } = await supabase
        .from('billing_records')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching all billing records:', error);
        return [];
    }

    // Fetch reference data once for all orders
    const [menuItems, vendors, boxTypes] = await Promise.all([
        getMenuItems(),
        getVendors(),
        getBoxTypes()
    ]);

    // Fetch order details separately if order_id exists
    const billingRecords = data || [];
    const recordsWithOrderData = await Promise.all(
        billingRecords.map(async (d: any) => {
            let deliveryDate: string | undefined = undefined;
            let calculatedAmount = d.amount; // Default to stored amount

            if (d.order_id) {
                const { data: orderData, error: orderError } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('id', d.order_id)
                    .single();

                if (!orderError && orderData) {
                    // Prefer actual_delivery_date, fallback to scheduled_delivery_date
                    deliveryDate = orderData.actual_delivery_date || orderData.scheduled_delivery_date || undefined;

                    // Calculate amount from order items
                    if (orderData.service_type === 'Food') {
                        // Fetch vendor selections and items
                        const { data: vendorSelections } = await supabase
                            .from('order_vendor_selections')
                            .select('*')
                            .eq('order_id', d.order_id);

                        if (vendorSelections && vendorSelections.length > 0) {
                            const vendorAmounts = await Promise.all(
                                vendorSelections.map(async (vs: any) => {
                                    const { data: items } = await supabase
                                        .from('order_items')
                                        .select('*')
                                        .eq('vendor_selection_id', vs.id);

                                    return (items || []).reduce((sum: number, item: any) => {
                                        const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                        const itemPrice = menuItem?.priceEach ?? parseFloat(item.unit_value);
                                        return sum + (itemPrice * item.quantity);
                                    }, 0);
                                })
                            );
                            calculatedAmount = vendorAmounts.reduce((sum: number, val: number) => sum + val, 0);
                        }
                    } else if (orderData.service_type === 'Boxes') {
                        // Fetch box selection and use stored total_value if available
                        const { data: boxSelection } = await supabase
                            .from('order_box_selections')
                            .select('*')
                            .eq('order_id', d.order_id)
                            .maybeSingle();

                        if (boxSelection && boxSelection.total_value) {
                            calculatedAmount = parseFloat(boxSelection.total_value);
                        } else {
                            calculatedAmount = parseFloat(orderData.total_value || 0);
                        }
                    } else {
                        // For other service types, use the order's total_value
                        calculatedAmount = parseFloat(orderData.total_value || 0);
                    }
                }
            }

            return {
                id: d.id,
                clientId: d.client_id,
                clientName: d.client_name,
                status: d.status,
                remarks: d.remarks,
                navigator: d.navigator,
                amount: calculatedAmount,
                createdAt: d.created_at,
                orderId: d.order_id || undefined,
                deliveryDate: deliveryDate
            };
        })
    );

    return recordsWithOrderData;
}

export async function getRecentOrdersForClient(clientId: string, limit: number = 3) {
    if (!clientId) return null;

    try {
        // Query orders table by client_id, ordered by created_at DESC, limited by limit
        let { data: ordersData, error } = await supabase
            .from('orders')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Error fetching recent orders:', error);
            return null;
        }

        if (!ordersData || ordersData.length === 0) {
            return null;
        }

        // Fetch related data
        const menuItems = await getMenuItems();
        const vendors = await getVendors();
        const boxTypes = await getBoxTypes();

        // Process all orders
        const processOrder = async (orderData: any) => {
            // Build order configuration object
            const orderConfig: any = {
                id: orderData.id,
                serviceType: orderData.service_type,
                caseId: orderData.case_id,
                status: orderData.status,
                lastUpdated: orderData.last_updated,
                updatedBy: orderData.updated_by,
                scheduledDeliveryDate: orderData.scheduled_delivery_date,
                createdAt: orderData.created_at,
                deliveryDistribution: orderData.delivery_distribution,
                totalValue: orderData.total_value,
                totalItems: orderData.total_items,
                notes: orderData.notes,
                deliveryDay: orderData.delivery_day,
                isUpcoming: false,
                orderNumber: orderData.order_number,
                proofOfDelivery: orderData.proof_of_delivery_image || orderData.delivery_proof_url
            };

            const vendorSelectionsTable = 'order_vendor_selections';
            const itemsTable = 'order_items';
            const boxSelectionsTable = 'order_box_selections';

            // Get Vendor Selections (for Food service)
            const { data: vendorSelections } = await supabase
                .from(vendorSelectionsTable)
                .select('*')
                .eq('order_id', orderData.id);

            if (vendorSelections) {
                const vendorSelectionsWithItems = await Promise.all(vendorSelections.map(async (selection: any) => {
                    const { data: items } = await supabase
                        .from(itemsTable)
                        .select('*')
                        .eq('vendor_selection_id', selection.id);

                    const itemsMap: any = {};
                    const itemNotesMap: any = {};

                    if (items) {
                        items.forEach((item: any) => {
                            if (item.menu_item_id) {
                                itemsMap[item.menu_item_id] = item.quantity;
                                if (item.notes) {
                                    itemNotesMap[item.menu_item_id] = item.notes;
                                }
                            }
                        });
                    }

                    return {
                        id: selection.id, // Keep ID for reference
                        vendorId: selection.vendor_id,
                        selectedDeliveryDays: selection.selected_days || [],
                        items: itemsMap,
                        itemNotes: itemNotesMap,
                        itemsByDay: selection.items_by_day || {}, // For new format
                        itemNotesByDay: selection.item_notes_by_day || {} // For new format
                    };
                }));

                orderConfig.vendorSelections = vendorSelectionsWithItems;
            }

            // Get Box Selections (for Boxes service)
            const { data: boxSelections } = await supabase
                .from(boxSelectionsTable)
                .select('*')
                .eq('order_id', orderData.id);

            if (boxSelections && boxSelections.length > 0) {
                // Map to boxOrders format
                orderConfig.boxOrders = boxSelections.map((box: any) => ({
                    boxTypeId: box.box_type_id,
                    vendorId: box.vendor_id,
                    quantity: box.quantity,
                    items: box.items || {},
                    itemNotes: box.item_notes || {}
                }));
                // Also set top-level properties for backward compatibility if single box
                if (boxSelections.length === 1) {
                    orderConfig.boxTypeId = boxSelections[0].box_type_id;
                    orderConfig.vendorId = boxSelections[0].vendor_id;
                    orderConfig.boxQuantity = boxSelections[0].quantity;
                }
            }

            return orderConfig;
        };

        const processedOrders = await Promise.all(ordersData.map(processOrder));

        return {
            orders: processedOrders,
            multiple: true // Flag to tell UI it's a list
        };

    } catch (error) {
        console.error('getRecentOrdersForClient error:', error);
        return null;
    }
}

/**
 * Get active order from orders table for a client
 * This is used for "Recent Orders" display
 * Returns orders with scheduled_delivery_date in the current week, or orders created/updated this week
 * Now uses local database for fast access
 */
export async function getActiveOrderForClient(clientId: string) {
    if (!clientId) return null;

    try {
        // Calculate current week range (Sunday to Saturday)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const day = today.getDay();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - day);
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
        const endOfWeekStr = endOfWeek.toISOString().split('T')[0];
        const startOfWeekISO = startOfWeek.toISOString();
        const endOfWeekISO = endOfWeek.toISOString();

        // Try to get all orders with scheduled_delivery_date in current week
        // Now supports multiple orders per client (one per delivery day)
        let { data: ordersData, error } = await supabase
            .from('orders')
            .select('*')
            .eq('client_id', clientId)
            .in('status', ['pending', 'confirmed', 'processing', 'completed', 'waiting_for_proof', 'billing_pending'])
            .gte('scheduled_delivery_date', startOfWeekStr)
            .lte('scheduled_delivery_date', endOfWeekStr)
            .order('created_at', { ascending: false });

        // If no orders found with scheduled_delivery_date in current week,
        // try to get orders created or updated this week (fallback)
        if (!ordersData || ordersData.length === 0) {
            // Log error if it's not just "no rows returned"
            if (error && error.code !== 'PGRST116') {
                console.error('Error fetching orders by scheduled_delivery_date:', error);
            }

            // Try fetching by created_at in current week
            const { data: dataByCreated, error: errorByCreated } = await supabase
                .from('orders')
                .select('*')
                .eq('client_id', clientId)
                .in('status', ['pending', 'confirmed', 'processing', 'completed', 'waiting_for_proof', 'billing_pending'])
                .gte('created_at', startOfWeekISO)
                .lte('created_at', endOfWeekISO)
                .order('created_at', { ascending: false });

            if (errorByCreated && errorByCreated.code !== 'PGRST116') {
                console.error('Error fetching orders by created_at:', errorByCreated);
            }

            // If still no data, try by last_updated
            if (!dataByCreated || dataByCreated.length === 0) {
                const { data: dataByUpdated, error: errorByUpdated } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('client_id', clientId)
                    .in('status', ['pending', 'confirmed', 'processing', 'completed', 'waiting_for_proof', 'billing_pending'])
                    .gte('last_updated', startOfWeekISO)
                    .lte('last_updated', endOfWeekISO)
                    .order('created_at', { ascending: false });

                if (errorByUpdated && errorByUpdated.code !== 'PGRST116') {
                    console.error('Error fetching orders by last_updated:', errorByUpdated);
                }

                ordersData = dataByUpdated || [];
            } else {
                ordersData = dataByCreated;
            }
        }

        // If no orders found in orders table, check upcoming_orders as fallback
        // This handles cases where orders haven't been processed yet
        // Removed upcoming_orders fallback based on user requirement: 
        // "Things should only start showing under recent orders once they are an actual order"

        if (!ordersData || ordersData.length === 0) {
            // No active orders found
            return null;
        }

        // If only one order, return it in the old format for backward compatibility
        // If multiple orders, return them grouped by delivery day or as an array
        const isMultipleOrders = ordersData.length > 1;

        // Fetch related data
        const menuItems = await getMenuItems();
        const vendors = await getVendors();
        const boxTypes = await getBoxTypes();

        // Process all orders
        const processOrder = async (orderData: any) => {
            // Build order configuration object
            const orderConfig: any = {
                id: orderData.id,
                serviceType: orderData.service_type,
                caseId: orderData.case_id,
                status: orderData.status,
                lastUpdated: orderData.last_updated,
                updatedBy: orderData.updated_by,
                scheduledDeliveryDate: orderData.scheduled_delivery_date,
                createdAt: orderData.created_at,
                deliveryDistribution: orderData.delivery_distribution,
                totalValue: orderData.total_value,
                totalItems: orderData.total_items,
                notes: orderData.notes,
                deliveryDay: orderData.delivery_day, // Include delivery_day if present
                isUpcoming: orderData.is_upcoming || false, // Flag for upcoming orders
                orderNumber: orderData.order_number, // Numeric Order ID
                proofOfDelivery: orderData.proof_of_delivery_image || orderData.delivery_proof_url // URL to proof of delivery image (check both fields)
            };

            // Determine which table to query based on whether this is an upcoming order
            const vendorSelectionsTable = orderData.is_upcoming
                ? 'upcoming_order_vendor_selections'
                : 'order_vendor_selections';
            const itemsTable = orderData.is_upcoming
                ? 'upcoming_order_items'
                : 'order_items';
            const orderIdField = orderData.is_upcoming
                ? 'upcoming_order_id'
                : 'order_id';

            if (orderData.service_type === 'Food') {
                // Fetch vendor selections and items
                const { data: vendorSelections, error: vendorSelectionsError } = await supabase
                    .from(vendorSelectionsTable)
                    .select('*')
                    .eq(orderIdField, orderData.id);

                if (vendorSelectionsError) {
                    console.error('Error fetching vendor selections:', vendorSelectionsError);
                }

                if (vendorSelections && vendorSelections.length > 0) {
                    orderConfig.vendorSelections = [];
                    for (const vs of vendorSelections) {
                        // Both upcoming_order_items and order_items use 'vendor_selection_id' field
                        const { data: items, error: itemsError } = await supabase
                            .from(itemsTable)
                            .select('*')
                            .eq('vendor_selection_id', vs.id);

                        if (itemsError) {
                            console.error('Error fetching order items:', itemsError);
                        }

                        const itemsMap: any = {};
                        if (items && items.length > 0) {
                            for (const item of items) {
                                itemsMap[item.menu_item_id] = item.quantity;
                            }
                        }

                        orderConfig.vendorSelections.push({
                            vendorId: vs.vendor_id,
                            items: itemsMap
                        });
                    }
                } else {
                    // Initialize empty vendor selections if none found
                    orderConfig.vendorSelections = [];
                }
            } else if (orderData.service_type === 'Boxes') {
                // Fetch box selection
                const boxSelectionsTable = orderData.is_upcoming
                    ? 'upcoming_order_box_selections'
                    : 'order_box_selections';

                const { data: boxSelections, error: boxSelectionsError } = await supabase
                    .from(boxSelectionsTable)
                    .select('*')
                    .eq(orderIdField, orderData.id);

                if (boxSelectionsError) {
                    console.error('Error fetching box selections:', boxSelectionsError);
                }

                if (boxSelections && boxSelections.length > 0) {
                    // Populate boxOrders array for the new multi-box format
                    orderConfig.boxOrders = boxSelections.map((bs: any) => {
                        const itemsMap: any = {};
                        if (bs.items && Object.keys(bs.items).length > 0) {
                            for (const [itemId, val] of Object.entries(bs.items)) {
                                if (val && typeof val === 'object') {
                                    itemsMap[itemId] = (val as any).quantity;
                                } else {
                                    itemsMap[itemId] = val;
                                }
                            }
                        }
                        return {
                            boxTypeId: bs.box_type_id,
                            vendorId: bs.vendor_id,
                            quantity: bs.quantity,
                            items: itemsMap,
                            itemNotes: bs.item_notes || {}
                        };
                    });

                    // Also set top-level properties for backward compatibility (using the first box)
                    const firstBox = boxSelections[0];
                    orderConfig.vendorId = firstBox.vendor_id;
                    orderConfig.boxTypeId = firstBox.box_type_id;
                    orderConfig.boxQuantity = firstBox.quantity;

                    // Aggregate items into top-level items for backward compatibility
                    const aggregatedItems: any = {};
                    boxSelections.forEach((bs: any) => {
                        if (bs.items && Object.keys(bs.items).length > 0) {
                            for (const [itemId, val] of Object.entries(bs.items)) {
                                const qty = (val && typeof val === 'object') ? (val as any).quantity : val;
                                aggregatedItems[itemId] = (aggregatedItems[itemId] || 0) + (Number(qty) || 0);
                            }
                        }
                    });
                    orderConfig.items = aggregatedItems;
                }

                // Fallback for migrated data if items still empty (legacy format)
                if ((!orderConfig.items || Object.keys(orderConfig.items).length === 0) && boxSelections && boxSelections[0]?.vendor_id) {
                    const firstBoxVId = boxSelections[0].vendor_id;
                    // Find the vendor_selection for the box vendor in this order
                    const { data: vendorSelection } = await supabase
                        .from(vendorSelectionsTable)
                        .select('id')
                        .eq(orderIdField, orderData.id)
                        .eq('vendor_id', firstBoxVId)
                        .maybeSingle();

                    if (vendorSelection) {
                        // Fetch box items - both upcoming_order_items and order_items use 'vendor_selection_id' field
                        const { data: boxItems } = await supabase
                            .from(itemsTable)
                            .select('*')
                            .eq('vendor_selection_id', vendorSelection.id);

                        if (boxItems && boxItems.length > 0) {
                            const itemsMap: any = {};
                            for (const item of boxItems) {
                                itemsMap[item.menu_item_id] = item.quantity;
                            }
                            orderConfig.items = itemsMap;
                            // If we didn't have boxOrders (unlikely with select('*')), we should at least populate it from this fallback if needed
                            // But here we are just maintaining the legacy 'items' field.
                        }
                    }
                }
            } else if (orderData.service_type === 'Equipment') {
                // Parse equipment details from notes
                try {
                    const notes = orderData.notes ? JSON.parse(orderData.notes) : null;
                    if (notes) {
                        orderConfig.equipmentSelection = {
                            vendorId: notes.vendorId,
                            equipmentId: notes.equipmentId,
                            equipmentName: notes.equipmentName,
                            price: notes.price
                        };
                        orderConfig.vendorId = notes.vendorId; // For consistency
                    }
                } catch (e) {
                    console.error('Error parsing equipment order notes:', e);
                }
            }

            return orderConfig;
        };

        // Process all orders
        const processedOrders = await Promise.all(ordersData.map(processOrder));

        // If only one order, return it in the old format for backward compatibility
        if (processedOrders.length === 1) {
            return processedOrders[0];
        }

        // If multiple orders, return them as an array
        // The UI will need to handle displaying multiple orders
        return {
            multiple: true,
            orders: processedOrders
        };
    } catch (err) {
        console.error('Error in getActiveOrderForClient:', err);
        return null;
    }
}

/**
 * Get upcoming order from upcoming_orders table for a client
 * This is used for "Current Order Request" form
 */
/**
 * Get upcoming order from upcoming_orders table for a client
 * This is used for "Current Order Request" form
 * Now uses local database for fast access
 */
export async function getUpcomingOrderForClient(clientId: string) {
    if (!clientId) return null;

    try {
        // Use local database for fast access
        const { getUpcomingOrderForClientLocal } = await import('./local-db');
        return await getUpcomingOrderForClientLocal(clientId);
    } catch (err) {
        console.error('Error in getUpcomingOrderForClient:', err);
        return null;
    }
}

/**
 * Get previous orders (history) for a client
 */
export async function getPreviousOrdersForClient(clientId: string) {
    if (!clientId) return [];

    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching previous orders:', error);
            return [];
        }

        return orders || [];
    } catch (err) {
        console.error('Error in getPreviousOrdersForClient:', err);
        return [];
    }
}

/**
 * Get logs for a specific navigator
 */
export async function getNavigatorLogs(navigatorId: string) {
    try {
        // Fetch logs with client details
        const { data, error } = await supabase
            .from('navigator_logs')
            .select(`
                        *,
                        clients(
                            full_name
                        )
                            `)
            .eq('navigator_id', navigatorId)
            .gt('units_added', 0) // Only get logs where units were added
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching navigator logs:', error);
            return [];
        }

        return data.map((log: any) => ({
            id: log.id,
            clientId: log.client_id,
            clientName: log.clients?.full_name || 'Unknown Client',
            oldStatus: log.old_status,
            newStatus: log.new_status,
            unitsAdded: log.units_added,
            createdAt: log.created_at
        }));
    } catch (err) {
        console.error('Error in getNavigatorLogs:', err);
        return [];
    }
}

export async function getClientsPaginated(page: number, pageSize: number, query: string = '', filter?: 'needs-vendor') {
    // If filtering for clients needing vendor assignment, get Boxes clients whose vendor is not set
    if (filter === 'needs-vendor') {
        // First, get all clients with service_type = 'Boxes'
        const { data: allBoxesClients, error: clientsError } = await supabase
            .from('clients')
            .select('id')
            .eq('service_type', 'Boxes');

        if (clientsError) {
            console.error('Error fetching Boxes clients:', clientsError);
            return { clients: [], total: 0 };
        }

        if (!allBoxesClients || allBoxesClients.length === 0) {
            return { clients: [], total: 0 };
        }

        const boxesClientIds = allBoxesClients.map(c => c.id);

        // Get all upcoming box selections for these clients
        const { data: boxSelections, error: bsError } = await supabase
            .from('upcoming_order_box_selections')
            .select(`
                    vendor_id,
                        box_type_id,
                        upcoming_orders!inner(
                            client_id,
                            service_type,
                            status
                        )
                            `)
            .in('upcoming_orders.client_id', boxesClientIds)
            .eq('upcoming_orders.service_type', 'Boxes')
            .eq('upcoming_orders.status', 'scheduled');

        if (bsError) {
            console.error('Error fetching box selections:', bsError);
            return { clients: [], total: 0 };
        }

        // Get all box types to check their vendor_id
        const { data: boxTypes, error: btError } = await supabase
            .from('box_types')
            .select('id, vendor_id');

        if (btError) {
            console.error('Error fetching box types:', btError);
            return { clients: [], total: 0 };
        }

        const boxTypeMap = new Map((boxTypes || []).map(bt => [bt.id, bt.vendor_id]));

        // Group box selections by client_id
        const clientBoxSelections = new Map<string, any[]>();
        if (boxSelections) {
            for (const bs of boxSelections) {
                // upcoming_orders is returned as an array from the join, get the first element
                const upcomingOrder = Array.isArray(bs.upcoming_orders) ? bs.upcoming_orders[0] : bs.upcoming_orders;
                const clientId = upcomingOrder?.client_id;
                if (!clientId) continue;

                if (!clientBoxSelections.has(clientId)) {
                    clientBoxSelections.set(clientId, []);
                }
                clientBoxSelections.get(clientId)!.push(bs);
            }
        }

        // Find clients whose vendor is not set
        // Vendor is considered "set" if:
        // 1. box_selection.vendor_id is not null, OR
        // 2. box_type.vendor_id is not null (when box_type_id is set)
        const clientIdsNeedingVendor: string[] = [];

        for (const clientId of boxesClientIds) {
            const selections = clientBoxSelections.get(clientId) || [];

            // If client has no upcoming box selections, they need vendor assignment
            if (selections.length === 0) {
                clientIdsNeedingVendor.push(clientId);
                continue;
            }

            // Check if any selection has a vendor set
            let hasVendor = false;
            for (const selection of selections) {
                // Check direct vendor_id in box selection
                if (selection.vendor_id) {
                    hasVendor = true;
                    break;
                }

                // Check vendor_id from box type
                if (selection.box_type_id) {
                    const boxTypeVendorId = boxTypeMap.get(selection.box_type_id);
                    if (boxTypeVendorId) {
                        hasVendor = true;
                        break;
                    }
                }
            }

            if (!hasVendor) {
                clientIdsNeedingVendor.push(clientId);
            }
        }

        if (clientIdsNeedingVendor.length === 0) {
            return { clients: [], total: 0 };
        }

        // Fetch clients
        let queryBuilder = supabase
            .from('clients')
            .select('*, client_meal_orders(*)', { count: 'exact' })
            .in('id', clientIdsNeedingVendor);

        if (query) {
            queryBuilder = queryBuilder.ilike('full_name', `% ${query}% `);
        }

        const { data, count, error } = await queryBuilder
            .range((page - 1) * pageSize, page * pageSize - 1)
            .order('full_name');

        if (error) {
            console.error('Error fetching clients needing vendor:', error);
            return { clients: [], total: 0 };
        }

        return {
            clients: data.map(mapClientFromDB),
            total: count || 0
        };
    }

    // Default behavior - get all clients
    let queryBuilder = supabase
        .from('clients')
        .select('*, client_meal_orders(*)', { count: 'exact' });

    if (query) {
        queryBuilder = queryBuilder.ilike('full_name', `% ${query}% `);
    }

    const { data, count, error } = await queryBuilder
        .range((page - 1) * pageSize, page * pageSize - 1)
        .order('full_name');

    if (error) {
        console.error('Error fetching paginated clients:', error);
        return { clients: [], total: 0 };
    }

    return {
        clients: data.map(mapClientFromDB),
        total: count || 0
    };
}

export async function getClientFullDetails(clientId: string) {
    if (!clientId) return null;

    try {
        const { getClientSubmissions } = await import('./form-actions');

        const [
            client,
            history,
            orderHistory,
            billingHistory,
            activeOrder,
            upcomingOrder,
            foodOrder,
            mealOrder,
            boxOrders,
            submissions
        ] = await Promise.all([
            getClient(clientId),
            getClientHistory(clientId),
            getOrderHistory(clientId),
            getBillingHistory(clientId),
            getRecentOrdersForClient(clientId),
            getUpcomingOrderForClient(clientId),
            getClientFoodOrder(clientId),
            getClientMealOrder(clientId),
            getClientBoxOrder(clientId),
            getClientSubmissions(clientId)
        ]);

        if (!client) return null;

        return {
            client,
            history,
            orderHistory,
            billingHistory,
            activeOrder,
            upcomingOrder,
            foodOrder,
            mealOrder,
            boxOrders,
            submissions: submissions?.data || []
        };
    } catch (error) {
        console.error('Error fetching full client details:', error);
        return null;
    }
}

export async function getClientProfileData(clientId: string) {
    if (!clientId) return null;

    try {
        const { getClientSubmissions } = await import('./form-actions');

        // Fetch ONLY critical data for initial render
        // Moved history, billing, ordered history to lazy loading
        const [
            client,
            activeOrder,
            upcomingOrder,
            foodOrder,
            mealOrder,
            boxOrders
        ] = await Promise.all([
            getClient(clientId),
            getRecentOrdersForClient(clientId),
            getUpcomingOrderForClient(clientId),
            getClientFoodOrder(clientId),
            getClientMealOrder(clientId),
            getClientBoxOrder(clientId)
        ]);

        if (!client) return null;

        return {
            client,
            activeOrder,
            upcomingOrder,
            foodOrder,
            mealOrder,
            boxOrders
        };
    } catch (error) {
        console.error('Error fetching client profile data:', error);
        return null;
    }
}

export async function getOrdersByVendor(vendorId: string) {
    if (!vendorId) return [];

    const session = await getSession();
    if (!session || (session.role !== 'admin' && session.userId !== vendorId)) {
        console.error('Unauthorized access to getOrdersByVendor');
        return [];
    }

    // Use Service Role if available to bypass RLS
    // We already verified the user is authorized (Admin or the specific Vendor)
    let supabaseClient = supabase;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
        supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
            auth: { persistSession: false }
        });
    }

    try {
        // 1. Fetch completed orders (from orders table)
        // Include Food, Boxes, and Equipment orders
        const { data: foodOrderIds } = await supabaseClient
            .from('order_vendor_selections')
            .select('order_id')
            .eq('vendor_id', vendorId);

        const { data: boxOrderIds } = await supabaseClient
            .from('order_box_selections')
            .select('order_id')
            .eq('vendor_id', vendorId);

        // Also get Equipment orders - they use order_vendor_selections too
        // But we need to filter by service_type='Equipment' in the orders table
        const orderIds = Array.from(new Set([
            ...(foodOrderIds?.map(o => o.order_id) || []),
            ...(boxOrderIds?.map(o => o.order_id) || [])
        ]));

        let orders: any[] = [];
        if (orderIds.length > 0) {
            const { data: ordersData } = await supabaseClient
                .from('orders')
                .select('*')
                .in('id', orderIds)
                .order('created_at', { ascending: false });

            if (ordersData) {
                // Filter to only include orders for this vendor
                // For Equipment orders, check if vendor_id matches in notes
                const filteredOrders = ordersData.filter(order => {
                    if (order.service_type === 'Equipment') {
                        try {
                            const notes = order.notes ? JSON.parse(order.notes) : null;
                            return notes && notes.vendorId === vendorId;
                        } catch {
                            return false;
                        }
                    }
                    // For Food and Boxes, they're already filtered by vendor_selections/box_selections
                    return true;
                });

                orders = await Promise.all(filteredOrders.map(async (order) => {
                    const processed = await processVendorOrderDetails(supabaseClient, order, vendorId, false);
                    return { ...processed, orderType: 'completed' };
                }));
            }
        }

        return orders;

    } catch (err) {
        console.error('Error in getOrdersByVendor:', err);
        return [];
    }
}

export async function getVendorSession() {
    const session = await getSession();
    if (!session || session.role !== 'vendor') {
        return null;
    }
    return session;
}

export async function getVendorOrders() {
    const session = await getVendorSession();
    if (!session) return [];
    return await getOrdersByVendor(session.userId);
}

export async function getVendorMenuItems() {
    const session = await getVendorSession();
    if (!session) return [];

    const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('vendor_id', session.userId);

    if (error) return [];
    return data.map((i: any) => ({
        id: i.id,
        vendorId: i.vendor_id,
        name: i.name,
        value: i.value,
        priceEach: i.price_each ?? undefined,
        isActive: i.is_active,
        categoryId: i.category_id,
        quotaValue: i.quota_value,
        minimumOrder: i.minimum_order ?? 0
    }));
}

export async function getVendorDetails() {
    const session = await getVendorSession();
    if (!session) return null;

    const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .eq('id', session.userId)
        .single();

    if (error || !data) return null;

    return {
        id: data.id,
        name: data.name,
        email: data.email,
        serviceTypes: (data.service_type || '').split(',').map((s: string) => s.trim()).filter(Boolean) as ServiceType[],
        deliveryDays: data.delivery_days || [],
        allowsMultipleDeliveries: data.delivery_frequency === 'Multiple',
        isActive: data.is_active,
        minimumMeals: data.minimum_meals ?? 0
    };
}

export async function getOrdersPaginated(page: number, pageSize: number, filter?: 'needs-vendor') {
    // For the Orders tab, show orders from the orders table
    // Exclude billing_pending orders (those should only show on billing page)
    // Only show scheduled orders (orders with scheduled_delivery_date)
    let query = supabase
        .from('orders')
        .select(`
                        *,
                        clients(
                            full_name
                        )
                            `, { count: 'exact' })
        .neq('status', 'billing_pending')
        .not('scheduled_delivery_date', 'is', null);

    // If filtering for orders needing vendor assignment, only get Boxes orders with null vendor_id in box_selections
    if (filter === 'needs-vendor') {
        // Get all Boxes orders from orders table
        const { data: boxesOrders, error: boxesError } = await supabase
            .from('orders')
            .select('id')
            .eq('service_type', 'Boxes');

        if (boxesError) {
            console.error('Error fetching boxes orders:', boxesError);
            return { orders: [], total: 0 };
        }

        // Get all Boxes upcoming orders
        const { data: boxesUpcomingOrders, error: boxesUpcomingError } = await supabase
            .from('upcoming_orders')
            .select('id')
            .eq('service_type', 'Boxes')
            .eq('status', 'scheduled');

        if (boxesUpcomingError) {
            console.error('Error fetching boxes upcoming orders:', boxesUpcomingError);
        }

        const boxesOrderIds = (boxesOrders || []).map(o => o.id);
        const boxesUpcomingOrderIds = (boxesUpcomingOrders || []).map(o => o.id);

        const allBoxesOrderIds = [...boxesOrderIds, ...boxesUpcomingOrderIds];

        if (allBoxesOrderIds.length === 0) {
            return { orders: [], total: 0 };
        }

        // Get box selections with null vendor_id from both tables
        const [orderBoxSelectionsResult, upcomingBoxSelectionsResult] = await Promise.all([
            boxesOrderIds.length > 0 ? supabase
                .from('order_box_selections')
                .select('order_id')
                .in('order_id', boxesOrderIds)
                .is('vendor_id', null) : { data: [], error: null },
            boxesUpcomingOrderIds.length > 0 ? supabase
                .from('upcoming_order_box_selections')
                .select('upcoming_order_id')
                .in('upcoming_order_id', boxesUpcomingOrderIds)
                .is('vendor_id', null) : { data: [], error: null }
        ]);

        if (orderBoxSelectionsResult.error) {
            console.error('Error fetching order box selections:', orderBoxSelectionsResult.error);
        }
        if (upcomingBoxSelectionsResult.error) {
            console.error('Error fetching upcoming box selections:', upcomingBoxSelectionsResult.error);
        }

        const orderIdsNeedingVendor = [
            ...((orderBoxSelectionsResult.data || []).map((bs: any) => bs.order_id)),
            ...((upcomingBoxSelectionsResult.data || []).map((bs: any) => bs.upcoming_order_id))
        ];

        if (orderIdsNeedingVendor.length === 0) {
            return { orders: [], total: 0 };
        }

        // Filter to only upcoming orders that need vendor
        const orderIdsFromUpcoming = orderIdsNeedingVendor.filter(id => boxesUpcomingOrderIds.includes(id));
        if (orderIdsFromUpcoming.length > 0) {
            query = query.in('id', orderIdsFromUpcoming);
        } else {
            // If no upcoming orders need vendor, return empty
            return { orders: [], total: 0 };
        }
    }

    const { data, count, error } = await query
        .range((page - 1) * pageSize, page * pageSize - 1)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching paginated orders:', error);
        return { orders: [], total: 0 };
    }

    // console.log(`[getOrdersPaginated] Fetched ${data?.length} orders from table 'orders'. Total count: ${count}`);

    return {
        orders: (data || []).map((o: any) => ({
            ...o,
            clientName: o.clients?.full_name || 'Unknown',
            // Ensure status is 'scheduled' for upcoming_orders
            status: 'scheduled',
            // Map delivery_day to scheduled_delivery_date if needed
            scheduled_delivery_date: o.scheduled_delivery_date || null
        })),
        total: count || 0
    };
}

export async function getAllOrders() {
    // For the Orders tab, show orders from the orders table
    // Exclude billing_pending orders (those should only show on billing page)
    // Only show scheduled orders (orders with scheduled_delivery_date)
    const { data, error } = await supabase
        .from('orders')
        .select(`
            *,
            clients(
                full_name
            )
        `)
        .neq('status', 'billing_pending')
        .not('scheduled_delivery_date', 'is', null)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching all orders:', error);
        return [];
    }

    return (data || []).map((o: any) => ({
        ...o,
        clientName: o.clients?.full_name || 'Unknown',
        // Use actual status from DB
        status: o.status || 'pending',
        scheduled_delivery_date: o.scheduled_delivery_date || null
    }));
}

export async function getOrderById(orderId: string) {
    if (!orderId) return null;

    // Use Service Role if available to bypass RLS
    let supabaseClient = supabase;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
        supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
            auth: { persistSession: false }
        });
    }

    // Fetch the order
    const { data: orderData, error: orderError } = await supabaseClient
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

    if (orderError || !orderData) {
        console.error('Error fetching order:', orderError);
        return null;
    }

    // Fetch client information
    const { data: clientData } = await supabaseClient
        .from('clients')
        .select('id, full_name, address, email, phone_number')
        .eq('id', orderData.client_id)
        .single();

    // Fetch reference data
    const [menuItems, vendors, boxTypes, equipmentList, categories, mealItems] = await Promise.all([
        getMenuItems(),
        getVendors(),
        getBoxTypes(),
        getEquipment(),
        getCategories(),
        getMealItems()
    ]);

    let orderDetails: any = undefined;

    if (orderData.service_type === 'Food' || orderData.service_type === 'Meal') {
        // Fetch vendor selections and items
        const { data: vendorSelections } = await supabaseClient
            .from('order_vendor_selections')
            .select('*')
            .eq('order_id', orderId);

        console.log(`[getOrderById] Order ${orderId} (${orderData.service_type}): Found ${vendorSelections?.length} vendor selections`);

        if (vendorSelections && vendorSelections.length > 0) {
            const vendorSelectionsWithItems = await Promise.all(
                vendorSelections.map(async (vs: any) => {
                    const { data: items } = await supabaseClient
                        .from('order_items')
                        .select('*')
                        .eq('vendor_selection_id', vs.id);

                    console.log(`[getOrderById] VS ${vs.id}: Found ${items?.length} items in DB`);
                    if (items && items.length > 0) {
                        console.log(`[getOrderById] First item:`, items[0]);
                    }

                    const vendor = vendors.find(v => v.id === vs.vendor_id);
                    const itemsWithDetails = (items || []).map((item: any) => {
                        let menuItem: any = menuItems.find(mi => mi.id === item.menu_item_id);
                        if (!menuItem) {
                            // First try explicit meal_item_id
                            if (item.meal_item_id) {
                                menuItem = mealItems.find(mi => mi.id === item.meal_item_id);
                            }
                            // Fallback: Check if the ID in menu_item_id is actually a meal item (e.g. data consistency issue)
                            if (!menuItem && item.menu_item_id) {
                                menuItem = mealItems.find(mi => mi.id === item.menu_item_id);
                            }
                        }

                        if (!menuItem) {
                            console.warn(`[getOrderById] Item not found in menu or meal items: ${item.menu_item_id || item.meal_item_id}`);
                        }


                        console.log('[getOrderById] Processing Item:', {
                            id: item.id,
                            menuItemId: item.menu_item_id,
                            customName: item.custom_name,
                            customPrice: item.custom_price,
                            unitValue: item.unit_value
                        });

                        const itemPrice = item.custom_price ? parseFloat(item.custom_price) : (menuItem?.priceEach ?? parseFloat(item.unit_value));
                        const quantity = item.quantity;
                        const itemTotal = itemPrice * quantity;
                        return {
                            id: item.id,
                            menuItemId: item.menu_item_id,
                            menuItemName: item.custom_name || menuItem?.name || 'Unknown Item',
                            quantity: quantity,
                            unitValue: itemPrice,
                            totalValue: itemTotal,
                            notes: item.notes || null
                        };
                    });

                    return {
                        vendorId: vs.vendor_id,
                        vendorName: vendor?.name || 'Unknown Vendor',
                        items: itemsWithDetails
                    };
                })
            );

            orderDetails = {
                serviceType: orderData.service_type,
                vendorSelections: vendorSelectionsWithItems,
                totalItems: orderData.total_items,
                totalValue: parseFloat(orderData.total_value || 0)
            };
        }
    } else if (orderData.service_type === 'Custom') {
        // Handle Custom orders - fetch vendor selections and items
        const { data: vendorSelections } = await supabaseClient
            .from('order_vendor_selections')
            .select('*')
            .eq('order_id', orderId);

        if (vendorSelections && vendorSelections.length > 0) {
            const vendorSelectionsWithItems = await Promise.all(
                vendorSelections.map(async (vs: any) => {
                    const { data: items } = await supabaseClient
                        .from('order_items')
                        .select('*')
                        .eq('vendor_selection_id', vs.id);

                    const vendor = vendors.find(v => v.id === vs.vendor_id);

                    const itemsWithDetails = (items || []).map((item: any) => ({
                        id: item.id,
                        menuItemId: null,
                        menuItemName: item.custom_name || 'Custom Item',
                        quantity: item.quantity,
                        unitValue: parseFloat(item.custom_price || 0),
                        totalValue: parseFloat(item.custom_price || 0) * item.quantity
                    }));

                    return {
                        vendorId: vs.vendor_id,
                        vendorName: vendor?.name || 'Unknown Vendor',
                        items: itemsWithDetails
                    };
                })
            );

            orderDetails = {
                serviceType: 'Custom',
                vendorSelections: vendorSelectionsWithItems,
                totalItems: orderData.total_items,
                totalValue: parseFloat(orderData.total_value || 0),
                notes: orderData.notes
            };
        }
    } else if (orderData.service_type === 'Boxes') {
        // Fetch box selection
        const { data: boxSelection } = await supabaseClient
            .from('order_box_selections')
            .select('*')
            .eq('order_id', orderId)
            .maybeSingle();

        if (boxSelection) {
            const vendor = vendors.find(v => v.id === boxSelection.vendor_id);
            const boxType = boxTypes.find(bt => bt.id === boxSelection.box_type_id);
            const boxTotalValue = boxSelection.total_value
                ? parseFloat(boxSelection.total_value)
                : parseFloat(orderData.total_value || 0);

            // Structure box items by category
            const boxItems = boxSelection.items || {};
            const itemsByCategory: { [categoryId: string]: { categoryName: string; items: Array<{ itemId: string; itemName: string; quantity: number; quotaValue: number }> } } = {};

            // Group items by category
            Object.entries(boxItems).forEach(([itemId, qty]: [string, any]) => {
                const menuItem = menuItems.find(mi => mi.id === itemId);

                // Handle both object format {quantity: X} and direct number format
                const quantity = typeof qty === 'object' && qty !== null ? (qty as any).quantity : Number(qty) || 0;

                if (menuItem && menuItem.categoryId) {
                    const category = categories.find(c => c.id === menuItem.categoryId);
                    if (category) {
                        if (!itemsByCategory[category.id]) {
                            itemsByCategory[category.id] = {
                                categoryName: category.name,
                                items: []
                            };
                        }

                        itemsByCategory[category.id].items.push({
                            itemId: itemId,
                            itemName: menuItem.name,
                            quantity: quantity,
                            quotaValue: menuItem.quotaValue || 1
                        });
                    } else {
                        // Category not found but item exists
                        if (!itemsByCategory['uncategorized']) {
                            itemsByCategory['uncategorized'] = {
                                categoryName: 'Uncategorized',
                                items: []
                            };
                        }
                        itemsByCategory['uncategorized'].items.push({
                            itemId: itemId,
                            itemName: menuItem.name,
                            quantity: quantity,
                            quotaValue: menuItem.quotaValue || 1
                        });
                    }
                } else {
                    // Menu item not found - fallback
                    if (!itemsByCategory['uncategorized']) {
                        itemsByCategory['uncategorized'] = {
                            categoryName: 'Uncategorized',
                            items: []
                        };
                    }

                    itemsByCategory['uncategorized'].items.push({
                        itemId: itemId,
                        itemName: menuItem?.name || 'Unknown Item (' + itemId + ')',
                        quantity: quantity,
                        quotaValue: 1
                    });
                }
            });

            orderDetails = {
                serviceType: orderData.service_type,
                vendorId: boxSelection.vendor_id,
                vendorName: vendor?.name || 'Unknown Vendor',
                boxTypeId: boxSelection.box_type_id,
                boxTypeName: boxType?.name || 'Unknown Box Type',
                boxQuantity: boxSelection.quantity,
                items: boxSelection.items || {},
                itemsByCategory: itemsByCategory,
                totalValue: boxTotalValue
            };
        } else {
            orderDetails = {
                serviceType: orderData.service_type,
                vendorId: null,
                vendorName: `Unknown Vendor (ID: ${boxSelection.vendor_id || 'Missing'}) - Deleted?`,
                boxTypeId: null,
                boxTypeName: 'Unknown Box Type',
                boxQuantity: 1,
                items: {},
                itemsByCategory: {},
                totalValue: parseFloat(orderData.total_value || 0)
            };
        }
    } else if (orderData.service_type === 'Equipment') {
        // Parse equipment details from notes field
        try {
            const notes = orderData.notes ? JSON.parse(orderData.notes) : null;
            if (notes) {
                const vendor = vendors.find(v => v.id === notes.vendorId);
                const equipment = equipmentList.find(e => e.id === notes.equipmentId);

                orderDetails = {
                    serviceType: orderData.service_type,
                    vendorId: notes.vendorId,
                    vendorName: vendor?.name || 'Unknown Vendor',
                    equipmentId: notes.equipmentId,
                    equipmentName: notes.equipmentName || equipment?.name || 'Unknown Equipment',
                    price: notes.price || equipment?.price || 0,
                    totalValue: parseFloat(orderData.total_value || 0)
                };
            }
        } catch (e) {
            console.error('Error parsing equipment order notes:', e);
            // Fallback: try to get vendor from order_vendor_selections
            const { data: vendorSelections } = await supabase
                .from('order_vendor_selections')
                .select('*')
                .eq('order_id', orderId)
                .limit(1)
                .maybeSingle();

            if (vendorSelections) {
                const vendor = vendors.find(v => v.id === vendorSelections.vendor_id);
                orderDetails = {
                    serviceType: orderData.service_type,
                    vendorId: vendorSelections.vendor_id,
                    vendorName: vendor?.name || 'Unknown Vendor',
                    totalValue: parseFloat(orderData.total_value || 0)
                };
            }
        }
    }

    return {
        id: orderData.id,
        orderNumber: orderData.order_number,
        clientId: orderData.client_id,
        clientName: clientData?.full_name || 'Unknown Client',
        clientAddress: clientData?.address || '',
        clientEmail: clientData?.email || '',
        clientPhone: clientData?.phone_number || '',
        serviceType: orderData.service_type,
        caseId: orderData.case_id,
        status: orderData.status,
        scheduledDeliveryDate: orderData.scheduled_delivery_date,
        actualDeliveryDate: orderData.actual_delivery_date,
        deliveryProofUrl: orderData.proof_of_delivery_image || '',
        totalValue: parseFloat(orderData.total_value || 0),
        totalItems: orderData.total_items,
        notes: orderData.notes,
        createdAt: orderData.created_at,
        lastUpdated: orderData.updated_at,
        updatedBy: orderData.updated_by,
        orderDetails: orderDetails
    };
};

/**
 * Efficiently fetch full details for a batch of clients
 * Used for prefetching visible clients in the list
 */
export async function getBatchClientDetails(clientIds: string[]) {
    if (!clientIds || clientIds.length === 0) return {};

    try {
        // console.log(`[BatchFetch] Starting batch fetch for ${ clientIds.length } clients`);
        // We could optimize this further with a single SQL query or stored proc,
        // but for now, parallelizing the existing optimized getters is a massive step up from serial
        // fetching in a loop.
        // Also, most of the "sub-getters" (like history) are simple selects by ID.

        // Use Promise.all to fetch all clients in parallel
        const results = await Promise.all(
            clientIds.map(async (id) => {
                try {
                    const details = await getClientFullDetails(id);
                    return { id, details };
                } catch (e) {
                    console.error(`Error fetching details for client ${id}: `, e);
                    return { id, details: null };
                }
            })
        );

        // Convert array to map for easy lookup
        const resultMap: Record<string, any> = {};
        results.forEach(r => {
            if (r.details) {
                resultMap[r.id] = r.details;
            }
        });

        // console.log(`[BatchFetch] Completed batch fetch for ${ clientIds.length } clients`);
        return resultMap;
    } catch (error) {
        console.error('Error in getBatchClientDetails:', error);
        return {};
    }
}

export async function getClientFoodOrder(clientId: string): Promise<ClientFoodOrder | null> {
    const { data, error } = await supabase
        .from('client_food_orders')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();

    if (error) {
        // Suppress table missing error during migration phase? 
        // Or confirm tables exist. For now log error.
        console.error('Error fetching food order:', error);
        return null;
    }
    if (!data) return null;

    return {
        id: data.id,
        clientId: data.client_id,
        caseId: data.case_id,
        deliveryDayOrders: data.delivery_day_orders,
        notes: data.notes,
        created_at: data.created_at,
        updated_at: data.updated_at,
        updated_by: data.updated_by
    };
}

export async function getClientMealOrder(clientId: string): Promise<ClientMealOrder | null> {
    const { data, error } = await supabase
        .from('client_meal_orders')
        .select('*')
        .eq('client_id', clientId)
        .maybeSingle();

    if (error) {
        console.error('Error fetching meal order:', error);
        return null;
    }
    if (!data) return null;

    return {
        id: data.id,
        clientId: data.client_id,
        caseId: data.case_id,
        mealSelections: data.meal_selections,
        notes: data.notes,
        created_at: data.created_at,
        updated_at: data.updated_at,
        updated_by: data.updated_by
    };
}

export async function getClientBoxOrder(clientId: string): Promise<ClientBoxOrder[]> {
    const { data, error } = await supabase
        .from('client_box_orders')
        .select('*')
        .eq('client_id', clientId);

    if (error) {
        console.error('Error fetching box order:', error);
        return [];
    }
    if (!data) return [];

    console.log('[getClientBoxOrder] Fetched data count:', data.length);
    if (data.length > 0) {
        console.log('[getClientBoxOrder] Sample item notes:', JSON.stringify(data[0].item_notes, null, 2));
    }

    return data.map(d => ({
        id: d.id,
        clientId: d.client_id,
        caseId: d.case_id,
        boxTypeId: d.box_type_id,
        vendorId: d.vendor_id,
        quantity: d.quantity,
        items: d.items,
        itemNotes: d.item_notes, // Map item_notes from DB
        notes: d.notes,
        created_at: d.created_at,
        updated_at: d.updated_at,
        updated_by: d.updated_by
    }));
}