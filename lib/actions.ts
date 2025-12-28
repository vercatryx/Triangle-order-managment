'use server';

import { revalidatePath } from 'next/cache';
import { supabase } from './supabase';
import { ClientStatus, Vendor, MenuItem, BoxType, AppSettings, Navigator, ClientProfile, DeliveryRecord, ItemCategory, BoxQuota } from './types';
import { randomUUID } from 'crypto';
import { getSession } from './session';

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
        isActive: v.is_active,
        minimumOrder: v.minimum_order ?? 0
    }));
}

export async function addVendor(data: Omit<Vendor, 'id'>) {
    const payload = {
        name: data.name,
        service_type: data.serviceType,
        delivery_days: data.deliveryDays,
        delivery_frequency: data.allowsMultipleDeliveries ? 'Multiple' : 'Once',
        is_active: data.isActive,
        minimum_order: data.minimumOrder ?? 0
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
    if (data.minimumOrder !== undefined) payload.minimum_order = data.minimumOrder;

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
        priceEach: i.price_each ?? undefined,
        isActive: i.is_active,
        categoryId: i.category_id,
        quotaValue: i.quota_value,
        minimumOrder: i.minimum_order ?? 0
    }));
}

export async function addMenuItem(data: Omit<MenuItem, 'id'>) {
    const payload: any = {
        vendor_id: data.vendorId,
        name: data.name,
        value: data.value,
        is_active: data.isActive,
        category_id: data.categoryId,
        quota_value: data.quotaValue,
        minimum_order: data.minimumOrder ?? 0
    };
    if (data.priceEach !== undefined) {
        payload.price_each = data.priceEach;
    }
    const { data: res, error } = await supabase.from('menu_items').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateMenuItem(id: string, data: Partial<MenuItem>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.value !== undefined) payload.value = data.value;
    if (data.priceEach !== undefined) payload.price_each = data.priceEach;
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
        vendorId: b.vendor_id || null,
        priceEach: b.price_each ?? undefined
    }));
}

