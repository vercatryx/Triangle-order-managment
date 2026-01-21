'use server';
// HMR trigger

import { getCurrentTime } from './time';
import { revalidatePath } from 'next/cache';
import { cache as reactCache } from 'react';
import { supabase } from './supabase';
import { ClientStatus, Vendor, MenuItem, BoxType, AppSettings, Navigator, Nutritionist, ClientProfile, DeliveryRecord, ItemCategory, BoxQuota, ServiceType, Equipment, ClientFoodOrder, ClientMealOrder, ClientBoxOrder } from './types';
import { uploadFile, deleteFile } from './storage';
import { randomUUID } from 'crypto';
import { getSession } from './session';
import { createClient } from '@supabase/supabase-js';
import { roundCurrency } from './utils';

// --- HELPERS ---
function handleError(error: any) {
    if (error) {
        console.error('Supabase Error:', error);
        throw new Error(error.message);
    }
}

// --- STATUS ACTIONS ---

export const getStatuses = reactCache(async function () {
    const { data, error } = await supabase.from('client_statuses').select('*').order('created_at', { ascending: true });
    if (error) {
        console.error('Error fetching statuses:', error);
        return [];
    }
    return data.map((s: any) => ({
        id: s.id,
        name: s.name,
        isSystemDefault: s.is_system_default,
        deliveriesAllowed: s.deliveries_allowed,
        requiresUnitsOnChange: s.requires_units_on_change ?? false
    }));
});

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

// --- VENDOR ACTIONS ---

export const getVendors = reactCache(async function () {
    const { data, error } = await supabase.from('vendors').select(`
        *,
        vendor_locations (
            id,
            location_id,
            locations (
                name
            )
        )
    `);
    if (error) return [];

    return data.map((v: any) => ({
        id: v.id,
        name: v.name,
        email: v.email || null,
        serviceTypes: (v.service_type || '').split(',').map((s: string) => s.trim()).filter(Boolean) as ServiceType[],
        deliveryDays: v.delivery_days || [],
        allowsMultipleDeliveries: v.delivery_frequency === 'Multiple',
        isActive: v.is_active,
        minimumMeals: v.minimum_meals ?? 0,
        cutoffDays: v.cutoff_hours ?? 0,
        locations: v.vendor_locations?.map((vl: any) => ({
            id: vl.id,
            vendorId: v.id,
            locationId: vl.location_id,
            name: vl.locations?.name || 'Unknown'
        })) || []
    }));
});

export async function getVendor(id: string) {
    const { data: v, error } = await supabase.from('vendors').select('*').eq('id', id).single();
    if (error || !v) return null;

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

// --- GLOBAL LOCATION ACTIONS ---

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

// --- VENDOR LOCATION LINK ACTIONS ---

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

// --- FILE UPLOAD ACTION ---

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

// --- MENU ACTIONS ---

export const getMenuItems = reactCache(async function () {
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
        notesEnabled: i.notes_enabled ?? false,
        deliveryDays: i.delivery_days || null,
        itemType: 'menu'
    }));
});

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
        sort_order: data.sortOrder ?? 0,
        notes_enabled: data.notesEnabled ?? false,
        delivery_days: data.deliveryDays || null
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
    if (data.notesEnabled !== undefined) payload.notes_enabled = data.notesEnabled;
    if (data.deliveryDays !== undefined) payload.delivery_days = data.deliveryDays;

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

// --- ITEM CATEGORY ACTIONS ---

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

// --- ITEM CATEGORY ACTIONS (Generic / Food) ---
// Kept for backward compatibility if needed, but the new system uses Meal Categories below.

// --- MEAL SELECTION ACTIONS (Generic for Breakfast, Lunch, Dinner, etc.) ---
// Uses 'breakfast_categories' and 'breakfast_items' tables but is generic via 'meal_type'

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
        notesEnabled: i.notes_enabled ?? false,
        itemType: 'meal'
    }));
}

