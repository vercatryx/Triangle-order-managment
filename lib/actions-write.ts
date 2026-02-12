'use server';

import { getCurrentTime } from './time';
import { revalidatePath } from 'next/cache';
import { cache as reactCache } from 'react';
import { supabase } from './supabase';
import { ClientStatus, Vendor, MenuItem, BoxType, AppSettings, Navigator, Nutritionist, ClientProfile, DeliveryRecord, ItemCategory, BoxQuota, ServiceType, Equipment, ClientFoodOrder, ClientMealOrder, ClientBoxOrder } from './types';
import { uploadFile, deleteFile } from './storage';
import { randomUUID } from 'crypto';
import { getSession } from './session';
import { createClient } from '@/lib/supabase';
import { roundCurrency } from './utils';
import { handleError, mapClientFromDB } from './client-mappers';
import { getVendors, getMenuItems, getMealItems, getEquipment, getBoxTypes, getClient, getVendorSession } from './actions-read';
import { syncSingleOrderForDeliveryDay, updateClientUpcomingOrder } from './actions';
import { getNextDeliveryDateForDay } from './order-dates';



export async function addStatus(name: string) {
    const { data, error } = await supabase
        .from('client_statuses')
        .insert([{ name, is_system_default: false, deliveries_allowed: true, requires_units_on_change: false }])
        .select()
        .single();

    handleError(error);
    revalidatePath('/admin');
    return {
        id: data.id,
        name: data.name,
        isSystemDefault: data.is_system_default,
        deliveriesAllowed: data.deliveries_allowed,
        requiresUnitsOnChange: data.requires_units_on_change ?? false
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
    if (data.requiresUnitsOnChange !== undefined) payload.requires_units_on_change = data.requiresUnitsOnChange;

    const { data: res, error } = await supabase
        .from('client_statuses')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

    handleError(error);
    revalidatePath('/admin');
    return {
        id: res.id,
        name: res.name,
        isSystemDefault: res.is_system_default,
        deliveriesAllowed: res.deliveries_allowed,
        requiresUnitsOnChange: res.requires_units_on_change ?? false
    };
}

export async function addVendor(data: Omit<Vendor, 'id'> & { password?: string; email?: string }) {
    const payload: any = {
        name: data.name,
        service_type: (data.serviceTypes || []).join(','),
        delivery_days: data.deliveryDays,
        delivery_frequency: data.allowsMultipleDeliveries ? 'Multiple' : 'Once',
        is_active: data.isActive,
        minimum_meals: data.minimumMeals ?? 0,
        cutoff_hours: data.cutoffDays ?? 0
    };

    if (data.email !== undefined && data.email !== null) {
        const trimmedEmail = data.email.trim();
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }

    if (data.password && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        payload.password = await hashPassword(data.password.trim());
    }

    const { data: res, error } = await supabase.from('vendors').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateVendor(id: string, data: Partial<Vendor & { password?: string }>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.serviceTypes) payload.service_type = data.serviceTypes.join(',');
    if (data.deliveryDays) payload.delivery_days = data.deliveryDays;
    if (data.allowsMultipleDeliveries !== undefined) {
        payload.delivery_frequency = data.allowsMultipleDeliveries ? 'Multiple' : 'Once';
    }
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.minimumMeals !== undefined) payload.minimum_meals = data.minimumMeals;
    if (data.cutoffDays !== undefined) payload.cutoff_hours = data.cutoffDays;
    if (data.email !== undefined) {
        // Trim email and set to null if empty string
        const trimmedEmail = data.email?.trim() || '';
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }
    // Only update password if it's provided and not empty
    // Empty string means "don't change password" (for edit forms)
    if (data.password !== undefined && data.password !== null && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        payload.password = await hashPassword(data.password.trim());
    }

    const { error } = await supabase.from('vendors').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteVendor(id: string) {
    const { error } = await supabase.from('vendors').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function addGlobalLocation(name: string) {
    // 1. Get current count of locations (before adding new one) to identify "full coverage" vendors
    const { count: existingCount, error: countError } = await supabase
        .from('locations')
        .select('*', { count: 'exact', head: true });

    if (countError) {
        handleError(countError);
        return;
    }

    // 2. Insert the new location
    const { data: newLocation, error: insertError } = await supabase
        .from('locations')
        .insert([{ name }])
        .select()
        .single();

    if (insertError) {
        handleError(insertError);
        return;
    }

    // 3. Find vendors that have ALL existing locations (count = existingCount)
    // We can use a raw query or a helper. Since we don't have many vendors, we can fetch all and filter, 
    // or do a smarter query. For simplicity and reliability with current setup:

    // Fetch all vendors with their location count
    // Note: Supabase JS doesn't easily do "select id, count(vendor_locations)", so we might need a workaround 
    // or just fetch all links. Given < 100 vendors, fetching all links is cheap.
    const { data: allLinks } = await supabase
        .from('vendor_locations')
        .select('vendor_id');

    if (allLinks && existingCount !== null) {
        const vendorCounts: Record<string, number> = {};
        allLinks.forEach(link => {
            vendorCounts[link.vendor_id] = (vendorCounts[link.vendor_id] || 0) + 1;
        });

        // Vendors who had *exactly* the old count (meaning they had everything)
        // If they had less, they are "custom". If they had more (impossible), well.
        const fullCoverageVendorIds = Object.keys(vendorCounts).filter(vid => vendorCounts[vid] === existingCount);

        if (fullCoverageVendorIds.length > 0) {
            console.log(`Auto-assigning new location "${name}" to ${fullCoverageVendorIds.length} full-coverage vendors.`);
            const newLinks = fullCoverageVendorIds.map(vid => ({
                vendor_id: vid,
                location_id: newLocation.id
            }));

            const { error: linkError } = await supabase
                .from('vendor_locations')
                .insert(newLinks);

            if (linkError) console.error('Error auto-assigning location:', linkError);
        }
    }

    handleError(insertError);
    revalidatePath('/admin');
    return {
        id: newLocation.id,
        name: newLocation.name
    };
}

export async function deleteGlobalLocation(id: string) {
    const { error } = await supabase.from('locations').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function addVendorLocation(vendorId: string, locationId: string) {
    const { data, error } = await supabase
        .from('vendor_locations')
        .insert([{
            vendor_id: vendorId,
            location_id: locationId
        }])
        .select(`
            id,
            vendor_id,
            location_id,
            locations (
                name
            )
        `)
        .single();

    handleError(error);
    if (!data) {
        throw new Error('Failed to create vendor location');
    }
    revalidatePath('/admin');
    const location = Array.isArray(data.locations) ? data.locations[0] : data.locations;
    return {
        id: data.id,
        vendorId: data.vendor_id,
        locationId: data.location_id,
        name: location?.name || 'Unknown'
    };
}

export async function deleteVendorLocation(id: string) {
    const { error } = await supabase.from('vendor_locations').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function uploadMenuItemImage(formData: FormData) {
    const file = formData.get('file') as File;
    if (!file) {
        throw new Error('No file provided');
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const extension = file.name.split('.').pop();
    // Use a clean filename
    const key = `menu-item-${timestamp}-${randomUUID()}.${extension}`;

    // Upload to R2
    // We reuse the uploadFile from storage.ts which uses process.env.R2_BUCKET_NAME by default
    // Ensure R2_BUCKET_NAME is set in environment or fallbacks
    const result = await uploadFile(key, buffer, file.type);

    if (!result.success) {
        throw new Error('Failed to upload image');
    }

    // Construct public URL
    // Priority: Env Var -> Hardcoded fallback (matches delivery action)
    const publicUrlBase = process.env.NEXT_PUBLIC_R2_DOMAIN || 'https://pub-820fa32211a14c0b8bdc7c41106bfa02.r2.dev';

    // Ensure no trailing slash for consistent path joining
    const baseUrl = publicUrlBase.endsWith('/') ? publicUrlBase.slice(0, -1) : publicUrlBase;
    const publicUrl = `${baseUrl}/${key}`;

    return { success: true, url: publicUrl };
}

export async function addMenuItem(data: Omit<MenuItem, 'id'>) {
    const payload: any = {
        vendor_id: data.vendorId || null,
        name: data.name,
        value: data.value,
        is_active: data.isActive,
        category_id: data.categoryId || null,
        quota_value: data.quotaValue,
        minimum_order: data.minimumOrder ?? 0,
        price_each: data.priceEach, // Mandatory
        image_url: data.imageUrl || null,
        sort_order: data.sortOrder ?? 0
    };

    if (!data.priceEach || data.priceEach <= 0) {
        throw new Error('Price is required and must be greater than 0');
    }
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
    if (data.categoryId !== undefined) payload.category_id = data.categoryId || null;
    if (data.quotaValue !== undefined) payload.quota_value = data.quotaValue;
    if (data.minimumOrder !== undefined) payload.minimum_order = data.minimumOrder;
    if (data.imageUrl !== undefined) payload.image_url = data.imageUrl;
    if (data.sortOrder !== undefined) payload.sort_order = data.sortOrder;

    if (data.vendorId !== undefined) payload.vendor_id = data.vendorId || null;

    // R2 Cleanup: If image is being updated/removed, delete the old one
    if (data.imageUrl !== undefined) {
        const { data: existing } = await supabase.from('menu_items').select('image_url').eq('id', id).single();
        const oldUrl = existing?.image_url;

        // If there was an old URL and it's different from the new one (or new one is null)
        if (oldUrl && oldUrl !== data.imageUrl) {
            try {
                const key = oldUrl.split('/').pop();
                if (key) await deleteFile(key);
            } catch (e) {
                console.error("Failed to delete stale image:", e);
            }
        }
    }

    const { error } = await supabase.from('menu_items').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteMenuItem(id: string) {
    // R2 Cleanup: Get image url before deleting
    const { data: item } = await supabase.from('menu_items').select('image_url').eq('id', id).single();

    const { error } = await supabase.from('menu_items').delete().eq('id', id);

    if (error) {
        // If the item is referenced by orders (FK violation 23503), we can't hard delete it.
        // Instead, we mark it as inactive (soft delete) so it doesn't appear in new order selections
        // but preserves history for existing orders.
        if (error.code === '23503') {
            const { error: updateError } = await supabase
                .from('menu_items')
                .update({ is_active: false })
                .eq('id', id);

            if (updateError) handleError(updateError);

            revalidatePath('/admin');
            return { success: false, message: 'Item is in use by existing orders. It has been deactivated instead of permanently deleted.' };
        }
        handleError(error);
    }
    if (item?.image_url) {
        try {
            const key = item.image_url.split('/').pop();
            if (key) await deleteFile(key);
        } catch (e) {
            console.error("Failed to delete image for deleted item:", e);
        }
    }

    revalidatePath('/admin');
    return { success: true };
}

export async function addCategory(name: string, setValue?: number | null) {
    const payload: any = { name };
    if (setValue !== undefined) {
        payload.set_value = setValue;
    }
    const { data, error } = await supabase.from('item_categories').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { id: data.id, name: data.name, setValue: data.set_value ?? undefined };
}

export async function deleteCategory(id: string) {
    const { error } = await supabase.from('item_categories').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function updateCategoryOrder(updates: { id: string; sortOrder: number }[]) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const promises = updates.map(({ id, sortOrder }) =>
        supabaseAdmin.from('item_categories').update({ sort_order: sortOrder }).eq('id', id)
    );
    await Promise.all(promises);
    revalidatePath('/admin');
    return { success: true };
}

export async function updateCategory(id: string, name: string, setValue?: number | null) {
    const payload: any = { name };
    if (setValue !== undefined) {
        payload.set_value = setValue;
    }
    const { error } = await supabase.from('item_categories').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
    revalidatePath('/admin');
}

export async function addMealCategory(mealType: string, name: string, setValue?: number | null) {
    const payload: any = {
        name,
        meal_type: mealType
    };
    if (setValue !== undefined) {
        payload.set_value = setValue;
    }
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: res, error } = await supabaseAdmin.from('breakfast_categories').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return {
        id: res.id,
        name: res.name,
        mealType: res.meal_type,
        setValue: res.set_value ?? undefined
    };
}

export async function updateMealCategory(id: string, name: string, setValue?: number | null) {
    const payload: any = { name };
    if (setValue !== undefined) {
        payload.set_value = setValue;
    }
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabaseAdmin.from('breakfast_categories').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteMealCategory(id: string) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabaseAdmin.from('breakfast_categories').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteMealType(mealType: string) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    // Delete all categories for this meal type. 
    // Items will cascade delete because of FK 'ON DELETE CASCADE' on breakfast_items.category_id
    const { error } = await supabaseAdmin
        .from('breakfast_categories')
        .delete()
        .eq('meal_type', mealType);

    handleError(error);
    revalidatePath('/admin');
}

export async function addMealItem(data: { categoryId: string, name: string, quotaValue: number, priceEach?: number, isActive: boolean, imageUrl?: string | null, sortOrder?: number }) {
    const payload: any = {
        category_id: data.categoryId,
        name: data.name,
        quota_value: data.quotaValue,
        is_active: data.isActive,
        image_url: data.imageUrl || null,
        sort_order: data.sortOrder ?? 0
    };
    if (data.priceEach !== undefined) {
        payload.price_each = data.priceEach;
    }

    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: res, error } = await supabaseAdmin.from('breakfast_items').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateMealItem(id: string, data: Partial<{ name: string, quotaValue: number, priceEach?: number, isActive: boolean, imageUrl?: string | null, sortOrder?: number }>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.quotaValue !== undefined) payload.quota_value = data.quotaValue;
    if (data.priceEach !== undefined) payload.price_each = data.priceEach;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.imageUrl !== undefined) payload.image_url = data.imageUrl;
    if (data.sortOrder !== undefined) payload.sort_order = data.sortOrder;

    // R2 Cleanup: If image is being updated/removed, delete the old one
    if (data.imageUrl !== undefined) {
        const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const { data: existing } = await supabaseAdmin.from('breakfast_items').select('image_url').eq('id', id).single();
        const oldUrl = existing?.image_url;

        if (oldUrl && oldUrl !== data.imageUrl) {
            try {
                const key = oldUrl.split('/').pop();
                if (key) await deleteFile(key);
            } catch (e) {
                console.error("Failed to delete stale meal image:", e);
            }
        }
    }

    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await supabaseAdmin.from('breakfast_items').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteMealItem(id: string) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: item } = await supabaseAdmin.from('breakfast_items').select('image_url').eq('id', id).single();
    const { error } = await supabaseAdmin.from('breakfast_items').delete().eq('id', id);
    if (!error && item?.image_url) {
        try {
            const key = item.image_url.split('/').pop();
            if (key) await deleteFile(key);
        } catch (e) {
            console.error("Failed to delete meal image:", e);
        }
    }
    handleError(error);
    revalidatePath('/admin');
}

export async function addEquipment(data: Omit<Equipment, 'id'>) {
    const payload: any = {
        name: data.name,
        price: data.price
    };
    if (data.vendorId !== undefined) {
        payload.vendor_id = data.vendorId || null;
    }
    const { data: res, error } = await supabase.from('equipment').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateEquipment(id: string, data: Partial<Equipment>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.price !== undefined) payload.price = data.price;
    if (data.vendorId !== undefined) payload.vendor_id = data.vendorId || null;
    const { error } = await supabase.from('equipment').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteEquipment(id: string) {
    const { error } = await supabase.from('equipment').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function saveEquipmentOrder(clientId: string, vendorId: string, equipmentId: string, caseId?: string) {
    // Get equipment item to calculate price
    const equipmentList = await getEquipment();
    const equipmentItem = equipmentList.find(e => e.id === equipmentId);
    if (!equipmentItem) {
        throw new Error('Equipment item not found');
    }

    // Get current user for updated_by
    const session = await getSession();
    const currentUserName = session?.name || 'Admin';

    // Calculate scheduled delivery date for vendor
    const vendors = await getVendors();
    const vendor = vendors.find(v => v.id === vendorId);
    let scheduledDeliveryDate: Date | null = null;

    if (vendor && vendor.deliveryDays && vendor.deliveryDays.length > 0) {
        const today = await getCurrentTime();
        // Reset to start of day for accurate day-of-week adding
        today.setHours(0, 0, 0, 0);
        const dayNameToNumber: { [key: string]: number } = {
            'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
            'Thursday': 4, 'Friday': 5, 'Saturday': 6
        };
        const deliveryDayNumbers = vendor.deliveryDays
            .map((day: string) => dayNameToNumber[day])
            .filter((num: number | undefined): num is number => num !== undefined);

        // Find next occurrence of any delivery day
        for (let i = 1; i <= 14; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);
            if (deliveryDayNumbers.includes(checkDate.getDay())) {
                scheduledDeliveryDate = checkDate;
                break;
            }
        }
    }

    // Store equipment selection in notes as JSON
    const equipmentSelection = {
        vendorId,
        equipmentId,
        equipmentName: equipmentItem.name,
        price: equipmentItem.price
    };

    // Equipment orders do not get a creation_id (only batch/weekly order creation does)
    // Create actual order in orders table (not upcoming_orders)
    const orderData: any = {
        client_id: clientId,
        service_type: 'Equipment',
        case_id: caseId || null,
        status: 'pending',
        last_updated: (await getCurrentTime()).toISOString(),
        updated_by: currentUserName,
        scheduled_delivery_date: scheduledDeliveryDate ? scheduledDeliveryDate.toISOString().split('T')[0] : null,
        total_value: equipmentItem.price,
        total_items: 1,
        notes: JSON.stringify(equipmentSelection),
        creation_id: null
    };

    const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert([orderData])
        .select()
        .single();

    handleError(orderError);

    // Ensure order_number is at least 6 digits (100000+)
    // The database default should handle this, but we'll verify and fix if needed
    if (newOrder && (!newOrder.order_number || newOrder.order_number < 100000)) {
        // Get the max order_number and ensure next is at least 6 digits
        const { data: maxOrder } = await supabase
            .from('orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .maybeSingle();

        const nextNumber = Math.max((maxOrder?.order_number || 99999) + 1, 100000);
        const { error: updateError } = await supabase
            .from('orders')
            .update({ order_number: nextNumber })
            .eq('id', newOrder.id);

        if (!updateError) {
            newOrder.order_number = nextNumber;
        }
    }

    // Also create a vendor selection record so it shows up in vendor tab
    // We'll use order_vendor_selections table for Equipment orders too
    if (newOrder) {
        const { error: vsError } = await supabase
            .from('order_vendor_selections')
            .insert({
                order_id: newOrder.id,
                vendor_id: vendorId
            });

        if (vsError) {
            console.error('Error creating vendor selection for equipment order:', vsError);
            // Don't fail the whole operation if this fails
        }
    }

    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/vendor`);
    return { success: true, orderId: newOrder.id };
}

export async function saveCustomOrder(clientId: string, vendorId: string, itemDescription: string, price: number, deliveryDay: string, caseId?: string) {
    // Get current user
    const session = await getSession();
    const currentUserName = session?.name || 'Admin';

    // Calculate scheduled delivery date based on selected day string (e.g., "Monday")
    // Use logic similar to equipment order but specific to the requested day
    const dayNameToNumber: { [key: string]: number } = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
        'Thursday': 4, 'Friday': 5, 'Saturday': 6
    };
    const targetDayNum = dayNameToNumber[deliveryDay];

    // Find next occurrence of this day
    const today = await getCurrentTime();
    today.setHours(0, 0, 0, 0);

    let scheduledDeliveryDate: Date | null = null;

    if (targetDayNum !== undefined) {
        for (let i = 1; i <= 14; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);
            if (checkDate.getDay() === targetDayNum) {
                scheduledDeliveryDate = checkDate;
                break;
            }
        }
    }

    // Get creation_id for this individual order
    const { getNextCreationId } = await import('./actions');
    const creationId = await getNextCreationId();

    // Create order record
    const orderData: any = {
        client_id: clientId,
        service_type: 'Custom',
        case_id: caseId || null,
        status: 'pending',
        last_updated: (await getCurrentTime()).toISOString(),
        updated_by: currentUserName,
        scheduled_delivery_date: scheduledDeliveryDate ? scheduledDeliveryDate.toISOString().split('T')[0] : null,
        total_value: price,
        total_items: 1,
        notes: `Custom Order: ${itemDescription}`,
        creation_id: creationId
    };

    const { data: newOrder, error: orderError } = await supabase
        .from('orders')
        .insert([orderData])
        .select()
        .single();

    if (orderError) throw new Error(orderError.message);

    // Initial Order Number fix
    if (newOrder && (!newOrder.order_number || newOrder.order_number < 100000)) {
        const { data: maxOrder } = await supabase
            .from('orders')
            .select('order_number')
            .order('order_number', { ascending: false })
            .limit(1)
            .maybeSingle();
        const nextNumber = Math.max((maxOrder?.order_number || 99999) + 1, 100000);
        await supabase.from('orders').update({ order_number: nextNumber }).eq('id', newOrder.id);
        newOrder.order_number = nextNumber;
    }

    // 1. Create Vendor Selection FIRST to get the ID
    const { data: vendorSelection, error: vsError } = await supabase
        .from('order_vendor_selections')
        .insert({
            order_id: newOrder.id,
            vendor_id: vendorId
        })
        .select()
        .single();

    if (vsError || !vendorSelection) {
        throw new Error('Failed to create vendor selection: ' + (vsError?.message || 'Unknown error'));
    }

    // 2. Insert into order_items linked to BOTH order and vendor selection
    // Requires schema update to support custom_name, custom_price and null menu_item_id
    const { error: itemError } = await supabase
        .from('order_items')
        .insert({
            order_id: newOrder.id,
            vendor_selection_id: vendorSelection.id, // LINKED HERE
            // menu_item_id left null
            custom_name: itemDescription,
            custom_price: price,
            quantity: 1,
            unit_value: 0,
            total_value: 0
        });

    if (itemError) {
        console.error('Error inserting custom order item:', itemError);
        // Might fail if constraint exists/schema not updated.
    }

    revalidatePath(`/clients/${clientId}`);
    // revalidatePath('/vendor'); // If used there
    return { success: true, orderId: newOrder.id };
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

export async function addBoxType(data: Omit<BoxType, 'id'>) {
    const payload: any = {
        name: data.name,
        is_active: data.isActive,
        price_each: data.priceEach ?? 1
    };

    if (data.priceEach !== undefined && data.priceEach <= 0) {
        throw new Error('Price must be greater than 0');
    }
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
            weekly_cutoff_time: settings.weeklyCutoffTime,
            report_email: settings.reportEmail || null,
            enable_passwordless_login: settings.enablePasswordlessLogin,
            send_vendor_next_week_emails: settings.sendVendorNextWeekEmails
        })
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Hack to update all rows

    if (error) console.error(error);
    revalidatePath('/admin');
}

export async function addNavigator(data: Omit<Navigator, 'id'>) {
    const payload: any = {
        name: data.name,
        is_active: data.isActive
    };

    if (data.email !== undefined && data.email !== null) {
        const trimmedEmail = data.email.trim();
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }

    if (data.password && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        payload.password = await hashPassword(data.password.trim());
    }

    const { data: res, error } = await supabase.from('navigators').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateNavigator(id: string, data: Partial<Navigator>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.isActive !== undefined) payload.is_active = data.isActive;

    if (data.email !== undefined) {
        const trimmedEmail = data.email?.trim() || '';
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }

    if (data.password !== undefined && data.password !== null && data.password.trim() !== '') {
        const { hashPassword } = await import('./password');
        payload.password = await hashPassword(data.password.trim());
    }

    const { error } = await supabase.from('navigators').update(payload).eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function deleteNavigator(id: string) {
    const { error } = await supabase.from('navigators').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function addNutritionist(data: Omit<Nutritionist, 'id'>) {
    const payload: any = {
        name: data.name
    };

    if (data.email !== undefined && data.email !== null) {
        const trimmedEmail = data.email.trim();
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }

    const { data: res, error } = await supabase.from('nutritionists').insert([payload]).select().single();
    handleError(error);
    revalidatePath('/admin');
    return { ...data, id: res.id };
}

export async function updateNutritionist(id: string, data: Partial<Nutritionist>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;

    if (data.email !== undefined) {
        const trimmedEmail = data.email?.trim() || '';
        payload.email = trimmedEmail === '' ? null : trimmedEmail;
    }

    const { data: res, error } = await supabase.from('nutritionists').update(payload).eq('id', id).select().single();
    handleError(error);
    revalidatePath('/admin');
    return {
        id: res.id,
        name: res.name,
        email: res.email || null
    };
}

export async function deleteNutritionist(id: string) {
    const { error } = await supabase.from('nutritionists').delete().eq('id', id);
    handleError(error);
    revalidatePath('/admin');
}

export async function addClient(data: Omit<ClientProfile, 'id' | 'createdAt' | 'updatedAt'>) {
    const payload: any = {
        full_name: data.fullName,
        email: data.email,
        address: data.address,
        phone_number: data.phoneNumber,
        secondary_phone_number: data.secondaryPhoneNumber || null,
        navigator_id: data.navigatorId || null,
        end_date: data.endDate,
        screening_took_place: data.screeningTookPlace,
        screening_signed: data.screeningSigned,
        notes: data.notes,
        status_id: data.statusId || null,
        service_type: data.serviceType,
        approved_meals_per_week: data.approvedMealsPerWeek || 0,
        authorized_amount: data.authorizedAmount !== null && data.authorizedAmount !== undefined ? roundCurrency(data.authorizedAmount) : null,
        expiration_date: data.expirationDate || null,
        location_id: data.locationId || null
    };

    if (data.upcomingOrder !== undefined && data.upcomingOrder !== null) {
        payload.upcoming_order = data.upcomingOrder;
    } else {
        payload.upcoming_order = null;
    }

    const { data: res, error } = await supabase.from('clients').insert([payload]).select().single();
    handleError(error);

    if (!res) {
        throw new Error('Failed to create client: no data returned');
    }

    const newClient = mapClientFromDB(res);

    if (newClient.upcomingOrder && (newClient.upcomingOrder as any).caseId) {
        await updateClientUpcomingOrder(newClient.id, newClient.upcomingOrder as any);
    }

    revalidatePath('/clients');

    // Targeted local DB sync for this client
    const { updateClientInLocalDB } = await import('./local-db');
    updateClientInLocalDB(newClient.id);

    return newClient;
}

export async function addDependent(name: string, parentClientId: string, dob?: string | null, cin?: string | null) {
    if (!name.trim() || !parentClientId) {
        throw new Error('Dependent name and parent client are required');
    }

    // Verify parent client exists and is not itself a dependent
    const parentClient = await getClient(parentClientId);
    if (!parentClient) {
        throw new Error('Parent client not found');
    }
    if (parentClient.parentClientId) {
        throw new Error('Cannot attach dependent to another dependent');
    }

    const payload = {
        full_name: name.trim(),
        email: null,
        address: '',
        phone_number: '',
        navigator_id: null,
        end_date: '',
        screening_took_place: false,
        screening_signed: false,
        notes: '',
        status_id: null,
        service_type: 'Food' as ServiceType, // Default service type
        approved_meals_per_week: 0,
        authorized_amount: null,
        expiration_date: null,
        upcoming_order: null,
        parent_client_id: parentClientId,
        dob: dob || null,
        cin: cin ?? null
    };

    const { data: res, error } = await supabase.from('clients').insert([payload]).select().single();
    handleError(error);

    if (!res) {
        throw new Error('Failed to create dependent: no data returned');
    }

    const newDependent = mapClientFromDB(res);

    revalidatePath('/clients');

    // Targeted local DB sync for this client
    const { updateClientInLocalDB } = await import('./local-db');
    updateClientInLocalDB(res.id);

    return newDependent;
}

export async function updateClient(id: string, data: Partial<ClientProfile>) {
    console.log('[updateClient] Server Action Received:', id);
    if (data.upcomingOrder) {
        console.log('[updateClient] Payload upcomingOrder mealSelections:', JSON.stringify((data.upcomingOrder as any).mealSelections, null, 2));
    }

    const payload: any = {};
    if (data.fullName) payload.full_name = data.fullName;
    if (data.email !== undefined) payload.email = data.email;
    if (data.address !== undefined) payload.address = data.address;
    if (data.phoneNumber !== undefined) payload.phone_number = data.phoneNumber;
    if (data.secondaryPhoneNumber !== undefined) payload.secondary_phone_number = data.secondaryPhoneNumber || null;
    if (data.navigatorId !== undefined) payload.navigator_id = data.navigatorId || null;
    if (data.endDate !== undefined) payload.end_date = data.endDate;
    if (data.screeningTookPlace !== undefined) payload.screening_took_place = data.screeningTookPlace;
    if (data.screeningSigned !== undefined) payload.screening_signed = data.screeningSigned;
    if (data.notes !== undefined) payload.notes = data.notes;
    if (data.statusId !== undefined) payload.status_id = data.statusId || null;
    if (data.serviceType) payload.service_type = data.serviceType;
    if (data.approvedMealsPerWeek !== undefined) payload.approved_meals_per_week = data.approvedMealsPerWeek;
    if (data.parentClientId !== undefined) payload.parent_client_id = data.parentClientId || null;
    if (data.dob !== undefined) payload.dob = data.dob || null;
    if (data.cin !== undefined) payload.cin = data.cin ?? null;
    if (data.authorizedAmount !== undefined) payload.authorized_amount = data.authorizedAmount !== null ? roundCurrency(data.authorizedAmount) : null;
    if (data.expirationDate !== undefined) payload.expiration_date = data.expirationDate || null;
    if (data.locationId !== undefined) payload.location_id = data.locationId || null;
    if (data.upcomingOrder !== undefined) payload.upcoming_order = data.upcomingOrder;

    payload.updated_at = new Date().toISOString();

    const { data: updatedData, error } = await supabase.from('clients').update(payload).eq('id', id).select().single();
    handleError(error);

    if (updatedData) {
        const { updateClientInLocalDB } = await import('./local-db');
        updateClientInLocalDB(id);
    }

    try {
        revalidatePath('/clients');
        revalidatePath(`/clients/${id}`);
    } catch (e) { }

    return updatedData ? mapClientFromDB(updatedData) : null;
}

export async function deleteClient(id: string) {
    // First, get all dependents of this client (if it's a parent client)
    const { data: dependents } = await supabase
        .from('clients')
        .select('id')
        .eq('parent_client_id', id);

    // Delete all dependents first (cascade delete)
    // Dependents cannot have their own dependents (enforced in addDependent),
    // so we can safely delete them directly
    if (dependents && dependents.length > 0) {
        const dependentIds = dependents.map(d => d.id);

        // Delete active orders for all dependents
        const { error: dependentActiveOrdersError } = await supabase
            .from('orders')
            .delete()
            .in('client_id', dependentIds)
            .in('status', ['pending', 'confirmed', 'processing']);
        handleError(dependentActiveOrdersError);

        // Delete form submissions for all dependents
        const { error: dependentFormSubmissionsError } = await supabase
            .from('form_submissions')
            .delete()
            .in('client_id', dependentIds);
        handleError(dependentFormSubmissionsError);

        // Delete all dependents
        const { error: dependentsDeleteError } = await supabase
            .from('clients')
            .delete()
            .in('id', dependentIds);
        handleError(dependentsDeleteError);
    }

    // Delete active orders (pending, confirmed, processing) but preserve order history
    // Order history includes: completed, waiting_for_proof, billing_pending, cancelled
    const { error: activeOrdersError } = await supabase
        .from('orders')
        .delete()
        .eq('client_id', id)
        .in('status', ['pending', 'confirmed', 'processing']);
    handleError(activeOrdersError);

    // Delete form submissions for this client
    const { error: formSubmissionsError } = await supabase
        .from('form_submissions')
        .delete()
        .eq('client_id', id);
    handleError(formSubmissionsError);

    // Delete the client
    // Note: Client IDs are generated identifiers (e.g. CLIENT-XXX) which CAN be reused after deletion.
    // We must ensure the local cache is synced to remove any stale data associated with this ID.
    const { error } = await supabase.from('clients').delete().eq('id', id);
    handleError(error);
    revalidatePath('/clients');

    // Targeted local DB sync to remove deleted client data from cache
    const { updateClientInLocalDB } = await import('./local-db');
    updateClientInLocalDB(id, true);
}

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

    const upcomingKey = clients.length && 'upcomingOrder' in clients[0] ? 'upcomingOrder' : 'upcoming_order';
    for (const c of clients) {
        const uo = (c as any)[upcomingKey];
        if (!uo || !uo.vendorId) continue;

        const vendor = vendors.find((v: any) => v.id === uo.vendorId);
        if (!vendor) continue;

        // Check day
        const deliveryDays = vendor.delivery_days || [];
        if (deliveryDays.includes(dayName)) {
            // Check duplication
            // (Simplified: assuming we don't want duplicate per day)
            // We'll skip the duplication check in code for now to save complexity, or assume UI handles idempotency

            let summary = '';
            if (c.service_type === 'Food') {
                summary = `Food Order: ${Object.keys(uo.menuSelections || {}).length} items`;
            } else if (c.service_type === 'Boxes') {
                const box = boxTypes?.find((b: any) => b.id === uo.boxTypeId);
                summary = `${box?.name || 'Box'} x${uo.boxQuantity}`;
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

    console.log(`[history] recordClientChange called`, { clientId, summary, who });
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

/**
 * Persist current order to clients.upcoming_order only (single source of truth).
 * No writes to upcoming_orders table or clients.active_order.
 */
export async function syncCurrentOrderToUpcoming(clientId: string, client: ClientProfile, skipClientUpdate: boolean = false) {
    const orderConfig = (client as any).upcomingOrder ?? client.activeOrder ?? null;
    if (skipClientUpdate || !orderConfig) return;
    await updateClientUpcomingOrder(clientId, orderConfig);
    try {
        revalidatePath('/clients');
        revalidatePath(`/client-portal/${clientId}`);
    } catch (_e) { }
}

export async function processUpcomingOrders() {
    const today = await getCurrentTime();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Use Service Role if available to bypass RLS
    let supabaseClient = supabase;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
        supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
            auth: { persistSession: false }
        });
    }

    // Find all upcoming orders where take_effect_date <= today and status is 'scheduled'
    const { data: upcomingOrders, error: fetchError } = await supabaseClient
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
            // Calculate scheduled_delivery_date from delivery_day if available
            let scheduledDeliveryDate: string | null = null;
            if (upcomingOrder.delivery_day) {
                const currentTime = await getCurrentTime();
                const calculatedDate = getNextDeliveryDateForDay(
                    upcomingOrder.delivery_day,
                    await getVendors(),
                    undefined,
                    currentTime,
                    currentTime
                );
                if (calculatedDate) {
                    scheduledDeliveryDate = calculatedDate.toISOString().split('T')[0];
                }
            }

            // Create order in orders table
            const currentTime = await getCurrentTime();
            const orderData: any = {
                client_id: upcomingOrder.client_id,
                service_type: upcomingOrder.service_type,
                case_id: upcomingOrder.case_id,
                status: 'pending',
                last_updated: currentTime.toISOString(),
                updated_by: upcomingOrder.updated_by,
                scheduled_delivery_date: scheduledDeliveryDate,
                delivery_distribution: null, // Can be set later if needed
                total_value: upcomingOrder.total_value,
                total_items: upcomingOrder.total_items,
                notes: upcomingOrder.notes,
                order_number: upcomingOrder.order_number // Preserve the assigned 6-digit number
            };

            const { data: newOrder, error: orderError } = await supabaseClient
                .from('orders')
                .insert(orderData)
                .select()
                .single();

            // Refetch to get the generated order_number if it wasn't returned in the insert select (triggers sometimes issue)
            // But usually select() returns it. Let's verify type if needed.

            if (orderError || !newOrder) {
                errors.push(`Failed to create order for client ${upcomingOrder.client_id}: ${orderError?.message} `);
                continue;
            }

            // Copy vendor selections and items (for Food orders)
            const { data: vendorSelections } = await supabaseClient
                .from('upcoming_order_vendor_selections')
                .select('*')
                .eq('upcoming_order_id', upcomingOrder.id);

            if (vendorSelections) {
                for (const vs of vendorSelections) {
                    const { data: newVs, error: vsError } = await supabaseClient
                        .from('order_vendor_selections')
                        .insert({
                            order_id: newOrder.id,
                            vendor_id: vs.vendor_id
                        })
                        .select()
                        .single();

                    if (vsError) {
                        console.error(`[processUpcomingOrders] Error inserting VS (source: ${vs.id}):`, vsError);
                    }

                    if (vsError || !newVs) continue;

                    // Copy items
                    const { data: items } = await supabaseClient
                        .from('upcoming_order_items')
                        .select('*')
                        .eq('vendor_selection_id', vs.id);

                    if (items) {
                        for (const item of items) {
                            const { error: insertError } = await supabaseClient.from('order_items').insert({
                                order_id: newOrder.id,
                                vendor_selection_id: newVs.id,
                                menu_item_id: item.menu_item_id,
                                meal_item_id: item.meal_item_id, // Ensure this is copied
                                quantity: item.quantity,
                                unit_value: item.unit_value,
                                total_value: item.total_value,
                                notes: item.notes
                            });

                            if (insertError) {
                                console.error(`[processUpcomingOrders] Error inserting item ${item.id} (menu: ${item.menu_item_id}):`, insertError);
                            }
                        }
                    }
                }
            }

            // Recalculate total_value from all items for Food/Meal orders
            // Use unit_value * quantity (same logic as getOrderById and the fix script)
            if (upcomingOrder.service_type === 'Food' || upcomingOrder.service_type === 'Meal') {
                const { data: allOrderItems } = await supabaseClient
                    .from('order_items')
                    .select('unit_value, quantity, custom_price')
                    .eq('order_id', newOrder.id);

                if (allOrderItems && allOrderItems.length > 0) {
                    // Calculate from unit_value * quantity (more reliable than using total_value from items)
                    const calculatedTotal = allOrderItems.reduce((sum, item) => {
                        // Use custom_price if available, otherwise use unit_value * quantity
                        const itemPrice = item.custom_price
                            ? parseFloat(item.custom_price.toString() || '0')
                            : parseFloat(item.unit_value?.toString() || '0');
                        const quantity = parseFloat(item.quantity?.toString() || '0');
                        return sum + (itemPrice * quantity);
                    }, 0);

                    // Update order total_value if it differs
                    if (Math.abs(calculatedTotal - parseFloat(newOrder.total_value || 0)) > 0.01) {
                        await supabaseClient
                            .from('orders')
                            .update({ total_value: calculatedTotal })
                            .eq('id', newOrder.id);
                    }
                }
            }

            // Copy box selections (for Box orders)
            const { data: boxSelections } = await supabaseClient
                .from('upcoming_order_box_selections')
                .select('*')
                .eq('upcoming_order_id', upcomingOrder.id);



            if (boxSelections) {
                for (const bs of boxSelections) {
                    const insertData = {
                        order_id: newOrder.id,
                        box_type_id: bs.box_type_id,
                        vendor_id: bs.vendor_id,
                        quantity: bs.quantity,
                        unit_value: bs.unit_value || 0,
                        total_value: bs.total_value || 0,
                        items: bs.items || {},
                        item_notes: bs.item_notes ?? {}
                    };

                    const { error: boxInsertError } = await supabaseClient.from('order_box_selections').insert(insertData);

                    if (boxInsertError) {
                        console.error('[processUpcomingOrders] Error inserting box selection:', boxInsertError);
                    }
                }
            }

            // Update upcoming order status
            await supabaseClient
                .from('upcoming_orders')
                .update({
                    status: 'processed',
                    processed_order_id: newOrder.id,
                    processed_at: (await getCurrentTime()).toISOString()
                })
                .eq('id', upcomingOrder.id);

            processedCount++;
        } catch (error: any) {
            errors.push(`Error processing upcoming order ${upcomingOrder.id}: ${error.message} `);
        }
    }

    try {
        revalidatePath('/clients');
    } catch (e) { }

    // Targeted local DB sync for all affected clients
    const clientIds = [...new Set(upcomingOrders.map(uo => uo.client_id))];
    if (clientIds.length > 0) {
        const { syncClientsInLocalDB } = await import('./local-db');
        syncClientsInLocalDB(clientIds as string[]).catch((e: unknown) => console.error('Bulk sync error:', e));
    }


    return { processed: processedCount, errors };
}

/**
 * Log a navigator action (status change)
 */
export async function logNavigatorAction(data: {
    navigatorId: string;
    clientId: string;
    oldStatus: string;
    newStatus: string;
    unitsAdded: number;
}) {
    try {
        const { error } = await supabase.from('navigator_logs').insert([{
            navigator_id: data.navigatorId,
            client_id: data.clientId,
            old_status: data.oldStatus,
            new_status: data.newStatus,
            units_added: data.unitsAdded
        }]);

        if (error) {
            console.error('Error logging navigator action:', error);
            // We don't throw here to avoid blocking the main action if logging fails, 
            // but in a strict audit system we might want to.
        }
    } catch (err) {
        console.error('Error in logNavigatorAction:', err);
    }
}

/**
 * Resolve order ID from either order number (numeric) or UUID order ID
 * Returns the UUID order ID
 */
export async function resolveOrderId(orderIdentifier: string): Promise<string | null> {
    if (!orderIdentifier) return null;

    // Check if it's a UUID (contains hyphens and is 36 chars)
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdentifier);

    if (isUUID) {
        // Already a UUID, verify it exists
        const { data } = await supabase
            .from('orders')
            .select('id')
            .eq('id', orderIdentifier)
            .maybeSingle();
        return data?.id || null;
    }

    // Try as order number (numeric)
    const orderNumber = parseInt(orderIdentifier, 10);
    if (!isNaN(orderNumber)) {
        const { data } = await supabase
            .from('orders')
            .select('id')
            .eq('order_number', orderNumber)
            .maybeSingle();
        return data?.id || null;
    }

    return null;
}

export async function isOrderUnderVendor(orderId: string, vendorId: string) {
    // Quick check if order is in list
    // Optimization: check DB directly
    const { data: foodOrder } = await supabase
        .from('order_vendor_selections')
        .select('id')
        .eq('order_id', orderId)
        .eq('vendor_id', vendorId)
        .maybeSingle();

    if (foodOrder) return true;

    const { data: boxOrder } = await supabase
        .from('order_box_selections')
        .select('id')
        .eq('order_id', orderId)
        .eq('vendor_id', vendorId)
        .maybeSingle();

    if (boxOrder) return true;

    // Check Equipment orders - vendor ID is stored in notes JSON
    const { data: equipmentOrder } = await supabase
        .from('orders')
        .select('service_type, notes')
        .eq('id', orderId)
        .eq('service_type', 'Equipment')
        .maybeSingle();

    if (equipmentOrder && equipmentOrder.notes) {
        try {
            const notes = JSON.parse(equipmentOrder.notes);
            if (notes && notes.vendorId === vendorId) {
                return true;
            }
        } catch (e) {
            // Invalid JSON, skip
        }
    }

    return false;
}

export async function orderHasDeliveryProof(orderId: string) {
    const { data, error } = await supabase
        .from('orders')
        .select('delivery_proof_url')
        .eq('id', orderId)
        .single();

    if (error || !data) return false;
    return !!data.delivery_proof_url;
}

export async function updateOrderDeliveryProof(orderId: string, proofUrl: string) {
    // Security check: must be logged in (admin or vendor). Vendors can upload proof for any order.
    const session = await getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    // 1. Update Order Status
    const { data: order, error } = await supabase
        .from('orders')
        .update({
            delivery_proof_url: proofUrl,
            status: 'billing_pending', // Changed from 'completed'
            actual_delivery_date: new Date().toISOString()
        })
        .eq('id', orderId)
        .select()
        .single();

    if (error) return { success: false, error: 'Failed to update order status: ' + error.message };

    // 2. Create Billing Record (if it doesn't already exist)
    // Fetch client to get navigator info and client name
    const { data: client } = await supabase
        .from('clients')
        .select('navigator_id, fullName, authorized_amount')
        .eq('id', order.client_id)
        .single();

    // Check if billing record already exists for this order
    const { data: existingBilling } = await supabase
        .from('billing_records')
        .select('id')
        .eq('order_id', order.id)
        .maybeSingle();

    if (!existingBilling) {
        const billingPayload = {
            client_id: order.client_id,
            client_name: client?.fullName || 'Unknown Client',
            order_id: order.id,
            status: 'pending',
            amount: order.total_value || 0,
            navigator: client?.navigator_id || 'Unknown',
            delivery_date: order.actual_delivery_date,
            remarks: 'Auto-generated upon proof upload'
        };

        const { error: billingError } = await supabase.from('billing_records').insert([billingPayload]);

        if (billingError) {
            console.error('Failed to create billing record:', billingError);
            return { success: true, warning: 'Order updated but billing record creation failed.' };
        }
    }

    // Reduce client's authorized amount by the order amount (only if billing record didn't already exist)
    if (!existingBilling && client && client.authorized_amount !== null && client.authorized_amount !== undefined) {
        const orderAmount = order.total_value || 0;
        const newAuthorizedAmount = roundCurrency(Math.max(0, client.authorized_amount - orderAmount));

        const { error: authAmountError } = await supabase
            .from('clients')
            .update({ authorized_amount: newAuthorizedAmount })
            .eq('id', order.client_id);

        if (authAmountError) {
            console.error('Failed to update authorized amount:', authAmountError);
        }
    }

    revalidatePath('/vendors');
    return { success: true };
}

export async function updateVendorDetails(data: Partial<Vendor & { password?: string }>) {
    const session = await getVendorSession();
    if (!session) {
        throw new Error('Unauthorized');
    }

    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.serviceTypes) payload.service_type = data.serviceTypes.join(',');
    if (data.deliveryDays) payload.delivery_days = data.deliveryDays;
    if (data.allowsMultipleDeliveries !== undefined) {
        payload.delivery_frequency = data.allowsMultipleDeliveries ? 'Multiple' : 'Once';
    }
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.minimumMeals !== undefined) payload.minimum_meals = data.minimumMeals;
    if (data.email !== undefined) payload.email = data.email;
    if (data.password) {
        const { hashPassword } = await import('./password');
        payload.password = await hashPassword(data.password);
    }

    const { error } = await supabase
        .from('vendors')
        .update(payload)
        .eq('id', session.userId);

    handleError(error);
    revalidatePath('/vendor');
    revalidatePath('/vendor/details');
}

export async function addVendorMenuItem(data: Omit<MenuItem, 'id'>) {
    const session = await getVendorSession();
    if (!session) {
        throw new Error('Unauthorized');
    }

    const payload: any = {
        vendor_id: session.userId,
        name: data.name,
        value: data.value,
        is_active: data.isActive,
        category_id: data.categoryId || null,
        quota_value: data.quotaValue,
        minimum_order: data.minimumOrder ?? 0,
        price_each: data.priceEach
    };

    if (!data.priceEach || data.priceEach <= 0) {
        throw new Error('Price is required and must be greater than 0');
    }

    const { data: res, error } = await supabase
        .from('menu_items')
        .insert([payload])
        .select()
        .single();

    handleError(error);
    revalidatePath('/vendor');
    revalidatePath('/vendor/items');
    return { ...data, id: res.id };
}

export async function updateVendorMenuItem(id: string, data: Partial<MenuItem>) {
    const session = await getVendorSession();
    if (!session) {
        throw new Error('Unauthorized');
    }

    // Verify the menu item belongs to this vendor
    const { data: item } = await supabase
        .from('menu_items')
        .select('vendor_id')
        .eq('id', id)
        .single();

    if (!item || item.vendor_id !== session.userId) {
        throw new Error('Unauthorized: Menu item does not belong to this vendor');
    }

    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.value !== undefined) payload.value = data.value;
    if (data.priceEach !== undefined) payload.price_each = data.priceEach;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.categoryId !== undefined) payload.category_id = data.categoryId || null;
    if (data.quotaValue !== undefined) payload.quota_value = data.quotaValue;
    if (data.minimumOrder !== undefined) payload.minimum_order = data.minimumOrder;

    const { error } = await supabase
        .from('menu_items')
        .update(payload)
        .eq('id', id);

    handleError(error);
    revalidatePath('/vendor');
    revalidatePath('/vendor/items');
}

export async function deleteVendorMenuItem(id: string) {
    const session = await getVendorSession();
    if (!session) {
        throw new Error('Unauthorized');
    }

    // Verify the menu item belongs to this vendor
    const { data: item } = await supabase
        .from('menu_items')
        .select('vendor_id')
        .eq('id', id)
        .single();

    if (!item || item.vendor_id !== session.userId) {
        throw new Error('Unauthorized: Menu item does not belong to this vendor');
    }

    const { error } = await supabase
        .from('menu_items')
        .delete()
        .eq('id', id);

    handleError(error);
    revalidatePath('/vendor');
    revalidatePath('/vendor/items');
}

export async function invalidateOrderData(path?: string) {
    if (path) {
        revalidatePath(path);
    } else {
        revalidatePath('/', 'layout');
    }
}

export async function saveClientFoodOrder(clientId: string, data: Partial<ClientFoodOrder>) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // VALIDATION: Ensure vendor is selected for all delivery days
    if (data.deliveryDayOrders) {
        Object.values(data.deliveryDayOrders).forEach((dayOrder: any) => {
            if (dayOrder.vendorSelections) {
                dayOrder.vendorSelections.forEach((selection: any) => {
                    if (!selection.vendorId) {
                        throw new Error('Vendor is required for Food orders');
                    }
                });
            }
        });
    }

    const upcomingOrder = {
        serviceType: 'Food',
        caseId: data.caseId ?? null,
        deliveryDayOrders: data.deliveryDayOrders ?? {},
        notes: data.notes ?? null
    };

    const { error } = await supabaseAdmin.from('clients').update({ upcoming_order: upcomingOrder }).eq('id', clientId);
    handleError(error);
    revalidatePath(`/client-portal/${clientId}`);
    revalidatePath(`/clients/${clientId}`);
    return { id: clientId, client_id: clientId, case_id: data.caseId, delivery_day_orders: data.deliveryDayOrders, notes: data.notes };
}

export async function saveClientMealOrder(clientId: string, data: Partial<ClientMealOrder>) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // VALIDATION: Ensure vendor is selected for all meal selections
    if (data.mealSelections) {
        Object.values(data.mealSelections).forEach((selection: any) => {
            if (!selection.vendorId) {
                throw new Error('Vendor is required for Meal orders');
            }
        });
    }

    const upcomingOrder = {
        serviceType: 'Meal',
        caseId: data.caseId ?? null,
        mealSelections: data.mealSelections ?? {},
        notes: data.notes ?? null
    };

    const { error } = await supabaseAdmin.from('clients').update({ upcoming_order: upcomingOrder }).eq('id', clientId);
    handleError(error);
    revalidatePath(`/client-portal/${clientId}`);
    revalidatePath(`/clients/${clientId}`);
    return { id: clientId, client_id: clientId, case_id: data.caseId, meal_selections: data.mealSelections, notes: data.notes };
}

export async function saveClientBoxOrder(clientId: string, data: Partial<ClientBoxOrder>[]) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    if (!data || data.length === 0) {
        const { error } = await supabaseAdmin.from('clients').update({ upcoming_order: null }).eq('id', clientId);
        handleError(error);
        revalidatePath(`/client-portal/${clientId}`);
        revalidatePath(`/clients/${clientId}`);
        return [];
    }

    data.forEach(order => {
        if (!order.vendorId) throw new Error('Vendor is required for Box orders');
    });

    const boxOrders = data.map(order => ({
        boxTypeId: order.boxTypeId ?? null,
        vendorId: order.vendorId ?? null,
        quantity: order.quantity ?? 1,
        items: order.items ?? {},
        itemNotes: (order as any).itemNotes ?? {}
    }));
    const first = data[0];
    const upcomingOrder = {
        serviceType: 'Boxes',
        caseId: first?.caseId ?? null,
        boxOrders,
        notes: first?.notes ?? null
    };

    const { error } = await supabaseAdmin.from('clients').update({ upcoming_order: upcomingOrder }).eq('id', clientId);
    handleError(error);
    revalidatePath(`/client-portal/${clientId}`);
    revalidatePath(`/clients/${clientId}`);
    return data.map((order, idx) => ({
        id: `${clientId}-box-${idx}`,
        client_id: clientId,
        case_id: first?.caseId,
        box_type_id: order.boxTypeId,
        vendor_id: order.vendorId,
        quantity: order.quantity,
        items: order.items,
        item_notes: (order as any).itemNotes
    }));
}

export async function updateMenuItemOrder(updates: { id: string; sortOrder: number }[]) {
    // Perform updates in parallel
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const promises = updates.map(({ id, sortOrder }) =>
        supabaseAdmin.from('menu_items').update({ sort_order: sortOrder }).eq('id', id)
    );

    await Promise.all(promises);
    revalidatePath('/admin');
    return { success: true };
}

export async function updateMealItemOrder(updates: { id: string; sortOrder: number }[]) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const promises = updates.map(({ id, sortOrder }) =>
        supabaseAdmin.from('breakfast_items').update({ sort_order: sortOrder }).eq('id', id)
    );
    await Promise.all(promises);
    revalidatePath('/admin');
    return { success: true };
}

export async function updateMealCategoryOrder(updates: { id: string; sortOrder: number }[]) {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const promises = updates.map(({ id, sortOrder }) =>
        supabaseAdmin.from('breakfast_categories').update({ sort_order: sortOrder }).eq('id', id)
    );
    await Promise.all(promises);
    revalidatePath('/admin');
    return { success: true };
}

export async function saveClientCustomOrder(clientId: string, vendorId: string, itemDescription: string, price: number, deliveryDay: string, caseId?: string) {
    const session = await getSession();
    const currentUserName = session?.name || 'Admin';

    // 1. Check or Create Upcoming Order
    let { data: upcomingOrder, error: upcomingError } = await supabase
        .from('upcoming_orders')
        .select('*')
        .eq('client_id', clientId)
        .neq('status', 'processed')
        .maybeSingle();

    if (upcomingError) throw new Error(upcomingError.message);

    if (upcomingOrder) {
        // Update existing
        const { error: updateError } = await supabase
            .from('upcoming_orders')
            .update({
                service_type: 'Custom', // Switch to Custom
                case_id: caseId || null,
                notes: `Custom Order: ${itemDescription}`,
                total_value: price,
                total_items: 1,
                updated_by: currentUserName,
                last_updated: (await getCurrentTime()).toISOString(),
                delivery_day: deliveryDay // Save the delivery day on the order itself for simple custom orders
            })
            .eq('id', upcomingOrder.id);
        if (updateError) throw new Error(updateError.message);
    } else {
        // Create new
        const { data: newUpcoming, error: createError } = await supabase
            .from('upcoming_orders')
            .insert({
                client_id: clientId,
                service_type: 'Custom',
                case_id: caseId || null,
                status: 'pending',
                notes: `Custom Order: ${itemDescription}`,
                total_value: price,
                total_items: 1,
                updated_by: currentUserName,
                last_updated: (await getCurrentTime()).toISOString(),
                delivery_day: deliveryDay
            })
            .select()
            .single();
        if (createError) throw new Error(createError.message);
        upcomingOrder = newUpcoming;
    }

    // 2. Clear existing items/selections for this upcoming order (since we're overwriting with a single custom order)
    // Delete items first to avoid FK issues
    await supabase.from('upcoming_order_items').delete().eq('upcoming_order_id', upcomingOrder.id);
    await supabase.from('upcoming_order_vendor_selections').delete().eq('upcoming_order_id', upcomingOrder.id);
    // Also clear box selections if any existed
    await supabase.from('upcoming_order_box_selections').delete().eq('upcoming_order_id', upcomingOrder.id);


    // 3. Create Vendor Selection
    const { data: vendorSelection, error: vsError } = await supabase
        .from('upcoming_order_vendor_selections')
        .insert({
            upcoming_order_id: upcomingOrder.id,
            vendor_id: vendorId
        })
        .select()
        .single();

    if (vsError || !vendorSelection) throw new Error(vsError?.message || 'Failed to create vendor selection');

    // 4. Create Item
    // We use the new columns: custom_name, custom_price. menu_item_id is null.
    const { error: itemError } = await supabase
        .from('upcoming_order_items')
        .insert({
            upcoming_order_id: upcomingOrder.id,
            vendor_selection_id: vendorSelection.id,
            menu_item_id: null,
            quantity: 1,
            unit_value: 0, // Not really relevant for custom price, or could be price
            total_value: 0, // Standard fields might be ignored or used for reporting, but custom_price is the source of truth for value here?
            // Wait, logic usually sums total_value. Let's set total_value to 0 and rely on custom_price? 
            // Or better, set unit_value/total_value to 0 and rely on the order total_value we set above.
            // Actually, let's look at `saveCustomOrder` (one-off).
            // It sets custom_price and custom_name. 
            custom_name: itemDescription,
            custom_price: price
        });

    if (itemError) throw new Error(itemError.message);

    // Update client service type to Custom
    await supabase.from('clients').update({ service_type: 'Custom' }).eq('id', clientId);

    revalidatePath(`/clients/${clientId}`);
    return { success: true };
}