'use server';

import { revalidatePath } from 'next/cache';
import { supabase } from './supabase';
import { ClientStatus, Vendor, MenuItem, BoxType, AppSettings, Navigator, ClientProfile, DeliveryRecord, ItemCategory, BoxQuota } from './types';
import { randomUUID } from 'crypto';

// --- HELPERS ---
function handleError(error: any) {
    if (error) {
        console.error('Supabase Error:', error);
        throw new Error(error.message);
    }
}

// --- STATUS ACTIONS ---

export async function getStatuses() {
    const { data, error } = await supabase.from('client_statuses').select('*').order('created_at', { ascending: true });
    if (error) {
        console.error('Error fetching statuses:', error);
        return [];
    }
    return data.map((s: any) => ({
        id: s.id,
        name: s.name,
        isSystemDefault: s.is_system_default,
        deliveriesAllowed: s.deliveries_allowed
    }));
}

export async function addStatus(name: string) {
    const { data, error } = await supabase
        .from('client_statuses')
        .insert([{ name, is_system_default: false, deliveries_allowed: true }]) // Default to true or false? Let's say true.
        .select()
        .single();

    handleError(error);
    revalidatePath('/admin');
    return {
        id: data.id,
        name: data.name,
        isSystemDefault: data.is_system_default,
        deliveriesAllowed: data.deliveries_allowed
    };
}

export async function deleteStatus(id: string) {
    const { error } = await supabase.from('client_statuses').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function updateStatus(id: string, data: Partial<ClientStatus>) { // Modified signature to take Partial<ClientStatus> instead of just name
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.deliveriesAllowed !== undefined) payload.deliveries_allowed = data.deliveriesAllowed;

    const { data: res, error } = await supabase
        .from('client_statuses')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

    handleError(error);
    revalidatePath('/admin');
    return { id: res.id, name: res.name, isSystemDefault: res.is_system_default, deliveriesAllowed: res.deliveries_allowed };
}

// --- VENDOR ACTIONS ---

export async function getVendors() {
    const { data, error } = await supabase.from('vendors').select('*');
    if (error) return [];

    return data.map((v: any) => ({
        id: v.id,
        name: v.name,
        serviceType: v.service_type,
        deliveryDays: v.delivery_days || [],
        allowsMultipleDeliveries: v.delivery_frequency === 'Multiple',
        isActive: v.is_active
    }));
}