export async function addMealItem(data: { categoryId: string, name: string, quotaValue: number, priceEach?: number, isActive: boolean, imageUrl?: string | null, sortOrder?: number, notesEnabled?: boolean }) {
    const payload: any = {
        category_id: data.categoryId,
        name: data.name,
        quota_value: data.quotaValue,
        is_active: data.isActive,
        image_url: data.imageUrl || null,
        sort_order: data.sortOrder ?? 0,
        notes_enabled: data.notesEnabled ?? false
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

export async function updateMealItem(id: string, data: Partial<{ name: string, quotaValue: number, priceEach?: number, isActive: boolean, imageUrl?: string | null, sortOrder?: number, notesEnabled?: boolean }>) {
    const payload: any = {};
    if (data.name) payload.name = data.name;
    if (data.quotaValue !== undefined) payload.quota_value = data.quotaValue;
    if (data.priceEach !== undefined) payload.price_each = data.priceEach;
    if (data.isActive !== undefined) payload.is_active = data.isActive;
    if (data.imageUrl !== undefined) payload.image_url = data.imageUrl;
    if (data.sortOrder !== undefined) payload.sort_order = data.sortOrder;
    if (data.notesEnabled !== undefined) payload.notes_enabled = data.notesEnabled;

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

// --- EQUIPMENT ACTIONS ---

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
        notes: JSON.stringify(equipmentSelection)
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
        notes: `Custom Order: ${itemDescription}`
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

export const getBoxTypes = reactCache(async function () {
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

// --- SETTINGS ACTIONS ---

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
            enable_passwordless_login: settings.enablePasswordlessLogin
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
        email: n.email || null,
        isActive: n.is_active
    }));
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

// --- NUTRITIONIST ACTIONS ---

export async function getNutritionists() {
    const { data, error } = await supabase.from('nutritionists').select('*').order('created_at', { ascending: true });
    if (error) return [];
    return data.map((n: any) => ({
        id: n.id,
        name: n.name,
        email: n.email || null
    }));
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

// --- CLIENT ACTIONS ---

function mapClientFromDB(c: any): ClientProfile {
    return {
        id: c.id,
        fullName: c.full_name,
        email: c.email || '',
        address: c.address || '',
        phoneNumber: c.phone_number || '',
        secondaryPhoneNumber: c.secondary_phone_number || null,
        navigatorId: c.navigator_id || '',
        endDate: c.end_date || '',
        screeningTookPlace: c.screening_took_place,
        screeningSigned: c.screening_signed,
        screeningStatus: c.screening_status || 'not_started',
        notes: c.notes || '',
        statusId: c.status_id || '',
        serviceType: c.service_type as any,
        approvedMealsPerWeek: c.approved_meals_per_week,
        parentClientId: c.parent_client_id || null,
        dob: c.dob || null,
        cin: c.cin ?? null,
        authorizedAmount: c.authorized_amount ?? null,
        expirationDate: c.expiration_date || null,
        activeOrder: c.active_order, // Metadata matches structure
        mealOrder: c.client_meal_orders && Array.isArray(c.client_meal_orders) && c.client_meal_orders.length > 0
            ? c.client_meal_orders[0] // Take the first one if array (should be one-to-one effectively)
            : (c.client_meal_orders && !Array.isArray(c.client_meal_orders) ? c.client_meal_orders : undefined),
        locationId: c.location_id || null,
        createdAt: c.created_at,
        updatedAt: c.updated_at
    };
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

export const getClient = reactCache(async function (id: string) {
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

    // Save active_order if provided (ClientProfile component handles validation)
    if (data.activeOrder !== undefined && data.activeOrder !== null) {
        payload.active_order = data.activeOrder;
    } else {
        payload.active_order = {};
    }

    const { data: res, error } = await supabase.from('clients').insert([payload]).select().single();
    handleError(error);

    if (!res) {
        throw new Error('Failed to create client: no data returned');
    }

    const newClient = mapClientFromDB(res);

    if (newClient.activeOrder && newClient.activeOrder.caseId) {
        await syncCurrentOrderToUpcoming(newClient.id, newClient, true);
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
        active_order: {},
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
    updateClientInLocalDB(newDependent.id);

    return newDependent;
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

export async function updateClient(id: string, data: Partial<ClientProfile>) {
    console.log('[updateClient] Server Action Received:', id);
    if (data.activeOrder) {
        console.log('[updateClient] Payload activeOrder mealSelections:', JSON.stringify((data.activeOrder as any).mealSelections, null, 2));
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
    if (data.activeOrder) payload.active_order = data.activeOrder;

    payload.updated_at = new Date().toISOString();

    const { data: updatedData, error } = await supabase.from('clients').update(payload).eq('id', id).select().single();
    handleError(error);

    // If activeOrder was updated, sync to upcoming_orders
    if (data.activeOrder) {
        if (updatedData) {
            await syncCurrentOrderToUpcoming(id, mapClientFromDB(updatedData), true);
        }
    } else {
        // Targeted local DB sync for this client
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

        // Delete upcoming orders for all dependents
        const { error: dependentUpcomingOrdersError } = await supabase
            .from('upcoming_orders')
            .delete()
            .in('client_id', dependentIds);
        handleError(dependentUpcomingOrdersError);

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

    // Delete all upcoming orders for this client
    const { error: upcomingOrdersError } = await supabase
        .from('upcoming_orders')
        .delete()
        .eq('client_id', id);
    handleError(upcomingOrdersError);

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

// --- UPCOMING ORDERS ACTIONS ---

// Import centralized order date calculation utilities
import {
    getNextDeliveryDate,
    getNextDeliveryDateForDay,
    getTakeEffectDate as getTakeEffectDateFromUtils,
    getAllDeliveryDatesForOrder as getAllDeliveryDatesFromUtils
} from './order-dates';

// Re-export for backward compatibility (deprecated, use order-dates.ts directly)
/** @deprecated Use getTakeEffectDateLegacy from order-dates.ts */
function calculateTakeEffectDate(vendorId: string, vendors: Vendor[]): Date | null {
    const { getTakeEffectDateLegacy } = require('./order-dates');
    return getTakeEffectDateLegacy(vendorId, vendors);
}

/** @deprecated Use getEarliestDeliveryDate from order-dates.ts */
function calculateEarliestTakeEffectDate(vendorIds: string[], vendors: Vendor[]): Date | null {
    const { getTakeEffectDateLegacy, getEarliestDeliveryDate } = require('./order-dates');
    const dates: Date[] = [];
    for (const vendorId of vendorIds) {
        const date = getTakeEffectDateLegacy(vendorId, vendors);
        if (date) dates.push(date);
    }
    if (dates.length === 0) return null;
    return dates.reduce((earliest, current) => current < earliest ? current : earliest);
}

/** @deprecated Use getNextDeliveryDateForDay from order-dates.ts */
function calculateScheduledDeliveryDateForDay(deliveryDay: string, vendors: Vendor[], vendorId?: string): Date | null {
    return getNextDeliveryDateForDay(deliveryDay, vendors, vendorId);
}

/** @deprecated Use getTakeEffectDateForDayLegacy from order-dates.ts */
function calculateTakeEffectDateForDay(deliveryDay: string, vendors: Vendor[], vendorId?: string): Date | null {
    const { getTakeEffectDateForDayLegacy } = require('./order-dates');
    return getTakeEffectDateForDayLegacy(deliveryDay, vendors, vendorId);
}

/**
 * Helper function to sync a single order configuration for a specific delivery day
 */
export async function syncSingleOrderForDeliveryDay(
    clientId: string,
    orderConfig: any,
    deliveryDay: string | null,
    vendors: Vendor[],
    menuItems: any[],
    boxTypes: any[],
    supabaseClientObj?: any,
    mealType: string = 'Lunch' // Default to 'Lunch' for backward compatibility
): Promise<void> {
    const supabaseClient = supabaseClientObj || supabase;

    console.log('[syncSingleOrderForDeliveryDay] Start', {
        clientId,
        serviceType: orderConfig.serviceType,
        deliveryDay,
        itemsCount: orderConfig.items ? Object.keys(orderConfig.items).length : 0,
        boxQuantity: orderConfig.boxQuantity,
        // Detailed logging for standard inputs to help debug persistence
        fullOrderConfigKeys: Object.keys(orderConfig),
        customFields: orderConfig.serviceType === 'Custom' ? {
            description: orderConfig.description,
            items: orderConfig.items,
            totalValue: orderConfig.totalValue
        } : 'N/A'
    });

    // Calculate dates for this specific delivery day
    // IMPORTANT: take_effect_date must always be a Sunday and respect weekly locking
    let takeEffectDate: Date | null = null;
    let scheduledDeliveryDate: Date | null = null;

    // Get settings for weekly locking logic
    const settings = await getSettings();

    // ... logic ...
    // Note: I am rewriting the top of the function to include supabaseClientObj.
    // I need to search and replace 'supabase.' with 'supabaseClient.' in the REST of the function.
    // However, ReplaceFileContent works on chunks. I can't easily replace all internal usages without listing them or rewriting the whole function.
    // The function is long (1234 to 1500+).
    // I will try to use sed or multiple chunks if possible, or rewrite critical parts.
    // Let's check usages of `supabase.` in this function.
    // It uses `supabase.from` for upcoming_orders queries, inserts, deletes.
    // I will rewrite the query sections.

    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0) {
        const vendorIds = orderConfig.vendorSelections
            .map((s: any) => s.vendorId)
            .filter((id: string) => id);

        if (vendorIds.length > 0) {
            if (deliveryDay) {
                // Calculate scheduled delivery date for the specific day
                const currentTime = await getCurrentTime();
                scheduledDeliveryDate = getNextDeliveryDateForDay(deliveryDay, vendors, vendorIds[0], currentTime, currentTime);
            } else {
                // Fallback: find the first delivery date
                const firstVendorId = vendorIds[0];
                const vendor = vendors.find(v => v.id === firstVendorId);
                if (vendor && vendor.deliveryDays) {
                    const dayNameToNumber: { [key: string]: number } = {
                        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
                        'Thursday': 4, 'Friday': 5, 'Saturday': 6
                    };
                    const deliveryDayNumbers = vendor.deliveryDays
                        .map((day: string) => dayNameToNumber[day])
                        .filter((num: number | undefined): num is number => num !== undefined);

                    const today = await getCurrentTime();
                    today.setHours(0, 0, 0, 0);
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

            // IMPORTANT: take_effect_date must always be a Sunday using weekly locking logic
            takeEffectDate = getTakeEffectDateFromUtils(settings);
        }
    } else if (orderConfig.serviceType === 'Boxes') {
        const boxOrders = orderConfig.boxOrders || [];
        const uniqueVendorIds = new Set<string>();

        if (boxOrders.length > 0) {
            boxOrders.forEach((box: any) => {
                const boxDef = boxTypes.find(bt => bt.id === box.boxTypeId);
                const vId = box.vendorId || boxDef?.vendorId;
                if (vId) uniqueVendorIds.add(vId);
            });
        } else {
            // Fallback for legacy format
            let boxVendorId = (orderConfig.vendorId && orderConfig.vendorId.trim() !== '') ? orderConfig.vendorId : null;
            if (!boxVendorId && orderConfig.boxTypeId) {
                const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
                boxVendorId = boxType?.vendorId || null;
            }
            if (boxVendorId) uniqueVendorIds.add(boxVendorId);
        }

        if (uniqueVendorIds.size > 0) {
            // For Boxes, we take the first available delivery day from any of the vendors involved
            // Strictly speaking, multi-vendor box orders are tricky, but we usually default to the first one's first day.
            const primaryVendorId = Array.from(uniqueVendorIds)[0];

            if (deliveryDay) {
                const currentTime = await getCurrentTime();
                scheduledDeliveryDate = getNextDeliveryDateForDay(deliveryDay, vendors, primaryVendorId, currentTime, currentTime);
            } else {
                const vendor = vendors.find(v => v.id === primaryVendorId);
                if (vendor && vendor.deliveryDays && vendor.deliveryDays.length > 0) {
                    const today = await getCurrentTime();
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
            takeEffectDate = getTakeEffectDateFromUtils(settings);
        } else {
            console.log(`[syncSingleOrderForDeliveryDay] No vendorId found for Boxes order - setting fallback take_effect_date (2099-12-31)`);
            const fallbackDate = new Date('2099-12-31T00:00:00.000Z');
            takeEffectDate = fallbackDate;
            scheduledDeliveryDate = fallbackDate;
        }
    }

    // For Boxes orders, dates are optional - they can be set later
    // Only require dates for Food orders - but allow processing to continue so we save draft state
    if (orderConfig.serviceType === 'Food' && (!takeEffectDate || !scheduledDeliveryDate)) {
        console.warn(`[syncSingleOrderForDeliveryDay] Missing dates for Food order - will save with NULL dates`);
        // We continue instead of returning, to allow saving "draft" orders
    }

    // For Boxes orders without dates, we'll save with null dates (can be set later)
    if (orderConfig.serviceType === 'Boxes' && (!takeEffectDate || !scheduledDeliveryDate)) {
        console.log(`[syncSingleOrderForDeliveryDay] Boxes order without dates - will save with null dates (can be set later)`);
        // Allow null dates for Boxes orders
    }

    // For Meal orders, also allow null dates (inherit from context or set later)
    if (orderConfig.serviceType === 'Meal' && (!takeEffectDate || !scheduledDeliveryDate)) {
        console.log(`[syncSingleOrderForDeliveryDay] Meal order without dates - will save with null dates`);
    }

    // Fallback removed to allow NULL dates per user request



    // Calculate totals
    let totalValue = 0;
    let totalItems = 0;

    console.log(`[syncSingleOrderForDeliveryDay] Starting total calculation for order`);
    console.log(`[syncSingleOrderForDeliveryDay] Order config:`, {
        serviceType: orderConfig.serviceType,
        hasVendorSelections: !!orderConfig.vendorSelections,
        vendorSelectionsCount: orderConfig.vendorSelections?.length || 0
    });

    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections) {
        // Reduced logging for regular Food orders per user request
        // console.log(`[syncSingleOrderForDeliveryDay] Processing Food order with ${orderConfig.vendorSelections.length} vendor selections`);
        for (const selection of orderConfig.vendorSelections) {
            if (!selection.items) {
                // console.log(`[syncSingleOrderForDeliveryDay] Skipping vendor selection - no items`);
                continue;
            }
            // console.log(`[syncSingleOrderForDeliveryDay] Processing vendor ${selection.vendorId} with ${Object.keys(selection.items).length} items`);
            for (const [itemId, qty] of Object.entries(selection.items)) {
                const item = menuItems.find(i => i.id === itemId);
                const quantity = qty as number;
                if (item && quantity > 0) {
                    // Use priceEach if available, otherwise fall back to value
                    const itemPrice = item.priceEach ?? item.value;
                    const itemTotal = itemPrice * quantity;
                    // console.log(`[syncSingleOrderForDeliveryDay] Item: ${item.name}`, { ... });
                    totalValue += itemTotal;
                    totalItems += quantity;
                    // console.log(`[syncSingleOrderForDeliveryDay] Updated totalValue: ${totalValue}, totalItems: ${totalItems}`);
                } else {
                    // Keep error/warning logs
                    if (!item) {
                        console.warn(`[syncSingleOrderForDeliveryDay] Skipping item ${itemId} - item not found in menuItems list!`);
                    }
                }
            }
        }
    } else if (orderConfig.serviceType === 'Meal' && orderConfig.vendorSelections) {
        // Detailed logging for Meal orders
        console.log(`[syncSingleOrderForDeliveryDay] Processing Meal order (${mealType}) with ${orderConfig.vendorSelections.length} selections`);
        for (const selection of orderConfig.vendorSelections) {
            if (!selection.items) continue;

            for (const [itemId, qty] of Object.entries(selection.items)) {
                // Look up in the passed menuItems (which should be mealItems)
                const item = menuItems.find(i => i.id === itemId);
                const quantity = qty as number;

                if (item && quantity > 0) {
                    const itemPrice = item.priceEach ?? 0; // Meal items usually have 0 value unless priced
                    const itemTotal = itemPrice * quantity;

                    console.log(`[syncSingleOrderForDeliveryDay] Meal Item Found: ${item.name}`, {
                        itemId,
                        quantity,
                        price: itemPrice,
                        total: itemTotal
                    });

                    totalValue += itemTotal;
                    totalItems += quantity;
                } else {
                    console.error(`[syncSingleOrderForDeliveryDay] Meal Item NOT FOUND: ${itemId}`, {
                        availableItemsCount: menuItems.length,
                        firstAvailableId: menuItems[0]?.id
                    });
                }
            }
        }
    } else if (orderConfig.serviceType === 'Boxes') {
        const boxOrders = orderConfig.boxOrders || [];
        if (boxOrders.length > 0) {
            boxOrders.forEach((box: any) => {
                totalItems += box.quantity || 1;
                const items = box.items || {};
                const itemPrices = box.itemPrices || {};
                let boxItemsTotal = 0;
                for (const [itemId, qty] of Object.entries(items)) {
                    const quantity = typeof qty === 'number' ? qty : 0;
                    const price = itemPrices[itemId];
                    if (price !== undefined && price !== null && quantity > 0) {
                        boxItemsTotal += price * quantity;
                    }
                }
                if (boxItemsTotal > 0) {
                    totalValue += boxItemsTotal;
                } else if (box.boxTypeId) {
                    const boxType = boxTypes.find(bt => bt.id === box.boxTypeId);
                    if (boxType && boxType.priceEach) {
                        totalValue += boxType.priceEach * (box.quantity || 1);
                    }
                }
            });
        } else {
            // Fallback for legacy format
            totalItems = orderConfig.boxQuantity || 0;
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
            if (boxItemsTotal > 0) {
                totalValue = boxItemsTotal;
            } else if (orderConfig.boxTypeId) {
                const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
                if (boxType && boxType.priceEach) {
                    totalValue = boxType.priceEach * totalItems;
                }
            }
        }
    }

    // Get current user from session for updated_by
    let session;
    try {
        session = await getSession();
    } catch (e) {
        // Ignore error in scripts
    }
    const currentUserName = session?.name || 'Admin';
    const updatedBy = (orderConfig.updatedBy && orderConfig.updatedBy !== 'Admin') ? orderConfig.updatedBy : currentUserName;

    console.log(`[syncSingleOrderForDeliveryDay] Final calculated totals:`, {
        totalValue,
        totalItems
    });

    // Upsert upcoming order for this delivery day
    const currentTime = await getCurrentTime();
    const upcomingOrderData: any = {
        client_id: clientId,
        service_type: orderConfig.serviceType,
        case_id: orderConfig.caseId,
        status: 'scheduled',
        last_updated: orderConfig.lastUpdated || currentTime.toISOString(),
        updated_by: updatedBy,
        // For Boxes orders, dates are optional (can be null)
        // Note: scheduled_delivery_date column doesn't exist in upcoming_orders table
        total_value: totalValue,
        total_items: totalItems,
        notes: null,
        meal_type: mealType
    };

    // Add delivery_day if provided
    if (deliveryDay) {
        upcomingOrderData.delivery_day = deliveryDay;
    }

    // Check if upcoming order exists for this delivery day
    let query = supabaseClient
        .from('upcoming_orders')
        .select('id')
        .eq('client_id', clientId);

    if (deliveryDay) {
        query = query.eq('delivery_day', deliveryDay);
    } else {
        // For backward compatibility, check for orders without delivery_day
        query = query.is('delivery_day', null);
    }

    // Add meal_type check
    query = query.eq('meal_type', mealType);

    const { data: existing } = await query.maybeSingle();

    // console.log('[syncSingleOrderForDeliveryDay] Checking existing', {
    //     deliveryDay,
    //     foundExisting: !!existing,
    //     existingId: existing?.id,
    //     willCreateNew: !existing
    // });

    let upcomingOrderId: string;

    if (existing) {
        // Update existing
        const { data, error } = await supabaseClient
            .from('upcoming_orders')
            .update(upcomingOrderData)
            .eq('id', existing.id)
            .select()
            .single();

        if (error) {
            console.error('[syncSingleOrderForDeliveryDay] Error updating upcoming order:', error);
            throw new Error(`Failed to update upcoming order: ${error.message}`);
        }
        upcomingOrderId = data.id;
    } else {
        // Insert new
        const { data, error } = await supabaseClient
            .from('upcoming_orders')
            .insert(upcomingOrderData)
            .select()
            .single();

        if (error) {
            console.error('[syncSingleOrderForDeliveryDay] Error creating upcoming order:', error);
            throw new Error(`Failed to create upcoming order: ${error.message}`);
        }
        upcomingOrderId = data.id;
    }

    // Now sync related data (vendor selections, items, box selections)
    // Delete existing related records
    await supabaseClient.from('upcoming_order_vendor_selections').delete().eq('upcoming_order_id', upcomingOrderId);
    await supabaseClient.from('upcoming_order_items').delete().eq('upcoming_order_id', upcomingOrderId);
    await supabaseClient.from('upcoming_order_box_selections').delete().eq('upcoming_order_id', upcomingOrderId);

    if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections) {
        // Insert vendor selections and items
        let calculatedTotalFromItems = 0;
        const allVendorSelections: any[] = [];

        // console.log(`[syncSingleOrderForDeliveryDay] Starting to insert items for upcoming_order_id: ${upcomingOrderId}`);

        for (const selection of orderConfig.vendorSelections) {
            if (!selection.vendorId || !selection.items) {
                // console.log(`[syncSingleOrderForDeliveryDay] Skipping vendor selection - missing vendorId or items`);
                continue;
            }

            // console.log(`[syncSingleOrderForDeliveryDay] Creating vendor selection for vendor ${selection.vendorId}`);
            const { data: vendorSelection, error: vsError } = await supabaseClient
                .from('upcoming_order_vendor_selections')
                .insert({
                    upcoming_order_id: upcomingOrderId,
                    vendor_id: selection.vendorId
                })
                .select()
                .single();

            if (vsError || !vendorSelection) {
                console.error(`[syncSingleOrderForDeliveryDay] Error creating vendor selection:`, vsError);
                continue;
            }

            allVendorSelections.push(vendorSelection);
            // console.log(`[syncSingleOrderForDeliveryDay] Created vendor selection ${vendorSelection.id}`);

            // Insert items
            for (const [itemId, qty] of Object.entries(selection.items)) {
                const item = menuItems.find(i => i.id === itemId);
                const quantity = qty as number;
                if (item && quantity > 0) {
                    // Use priceEach if available, otherwise fall back to value
                    const itemPrice = item.priceEach ?? item.value;
                    const itemTotal = itemPrice * quantity;
                    // console.log(`[syncSingleOrderForDeliveryDay] Inserting item:`, {
                    //     itemId,
                    //     itemName: item.name,
                    //     quantity,
                    //     itemPrice,
                    //     itemValue: item.value,
                    //     itemPriceEach: item.priceEach,
                    //     itemTotal,
                    //     calculatedTotalBefore: calculatedTotalFromItems
                    // });
                    calculatedTotalFromItems += itemTotal;
                    // console.log(`[syncSingleOrderForDeliveryDay] Updated calculatedTotalFromItems: ${calculatedTotalFromItems}`);

                    // Get item note if exists
                    const itemNote = selection.itemNotes ? selection.itemNotes[itemId] : null;

                    const insertResult = await supabaseClient.from('upcoming_order_items').insert({
                        upcoming_order_id: upcomingOrderId,
                        vendor_selection_id: vendorSelection.id,
                        menu_item_id: (item as any).itemType === 'menu' ? itemId : null,
                        meal_item_id: (item as any).itemType === 'meal' ? itemId : null,
                        quantity: quantity,
                        unit_value: itemPrice,
                        total_value: itemTotal,
                        notes: itemNote || null
                    });

                    if (insertResult.error) {
                        console.error(`[syncSingleOrderForDeliveryDay] Error inserting item:`, insertResult.error);
                    } else {
                        // console.log(`[syncSingleOrderForDeliveryDay] Successfully inserted item ${itemId}`);
                    }
                } else {
                    // console.log(`[syncSingleOrderForDeliveryDay] Skipping item ${itemId} - item not found or quantity is 0`);
                }
            }
        }

        // console.log(`[syncSingleOrderForDeliveryDay] Final calculatedTotalFromItems: ${calculatedTotalFromItems}`);
        // console.log(`[syncSingleOrderForDeliveryDay] Original totalValue: ${totalValue}`);

        // Update total_value to match calculated total from items
        if (calculatedTotalFromItems !== totalValue) {
            // console.log(`[syncSingleOrderForDeliveryDay] Mismatch detected! Updating total_value from ${totalValue} to ${calculatedTotalFromItems}`);
            totalValue = calculatedTotalFromItems;
            const updateResult = await supabaseClient
                .from('upcoming_orders')
                .update({ total_value: totalValue })
                .eq('id', upcomingOrderId);

            if (updateResult.error) {
                console.error(`[syncSingleOrderForDeliveryDay] Error updating total_value:`, updateResult.error);
            } else {
                // console.log(`[syncSingleOrderForDeliveryDay] Successfully updated total_value to ${totalValue}`);
            }
        } else {
            // console.log(`[syncSingleOrderForDeliveryDay] Total values match, no update needed`);
        }

        // Add total as a separate item in the order_items table
        // Use the first vendor selection or create a special one for the total
        if (allVendorSelections.length > 0 && calculatedTotalFromItems > 0) {
            // Use the first vendor selection to attach the total item
            const firstVendorSelection = allVendorSelections[0];
            await supabaseClient.from('upcoming_order_items').insert({
                upcoming_order_id: upcomingOrderId,
                vendor_selection_id: firstVendorSelection.id,
                menu_item_id: null, // null indicates this is a total item
                quantity: 1,
                unit_value: calculatedTotalFromItems,
                total_value: calculatedTotalFromItems
            });
        }
    } else if (orderConfig.serviceType === 'Meal' && orderConfig.vendorSelections) {
        // Insert logic for Meal items
        const { data: vendorSelection, error: vsError } = await supabaseClient
            .from('upcoming_order_vendor_selections')
            .insert({
                upcoming_order_id: upcomingOrderId,
                vendor_id: orderConfig.vendorSelections[0]?.vendorId || null // Meal might not have vendor
            })
            .select()
            .single();

        if (vsError) {
            console.error(`[syncSingleOrderForDeliveryDay] Error inserting Meal VS:`, vsError);
            throw new Error(`Failed to insert Meal vendor selection: ${vsError.message}`);
        }

        if (vendorSelection) {
            for (const selection of orderConfig.vendorSelections) {
                if (!selection.items) continue;
                for (const [itemId, qty] of Object.entries(selection.items)) {
                    const item = menuItems.find(i => i.id === itemId);
                    const quantity = qty as number;
                    if (item && quantity > 0) {
                        const itemPrice = item.priceEach ?? 0;
                        const itemTotal = itemPrice * quantity;

                        const itemInsertData = {
                            upcoming_order_id: upcomingOrderId,
                            vendor_selection_id: vendorSelection.id,
                            menu_item_id: null,
                            meal_item_id: itemId,
                            quantity: quantity,
                            unit_value: itemPrice,
                            total_value: itemTotal
                        };
                        const { error: itemInsertError } = await supabaseClient.from('upcoming_order_items').insert(itemInsertData);

                        if (itemInsertError) {
                            console.error(`[syncSingleOrderForDeliveryDay] FAILED to insert Meal item ${itemId}:`, itemInsertError);
                            throw new Error(`Failed to insert Meal item ${itemId}: ${itemInsertError.message}`);
                        }
                    }
                }
            }
        }
    } else if (orderConfig.serviceType === 'Boxes') {
        const boxOrders = orderConfig.boxOrders || [];

        const processBox = async (boxData: any) => {
            const boxDef = boxTypes.find(bt => bt.id === boxData.boxTypeId);
            const boxVendorId = boxData.vendorId || boxDef?.vendorId || null;
            const quantity = boxData.quantity || 1;
            const boxItemsRaw = boxData.items || {};
            const boxItemNotes = boxData.itemNotes || {};
            const boxItemPrices = boxData.itemPrices || {};

            const boxItems: any = {};
            let calculatedTotal = 0;

            for (const [itemId, qty] of Object.entries(boxItemsRaw)) {
                const quantity = typeof qty === 'number' ? qty : 0;
                const price = boxItemPrices[itemId];
                const note = boxItemNotes[itemId];

                if ((price !== undefined && price !== null) || note) {
                    const itemEntry: any = { quantity };
                    if (price !== undefined && price !== null) itemEntry.price = price;
                    if (note) itemEntry.note = note;
                    boxItems[itemId] = itemEntry;
                } else {
                    boxItems[itemId] = quantity;
                }

                if (price !== undefined && price !== null && quantity > 0) {
                    calculatedTotal += price * quantity;
                }
            }

            if (calculatedTotal === 0 && boxDef?.priceEach) {
                calculatedTotal = boxDef.priceEach * quantity;
            }

            const boxSelectionData: any = {
                upcoming_order_id: upcomingOrderId,
                vendor_id: boxVendorId,
                quantity: quantity,
                unit_value: 0,
                total_value: calculatedTotal,
                items: boxItems,
                box_type_id: boxData.boxTypeId || null
            };

            const { error: boxSelectionError } = await supabaseClient.from('upcoming_order_box_selections').insert(boxSelectionData);
            if (boxSelectionError) {
                console.error(`[syncSingleOrderForDeliveryDay] Error inserting box selection:`, boxSelectionError);
            }
        };

        if (boxOrders.length > 0) {
            for (const box of boxOrders) {
                await processBox(box);
            }
        } else {
            // Fallback for legacy format
            await processBox({
                boxTypeId: orderConfig.boxTypeId,
                vendorId: orderConfig.vendorId,
                quantity: orderConfig.boxQuantity,
                items: (orderConfig as any).items,
                itemNotes: (orderConfig as any).itemNotes,
                itemPrices: (orderConfig as any).itemPrices
            });
        }
    } else if (orderConfig.serviceType === 'Custom') {
        console.log('[syncSingleOrderForDeliveryDay] Processing Custom order', {
            description: orderConfig.description || orderConfig.custom_name,
            totalValue: orderConfig.totalValue || orderConfig.custom_price,
            vendorId: orderConfig.vendorId
        });

        // For Custom orders, we treat it as a single item order
        const description = orderConfig.custom_name || orderConfig.description || 'Custom Order';
        const price = Number(orderConfig.custom_price ?? orderConfig.totalValue ?? 0);

        // 1. Update upcoming_orders record with totals
        totalValue = price;
        totalItems = 1;

        const updateResult = await supabaseClient
            .from('upcoming_orders')
            .update({
                total_value: totalValue,
                total_items: totalItems,
                notes: description
            })
            .eq('id', upcomingOrderId);

        if (updateResult.error) {
            console.error('[syncSingleOrderForDeliveryDay] Error updating Custom order totals:', updateResult.error);
        }

        // 2. Insert a single item into upcoming_order_items
        const { data: vendorSelection, error: vsError } = await supabaseClient
            .from('upcoming_order_vendor_selections')
            .insert({
                upcoming_order_id: upcomingOrderId,
                vendor_id: orderConfig.vendorId || null
            })
            .select()
            .single();

        if (vsError) {
            console.error('[syncSingleOrderForDeliveryDay] Error creating Custom vendor selection:', vsError);
        } else if (vendorSelection) {
            const { error: itemError } = await supabaseClient.from('upcoming_order_items').insert({
                upcoming_order_id: upcomingOrderId,
                vendor_selection_id: vendorSelection.id,
                menu_item_id: null,
                meal_item_id: null,
                quantity: 1,
                unit_value: price,
                total_value: price,
                notes: description
            });

            if (itemError) {
                console.error('[syncSingleOrderForDeliveryDay] Error inserting Custom item:', itemError);
            }
        }
    }
}

/**
 * Sync Current Order Request (activeOrder) to upcoming_orders table
 * This ensures upcoming_orders always reflects the latest order configuration
 * Now supports multiple orders per client (one per delivery day)
 */
export async function syncCurrentOrderToUpcoming(clientId: string, client: ClientProfile, skipClientUpdate: boolean = false) {
    // console.log('[syncCurrentOrderToUpcoming] START', { clientId, serviceType: client.activeOrder?.serviceType });

    // 1. DRAFT PERSISTENCE: Save the raw activeOrder metadata to the clients table.
    // This ensures Case ID, Vendor, and other selections are persisted even if the 
    // full sync to upcoming_orders fails (e.g. if the vendor/delivery day isn't fully set yet).
    const orderConfig = client.activeOrder;
    // console.log('[syncCurrentOrderToUpcoming] orderConfig received:', {
    //     serviceType: orderConfig?.serviceType,
    //     vendorId: orderConfig?.vendorId,
    //     boxTypeId: orderConfig?.boxTypeId,
    //     boxQuantity: orderConfig?.boxQuantity,
    //     hasItems: !!(orderConfig as any)?.items && Object.keys((orderConfig as any).items || {}).length > 0
    // });

    const vendors = await getVendors();
    const menuItems = await getMenuItems();
    const boxTypes = await getBoxTypes();

    // Use Service Role if available to bypass RLS for this public-facing update
    let supabaseClient = supabase;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
        supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
            auth: { persistSession: false }
        });
    } else {
        console.warn('[syncCurrentOrderToUpcoming] Service role key not found - using regular client (may be blocked by RLS)');
    }



    // 1. DRAFT PERSISTENCE: Save the raw activeOrder metadata to the clients table.
    // This ensures Case ID, Vendor, and other selections are persisted even if the 
    // full sync to upcoming_orders fails (e.g. if the vendor/delivery day isn't fully set yet).
    if (!skipClientUpdate && client.activeOrder) {
        const currentTime = await getCurrentTime();
        const { error: updateError } = await supabaseClient.from('clients').update({
            active_order: client.activeOrder,
            updated_at: currentTime.toISOString()
        }).eq('id', clientId);

        if (updateError) {
            console.error('[syncCurrentOrderToUpcoming] Error updating clients.active_order:', updateError);
            throw new Error(`Failed to save order: ${updateError.message}`);
        }
        revalidatePath('/clients');
    }

    // 2. NUCLEAR OPTION: Delete ALL existing upcoming orders for this client
    // This ensures that any removed items/meals/days are correctly removed from the DB
    // by starting with a clean slate.


    // First find all upcoming orders to delete related records
    const { data: ordersToDelete } = await supabaseClient
        .from('upcoming_orders')
        .select('id')
        .eq('client_id', clientId);

    if (ordersToDelete && ordersToDelete.length > 0) {
        const ids = ordersToDelete.map(o => o.id);

        // Delete related records manually (in case cascade is not set up or to be safe)
        const { error: vsError } = await supabaseClient.from('upcoming_order_vendor_selections').delete().in('upcoming_order_id', ids);
        if (vsError) console.error('Error deleting vendor selections:', vsError);

        const { error: itemsError } = await supabaseClient.from('upcoming_order_items').delete().in('upcoming_order_id', ids);
        if (itemsError) console.error('Error deleting items:', itemsError);

        const { error: boxError } = await supabaseClient.from('upcoming_order_box_selections').delete().in('upcoming_order_id', ids);
        if (boxError) console.error('Error deleting box selections:', boxError);

        // Finally delete the orders
        const { error: deleteError } = await supabaseClient.from('upcoming_orders').delete().in('id', ids);
        if (deleteError) {
            console.error('Error deleting upcoming orders:', deleteError);
            throw new Error(`Failed to clear existing orders: ${deleteError.message}`);
        }
    }

    if (!orderConfig) {
        // If no active order, we are done (config cleared)
        return;
    }

    // Check if orderConfig uses the new deliveryDayOrders format
    // Boxes orders should NOT use deliveryDayOrders format - they use the old format
    const hasDeliveryDayOrders = orderConfig &&
        orderConfig.serviceType !== 'Boxes' &&
        (orderConfig as any).deliveryDayOrders &&
        typeof (orderConfig as any).deliveryDayOrders === 'object';

    if (hasDeliveryDayOrders) {
        // New format: create/update orders for each delivery day
        const deliveryDayOrders = (orderConfig as any).deliveryDayOrders;
        // Only sync days that are in deliveryDayOrders (user's selected days)
        // Filter to only include days that have at least one vendor with items
        const deliveryDays = Object.keys(deliveryDayOrders).filter(day => {
            const dayOrder = deliveryDayOrders[day];
            if (!dayOrder || !dayOrder.vendorSelections || dayOrder.vendorSelections.length === 0) {
                return false;
            }
            // Check if at least one vendor has items
            return dayOrder.vendorSelections.some((sel: any) => {
                if (!sel.vendorId) return false;
                const items = sel.items || {};
                return Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
            });
        });

        // Sync each delivery day order
        for (const deliveryDay of deliveryDays) {
            const dayOrder = deliveryDayOrders[deliveryDay];
            if (dayOrder && dayOrder.vendorSelections) {
                // Create a full order config for this day
                const dayOrderConfig = {
                    serviceType: orderConfig.serviceType,
                    caseId: orderConfig.caseId,
                    vendorSelections: dayOrder.vendorSelections.filter((s: any) => {
                        // Only include vendors with items
                        if (!s.vendorId) return false;
                        const items = s.items || {};
                        const hasItems = Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
                        return hasItems;
                    }),
                    lastUpdated: orderConfig.lastUpdated,
                    updatedBy: orderConfig.updatedBy
                };

                // Only sync if there are vendors with items
                if (dayOrderConfig.vendorSelections.length > 0) {
                    // console.log(`[syncCurrentOrderToUpcoming] Syncing order for ${deliveryDay}`);
                    await syncSingleOrderForDeliveryDay(
                        clientId,
                        dayOrderConfig,
                        deliveryDay,
                        vendors,
                        menuItems,
                        boxTypes,
                        supabaseClient,
                        'Lunch' // Default meal type for main selections
                    );
                }
            }
        }


    } else {
        // Old format: single order config
        // Check if any selected vendors have multiple delivery days
        let deliveryDays: string[] = [];

        if (orderConfig.serviceType === 'Food' && orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0) {
            // Get all unique delivery days from selected vendors
            const allDeliveryDays = new Set<string>();
            for (const selection of orderConfig.vendorSelections) {
                if (selection.vendorId) {
                    const vendor = vendors.find(v => v.id === selection.vendorId);
                    if (vendor && vendor.deliveryDays) {
                        vendor.deliveryDays.forEach((day: string) => allDeliveryDays.add(day));
                    }
                }
            }
            deliveryDays = Array.from(allDeliveryDays);
        } else if (orderConfig.serviceType === 'Boxes') {
            const boxOrders = orderConfig.boxOrders || [];
            const allDeliveryDays = new Set<string>();

            if (boxOrders.length > 0) {
                boxOrders.forEach((box: any) => {
                    const vId = box.vendorId || boxTypes.find(bt => bt.id === box.boxTypeId)?.vendorId;
                    if (vId) {
                        const vendor = vendors.find(v => v.id === vId);
                        if (vendor && vendor.deliveryDays) {
                            vendor.deliveryDays.forEach((day: string) => allDeliveryDays.add(day));
                        }
                    }
                });
            } else {
                // Fallback for legacy format
                const boxType = orderConfig.boxTypeId ? boxTypes.find(bt => bt.id === orderConfig.boxTypeId) : null;
                const boxVendorId = (orderConfig.vendorId && orderConfig.vendorId.trim() !== '') ? orderConfig.vendorId : (boxType?.vendorId || null);
                if (boxVendorId) {
                    const vendor = vendors.find(v => v.id === boxVendorId);
                    if (vendor && vendor.deliveryDays) {
                        vendor.deliveryDays.forEach((day: string) => allDeliveryDays.add(day));
                    }
                }
            }

            if (allDeliveryDays.size > 0) {
                // For Boxes, we strictly want recurrence. If multi-day, we might need a better policy, 
                // but for now we follow the existing pattern: if multi-vendor multi-day, take them all.
                // However, the existing logic (line 2975) was defaulting to the first day for Boxes.
                // Let's stick to the FIRST day of the set to maintain "one recurring order per week" for boxes.
                deliveryDays = [Array.from(allDeliveryDays)[0]];
            } else {
                deliveryDays = [];
            }
        } else if (orderConfig.serviceType === 'Custom') {
            // [CUSTOM ORDER LOG]
            console.log('[syncCurrentOrderToUpcoming] Custom Order Delivery Day extraction:', {
                deliveryDay: orderConfig.deliveryDay,
                hasDeliveryDay: !!orderConfig.deliveryDay
            });

            if (orderConfig.deliveryDay) {
                deliveryDays = [orderConfig.deliveryDay];
            }
        }

        // If vendor(s) have multiple delivery days, create orders for each
        if (deliveryDays.length > 1) {
            // Create order for each delivery day
            for (const deliveryDay of deliveryDays) {
                await syncSingleOrderForDeliveryDay(
                    clientId,
                    orderConfig,
                    deliveryDay,
                    vendors,
                    menuItems,
                    boxTypes,
                    supabaseClient
                );
            }
        } else {
            // [CUSTOM ORDER LOG]
            if (orderConfig.serviceType === 'Custom') {
                console.log('[syncCurrentOrderToUpcoming] calling syncSingleOrderForDeliveryDay for Custom Order', {
                    deliveryDay: deliveryDays.length === 1 ? deliveryDays[0] : null
                });
            }

            await syncSingleOrderForDeliveryDay(
                clientId,
                orderConfig,
                deliveryDays.length === 1 ? deliveryDays[0] : null,
                vendors,
                menuItems,
                boxTypes,
                supabaseClient
            );
        }
    }

    // 3. MEAL SELECTIONS SYNC (Breakfast, Dinner, etc.)
    // MOVED OUTSIDE of hasDeliveryDayOrders check to ensure it runs for all formats

    // LOGGING: Check what we received
    console.log('[syncCurrentOrderToUpcoming] Syncing meal selections...');

    if (orderConfig && orderConfig.mealSelections) {
        // console.log('[syncCurrentOrderToUpcoming] Syncing meal selections', Object.keys(orderConfig.mealSelections));
        for (const [mealType, selection] of Object.entries(orderConfig.mealSelections)) {

            // Create a temporary config for this meal
            // It needs to look like a standard orderConfig with vendorSelections
            // FIX: Ensure vendorId is null if missing, NOT empty string, to avoid UUID errors
            const mealOrderConfig = {
                ...orderConfig,
                serviceType: 'Food' as ServiceType,
                vendorSelections: [{
                    vendorId: selection.vendorId || null,
                    items: selection.items,
                    itemNotes: selection.itemNotes
                }]
            };

            // Updates: Check if we have deliveryDayOrders.
            if (orderConfig.deliveryDayOrders) {
                // If using new format, sync for each day that has "Food" orders?
                // OR should we sync blindly for all days?
                // Let's iterate days in deliveryDayOrders
                for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                    const mealItems = await getMealItems();
                    const mappedMealItems = mealItems.map(mi => ({
                        id: mi.id,
                        vendorId: '',
                        name: mi.name,
                        value: 0,
                        priceEach: mi.priceEach,
                        isActive: mi.isActive,
                        categoryId: mi.categoryId,
                        quotaValue: mi.quotaValue
                    }));

                    mealOrderConfig.serviceType = 'Meal';

                    await syncSingleOrderForDeliveryDay(clientId, mealOrderConfig, day, vendors, mappedMealItems, boxTypes, supabaseClient, mealType);
                }
            } else {
                // Single delivery day or null (Legacy/Simple format)
                const mealItems = await getMealItems();
                const mappedMealItems = mealItems.map(mi => ({
                    id: mi.id,
                    vendorId: '',
                    name: mi.name,
                    value: 0,
                    priceEach: mi.priceEach,
                    isActive: mi.isActive,
                    categoryId: mi.categoryId,
                    quotaValue: mi.quotaValue
                }));

                mealOrderConfig.serviceType = 'Meal';
                // Pass null as delivery day to rely on default or allow draft
                await syncSingleOrderForDeliveryDay(clientId, mealOrderConfig, null, vendors, mappedMealItems, boxTypes, supabaseClient, mealType);
            }
        }
    }

    // Targeted local DB sync for this client to avoid full blocking sync
    const { updateClientInLocalDB } = await import('./local-db');
    await updateClientInLocalDB(clientId);

    try {
        revalidatePath('/clients');
        revalidatePath(`/client-portal/${clientId}`);
    } catch (e) { }

}

/**
 * Process upcoming orders that have reached their take effect date
 * Moves them from upcoming_orders to orders table
 */
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
                        items: bs.items || {}
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
        syncClientsInLocalDB(clientIds).catch(e => console.error('Bulk sync error:', e));
    }


    return { processed: processedCount, errors };
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

// --- OPTIMIZED ACTIONS ---

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
        const {
            getActiveOrderForClientLocal,
            getUpcomingOrderForClientLocal,
            getClientFoodOrderLocal,
            getClientMealOrderLocal,
            getClientBoxOrderLocal
        } = await import('./local-db');

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
            getActiveOrderForClientLocal(clientId),
            getUpcomingOrderForClientLocal(clientId),
            getClientFoodOrderLocal(clientId),
            getClientMealOrderLocal(clientId),
            getClientBoxOrderLocal(clientId)
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
// --- VENDOR ORDER ACTIONS ---

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

export async function processVendorOrderDetails(supabaseClient: any, order: any, vendorId: string, isUpcoming: boolean) {
    const orderIdField = isUpcoming ? 'upcoming_order_id' : 'order_id';
    const vendorSelectionsTable = isUpcoming ? 'upcoming_order_vendor_selections' : 'order_vendor_selections';
    const itemsTable = isUpcoming ? 'upcoming_order_items' : 'order_items';
    const boxSelectionsTable = isUpcoming ? 'upcoming_order_box_selections' : 'order_box_selections';

    const result = {
        ...order,
        orderNumber: order.order_number, // Ensure mapped for UI
        items: [],
        boxSelection: null
    };

    if (order.service_type === 'Food' || order.service_type === 'Meal' || order.service_type === 'Custom') {
        const { data: vs } = await supabaseClient
            .from(vendorSelectionsTable)
            .select('id')
            .eq(orderIdField, order.id)
            .eq('vendor_id', vendorId)
            .maybeSingle();

        if (vs) {
            // Both upcoming_order_items and order_items use 'vendor_selection_id' field
            const { data: items } = await supabaseClient
                .from(itemsTable)
                .select('*')
                .eq('vendor_selection_id', vs.id);

            result.items = items || [];
        }
    } else if (order.service_type === 'Equipment') {
        // Parse equipment details from notes
        // Note: Orders are already filtered by vendor in getOrdersByVendor, so we can trust the vendorId
        try {
            const notes = order.notes ? JSON.parse(order.notes) : null;
            if (notes && notes.equipmentName) {
                result.equipmentSelection = {
                    vendorId: notes.vendorId,
                    equipmentId: notes.equipmentId,
                    equipmentName: notes.equipmentName,
                    price: notes.price
                };
            }
        } catch (e) {
            console.error('Error parsing equipment order notes:', e);
        }
    } else if (order.service_type === 'Boxes') {
        const { data: bs } = await supabaseClient
            .from(boxSelectionsTable)
            .select('*')
            .eq(orderIdField, order.id)
            .eq('vendor_id', vendorId)
            .maybeSingle();

        if (bs) {
            result.boxSelection = bs;

            // If items field is empty, try to fetch from client's active_order (same source as client profile uses)
            if (!bs.items || Object.keys(bs.items).length === 0) {
                // Get the client's active_order from clients table (this is where client profile gets box items from)
                const { data: clientData } = await supabaseClient
                    .from('clients')
                    .select('active_order')
                    .eq('id', order.client_id)
                    .maybeSingle();

                if (clientData && clientData.active_order) {
                    const activeOrder = clientData.active_order;
                    // Check if this is a box order and has items
                    if (activeOrder.serviceType === 'Boxes' && activeOrder.items && Object.keys(activeOrder.items).length > 0) {
                        // Use items from client's active_order (same as client profile uses)
                        result.boxSelection = {
                            ...bs,
                            items: activeOrder.items
                        };
                    }
                }

                // If still empty, try to fetch items from order_items table as fallback (for migrated data)
                if ((!result.boxSelection.items || Object.keys(result.boxSelection.items).length === 0) && bs.vendor_id) {
                    // Find the vendor_selection for the box vendor in this order
                    const { data: vendorSelection } = await supabaseClient
                        .from(vendorSelectionsTable)
                        .select('id')
                        .eq(orderIdField, order.id)
                        .eq('vendor_id', vendorId)
                        .maybeSingle();

                    if (vendorSelection) {
                        // Fetch box items - both upcoming_order_items and order_items use 'vendor_selection_id' field
                        const { data: boxItems } = await supabaseClient
                            .from(itemsTable)
                            .select('*')
                            .eq('vendor_selection_id', vendorSelection.id);

                        if (boxItems && boxItems.length > 0) {
                            // Convert items array to object format: { itemId: quantity }
                            const itemsObj: any = {};
                            for (const item of boxItems) {
                                if (item.menu_item_id && item.quantity) {
                                    itemsObj[item.menu_item_id] = item.quantity;
                                }
                            }
                            // Update the boxSelection with items
                            result.boxSelection = {
                                ...bs,
                                items: itemsObj
                            };
                        }
                    }
                }
            }
        }
    }

    return result;
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
    // Security check
    const session = await getSession();
    if (!session) return { success: false, error: 'Unauthorized' };

    if (session.role === 'vendor') {
        const authorized = await isOrderUnderVendor(orderId, session.userId);
        if (!authorized) {
            return { success: false, error: 'Unauthorized: Order does not belong to this vendor' };
        }
    }
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

export async function saveDeliveryProofUrlAndProcessOrder(
    orderId: string,
    orderType: string,
    proofUrl: string
) {
    console.log(`[Process Pending Order] START saveDeliveryProofUrlAndProcessOrder for Order: "${orderId}", Type: "${orderType}"`);
    console.log(`[Process Pending Order] Proof URL: ${proofUrl} `);

    const session = await getSession();
    const currentUserName = session?.name || 'Admin';

    let finalOrderId = orderId;
    let wasProcessed = false;
    const errors: string[] = [];

    // If order is from upcoming_orders, process it first (but check if already processed)
    if (orderType === 'upcoming') {
        // Fetch the upcoming order
        const { data: upcomingOrder, error: fetchError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('id', orderId)
            .single();

        if (fetchError || !upcomingOrder) {
            return {
                success: false,
                error: 'Upcoming order not found: ' + (fetchError?.message || 'Unknown error')
            };
        }

        // Check if already processed - look for order with same case_id
        if (upcomingOrder.case_id) {
            const { data: existingOrder, error: checkError } = await supabase
                .from('orders')
                .select('id')
                .eq('case_id', upcomingOrder.case_id)
                .maybeSingle();

            if (checkError) {
                return {
                    success: false,
                    error: 'Error checking for existing order: ' + checkError.message
                };
            }

            if (existingOrder) {
                // Already processed, use the existing order ID
                finalOrderId = existingOrder.id;
                wasProcessed = false; // Not processed now, was already processed before
            } else {
                // Not processed yet, process it now
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
                    console.log(`[Process Pending Order] Creating new Order for Case ${upcomingOrder.case_id} with status 'billing_pending'`);
                    const currentTime = await getCurrentTime();
                    const orderData: any = {
                        client_id: upcomingOrder.client_id,
                        service_type: upcomingOrder.service_type,
                        case_id: upcomingOrder.case_id,
                        status: 'billing_pending',
                        last_updated: currentTime.toISOString(),
                        updated_by: currentUserName,
                        scheduled_delivery_date: scheduledDeliveryDate,
                        delivery_distribution: null, // Can be set later if needed
                        total_value: upcomingOrder.total_value,
                        total_items: upcomingOrder.total_items,
                        notes: upcomingOrder.notes,
                        actual_delivery_date: currentTime.toISOString()
                    };

                    const { data: newOrder, error: orderError } = await supabase
                        .from('orders')
                        .insert(orderData)
                        .select()
                        .single();

                    if (orderError || !newOrder) {
                        return {
                            success: false,
                            error: 'Failed to create order: ' + (orderError?.message || 'Unknown error')
                        };
                    }

                    finalOrderId = newOrder.id;
                    wasProcessed = true;
                    console.log(`[Process Pending Order] Successfully created Order ${newOrder.id} `);

                    // Create billing record for the processed order
                    const { data: client } = await supabase
                        .from('clients')
                        .select('navigator_id, full_name, authorized_amount')
                        .eq('id', upcomingOrder.client_id)
                        .single();

                    // Check if billing record already exists for this order
                    const { data: existingBilling } = await supabase
                        .from('billing_records')
                        .select('id')
                        .eq('order_id', newOrder.id)
                        .maybeSingle();

                    if (!existingBilling) {
                        console.log(`[Process Pending Order] Creating Billing Record for ${newOrder.id}`);
                        const billingPayload = {
                            client_id: upcomingOrder.client_id,
                            client_name: client?.full_name || 'Unknown Client',
                            order_id: newOrder.id,
                            status: 'pending',
                            amount: upcomingOrder.total_value || 0,
                            navigator: client?.navigator_id || 'Unknown',
                            delivery_date: newOrder.actual_delivery_date,
                            remarks: 'Auto-generated when order processed for delivery'
                        };

                        const { error: billingError } = await supabase
                            .from('billing_records')
                            .insert([billingPayload]);

                        if (billingError) {
                            errors.push('Failed to create billing record: ' + billingError.message);
                        }
                    }

                    // Reduce client's authorized amount by the order amount (only if billing record didn't already exist)
                    if (!existingBilling && client) {
                        console.log(`[Process Pending Order] Processing deduction for client ${upcomingOrder.client_id}`);
                        console.log(`[Process Pending Order] Client Object: `, client);
                        console.log(`[Process Pending Order] Current authorized_amount: ${client?.authorized_amount} `);
                        console.log(`[Process Pending Order] Order total_value: ${upcomingOrder.total_value} `);

                        // Treat null/undefined as 0 and allow negative result
                        const currentAmount = client.authorized_amount ?? 0;
                        const orderAmount = upcomingOrder.total_value || 0;
                        const newAuthorizedAmount = roundCurrency(currentAmount - orderAmount);

                        console.log(`[Process Pending Order] Deducting ${orderAmount} from ${currentAmount}. New amount: ${newAuthorizedAmount} `);

                        const { error: authAmountError } = await supabase
                            .from('clients')
                            .update({ authorized_amount: newAuthorizedAmount })
                            .eq('id', upcomingOrder.client_id);

                        if (authAmountError) {
                            errors.push('Failed to update authorized amount: ' + authAmountError.message);
                            console.error('[Process Pending Order] Failed to update authorized amount:', authAmountError);
                        } else {
                            console.log('[Process Pending Order] Successfully updated authorized_amount');
                        }
                    }

                    // Copy vendor selections and items (for Food orders)
                    if (upcomingOrder.service_type === 'Food') {
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

                                if (vsError || !newVs) {
                                    errors.push(`Failed to copy vendor selection: ${vsError?.message} `);
                                    continue;
                                }

                                // Copy items
                                const { data: items } = await supabase
                                    .from('upcoming_order_items')
                                    .select('*')
                                    .eq('vendor_selection_id', vs.id);

                                if (items) {
                                    for (const item of items) {
                                        const { error: itemError } = await supabase
                                            .from('order_items')
                                            .insert({
                                                order_id: newOrder.id,
                                                vendor_selection_id: newVs.id,
                                                menu_item_id: item.menu_item_id,
                                                quantity: item.quantity,
                                                unit_value: item.unit_value,
                                                total_value: item.total_value,
                                                notes: item.notes
                                            });

                                        if (itemError) {
                                            errors.push(`Failed to copy item: ${itemError.message} `);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    // Copy box selections (for Box orders)
                    if (upcomingOrder.service_type === 'Boxes') {
                        const { data: boxSelections } = await supabase
                            .from('upcoming_order_box_selections')
                            .select('*')
                            .eq('upcoming_order_id', upcomingOrder.id);

                        if (boxSelections) {
                            for (const bs of boxSelections) {
                                const { error: bsError } = await supabase
                                    .from('order_box_selections')
                                    .insert({
                                        order_id: newOrder.id,
                                        box_type_id: bs.box_type_id,
                                        vendor_id: bs.vendor_id,
                                        quantity: bs.quantity,
                                        unit_value: bs.unit_value || 0,
                                        total_value: bs.total_value || 0,
                                        items: bs.items || {}
                                    });

                                if (bsError) {
                                    errors.push(`Failed to copy box selection: ${bsError.message} `);
                                }
                            }
                        }
                    }

                    // Update upcoming order status to processed
                    await supabase
                        .from('upcoming_orders')
                        .update({
                            status: 'processed',
                            processed_order_id: newOrder.id,
                            processed_at: new Date().toISOString()
                        })
                        .eq('id', upcomingOrder.id);
                } catch (error: any) {
                    return {
                        success: false,
                        error: 'Error processing upcoming order: ' + error.message
                    };
                }
            }
        } else {
            // No case_id, can't check if processed, so just try to process
            // This is similar to above but we'll skip duplicate checking
            // Actually, let's return an error if there's no case_id as it's risky
            return {
                success: false,
                error: 'Upcoming order has no case_id, cannot safely process'
            };
        }
    }

    // Now update the order (from either upcoming or existing orders table) with proof URL
    // If order was just processed, it already has status 'billing_pending' and billing record created
    // Just update the proof URL and other fields
    const updateData: any = {
        delivery_proof_url: proofUrl.trim(),
        updated_by: currentUserName,
        last_updated: new Date().toISOString()
    };

    // Only update status and actual_delivery_date if order wasn't just processed
    if (!wasProcessed) {
        updateData.status = 'billing_pending';
        updateData.actual_delivery_date = new Date().toISOString();
    }

    const { data: order, error: updateError } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', finalOrderId)
        .select()
        .single();

    if (updateError || !order) {
        return {
            success: false,
            error: 'Failed to update order with proof URL: ' + (updateError?.message || 'Unknown error')
        };
    }

    // Only create billing record if order wasn't just processed (for existing orders)
    if (!wasProcessed) {
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
            // Create billing record if it doesn't exist
            const billingPayload = {
                client_id: order.client_id,
                client_name: client?.fullName || 'Unknown Client',
                order_id: order.id,
                status: 'pending',
                amount: order.total_value || 0,
                navigator: client?.navigator_id || 'Unknown',
                delivery_date: order.actual_delivery_date || new Date().toISOString(),
                remarks: 'Auto-generated upon proof upload'
            };

            const { error: billingError } = await supabase
                .from('billing_records')
                .insert([billingPayload]);

            if (billingError) {
                errors.push('Failed to create billing record: ' + billingError.message);
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
                errors.push('Failed to update authorized amount: ' + authAmountError.message);
            }
        }
    }

    revalidatePath('/vendors');
    revalidatePath('/clients');

    // Targeted local DB sync for this client
    if (order.client_id) {
        const { updateClientInLocalDB } = await import('./local-db');
        updateClientInLocalDB(order.client_id);
    }

    return {
        success: true,
        orderId: finalOrderId,
        wasProcessed,
        errors: errors.length > 0 ? errors : undefined,
        summary: {
            orderId: finalOrderId,
            caseId: order.case_id || 'N/A',
            clientId: order.client_id,
            serviceType: order.service_type,
            status: order.status,
            wasProcessed: wasProcessed,
            hasErrors: errors.length > 0,
            errors: errors.length > 0 ? errors : undefined
        }
    };
}

// --- VENDOR-SPECIFIC ACTIONS (for vendor portal) ---

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
            // Fallback if box selection is missing
            orderDetails = {
                serviceType: orderData.service_type,
                vendorId: null,
                vendorName: 'Unknown Vendor (Missing Selection Data)',
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

export async function deleteOrder(orderId: string) {
    if (!orderId) {
        return { success: false, message: 'Order ID is required' };
    }

    try {
        // Use Service Role to bypass RLS
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false } }
        );

        // Fetch order data to get clientId before deletion
        const { data: orderData } = await supabaseAdmin
            .from('orders')
            .select('client_id')
            .eq('id', orderId)
            .single();

        const clientId = orderData?.client_id;

        // 1. Get vendor selections to find related items
        const { data: vendorSelections } = await supabaseAdmin
            .from('order_vendor_selections')
            .select('id')
            .eq('order_id', orderId);

        if (vendorSelections && vendorSelections.length > 0) {
            const vsIds = vendorSelections.map(vs => vs.id);

            // 2. Delete order items
            const { error: itemsError } = await supabaseAdmin
                .from('order_items')
                .delete()
                .in('vendor_selection_id', vsIds);

            if (itemsError) throw itemsError;

            // 3. Delete vendor selections
            const { error: vsError } = await supabaseAdmin
                .from('order_vendor_selections')
                .delete()
                .eq('order_id', orderId);

            if (vsError) throw vsError;
        }

        // 4. Delete box selections
        const { error: boxError } = await supabaseAdmin
            .from('order_box_selections')
            .delete()
            .eq('order_id', orderId);

        if (boxError) throw boxError;

        // 5. Delete the order itself
        const { error: orderError } = await supabaseAdmin
            .from('orders')
            .delete()
            .eq('id', orderId);

        if (orderError) throw orderError;

        // Revalidate paths
        revalidatePath('/orders');
        revalidatePath(`/orders/${orderId}`);
        revalidatePath('/billing'); // Orders might affect billing view

        if (clientId) {
            // Trigger local DB sync in background for the affected client
            const { updateClientInLocalDB } = await import('./local-db');
            updateClientInLocalDB(clientId);
        }

        return { success: true };
    } catch (error: any) {
        console.error('Error deleting order:', error);
        return { success: false, message: error.message || 'An unknown error occurred' };
    }
}

export async function getBatchClientDetails(clientIds: string[]) {
    if (!clientIds || clientIds.length === 0) return {};
    const start = Date.now();

    try {
        const { getClientSubmissions } = await import('./form-actions');

        // Broad parallel fetches for all requested clients
        const [
            clientsData,
            historyData,
            orderHistoryData,
            billingHistoryData,
            ordersData,
            allUpcomingOrdersData,
            foodOrdersData,
            mealOrdersData,
            boxOrdersData,
            submissionsData
        ] = await Promise.all([
            supabase.from('clients').select('*').in('id', clientIds),
            supabase.from('client_history').select('*').in('client_id', clientIds).order('created_at', { ascending: false }),
            supabase.from('orders').select('*').in('client_id', clientIds).order('created_at', { ascending: false }),
            supabase.from('billing_history').select('*').in('client_id', clientIds).order('created_at', { ascending: false }),
            supabase.from('orders').select('*').in('client_id', clientIds).order('created_at', { ascending: false }).limit(20 * clientIds.length), // Get enough for recent orders
            supabase.from('upcoming_orders').select('*').in('client_id', clientIds),
            supabase.from('client_food_orders').select('*').in('client_id', clientIds),
            supabase.from('client_meal_orders').select('*').in('client_id', clientIds),
            supabase.from('client_box_orders').select('*').in('client_id', clientIds),
            getClientSubmissions(clientIds[0]) // Note: submissions might need a specific batch version, but for now we follow existing pattern or skip if too complex
        ]);

        // Helper to organize data per client
        const resultMap: Record<string, any> = {};

        for (const id of clientIds) {
            const clientRaw = (clientsData.data || []).find(c => c.id === id);
            if (!clientRaw) continue;

            const client = mapClientFromDB(clientRaw);
            const history = (historyData.data || []).filter(h => h.client_id === id);
            const orderHistory = (orderHistoryData.data || []).filter(oh => oh.client_id === id);
            const billingHistory = (billingHistoryData.data || []).filter(bh => bh.client_id === id);

            // For active/upcoming, we prefer using the local logic if possible, 
            // but for a true fallback or remote-only batch, we filtered them above.
            // Ideally we also fetch orders for the local-db to be populated.

            // For now, let's use the individual getters for complex nested logic (activeOrder/upcomingOrder)
            // BUT we already fetched the raw rows above to potentially optimize.
            // To maintain compatibility with the complex mapping logic in individual getters:
            const [activeOrder, upcomingOrder] = await Promise.all([
                getRecentOrdersForClient(id),
                getUpcomingOrderForClient(id)
            ]);

            resultMap[id] = {
                client,
                history,
                orderHistory,
                billingHistory,
                activeOrder,
                upcomingOrder,
                foodOrder: (foodOrdersData.data || []).find(fo => fo.client_id === id),
                mealOrder: (mealOrdersData.data || []).find(mo => mo.client_id === id),
                boxOrders: (boxOrdersData.data || []).filter(bo => bo.client_id === id),
                submissions: id === clientIds[0] ? (submissionsData?.data || []) : [] // Submissions only for first for now to avoid complexity
            };
        }

        const duration = Date.now() - start;
        console.log(`[Actions] getBatchClientDetails(${clientIds.length} clients) took ${duration}ms`);
        return resultMap;
    } catch (error) {
        console.error('Error in getBatchClientDetails:', error);
        return {};
    }
}

// --- INDEPENDENT ORDER ACTIONS ---

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

export async function saveClientFoodOrder(clientId: string, data: Partial<ClientFoodOrder>) {
    const session = await getSession();
    const updatedBy = session?.userId || null;

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const payload: any = {
        client_id: clientId,
        case_id: data.caseId,
        delivery_day_orders: data.deliveryDayOrders,
        notes: data.notes,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy
    };

    // Check if order exists first
    const { data: existing } = await supabaseAdmin
        .from('client_food_orders')
        .select('id')
        .eq('client_id', clientId)
        .single();

    let query;
    if (existing) {
        query = supabaseAdmin
            .from('client_food_orders')
            .update(payload)
            .eq('id', existing.id);
    } else {
        query = supabaseAdmin
            .from('client_food_orders')
            .insert(payload);
    }

    const { data: saved, error } = await query.select().single();

    handleError(error);
    revalidatePath(`/client-portal/${clientId}`);
    revalidatePath(`/clients/${clientId}`);
    return saved;
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

export async function saveClientMealOrder(clientId: string, data: Partial<ClientMealOrder>) {
    const session = await getSession();
    const updatedBy = session?.userId || null;
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const payload: any = {
        client_id: clientId,
        case_id: data.caseId,
        meal_selections: data.mealSelections,
        notes: data.notes,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy
    };

    // Check for existing order
    const { data: existing } = await supabaseAdmin
        .from('client_meal_orders')
        .select('id')
        .eq('client_id', clientId)
        .single();

    let query;
    if (existing) {
        query = supabaseAdmin
            .from('client_meal_orders')
            .update(payload)
            .eq('id', existing.id);
    } else {
        query = supabaseAdmin
            .from('client_meal_orders')
            .insert(payload);
    }

    const { data: saved, error } = await query.select().single();

    handleError(error);
    revalidatePath(`/client-portal/${clientId}`);
    revalidatePath(`/clients/${clientId}`);
    return saved;
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

export async function saveClientBoxOrder(clientId: string, data: Partial<ClientBoxOrder>[]) {
    const session = await getSession();
    const updatedBy = session?.userId || null;
    // if (!session || !session.userId) throw new Error('Unauthorized');
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Full replacement strategy: Delete all existing box orders for this client first
    const { error: deleteError } = await supabaseAdmin
        .from('client_box_orders')
        .delete()
        .eq('client_id', clientId);

    if (deleteError) {
        handleError(deleteError);
        throw deleteError;
    }

    if (!data || data.length === 0) {
        revalidatePath(`/client-portal/${clientId}`);
        revalidatePath(`/clients/${clientId}`);
        return [];
    }

    console.log('[saveClientBoxOrder] Received data:', JSON.stringify(data, null, 2));

    const insertPayload = data.map(order => {
        const payload: any = {
            client_id: clientId,
            case_id: order.caseId,
            box_type_id: order.boxTypeId,
            vendor_id: order.vendorId,
            quantity: order.quantity,
            items: order.items,
            item_notes: (order as any).itemNotes, // Save item notes to DB

            // notes: order.notes // Removed per user request
        };
        if (updatedBy) payload.updated_by = updatedBy;
        return payload;
    });

    let { data: created, error } = await supabaseAdmin
        .from('client_box_orders')
        .insert(insertPayload)
        .select();

    if (error && error.code === '23503') {
        const payloadWithoutUser = insertPayload.map(p => {
            const { updated_by, ...rest } = p;
            return rest;
        });
        const retry = await supabaseAdmin
            .from('client_box_orders')
            .insert(payloadWithoutUser)
            .select();
        created = retry.data;
        error = retry.error;
    }
    handleError(error);
    revalidatePath(`/client-portal/${clientId}`);
    revalidatePath(`/clients/${clientId}`);
    return created;
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
