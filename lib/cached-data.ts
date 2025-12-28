'use client';

/**
 * Cached wrapper functions around server actions
 * These functions check cache first before calling server actions
 */

import {
    getStatuses as serverGetStatuses,
    getNavigators as serverGetNavigators,
    getVendors as serverGetVendors,
    getMenuItems as serverGetMenuItems,
    getBoxTypes as serverGetBoxTypes,
    getCategories as serverGetCategories,
    getSettings as serverGetSettings,
    getClients as serverGetClients,
    getClient as serverGetClient,
} from './actions';

import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, AppSettings, ItemCategory } from './types';

// Cache entry with timestamp
interface CacheEntry<T> {
    data: T;
    timestamp: number;
}

// Cache configuration
const CACHE_DURATION = {
    REFERENCE_DATA: 5 * 60 * 1000, // 5 minutes for reference data
    CLIENT_DATA: 2 * 60 * 1000, // 2 minutes for client-specific data
    CLIENT_LIST: 1 * 60 * 1000, // 1 minute for client list
};

// In-memory cache stores (shared across all calls)
const referenceCache: Map<string, CacheEntry<any>> = new Map();
let clientsCache: CacheEntry<ClientProfile[]> | undefined;
const clientCache: Map<string, CacheEntry<ClientProfile>> = new Map();

// Helper to check if cache entry is stale
function isStale<T>(entry: CacheEntry<T> | undefined, duration: number): boolean {
    if (!entry) return true;
    return Date.now() - entry.timestamp > duration;
}

// Reference data getters (cached)
export async function getStatuses(): Promise<ClientStatus[]> {
    const cached = referenceCache.get('statuses');
    if (!isStale(cached, CACHE_DURATION.REFERENCE_DATA)) {
        return cached!.data;
    }
    const data = await serverGetStatuses();
    referenceCache.set('statuses', { data, timestamp: Date.now() });
    return data;
}

export async function getNavigators(): Promise<Navigator[]> {
    const cached = referenceCache.get('navigators');
    if (!isStale(cached, CACHE_DURATION.REFERENCE_DATA)) {
        return cached!.data;
    }
    const data = await serverGetNavigators();
    referenceCache.set('navigators', { data, timestamp: Date.now() });
    return data;
}

export async function getVendors(): Promise<Vendor[]> {
    const cached = referenceCache.get('vendors');
    if (!isStale(cached, CACHE_DURATION.REFERENCE_DATA)) {
        return cached!.data;
    }
    const data = await serverGetVendors();
    referenceCache.set('vendors', { data, timestamp: Date.now() });
    return data;
}

export async function getMenuItems(): Promise<MenuItem[]> {
    const cached = referenceCache.get('menuItems');
    if (!isStale(cached, CACHE_DURATION.REFERENCE_DATA)) {
        return cached!.data;
    }
    const data = await serverGetMenuItems();
    referenceCache.set('menuItems', { data, timestamp: Date.now() });
    return data;
}

export async function getBoxTypes(): Promise<BoxType[]> {
    const cached = referenceCache.get('boxTypes');
    if (!isStale(cached, CACHE_DURATION.REFERENCE_DATA)) {
        return cached!.data;
    }
    const data = await serverGetBoxTypes();
    referenceCache.set('boxTypes', { data, timestamp: Date.now() });
    return data;
}

export async function getCategories(): Promise<ItemCategory[]> {
    const cached = referenceCache.get('categories');
    if (!isStale(cached, CACHE_DURATION.REFERENCE_DATA)) {
        return cached!.data;
    }
    const data = await serverGetCategories();
    referenceCache.set('categories', { data, timestamp: Date.now() });
    return data;
}

export async function getSettings(): Promise<AppSettings> {
    const cached = referenceCache.get('settings');
    if (!isStale(cached, CACHE_DURATION.REFERENCE_DATA)) {
        return cached!.data;
    }
    const data = await serverGetSettings();
    referenceCache.set('settings', { data, timestamp: Date.now() });
    return data;
}

// Client data getters (cached)
export async function getClients(): Promise<ClientProfile[]> {
    if (!isStale(clientsCache, CACHE_DURATION.CLIENT_LIST)) {
        return clientsCache!.data;
    }
    const data = await serverGetClients();
    clientsCache = { data, timestamp: Date.now() };
    return data;
}

export async function getClient(id: string): Promise<ClientProfile | undefined> {
    const cached = clientCache.get(id);
    if (!isStale(cached, CACHE_DURATION.CLIENT_DATA)) {
        return cached!.data;
    }
    const data = await serverGetClient(id);
    if (data !== undefined) {
        clientCache.set(id, { data, timestamp: Date.now() });
    }
    return data;
}

// Cache invalidation functions
export function invalidateReferenceData(key?: string) {
    if (key) {
        referenceCache.delete(key);
    } else {
        referenceCache.clear();
    }
}

export function invalidateClientData(clientId?: string) {
    if (clientId) {
        clientCache.delete(clientId);
    } else {
        clientCache.clear();
        clientsCache = undefined;
    }
}

export function invalidateAll() {
    referenceCache.clear();
    clientCache.clear();
    clientsCache = undefined;
}