export async function addBoxType(data: Omit<BoxType, 'id'>) {
    const payload: any = {
        name: data.name,
        is_active: data.isActive,
        vendor_id: data.vendorId || null
    };
    if (data.priceEach !== undefined) {
        payload.price_each = data.priceEach;
    }
    const { data: res, error } = await supabase.from('box_types').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateBoxType(id: string, data: Partial<BoxType>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.vendorId !== undefined) payload.vendor_id = data.vendorId;
    if (data.priceEach !== undefined) payload.price_each = data.priceEach;

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
        
        // Trigger local DB sync in background after mutation
        const { triggerSyncInBackground } = await import('./local-db');
        triggerSyncInBackground();
        
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
    
    // If activeOrder was updated, sync to upcoming_orders
    if (data.activeOrder) {
        const updatedClient = await getClient(id);
        if (updatedClient) {
            await syncCurrentOrderToUpcoming(id, updatedClient);
        }
    } else {
        // Trigger local DB sync in background even if activeOrder wasn't updated
        // (other changes might affect orders indirectly)
        const { triggerSyncInBackground } = await import('./local-db');
        triggerSyncInBackground();
    }
    
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

export async function recordClientChange(clientId: string, summary: string, who?: string) {
    // Get current user from session if who is not provided
    let userName = who;
    if (!userName || userName === 'Admin') {
        const session = await getSession();
        userName = session?.name || 'Admin';
    }

    const { error } = await supabase
        .from('order_history')
        .insert([{
            client_id: clientId,
            who: userName,
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
                        // Fetch vendor selections and items
                        const { data: vendorSelections } = await supabase
                            .from('order_vendor_selections')
                            .select('*')
                            .eq('order_id', d.order_id);

                        if (vendorSelections && vendorSelections.length > 0) {
                            const vendorSelectionsWithItems = await Promise.all(
                                vendorSelections.map(async (vs: any) => {
                                    const { data: items } = await supabase
                                        .from('order_items')
                                        .select('*')
                                        .eq('vendor_selection_id', vs.id);

                                    const vendor = vendors.find(v => v.id === vs.vendor_id);
                                    const itemsWithDetails = (items || []).map((item: any) => {
                                        const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                        // Use priceEach if available, otherwise fall back to stored unit_value
                                        const itemPrice = menuItem?.priceEach ?? parseFloat(item.unit_value);
                                        const quantity = item.quantity;
                                        const itemTotal = itemPrice * quantity;
                                        return {
                                            id: item.id,
                                            menuItemId: item.menu_item_id,
                                            menuItemName: menuItem?.name || 'Unknown Item',
                                            quantity: quantity,
                                            unitValue: itemPrice,
                                            totalValue: itemTotal
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

export async function getAllBillingRecords() {
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
    } else if (orderConfig.serviceType === 'Boxes' && orderConfig.boxTypeId) {
        // For Boxes orders, get vendorId from orderConfig or from boxType
        let boxVendorId = (orderConfig as any).vendorId;
        if (!boxVendorId && orderConfig.boxTypeId) {
            const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
            boxVendorId = boxType?.vendorId || null;
        }
        
        if (boxVendorId) {
            takeEffectDate = calculateTakeEffectDate(boxVendorId, vendors);
            // For Box orders, scheduled_delivery_date is also the first delivery date
            const vendor = vendors.find(v => v.id === boxVendorId);
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
    } else if (orderConfig.serviceType === 'Boxes' && orderConfig.boxTypeId) {
        totalItems = orderConfig.boxQuantity || 0;
        // Calculate total from box item prices if available
        const items = (orderConfig as any).items || {};
        const itemPrices = (orderConfig as any).itemPrices || {};
        let boxItemsTotal = 0;
        for (const [itemId, qty] of Object.entries(items)) {
            const quantity = typeof qty === 'number' ? qty : 0;
            const price = itemPrices[itemId];
            if (price !== undefined && price !== null && quantity > 0) {
                boxItemsTotal += price * quantity;
            }
        }
        // Use box items total if available, otherwise fall back to box type price
        if (boxItemsTotal > 0) {
            totalValue = boxItemsTotal;
        } else {
            const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
            if (boxType && boxType.priceEach) {
                totalValue = boxType.priceEach * totalItems;
            }
        }
    }

    // Get current user from session for updated_by
    const session = await getSession();
    const currentUserName = session?.name || 'Admin';
    // Use session user name if updatedBy is not provided or is 'Admin'
    const updatedBy = (orderConfig.updatedBy && orderConfig.updatedBy !== 'Admin') ? orderConfig.updatedBy : currentUserName;

    // Upsert upcoming order (update if exists, insert if not)
    const upcomingOrderData: any = {
        client_id: clientId,
        service_type: orderConfig.serviceType,
        case_id: orderConfig.caseId,
        status: 'scheduled',
        last_updated: orderConfig.lastUpdated || new Date().toISOString(),
        updated_by: updatedBy,
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
        // Insert box selection with prices
        const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
        const quantity = orderConfig.boxQuantity || 1;
        const unitValue = boxType?.priceEach || 0;
        const totalValueForBox = unitValue * quantity;
        
        // Get vendorId from orderConfig or from boxType
        const boxVendorId = (orderConfig as any).vendorId || boxType?.vendorId || null;
        
        // Get box items and prices from orderConfig
        // Store items in format: { [itemId]: { quantity: number, price?: number } }
        const boxItemsRaw = (orderConfig as any).items || {};
        const boxItemPrices = (orderConfig as any).itemPrices || {};
        const boxItems: any = {};
        for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
            const price = boxItemPrices[itemId];
            if (price !== undefined && price !== null) {
                boxItems[itemId] = { quantity: qty, price: price };
            } else {
                // Backward compatibility: store as number if no price
                boxItems[itemId] = qty;
            }
        }
        
        // Calculate total from item prices if available
        let calculatedTotal = totalValueForBox;
        if (Object.keys(boxItemPrices).length > 0) {
            calculatedTotal = 0;
            for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
                const quantity = typeof qty === 'number' ? qty : 0;
                const price = boxItemPrices[itemId];
                if (price !== undefined && price !== null && quantity > 0) {
                    calculatedTotal += price * quantity;
                }
            }
        }
        
        await supabase.from('upcoming_order_box_selections').insert({
            upcoming_order_id: upcomingOrderId,
            box_type_id: orderConfig.boxTypeId,
            vendor_id: boxVendorId,
            quantity: quantity,
            unit_value: unitValue,
            total_value: calculatedTotal,
            items: boxItems
        });
    }

    // Check if there's an upcoming_order with scheduled_delivery_date matching take_effect_date
    // If the existing upcoming_order has a different scheduled_delivery_date, 
    // update it to have scheduled_delivery_date = take_effect_date
    const takeEffectDateStr = takeEffectDate.toISOString().split('T')[0];
    const currentScheduledDateStr = scheduledDeliveryDate.toISOString().split('T')[0];
    
    // Check if scheduled_delivery_date already matches take_effect_date
    if (currentScheduledDateStr !== takeEffectDateStr && takeEffectDate) {
        // Check if there's already an upcoming_order with scheduled_delivery_date = take_effect_date
        const { data: existingUpcomingOrderWithTakeEffect } = await supabase
            .from('upcoming_orders')
            .select('id')
            .eq('client_id', clientId)
            .eq('scheduled_delivery_date', takeEffectDateStr)
            .limit(1);

        // If no upcoming_order exists with scheduled_delivery_date matching take_effect_date, 
        // update the existing one we just created
        if ((!existingUpcomingOrderWithTakeEffect || existingUpcomingOrderWithTakeEffect.length === 0) && upcomingOrderId) {
            try {
                // Update the existing upcoming_order to have scheduled_delivery_date = take_effect_date
                const { error: updateError } = await supabase
                    .from('upcoming_orders')
                    .update({
                        scheduled_delivery_date: takeEffectDateStr
                    })
                    .eq('id', upcomingOrderId);

                if (updateError) {
                    console.error('Error updating upcoming order scheduled_delivery_date:', updateError);
                }
            } catch (error: any) {
                console.error('Error updating upcoming order with take_effect_date:', error);
            }
        }
    }
    
    // Trigger local DB sync in background after mutation
    const { triggerSyncInBackground } = await import('./local-db');
    triggerSyncInBackground();
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
                        quantity: bs.quantity,
                        unit_value: bs.unit_value || 0,
                        total_value: bs.total_value || 0,
                        items: bs.items || {}
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
    
    // Trigger local DB sync in background after mutation
    const { triggerSyncInBackground } = await import('./local-db');
    triggerSyncInBackground();
    
    return { processed: processedCount, errors };
}

/**
 * Get active order from orders table for a client
 * This is used for "This Week's Order" display
 * Returns orders with scheduled_delivery_date in the current week, or orders created/updated this week
 * Now uses local database for fast access
 */
export async function getActiveOrderForClient(clientId: string) {
    if (!clientId) return null;

    try {
        // Use local database for fast access
        const { getActiveOrderForClientLocal } = await import('./local-db');
        return await getActiveOrderForClientLocal(clientId);
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