export async function addVendor(data: Omit<Vendor, 'id'>) {
    const payload = {
        name: data.name,
        service_type: data.serviceType,
        delivery_days: data.deliveryDays,
        delivery_frequency: data.allowsMultipleDeliveries ? 'Multiple' : 'Once',
        is_active: data.isActive
    };

    const { data: res, error } = await supabase.from('vendors').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateVendor(id: string, data: Partial<Vendor>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.serviceType) payload.service_type = data.serviceType;
    if (data.deliveryDays) payload.delivery_days = data.deliveryDays;
    if (data.allowsMultipleDeliveries !== undefined) {
        payload.delivery_frequency = data.allowsMultipleDeliveries ? 'Multiple' : 'Once';
    }
    if (data.isActive !== undefined) payload.is_active = data.isActive;

    const { error } = await supabase.from('vendors').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteVendor(id: string) {
    const { error } = await supabase.from('vendors').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

// --- MENU ACTIONS ---

export async function getMenuItems() {
    const { data, error } = await supabase.from('menu_items').select('*');
    if (error) return [];
    return data.map((i: any) => ({
        id: i.id,
        vendorId: i.vendor_id,
        name: i.name,
        value: i.value,
        isActive: i.is_active,
        categoryId: i.category_id,
        quotaValue: i.quota_value,
        minimumOrder: i.minimum_order ?? 0
    }));
}

export async function addMenuItem(data: Omit<MenuItem, 'id'>) {
    const payload = {
        vendor_id: data.vendorId,
        name: data.name,
        value: data.value,
        is_active: data.isActive,
        category_id: data.categoryId,
        quota_value: data.quotaValue,
        minimum_order: data.minimumOrder ?? 0
    };
    const { data: res, error } = await supabase.from('menu_items').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateMenuItem(id: string, data: Partial<MenuItem>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.value) payload.value = data.value;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.categoryId !== undefined) payload.category_id = data.categoryId;
    if (data.quotaValue !== undefined) payload.quota_value = data.quotaValue;
    if (data.minimumOrder !== undefined) payload.minimum_order = data.minimumOrder;

    const { error } = await supabase.from('menu_items').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteMenuItem(id: string) {
    const { error } = await supabase.from('menu_items').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

// --- ITEM CATEGORY ACTIONS ---

export async function getCategories() {
    const { data, error } = await supabase.from('item_categories').select('*').order('name');
    if (error) return [];
    return data.map((c: any) => ({
        id: c.id,
        name: c.name
    }));
}

export async function addCategory(name: string) {
    const { data, error } = await supabase.from('item_categories').insert([{ name }]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { id: data.id, name: data.name };
}

export async function deleteCategory(id: string) {
    const { error } = await supabase.from('item_categories').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function updateCategory(id: string, name: string) {
    const { error } = await supabase.from('item_categories').update({ name }).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

// --- BOX QUOTA ACTIONS ---

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

export async function addBoxQuota(data: Omit<BoxQuota, 'id'>) {
    const payload = {
        box_type_id: data.boxTypeId,
        category_id: data.categoryId,
        target_value: data.targetValue
    };
    const { data: res, error } = await supabase.from('box_quotas').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateBoxQuota(id: string, targetValue: number) {
    const { error } = await supabase.from('box_quotas').update({ target_value: targetValue }).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteBoxQuota(id: string) {
    const { error } = await supabase.from('box_quotas').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

// --- BOX TYPE ACTIONS ---

export async function getBoxTypes() {
    const { data, error } = await supabase.from('box_types').select('*');
    if (error) return [];
    return data.map((b: any) => ({
        id: b.id,
        name: b.name,
        isActive: b.is_active,
        vendorId: b.vendor_id || null
    }));
}

export async function addBoxType(data: Omit<BoxType, 'id'>) {
    const { data: res, error } = await supabase.from('box_types').insert([{ name: data.name, is_active: data.isActive, vendor_id: data.vendorId || null }]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateBoxType(id: string, data: Partial<BoxType>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.vendorId !== undefined) payload.vendor_id = data.vendorId;

    const { error } = await supabase.from('box_types').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteBoxType(id: string) {
    const { error } = await supabase.from('box_types').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

// --- SETTINGS ACTIONS ---

export async function getSettings() {
    const { data, error } = await supabase.from('app_settings').select('*').single();
    if (error || !data) return { weeklyCutoffDay: 'Friday', weeklyCutoffTime: '17:00' };

    return {
        weeklyCutoffDay: data.weekly_cutoff_day,
        weeklyCutoffTime: data.weekly_cutoff_time
    };
}

export async function updateSettings(settings: AppSettings) {
    // We assume there's one row. We'll try to update all rows or insert if empty.
    // Ideally ID is known or we just update the first one found.
    // For simplicity, we can delete all and insert one, or update where true.
    // Best: Update based on ID if we have it, but we don't track it in FE types.
    // Safe bet: Update all rows (there should be only 1).

    const { error } = await supabase
        .from('app_settings')
        .update({
            weekly_cutoff_day: settings.weeklyCutoffDay,
            weekly_cutoff_time: settings.weeklyCutoffTime
        })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Hack to update all rows

    if (error) console.error(error);
    revalidatePath('/admin');
}

// --- NAVIGATOR ACTIONS ---

export async function getNavigators() {
    const { data, error } = await supabase.from('navigators').select('*');
    if (error) return [];
    return data.map((n: any) => ({
        id: n.id,
        name: n.name,
        isActive: n.is_active
    }));
}

export async function addNavigator(data: Omit<Navigator, 'id'>) {
    const { data: res, error } = await supabase.from('navigators').insert([{ name: data.name, is_active: data.isActive }]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateNavigator(id: string, data: Partial<Navigator>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.isActive !== undefined) payload.is_active = data.isActive;

    const { error } = await supabase.from('navigators').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteNavigator(id: string) {
    const { error } = await supabase.from('navigators').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

// --- CLIENT ACTIONS ---

function mapClientFromDB(c: any): ClientProfile {
    return {
        id: c.id,
        fullName: c.full_name,
        email: c.email || '',
        address: c.address || '',
        phoneNumber: c.phone_number || '',
        navigatorId: c.navigator_id || '',
        endDate: c.end_date || '',
        screeningTookPlace: c.screening_took_place,
        screeningSigned: c.screening_signed,
        notes: c.notes || '',
        statusId: c.status_id || '',
        serviceType: c.service_type as any,
        approvedMealsPerWeek: c.approved_meals_per_week,
        activeOrder: c.active_order, // Metadata matches structure
        createdAt: c.created_at,
        updatedAt: c.updated_at
    };
}

export async function getClients() {
    const { data, error } = await supabase.from('clients').select('*');
    if (error) return [];
    return data.map(mapClientFromDB);
}

export async function getClient(id: string) {
    const { data, error } = await supabase.from('clients').select('*').eq('id', id).single();
    if (error || !data) return undefined;
    return mapClientFromDB(data);
}

export async function addClient(data: Omit<ClientProfile, 'id' | 'createdAt' | 'updatedAt'>) {
    const payload = {
        full_name: data.fullName,
        email: data.email,
        address: data.address,
        phone_number: data.phoneNumber,
        navigator_id: data.navigatorId || null,
        end_date: data.endDate,
        screening_took_place: data.screeningTookPlace,
        screening_signed: data.screeningSigned,
        notes: data.notes,
        status_id: data.statusId || null,
        service_type: data.serviceType,
        approved_meals_per_week: data.approvedMealsPerWeek || 0,
        active_order: {}
    };

    const { data: res, error } = await supabase.from('clients').insert([payload]).select().single();
    handleError(error);

    if (res) {
        const newClient = mapClientFromDB(res);
        
        // Sync to upcoming_orders if activeOrder exists
        if (newClient.activeOrder && newClient.activeOrder.caseId) {
            await syncCurrentOrderToUpcoming(newClient.id, newClient);
        }

        revalidatePath('/clients');
        return newClient;
    }
}

export async function updateClient(id: string, data: Partial<ClientProfile>) {
    const payload: any = {};
    if (data.fullName) payload.full_name = data.fullName;
    if (data.email !== undefined) payload.email = data.email;
    if (data.address !== undefined) payload.address = data.address;
    if (data.phoneNumber !== undefined) payload.phone_number = data.phoneNumber;
    if (data.navigatorId !== undefined) payload.navigator_id = data.navigatorId || null;
    if (data.endDate !== undefined) payload.end_date = data.endDate;
    if (data.screeningTookPlace !== undefined) payload.screening_took_place = data.screeningTookPlace;
    if (data.screeningSigned !== undefined) payload.screening_signed = data.screeningSigned;
    if (data.notes !== undefined) payload.notes = data.notes;
    if (data.statusId !== undefined) payload.status_id = data.statusId || null;
    if (data.serviceType) payload.service_type = data.serviceType;
    if (data.approvedMealsPerWeek !== undefined) payload.approved_meals_per_week = data.approvedMealsPerWeek;
    if (data.activeOrder) payload.active_order = data.activeOrder;

    payload.updated_at = new Date().toISOString();

    const { error } = await supabase.from('clients').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/clients');
    revalidatePath(`/clients/${id}`);
}

export async function deleteClient(id: string) {
    const { error } = await supabase.from('clients').delete().eq('id', id);
    handleError(error);
    revalidatePath('/clients');
}

// --- DELIVERY ACTIONS ---

export async function generateDeliveriesForDate(dateStr: string) {
    // Fetch required data
    const { data: clients } = await supabase.from('clients').select('*');
    const { data: vendors } = await supabase.from('vendors').select('*');
    const { data: boxTypes } = await supabase.from('box_types').select('*');
    const { data: existingHistory } = await supabase.from('delivery_history')
        .select('*')
        .eq('delivery_date', dateStr); // Exact match might be tricky with ISO, assume we match text or check range?
    // For simplicity in this demo, strict string match if stored same

    // Note: Comparing ISO strings is fragile. Ideally use date_trunc in SQL.
    // We'll rely on the fact that we're generating for a specific timestamp or just proceed with optimistic creation
    // For robustness, let's fetch ALL history for these clients (optimize later)

    const dayName = new Date(dateStr).toLocaleDateString('en-US', { weekday: 'long' });
    let count = 0;

    if (!clients || !vendors) return 0;

    for (const c of clients) {
        if (!c.active_order || !c.active_order.vendorId) continue;

        const vendor = vendors.find((v: any) => v.id === c.active_order.vendorId);
        if (!vendor) continue;

        // Check day
        const deliveryDays = vendor.delivery_days || [];
        if (deliveryDays.includes(dayName)) {
            // Check duplication
            // (Simplified: assuming we don't want duplicate per day)
            // We'll skip the duplication check in code for now to save complexity, or assume UI handles idempotency

            let summary = '';
            if (c.service_type === 'Food') {
                summary = `Food Order: ${Object.keys(c.active_order.menuSelections || {}).length} items`;
            } else if (c.service_type === 'Boxes') {
                const box = boxTypes?.find((b: any) => b.id === c.active_order.boxTypeId);
                summary = `${box?.name || 'Box'} x${c.active_order.boxQuantity}`;
            }

            const { error } = await supabase.from('delivery_history').insert([{
                client_id: c.id,
                vendor_id: vendor.id,
                service_type: c.service_type,
                delivery_date: dateStr,
                items_summary: summary,
                proof_of_delivery_image: ''
            }]);

            if (!error) count++;
        }
    }

    revalidatePath('/clients');
    return count;
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

export async function updateDeliveryProof(id: string, proofUrl: string) {
    const { error } = await supabase
        .from('delivery_history')
        .update({ proof_of_delivery_image: proofUrl })
        .eq('id', id);

    handleError(error);
    revalidatePath('/clients');
}

export async function recordClientChange(clientId: string, summary: string, who: string = 'Admin') {
    const { error } = await supabase
        .from('order_history')
        .insert([{
            client_id: clientId,
            who: who,
            summary: summary,
            timestamp: new Date().toISOString()
        }]);

    if (error) {
        console.error('Error recording audit log:', error);
    }
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
    if (!data || data.length === 0) return [];

    return data.map((d: any) => ({
        id: d.id,
        clientId: d.client_id || d.clientId,
        who: d.who,
        summary: d.summary,
        timestamp: d.timestamp || d.created_at || new Date().toISOString()
    }));
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

    // Fetch order details separately if order_id exists
    const billingRecords = data || [];
    const recordsWithOrderData = await Promise.all(
        billingRecords.map(async (d: any) => {
            let deliveryDate: string | undefined = undefined;
            
            if (d.order_id) {
                const { data: orderData, error: orderError } = await supabase
                    .from('orders')
                    .select('scheduled_delivery_date, actual_delivery_date')
                    .eq('id', d.order_id)
                    .single();
                
                if (!orderError && orderData) {
                    // Prefer actual_delivery_date, fallback to scheduled_delivery_date
                    deliveryDate = orderData.actual_delivery_date || orderData.scheduled_delivery_date || undefined;
                }
            }

            return {
                id: d.id,
                clientId: d.client_id,
                clientName: d.client_name,
                status: d.status,
                remarks: d.remarks,
                navigator: d.navigator,
                amount: d.amount,
                createdAt: d.created_at,
                orderId: d.order_id || undefined,
                deliveryDate: deliveryDate
            };
        })
    );

    return recordsWithOrderData;
}

export async function getAllBillingRecords() {
    const { data, error } = await supabase
        .from('billing_records')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching all billing records:', error);
        return [];
    }

    // Fetch order details separately if order_id exists
    const billingRecords = data || [];
    const recordsWithOrderData = await Promise.all(
        billingRecords.map(async (d: any) => {
            let deliveryDate: string | undefined = undefined;
            
            if (d.order_id) {
                const { data: orderData, error: orderError } = await supabase
                    .from('orders')
                    .select('scheduled_delivery_date, actual_delivery_date')
                    .eq('id', d.order_id)
                    .single();
                
                if (!orderError && orderData) {
                    // Prefer actual_delivery_date, fallback to scheduled_delivery_date
                    deliveryDate = orderData.actual_delivery_date || orderData.scheduled_delivery_date || undefined;
                }
            }

            return {
                id: d.id,
                clientId: d.client_id,
                clientName: d.client_name,
                status: d.status,
                remarks: d.remarks,
                navigator: d.navigator,
                amount: d.amount,
                createdAt: d.created_at,
                orderId: d.order_id || undefined,
                deliveryDate: deliveryDate
            };
        })
    );

    return recordsWithOrderData;
}

// --- UPCOMING ORDERS ACTIONS ---

/**
 * Calculate the take effect date (second occurrence of vendor delivery day)
 * Returns a Date object or null if vendor has no delivery days
 */
function calculateTakeEffectDate(vendorId: string, vendors: Vendor[]): Date | null {
    if (!vendorId) return null;

    const vendor = vendors.find(v => v.id === vendorId);
    if (!vendor || !vendor.deliveryDays || vendor.deliveryDays.length === 0) {
        return null;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dayNameToNumber: { [key: string]: number } = {
        'Sunday': 0,
        'Monday': 1,
        'Tuesday': 2,
        'Wednesday': 3,
        'Thursday': 4,
        'Friday': 5,
        'Saturday': 6
    };

    const deliveryDayNumbers = vendor.deliveryDays
        .map(day => dayNameToNumber[day])
        .filter(num => num !== undefined) as number[];

    if (deliveryDayNumbers.length === 0) return null;

    // Find the second occurrence (next next delivery day, starting from tomorrow)
    let foundCount = 0;
    for (let i = 1; i <= 21; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        const dayOfWeek = checkDate.getDay();

        if (deliveryDayNumbers.includes(dayOfWeek)) {
            foundCount++;
            if (foundCount === 2) {
                return checkDate;
            }
        }
    }

    return null;
}

/**
 * Calculate the earliest take effect date from multiple vendors (for Food orders with multiple vendors)
 */
function calculateEarliestTakeEffectDate(vendorIds: string[], vendors: Vendor[]): Date | null {
    const dates: Date[] = [];
    
    for (const vendorId of vendorIds) {
        const date = calculateTakeEffectDate(vendorId, vendors);
        if (date) dates.push(date);
    }

    if (dates.length === 0) return null;
    return dates.reduce((earliest, current) => current < earliest ? current : earliest);
}

/**
 * Sync Current Order Request (activeOrder) to upcoming_orders table
 * This ensures upcoming_orders always reflects the latest order configuration
 */
export async function syncCurrentOrderToUpcoming(clientId: string, client: ClientProfile) {
    if (!client.activeOrder || !client.activeOrder.caseId) {
        // If no active order or case ID, remove any existing upcoming order
        await supabase.from('upcoming_orders').delete().eq('client_id', clientId);
        return;
    }

    const orderConfig = client.activeOrder;
    const vendors = await getVendors();
    const menuItems = await getMenuItems();
    const boxTypes = await getBoxTypes();

    // Calculate take effect date
    let takeEffectDate: Date | null = null;
    let scheduledDeliveryDate: Date | null = null;

    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0) {
        const vendorIds = orderConfig.vendorSelections
            .map((s: any) => s.vendorId)
            .filter((id: string) => id);
        
        if (vendorIds.length > 0) {
            takeEffectDate = calculateEarliestTakeEffectDate(vendorIds, vendors);
            // For Food orders, scheduled_delivery_date can be the first delivery date
            const firstVendorId = vendorIds[0];
            const firstDate = calculateTakeEffectDate(firstVendorId, vendors);
            if (firstDate) {
                // Go back to first occurrence for scheduled delivery
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const vendor = vendors.find(v => v.id === firstVendorId);
                if (vendor && vendor.deliveryDays) {
                    const dayNameToNumber: { [key: string]: number } = {
                        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                        'Thursday': 4, 'Friday': 5, 'Saturday': 6
                    };
                    const deliveryDayNumbers = vendor.deliveryDays
                        .map((day: string) => dayNameToNumber[day])
                        .filter((num: number | undefined): num is number => num !== undefined);
                    
                    for (let i = 0; i <= 14; i++) {
                        const checkDate = new Date(today);
                        checkDate.setDate(today.getDate() + i);
                        if (deliveryDayNumbers.includes(checkDate.getDay())) {
                            scheduledDeliveryDate = checkDate;
                            break;
                        }
                    }
                }
            }
        }
    } else if (orderConfig.serviceType === 'Boxes' && (orderConfig as any).vendorId) {
        takeEffectDate = calculateTakeEffectDate((orderConfig as any).vendorId, vendors);
        // For Box orders, scheduled_delivery_date is also the first delivery date
        const vendor = vendors.find(v => v.id === (orderConfig as any).vendorId);
        if (vendor && vendor.deliveryDays) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const dayNameToNumber: { [key: string]: number } = {
                'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                'Thursday': 4, 'Friday': 5, 'Saturday': 6
            };
            const deliveryDayNumbers = vendor.deliveryDays
                .map((day: string) => dayNameToNumber[day])
                .filter((num: number | undefined): num is number => num !== undefined);
            
            for (let i = 0; i <= 14; i++) {
                const checkDate = new Date(today);
                checkDate.setDate(today.getDate() + i);
                if (deliveryDayNumbers.includes(checkDate.getDay())) {
                    scheduledDeliveryDate = checkDate;
                    break;
                }
            }
        }
    }

    // If we can't calculate take effect date, don't create upcoming order
    if (!takeEffectDate || !scheduledDeliveryDate) {
        await supabase.from('upcoming_orders').delete().eq('client_id', clientId);
        return;
    }

    // Calculate totals
    let totalValue = 0;
    let totalItems = 0;

    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections) {
        for (const selection of orderConfig.vendorSelections) {
            if (!selection.items) continue;
            for (const [itemId, qty] of Object.entries(selection.items)) {
                const item = menuItems.find(i => i.id === itemId);
                const quantity = qty as number;
                if (item && quantity > 0) {
                    totalValue += item.value * quantity;
                    totalItems += quantity;
                }
            }
        }
    } else if (orderConfig.serviceType === 'Boxes') {
        totalItems = orderConfig.boxQuantity || 0;
        // Box value calculation can be added if needed
    }

    // Upsert upcoming order (update if exists, insert if not)
    const upcomingOrderData: any = {
        client_id: clientId,
        service_type: orderConfig.serviceType,
        case_id: orderConfig.caseId,
        status: 'scheduled',
        last_updated: orderConfig.lastUpdated || new Date().toISOString(),
        updated_by: orderConfig.updatedBy || 'Admin',
        scheduled_delivery_date: scheduledDeliveryDate.toISOString().split('T')[0],
        take_effect_date: takeEffectDate.toISOString().split('T')[0],
        delivery_distribution: orderConfig.deliveryDistribution || null,
        total_value: totalValue,
        total_items: totalItems,
        notes: null
    };

    // Check if upcoming order exists
    const { data: existing } = await supabase
        .from('upcoming_orders')
        .select('id')
        .eq('client_id', clientId)
        .single();

    let upcomingOrderId: string;

    if (existing) {
        // Update existing
        const { data, error } = await supabase
            .from('upcoming_orders')
            .update(upcomingOrderData)
            .eq('id', existing.id)
            .select()
            .single();
        
        if (error) {
            console.error('Error updating upcoming order:', error);
            return;
        }
        upcomingOrderId = data.id;
    } else {
        // Insert new
        const { data, error } = await supabase
            .from('upcoming_orders')
            .insert(upcomingOrderData)
            .select()
            .single();
        
        if (error) {
            console.error('Error creating upcoming order:', error);
            return;
        }
        upcomingOrderId = data.id;
    }

    // Now sync related data (vendor selections, items, box selections)
    // Delete existing related records
    await supabase.from('upcoming_order_vendor_selections').delete().eq('upcoming_order_id', upcomingOrderId);
    await supabase.from('upcoming_order_items').delete().eq('upcoming_order_id', upcomingOrderId);
    await supabase.from('upcoming_order_box_selections').delete().eq('upcoming_order_id', upcomingOrderId);

    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections) {
        // Insert vendor selections and items
        for (const selection of orderConfig.vendorSelections) {
            if (!selection.vendorId || !selection.items) continue;

            const { data: vendorSelection, error: vsError } = await supabase
                .from('upcoming_order_vendor_selections')
                .insert({
                    upcoming_order_id: upcomingOrderId,
                    vendor_id: selection.vendorId
                })
                .select()
                .single();

            if (vsError || !vendorSelection) continue;

            // Insert items
            for (const [itemId, qty] of Object.entries(selection.items)) {
                const item = menuItems.find(i => i.id === itemId);
                const quantity = qty as number;
                if (item && quantity > 0) {
                    await supabase.from('upcoming_order_items').insert({
                        upcoming_order_id: upcomingOrderId,
                        vendor_selection_id: vendorSelection.id,
                        menu_item_id: itemId,
                        quantity: quantity,
                        unit_value: item.value,
                        total_value: item.value * quantity
                    });
                }
            }
        }
    } else if (orderConfig.serviceType === 'Boxes' && orderConfig.boxTypeId) {
        // Insert box selection
        await supabase.from('upcoming_order_box_selections').insert({
            upcoming_order_id: upcomingOrderId,
            box_type_id: orderConfig.boxTypeId,
            vendor_id: (orderConfig as any).vendorId || null,
            quantity: orderConfig.boxQuantity || 1
        });
    }
}

/**
 * Process upcoming orders that have reached their take effect date
 * Moves them from upcoming_orders to orders table
 */
export async function processUpcomingOrders() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Find all upcoming orders where take_effect_date <= today and status is 'scheduled'
    const { data: upcomingOrders, error: fetchError } = await supabase
        .from('upcoming_orders')
        .select('*')
        .eq('status', 'scheduled')
        .lte('take_effect_date', todayStr);

    if (fetchError) {
        console.error('Error fetching upcoming orders:', fetchError);
        return { processed: 0, errors: [] };
    }

    if (!upcomingOrders || upcomingOrders.length === 0) {
        return { processed: 0, errors: [] };
    }

    const menuItems = await getMenuItems();
    const errors: string[] = [];
    let processedCount = 0;

    for (const upcomingOrder of upcomingOrders) {
        try {
            // Create order in orders table
            const orderData: any = {
                client_id: upcomingOrder.client_id,
                service_type: upcomingOrder.service_type,
                case_id: upcomingOrder.case_id,
                status: 'pending',
                last_updated: new Date().toISOString(),
                updated_by: upcomingOrder.updated_by,
                scheduled_delivery_date: upcomingOrder.scheduled_delivery_date,
                delivery_distribution: upcomingOrder.delivery_distribution,
                total_value: upcomingOrder.total_value,
                total_items: upcomingOrder.total_items,
                notes: upcomingOrder.notes
            };

            const { data: newOrder, error: orderError } = await supabase
                .from('orders')
                .insert(orderData)
                .select()
                .single();

            if (orderError || !newOrder) {
                errors.push(`Failed to create order for client ${upcomingOrder.client_id}: ${orderError?.message}`);
                continue;
            }

            // Copy vendor selections and items (for Food orders)
            const { data: vendorSelections } = await supabase
                .from('upcoming_order_vendor_selections')
                .select('*')
                .eq('upcoming_order_id', upcomingOrder.id);

            if (vendorSelections) {
                for (const vs of vendorSelections) {
                    const { data: newVs, error: vsError } = await supabase
                        .from('order_vendor_selections')
                        .insert({
                            order_id: newOrder.id,
                            vendor_id: vs.vendor_id
                        })
                        .select()
                        .single();

                    if (vsError || !newVs) continue;

                    // Copy items
                    const { data: items } = await supabase
                        .from('upcoming_order_items')
                        .select('*')
                        .eq('vendor_selection_id', vs.id);

                    if (items) {
                        for (const item of items) {
                            await supabase.from('order_items').insert({
                                order_id: newOrder.id,
                                vendor_selection_id: newVs.id,
                                menu_item_id: item.menu_item_id,
                                quantity: item.quantity,
                                unit_value: item.unit_value,
                                total_value: item.total_value
                            });
                        }
                    }
                }
            }

            // Copy box selections (for Box orders)
            const { data: boxSelections } = await supabase
                .from('upcoming_order_box_selections')
                .select('*')
                .eq('upcoming_order_id', upcomingOrder.id);

            if (boxSelections) {
                for (const bs of boxSelections) {
                    await supabase.from('order_box_selections').insert({
                        order_id: newOrder.id,
                        box_type_id: bs.box_type_id,
                        vendor_id: bs.vendor_id,
                        quantity: bs.quantity
                    });
                }
            }

            // Update upcoming order status
            await supabase
                .from('upcoming_orders')
                .update({
                    status: 'processed',
                    processed_order_id: newOrder.id,
                    processed_at: new Date().toISOString()
                })
                .eq('id', upcomingOrder.id);

            processedCount++;
        } catch (error: any) {
            errors.push(`Error processing upcoming order ${upcomingOrder.id}: ${error.message}`);
        }
    }

    revalidatePath('/clients');
    return { processed: processedCount, errors };
}

/**
 * Get active order from orders table for a client
 * This is used for "This Week's Order" display
 * Returns orders with scheduled_delivery_date in the current week, or orders created/updated this week
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

        // Try to get order with scheduled_delivery_date in current week first
        let { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('client_id', clientId)
            .in('status', ['pending', 'confirmed', 'processing'])
            .gte('scheduled_delivery_date', startOfWeekStr)
            .lte('scheduled_delivery_date', endOfWeekStr)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        // If no order found with scheduled_delivery_date in current week,
        // try to get order created or updated this week (fallback)
        if (!data) {
            // Log error if it's not just "no rows returned"
            if (error && error.code !== 'PGRST116') {
                console.error('Error fetching order by scheduled_delivery_date:', error);
            }
            
            // Try fetching by created_at in current week
            const { data: dataByCreated, error: errorByCreated } = await supabase
                .from('orders')
                .select('*')
                .eq('client_id', clientId)
                .in('status', ['pending', 'confirmed', 'processing'])
                .gte('created_at', startOfWeekISO)
                .lte('created_at', endOfWeekISO)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (errorByCreated && errorByCreated.code !== 'PGRST116') {
                console.error('Error fetching order by created_at:', errorByCreated);
            }

            // If still no data, try by last_updated
            if (!dataByCreated) {
                const { data: dataByUpdated, error: errorByUpdated } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('client_id', clientId)
                    .in('status', ['pending', 'confirmed', 'processing'])
                    .gte('last_updated', startOfWeekISO)
                    .lte('last_updated', endOfWeekISO)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();

                if (errorByUpdated && errorByUpdated.code !== 'PGRST116') {
                    console.error('Error fetching order by last_updated:', errorByUpdated);
                }

                data = dataByUpdated;
            } else {
                data = dataByCreated;
            }
        }

        if (!data) {
            // No active order found
            return null;
        }

        // Fetch related data
        const menuItems = await getMenuItems();
        const vendors = await getVendors();
        const boxTypes = await getBoxTypes();

        // Build order configuration object
        const orderConfig: any = {
            id: data.id,
            serviceType: data.service_type,
            caseId: data.case_id,
            status: data.status,
            lastUpdated: data.last_updated,
            updatedBy: data.updated_by,
            scheduledDeliveryDate: data.scheduled_delivery_date,
            createdAt: data.created_at,
            deliveryDistribution: data.delivery_distribution,
            totalValue: data.total_value,
            totalItems: data.total_items,
            notes: data.notes
        };

        if (data.service_type === 'Food') {
            // Fetch vendor selections and items
            const { data: vendorSelections, error: vendorSelectionsError } = await supabase
                .from('order_vendor_selections')
                .select('*')
                .eq('order_id', data.id);

            if (vendorSelectionsError) {
                console.error('Error fetching vendor selections:', vendorSelectionsError);
            }

            if (vendorSelections && vendorSelections.length > 0) {
                orderConfig.vendorSelections = [];
                for (const vs of vendorSelections) {
                    const { data: items, error: itemsError } = await supabase
                        .from('order_items')
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
        } else if (data.service_type === 'Boxes') {
            // Fetch box selection
            const { data: boxSelection, error: boxSelectionError } = await supabase
                .from('order_box_selections')
                .select('*')
                .eq('order_id', data.id)
                .maybeSingle();

            if (boxSelectionError && boxSelectionError.code !== 'PGRST116') {
                console.error('Error fetching box selection:', boxSelectionError);
            }

            if (boxSelection) {
                orderConfig.vendorId = boxSelection.vendor_id;
                orderConfig.boxTypeId = boxSelection.box_type_id;
                orderConfig.boxQuantity = boxSelection.quantity;
            }
        }

        return orderConfig;
    } catch (err) {
        console.error('Error in getActiveOrderForClient:', err);
        return null;
    }
}

/**
 * Get upcoming order from upcoming_orders table for a client
 * This is used for "Current Order Request" form
 */
export async function getUpcomingOrderForClient(clientId: string) {
    if (!clientId) return null;

    // Fetch the upcoming order for this client
    const { data, error } = await supabase
        .from('upcoming_orders')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'scheduled')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (error || !data) {
        // No upcoming order found
        return null;
    }

    // Fetch related data
    const menuItems = await getMenuItems();
    const vendors = await getVendors();
    const boxTypes = await getBoxTypes();

    // Build order configuration object
    const orderConfig: any = {
        id: data.id,
        serviceType: data.service_type,
        caseId: data.case_id,
        status: data.status,
        lastUpdated: data.last_updated,
        updatedBy: data.updated_by,
        scheduledDeliveryDate: data.scheduled_delivery_date,
        takeEffectDate: data.take_effect_date,
        deliveryDistribution: data.delivery_distribution,
        totalValue: data.total_value,
        totalItems: data.total_items,
        notes: data.notes
    };

    if (data.service_type === 'Food') {
        // Fetch vendor selections and items
        const { data: vendorSelections } = await supabase
            .from('upcoming_order_vendor_selections')
            .select('*')
            .eq('upcoming_order_id', data.id);

        if (vendorSelections) {
            orderConfig.vendorSelections = [];
            for (const vs of vendorSelections) {
                const { data: items } = await supabase
                    .from('upcoming_order_items')
                    .select('*')
                    .eq('vendor_selection_id', vs.id);

                const itemsMap: any = {};
                if (items) {
                    for (const item of items) {
                        itemsMap[item.menu_item_id] = item.quantity;
                    }
                }

                orderConfig.vendorSelections.push({
                    vendorId: vs.vendor_id,
                    items: itemsMap
                });
            }
        }
    } else if (data.service_type === 'Boxes') {
        // Fetch box selection
        const { data: boxSelection } = await supabase
            .from('upcoming_order_box_selections')
            .select('*')
            .eq('upcoming_order_id', data.id)
            .single();

        if (boxSelection) {
            orderConfig.vendorId = boxSelection.vendor_id;
            orderConfig.boxTypeId = boxSelection.box_type_id;
            orderConfig.boxQuantity = boxSelection.quantity;
        }
    }

    return orderConfig;
}