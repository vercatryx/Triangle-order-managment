'use client';

import { useState, useEffect, useMemo } from 'react';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ItemCategory, BoxQuota } from '@/lib/types';
import { syncCurrentOrderToUpcoming, getBoxQuotas, invalidateOrderData, updateClient } from '@/lib/actions';
import { Package, Truck, User, Loader2, Info, Plus, Calendar, AlertTriangle, Check, Trash2, History, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import styles from './ClientProfile.module.css';

interface Props {
    client: ClientProfile;
    statuses: ClientStatus[];
    navigators: Navigator[];
    vendors: Vendor[];
    menuItems: MenuItem[];
    boxTypes: BoxType[];
    categories: ItemCategory[];
    upcomingOrder: any;
    activeOrder: any;
    previousOrders: any[];
}

export function ClientPortalInterface({ client: initialClient, statuses, navigators, vendors, menuItems, boxTypes, categories, upcomingOrder, activeOrder, previousOrders }: Props) {
    const [client, setClient] = useState<ClientProfile>(initialClient);
    const [activeBoxQuotas, setActiveBoxQuotas] = useState<BoxQuota[]>([]);


    // Profile State
    const [profileData, setProfileData] = useState({
        fullName: initialClient.fullName,
        email: initialClient.email || '',
        phoneNumber: initialClient.phoneNumber || '',
        address: initialClient.address || ''
    });
    const [originalProfileData, setOriginalProfileData] = useState({
        fullName: initialClient.fullName,
        email: initialClient.email || '',
        phoneNumber: initialClient.phoneNumber || '',
        address: initialClient.address || ''
    });

    // Order Configuration State
    const [orderConfig, setOrderConfig] = useState<any>({});
    const [originalOrderConfig, setOriginalOrderConfig] = useState<any>({});

    // UI State
    const [saving, setSaving] = useState(false);
    const [savingProfile, setSavingProfile] = useState(false);
    const [message, setMessage] = useState<string | null>('');
    const [profileMessage, setProfileMessage] = useState<string | null>('');
    const [showPreviousOrders, setShowPreviousOrders] = useState(false);

    // Sync profile data when initialClient changes
    useEffect(() => {
        setProfileData({
            fullName: initialClient.fullName,
            email: initialClient.email || '',
            phoneNumber: initialClient.phoneNumber || '',
            address: initialClient.address || ''
        });
        setOriginalProfileData({
            fullName: initialClient.fullName,
            email: initialClient.email || '',
            phoneNumber: initialClient.phoneNumber || '',
            address: initialClient.address || ''
        });
        setClient(initialClient);
    }, [initialClient]);

    // Initialize state
    useEffect(() => {
        // Use a ref to track if we've already initialized to prevent overwriting user changes
        const currentItems = (orderConfig as any)?.items;
        const hasExistingItems = currentItems && typeof currentItems === 'object' && Object.keys(currentItems).length > 0;
        
        console.log('[ClientPortal] Initialization useEffect triggered', {
            hasUpcomingOrder: !!upcomingOrder,
            upcomingOrderType: typeof upcomingOrder,
            upcomingOrderKeys: upcomingOrder ? Object.keys(upcomingOrder) : [],
            currentOrderConfigItems: hasExistingItems ? Object.keys(currentItems).length : 0,
            currentOrderConfigItemsData: currentItems,
            upcomingOrderItems: upcomingOrder?.items ? Object.keys(upcomingOrder.items).length : 0,
            upcomingOrderItemsData: upcomingOrder?.items,
            willPreserveItems: hasExistingItems && (!upcomingOrder || !upcomingOrder.items || Object.keys(upcomingOrder.items || {}).length === 0)
        });
        
        let configToSet: any = {};

        if (upcomingOrder) {
            // Logic copied from ClientProfile.tsx - handle multi-day format only for Food
            const isMultiDayFormat = upcomingOrder && typeof upcomingOrder === 'object' &&
                !upcomingOrder.serviceType &&
                !upcomingOrder.deliveryDayOrders &&
                Object.keys(upcomingOrder).some(key => {
                    const val = (upcomingOrder as any)[key];
                    return val && val.serviceType;
                });

            if (isMultiDayFormat) {
                // Convert to deliveryDayOrders format (copied from ClientProfile)
                const deliveryDayOrders: any = {};
                for (const day of Object.keys(upcomingOrder)) {
                    const dayOrder = (upcomingOrder as any)[day];
                    if (dayOrder && dayOrder.serviceType) {
                        deliveryDayOrders[day] = {
                            vendorSelections: dayOrder.vendorSelections || []
                        };
                    }
                }
                // Check if it's Boxes - if so, flatten it to single order config (like ClientProfile does)
                const firstDayKey = Object.keys(upcomingOrder)[0];
                const firstDayOrder = (upcomingOrder as any)[firstDayKey];

                if (firstDayOrder?.serviceType === 'Boxes') {
                    configToSet = firstDayOrder;
                } else {
                    configToSet = {
                        serviceType: firstDayOrder?.serviceType || client.serviceType,
                        caseId: firstDayOrder?.caseId,
                        deliveryDayOrders
                    };
                }
            } else if (upcomingOrder.serviceType === 'Food' && !upcomingOrder.vendorSelections && !upcomingOrder.deliveryDayOrders) {
                // Migration/Safety: Ensure vendorSelections exists for Food
                if (upcomingOrder.vendorId) {
                    upcomingOrder.vendorSelections = [{ vendorId: upcomingOrder.vendorId, items: upcomingOrder.menuSelections || {} }];
                } else {
                    upcomingOrder.vendorSelections = [{ vendorId: '', items: {} }];
                }
                configToSet = upcomingOrder;
            } else {
                // For Boxes or other service types, use upcomingOrder directly (like ClientProfile does)
                configToSet = upcomingOrder;
            }
        } else if (activeOrder) {
            // No upcoming order, but we have active_order from clients table - use that
            // This ensures vendorId, items, and other Boxes data are preserved even if sync to upcoming_orders failed
            configToSet = { ...activeOrder };
            // Ensure serviceType matches client's service type
            if (!configToSet.serviceType) {
                configToSet.serviceType = client.serviceType;
            }
        } else {
            // No upcoming order and no active_order, initialize with default
            const defaultOrder: any = { serviceType: client.serviceType };
            if (client.serviceType === 'Food') {
                defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
            }
            configToSet = defaultOrder;
        }

        console.log('[ClientPortal] Setting orderConfig:', {
            serviceType: configToSet.serviceType,
            itemsCount: configToSet.items ? Object.keys(configToSet.items).length : 0,
            items: configToSet.items,
            fullConfig: JSON.stringify(configToSet, null, 2)
        });
        
        setOrderConfig(configToSet);
        setOriginalOrderConfig(JSON.parse(JSON.stringify(configToSet)));
    }, [upcomingOrder, client.serviceType, boxTypes]);

    // Box Logic - Load quotas if boxTypeId is set (optional for box contents)
    useEffect(() => {
        if (client.serviceType === 'Boxes' && orderConfig.boxTypeId) {
            getBoxQuotas(orderConfig.boxTypeId).then(quotas => {
                setActiveBoxQuotas(quotas);
            }).catch(err => {
                console.error('Error loading box quotas:', err);
                setActiveBoxQuotas([]);
            });
        } else {
            setActiveBoxQuotas([]);
        }
    }, [orderConfig.boxTypeId, client.serviceType]);

    // Extract dependencies for auto-save
    const caseId = useMemo(() => orderConfig?.caseId ?? null, [orderConfig?.caseId]);
    const vendorSelections = useMemo(() => orderConfig?.vendorSelections ?? [], [orderConfig?.vendorSelections]);
    const vendorId = useMemo(() => orderConfig?.vendorId ?? null, [orderConfig?.vendorId]);
    const boxTypeId = useMemo(() => orderConfig?.boxTypeId ?? null, [orderConfig?.boxTypeId]);
    const boxQuantity = useMemo(() => orderConfig?.boxQuantity ?? null, [orderConfig?.boxQuantity]);
    const items = useMemo(() => (orderConfig as any)?.items ?? {}, [JSON.stringify((orderConfig as any)?.items)]);
    const itemPrices = useMemo(() => (orderConfig as any)?.itemPrices ?? {}, [(orderConfig as any)?.itemPrices]);
    const serviceType = client.serviceType;

    // Auto-Save Logic
    useEffect(() => {
        if (!client || !orderConfig) return;

        const simpleCheck = JSON.stringify(orderConfig) === JSON.stringify(originalOrderConfig);
        if (simpleCheck) return;

        const timeoutId = setTimeout(async () => {
            try {
                const cleanedOrderConfig = { ...orderConfig };
                cleanedOrderConfig.updatedBy = 'Client';

                if (serviceType === 'Food') {
                    if (cleanedOrderConfig.deliveryDayOrders) {
                        for (const day of Object.keys(cleanedOrderConfig.deliveryDayOrders)) {
                            cleanedOrderConfig.deliveryDayOrders[day].vendorSelections = (cleanedOrderConfig.deliveryDayOrders[day].vendorSelections || [])
                                .filter((s: any) => s.vendorId)
                                .map((s: any) => ({
                                    vendorId: s.vendorId,
                                    items: s.items || {}
                                }));
                        }
                    } else if (cleanedOrderConfig.vendorSelections) {
                        const hasPerVendorDeliveryDays = cleanedOrderConfig.vendorSelections.some((s: any) =>
                            s.selectedDeliveryDays && s.selectedDeliveryDays.length > 0 && s.itemsByDay
                        );

                        if (hasPerVendorDeliveryDays) {
                            const deliveryDayOrders: any = {};
                            for (const selection of cleanedOrderConfig.vendorSelections) {
                                if (!selection.vendorId || !selection.selectedDeliveryDays || !selection.itemsByDay) continue;
                                for (const day of selection.selectedDeliveryDays) {
                                    if (!deliveryDayOrders[day]) {
                                        deliveryDayOrders[day] = { vendorSelections: [] };
                                    }
                                    deliveryDayOrders[day].vendorSelections.push({
                                        vendorId: selection.vendorId,
                                        items: selection.itemsByDay[day] || {}
                                    });
                                }
                            }
                            cleanedOrderConfig.deliveryDayOrders = deliveryDayOrders;
                            cleanedOrderConfig.vendorSelections = undefined;
                        } else {
                            cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                                .filter((s: any) => s.vendorId)
                                .map((s: any) => ({
                                    vendorId: s.vendorId,
                                    items: s.items || {}
                                }));
                        }
                    }
                } else if (serviceType === 'Boxes') {
                    // For Boxes: Preserve items, boxTypeId, boxQuantity, and itemPrices
                    cleanedOrderConfig.items = cleanedOrderConfig.items || {};
                    cleanedOrderConfig.boxQuantity = cleanedOrderConfig.boxQuantity || 1;
                    // Preserve boxTypeId and itemPrices if they exist
                    if (cleanedOrderConfig.boxTypeId !== undefined) {
                        cleanedOrderConfig.boxTypeId = cleanedOrderConfig.boxTypeId;
                    }
                    if (cleanedOrderConfig.itemPrices !== undefined) {
                        cleanedOrderConfig.itemPrices = cleanedOrderConfig.itemPrices;
                    }
                    // Debug: Log box items being saved
                    console.log('[ClientPortal] Saving Boxes order:', {
                        itemsCount: Object.keys(cleanedOrderConfig.items || {}).length,
                        items: cleanedOrderConfig.items,
                        boxTypeId: cleanedOrderConfig.boxTypeId,
                        boxQuantity: cleanedOrderConfig.boxQuantity
                    });
                }

                setSaving(true);
                setMessage('Saving...');

                const tempClient: ClientProfile = {
                    ...client,
                    activeOrder: {
                        ...cleanedOrderConfig,
                        serviceType: serviceType,
                        lastUpdated: new Date().toISOString(),
                        updatedBy: 'Client'
                    }
                } as ClientProfile;

                await syncCurrentOrderToUpcoming(client.id, tempClient);

                // After saving, update originalOrderConfig to prevent re-saving
                // But keep the current orderConfig with items intact
                const savedConfig = JSON.parse(JSON.stringify(orderConfig));
                setOriginalOrderConfig(savedConfig);
                console.log('[ClientPortal] After save - orderConfig:', JSON.stringify(orderConfig, null, 2));
                console.log('[ClientPortal] After save - originalOrderConfig:', JSON.stringify(savedConfig, null, 2));
                
                setSaving(false);
                setMessage('Saved');
                setTimeout(() => setMessage(null), 2000);
            } catch (error) {
                console.error('Error saving Service Configuration:', error);
                setSaving(false);
                setMessage('Error saving');
            }
        }, 1000);

        return () => clearTimeout(timeoutId);
    }, [caseId, vendorSelections, vendorId, boxTypeId, boxQuantity, items, itemPrices, serviceType, client, JSON.stringify(orderConfig), JSON.stringify(originalOrderConfig)]);

    // Auto-Save Profile Logic
    useEffect(() => {
        if (!client) return;

        const profileChanged = 
            profileData.fullName !== originalProfileData.fullName ||
            profileData.email !== originalProfileData.email ||
            profileData.phoneNumber !== originalProfileData.phoneNumber ||
            profileData.address !== originalProfileData.address;

        if (!profileChanged) return;

        const timeoutId = setTimeout(async () => {
            try {
                setSavingProfile(true);
                setProfileMessage('Saving...');

                await updateClient(client.id, {
                    fullName: profileData.fullName,
                    email: profileData.email || null,
                    phoneNumber: profileData.phoneNumber || '',
                    address: profileData.address || ''
                });

                setOriginalProfileData({ ...profileData });
                setSavingProfile(false);
                setProfileMessage('Saved');
                setTimeout(() => setProfileMessage(null), 2000);
            } catch (error) {
                console.error('Error saving profile:', error);
                setSavingProfile(false);
                setProfileMessage('Error saving');
            }
        }, 1000);

        return () => clearTimeout(timeoutId);
    }, [profileData, originalProfileData, client]);


    // -- LOGIC HELPERS --

    function getVendorMenuItems(vendorId: string) {
        return menuItems.filter(i => i.vendorId === vendorId && i.isActive);
    }

    function handleBoxItemChange(itemId: string, qty: number) {
        const currentItems = { ...(orderConfig.items || {}) };
        if (qty > 0) {
            currentItems[itemId] = qty;
        } else {
            delete currentItems[itemId];
        }
        setOrderConfig({ ...orderConfig, items: currentItems });
    }

    function getVendorSelectionsForDay(day: string | null): any[] {
        if (!orderConfig.deliveryDayOrders) {
            return orderConfig.vendorSelections || [];
        }
        if (day && orderConfig.deliveryDayOrders[day]) {
            return orderConfig.deliveryDayOrders[day].vendorSelections || [];
        }
        // If getting all (null) but in multi-day format, we need to flatten/combine.
        // For simple iteration of *active* selections across all days:
        let allSelections: any[] = [];
        if (orderConfig.deliveryDayOrders) {
            Object.values(orderConfig.deliveryDayOrders).forEach((dayOrder: any) => {
                if (dayOrder.vendorSelections) {
                    allSelections = [...allSelections, ...dayOrder.vendorSelections];
                }
            });
        }
        return allSelections;
    }

    function getVendorMealCount(vendorId: string, selection: any): number {
        if (!selection) return 0;
        // Handle per-vendor delivery days (itemsByDay)
        if (selection.itemsByDay && selection.selectedDeliveryDays) {
            let total = 0;
            for (const deliveryDay of selection.selectedDeliveryDays) {
                const dayItems = selection.itemsByDay[deliveryDay] || {};
                total += Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
            }
            return total;
        }
        // Normal items structure
        if (!selection.items) return 0;
        let total = 0;
        for (const [itemId, qty] of Object.entries(selection.items)) {
            total += (qty as number) || 0;
        }
        return total;
    }

    function getTotalMealCountAllDays(): number {
        // If editing in 'vendorSelections' mode (transient state before save)
        if (orderConfig.vendorSelections) {
            let total = 0;
            for (const selection of orderConfig.vendorSelections) {
                total += getVendorMealCount(selection.vendorId, selection);
            }
            return total;
        }
        // If in saved/multi-day format
        if (orderConfig.deliveryDayOrders) {
            let total = 0;
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                // simple summation of items in that day
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const sel of daySelections) {
                    const items = sel.items || {};
                    total += Object.values(items).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
                }
            }
            return total;
        }
        return 0;
    }

    function getCurrentOrderTotalValueAllDays(): number {
        // If editing in 'vendorSelections' mode
        if (orderConfig.vendorSelections) {
            let total = 0;
            for (const selection of orderConfig.vendorSelections) {
                // Calculate value
                if (selection.itemsByDay && selection.selectedDeliveryDays) {
                    for (const day of selection.selectedDeliveryDays) {
                        const dayItems = selection.itemsByDay[day] || {};
                        for (const [itemId, qty] of Object.entries(dayItems)) {
                            const item = menuItems.find(i => i.id === itemId);
                            total += (item ? item.value * (qty as number) : 0);
                        }
                    }
                } else if (selection.items) {
                    for (const [itemId, qty] of Object.entries(selection.items)) {
                        const item = menuItems.find(i => i.id === itemId);
                        total += (item ? item.value * (qty as number) : 0);
                    }
                }
            }
            return total;
        }
        // If in saved/multi-day format
        if (orderConfig.deliveryDayOrders) {
            let total = 0;
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const sel of daySelections) {
                    const items = sel.items || {};
                    for (const [itemId, qty] of Object.entries(items)) {
                        const item = menuItems.find(i => i.id === itemId);
                        total += (item ? item.value * (qty as number) : 0);
                    }
                }
            }
            return total;
        }
        return 0;
    }

    // -- RENDER HELPERS --

    const renderFoodOrderSection = () => {
        // Multi-day parsing logic for UI
        const isAlreadyMultiDay = orderConfig.deliveryDayOrders && typeof orderConfig.deliveryDayOrders === 'object';
        let currentSelections = orderConfig.vendorSelections || [];

        if (isAlreadyMultiDay && (!orderConfig.vendorSelections || orderConfig.vendorSelections.length === 0)) {
            // Convert saved deliveryDayOrders back to per-vendor format for editing if not already done
            const deliveryDays = Object.keys(orderConfig.deliveryDayOrders).sort();
            const vendorMap = new Map<string, any>();

            const vendorsByDay: { [day: string]: any[] } = {};
            for (const day of deliveryDays) {
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const sel of daySelections) {
                    if (!sel.vendorId) continue;
                    if (!vendorsByDay[day]) vendorsByDay[day] = [];
                    vendorsByDay[day].push(sel);
                }
            }

            for (const day of deliveryDays) {
                for (const sel of vendorsByDay[day] || []) {
                    if (!vendorMap.has(sel.vendorId)) {
                        vendorMap.set(sel.vendorId, {
                            vendorId: sel.vendorId,
                            selectedDeliveryDays: [],
                            itemsByDay: {}
                        });
                    }
                    const vendorSel = vendorMap.get(sel.vendorId);
                    if (!vendorSel.selectedDeliveryDays.includes(day)) {
                        vendorSel.selectedDeliveryDays.push(day);
                    }
                    vendorSel.itemsByDay[day] = sel.items || {};
                }
            }
            if (Array.from(vendorMap.values()).length > 0) {
                currentSelections = Array.from(vendorMap.values());
            }
        }

        // This 'conversion' is transient for render if we haven't 'touched' the config yet. 
        // If user interacts, we write to `orderConfig.vendorSelections` inside the handlers, breaking out of `deliveryDayOrders` mode.
        const selectionsToRender = (orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0)
            ? orderConfig.vendorSelections
            : currentSelections;

        return (
            <div className={styles.vendorsList}>
                {/* Budget Header */}
                <div className={styles.orderHeader} style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4>Your Selections</h4>
                    <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <div className={styles.budget} style={{
                            color: getTotalMealCountAllDays() > (client.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'inherit',
                            backgroundColor: getTotalMealCountAllDays() > (client.approvedMealsPerWeek || 0) ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface-hover)',
                            padding: '4px 8px', borderRadius: '4px', fontSize: '0.9rem', fontWeight: 500
                        }}>
                            Meals: {getTotalMealCountAllDays()} / {client.approvedMealsPerWeek || 0}
                        </div>
                    </div>
                </div>

                {selectionsToRender.map((selection: any, index: number) => {
                    const vendor = selection.vendorId ? vendors.find(v => v.id === selection.vendorId) : null;
                    const vendorHasMultipleDays = vendor && vendor.deliveryDays && vendor.deliveryDays.length > 1;
                    const vendorDeliveryDays = vendor?.deliveryDays || [];
                    const vendorSelectedDays = (selection.selectedDeliveryDays || []) as string[];
                    const vendorMinimum = vendor?.minimumMeals || 0;

                    return (
                        <div key={index} className={styles.vendorBlock}>
                            <div className={styles.vendorHeader}>
                                <select
                                    className="input"
                                    value={selection.vendorId}
                                    onChange={e => {
                                        const newSelections = [...selectionsToRender];
                                        newSelections[index] = { ...newSelections[index], vendorId: e.target.value, items: {}, itemsByDay: {}, selectedDeliveryDays: [] };
                                        setOrderConfig({ ...orderConfig, vendorSelections: newSelections, deliveryDayOrders: undefined });
                                    }}
                                >
                                    <option value="">Select Vendor...</option>
                                    {vendors.filter(v => v.serviceTypes.includes('Food') && v.isActive).map(v => (
                                        <option key={v.id} value={v.id} disabled={selectionsToRender.some((s: any, i: number) => i !== index && s.vendorId === v.id)}>
                                            {v.name}
                                        </option>
                                    ))}
                                </select>
                                <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => {
                                    const newSelections = [...selectionsToRender];
                                    newSelections.splice(index, 1);
                                    setOrderConfig({ ...orderConfig, vendorSelections: newSelections, deliveryDayOrders: undefined });
                                }} title="Remove Vendor">
                                    <Trash2 size={16} />
                                </button>
                            </div>

                            {/* Delivery Day Selection */}
                            {selection.vendorId && vendorHasMultipleDays && (
                                <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg-surface-hover)', borderRadius: 'var(--radius-sm)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                        <Calendar size={16} />
                                        <span>Select delivery days for {vendor?.name}:</span>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        {vendorDeliveryDays.map((day: string) => {
                                            const isSelected = vendorSelectedDays.includes(day);
                                            return (
                                                <button
                                                    key={day}
                                                    type="button"
                                                    onClick={() => {
                                                        const newSelected = isSelected
                                                            ? vendorSelectedDays.filter((d: string) => d !== day)
                                                            : [...vendorSelectedDays, day];

                                                        const updated = [...selectionsToRender];
                                                        updated[index] = {
                                                            ...updated[index],
                                                            selectedDeliveryDays: newSelected,
                                                            itemsByDay: (() => {
                                                                const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                if (!isSelected) { itemsByDay[day] = {}; } // Adding
                                                                else { delete itemsByDay[day]; } // Removing
                                                                return itemsByDay;
                                                            })()
                                                        };
                                                        setOrderConfig({ ...orderConfig, vendorSelections: updated, deliveryDayOrders: undefined });
                                                    }}
                                                    style={{
                                                        padding: '0.5rem 1rem',
                                                        borderRadius: 'var(--radius-sm)',
                                                        border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                                        backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--bg-app)',
                                                        color: isSelected ? 'white' : 'var(--text-primary)',
                                                        cursor: 'pointer',
                                                        fontSize: '0.85rem',
                                                        fontWeight: isSelected ? 600 : 400
                                                    }}
                                                >
                                                    {day}
                                                    {isSelected && <Check size={14} style={{ marginLeft: '0.25rem', display: 'inline' }} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Item Inputs */}
                            {selection.vendorId && (() => {
                                // If multiple days
                                if (vendorHasMultipleDays && vendorSelectedDays.length > 0) {
                                    return vendorSelectedDays.map((day: string) => {
                                        const dayItems = (selection.itemsByDay || {})[day] || {};
                                        const dayMealCount = Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
                                        const meetsMinimum = vendorMinimum === 0 || dayMealCount >= vendorMinimum;

                                        return (
                                            <div key={day} style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: meetsMinimum ? 'transparent' : 'rgba(239, 68, 68, 0.05)' }}>
                                                <div style={{ marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <Calendar size={16} />
                                                        <strong>{day}</strong>
                                                    </div>
                                                    {vendorMinimum > 0 && (
                                                        <div style={{ fontSize: '0.85rem', color: meetsMinimum ? 'var(--text-primary)' : 'var(--color-danger)', fontWeight: 500 }}>
                                                            Meals: {dayMealCount} / {vendorMinimum} min
                                                        </div>
                                                    )}
                                                </div>

                                                {vendorMinimum > 0 && !meetsMinimum && (
                                                    <div style={{ marginBottom: '0.75rem', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-danger)', backgroundColor: 'rgba(239, 68, 68, 0.1)', fontSize: '0.8rem', color: 'var(--color-danger)', display: 'flex', alignItems: 'center' }}>
                                                        <AlertTriangle size={14} style={{ marginRight: '8px' }} />
                                                        Minimum {vendorMinimum} meals required for {day}
                                                    </div>
                                                )}

                                                <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                                    {getVendorMenuItems(selection.vendorId).map(item => {
                                                        const qty = Number(dayItems[item.id] || 0);
                                                        return (
                                                            <div key={item.id} className={styles.menuItemCard} style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)' }}>
                                                                <div style={{ marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>{item.name}</div>
                                                                <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <button onClick={() => {
                                                                        const updated = [...selectionsToRender];
                                                                        const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                        if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                        const newQty = Math.max(0, qty - 1);
                                                                        if (newQty > 0) itemsByDay[day][item.id] = newQty;
                                                                        else delete itemsByDay[day][item.id];
                                                                        updated[index] = { ...updated[index], itemsByDay };
                                                                        setOrderConfig({ ...orderConfig, vendorSelections: updated, deliveryDayOrders: undefined });
                                                                    }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                    <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                    <button onClick={() => {
                                                                        const updated = [...selectionsToRender];
                                                                        const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                        if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                        itemsByDay[day][item.id] = qty + 1;
                                                                        updated[index] = { ...updated[index], itemsByDay };
                                                                        setOrderConfig({ ...orderConfig, vendorSelections: updated, deliveryDayOrders: undefined });
                                                                    }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    });
                                } else if (!vendorHasMultipleDays) {
                                    // Single Day / Standard
                                    return (
                                        <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                            {getVendorMenuItems(selection.vendorId).map(item => {
                                                const qty = Number((selection.items || {})[item.id] || 0);
                                                return (
                                                    <div key={item.id} className={styles.menuItemCard} style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)' }}>
                                                        <div style={{ marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>{item.name}</div>
                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <button onClick={() => {
                                                                const updated = [...selectionsToRender];
                                                                const items = { ...(updated[index].items || {}) };
                                                                const newQty = Math.max(0, qty - 1);
                                                                if (newQty > 0) items[item.id] = newQty;
                                                                else delete items[item.id];
                                                                updated[index] = { ...updated[index], items };
                                                                setOrderConfig({ ...orderConfig, vendorSelections: updated, deliveryDayOrders: undefined });
                                                            }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                            <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                            <button onClick={() => {
                                                                const updated = [...selectionsToRender];
                                                                const items = { ...(updated[index].items || {}) };
                                                                items[item.id] = qty + 1;
                                                                updated[index] = { ...updated[index], items };
                                                                setOrderConfig({ ...orderConfig, vendorSelections: updated, deliveryDayOrders: undefined });
                                                            }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                }
                            })()}
                        </div>
                    );
                })}

                <button className={styles.addVendorBtn} onClick={() => {
                    const newSelections = [...selectionsToRender, { vendorId: '', items: {} }];
                    setOrderConfig({ ...orderConfig, vendorSelections: newSelections, deliveryDayOrders: undefined });
                }}>
                    <Plus size={16} /> Add Vendor
                </button>
            </div>
        );
    };

    return (
        <div className={styles.container}>
            <div className={styles.grid}>
                {/* Access Profile - Editable */}
                <div className={styles.card}>
                    <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <User size={20} />
                            Profile Information
                        </div>
                        {savingProfile && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}><Loader2 className="animate-spin" size={14} /> Saving...</span>}
                        {profileMessage && !savingProfile && <span style={{ fontSize: '0.8rem', color: 'var(--color-success)' }}>{profileMessage}</span>}
                    </div>
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
                            <div>
                                <label className="label">Full Name</label>
                                <input
                                    type="text"
                                    className="input"
                                    value={profileData.fullName}
                                    onChange={(e) => setProfileData({ ...profileData, fullName: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="label">Email Address</label>
                                <input
                                    type="email"
                                    className="input"
                                    value={profileData.email}
                                    onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="label">Phone Number</label>
                                <input
                                    type="tel"
                                    className="input"
                                    value={profileData.phoneNumber}
                                    onChange={(e) => setProfileData({ ...profileData, phoneNumber: e.target.value })}
                                />
                            </div>
                        </div>
                        <div style={{ marginBottom: '16px' }}>
                            <label className="label">Delivery Address</label>
                            <textarea
                                className="input"
                                rows={2}
                                value={profileData.address}
                                onChange={(e) => setProfileData({ ...profileData, address: e.target.value })}
                                style={{ resize: 'vertical', minHeight: '60px' }}
                            />
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                            <div>
                                <label className="label">Service Type</label>
                                <div className="input" style={{ background: 'var(--bg-app)', opacity: 0.8 }}>{client.serviceType}</div>
                            </div>
                            <div>
                                <label className="label">Approved Amount</label>
                                <div className="input" style={{ background: 'var(--bg-app)', opacity: 0.8 }}>
                                    {client.serviceType === 'Food'
                                        ? `${client.approvedMealsPerWeek || 0} meals / week`
                                        : 'Standard Box Allocation'
                                    }
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>



            {/* Current Order Request - Editable */}
            <div className={styles.card}>
                <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>Current Order Request</span>
                        {saving && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}><Loader2 className="animate-spin" size={14} /> Saving...</span>}
                        {message && !saving && <span style={{ fontSize: '0.8rem', color: 'var(--color-success)' }}>{message}</span>}
                    </div>
                </div>

                <div className={styles.alert} style={{ marginBottom: '1rem' }}>
                    <Info size={16} />
                    <div>
                        <div>Update your order preferences below. Changes are saved automatically.</div>
                        {(() => {
                            // Only show date if there's a vendor set (for Boxes orders)
                            // For Food orders, always show if date exists
                            const hasVendor = client.serviceType === 'Food' || 
                                            orderConfig?.vendorId || 
                                            upcomingOrder?.vendorId ||
                                            (client.serviceType === 'Boxes' && orderConfig?.boxTypeId && boxTypes.find(bt => bt.id === orderConfig.boxTypeId)?.vendorId);
                            
                            // Get take effect date from upcomingOrder (could be in different formats)
                            let takeEffectDate = null;
                            if (upcomingOrder && hasVendor) {
                                if (upcomingOrder.takeEffectDate) {
                                    takeEffectDate = upcomingOrder.takeEffectDate;
                                } else if (typeof upcomingOrder === 'object' && !upcomingOrder.serviceType) {
                                    // Multi-day format - get from first day
                                    const firstDay = Object.keys(upcomingOrder)[0];
                                    if (firstDay && (upcomingOrder as any)[firstDay]?.takeEffectDate) {
                                        takeEffectDate = (upcomingOrder as any)[firstDay].takeEffectDate;
                                    }
                                }
                            }
                            return takeEffectDate ? (
                                <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                    Your changes will take effect on {new Date(takeEffectDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                                </div>
                            ) : null;
                        })()}
                    </div>
                </div>

                {client.serviceType === 'Food' && (
                    <>
                        {!orderConfig.caseId ? (
                            <div className={styles.alert} style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)' }}>
                                <AlertTriangle size={16} />
                                No active Case ID found. Please contact support.
                            </div>
                        ) : (
                            renderFoodOrderSection()
                        )}
                    </>
                )}

                {client.serviceType === 'Boxes' && (
                    <div>
                        {/* Box Content Selection - Show all categories with box items */}
                        {/* Box items are menu items where vendorId is null/empty */}
                        {(() => {
                            // Check if there are any box items (items without vendorId)
                            const hasBoxItems = menuItems.some(i =>
                                (i.vendorId === null || i.vendorId === '') &&
                                i.isActive
                            );

                            if (!hasBoxItems) {
                                return (
                                    <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', border: '1px solid var(--color-danger)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--color-danger)', fontWeight: 600 }}>
                                            <AlertTriangle size={16} />
                                            No box items found
                                        </div>
                                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            There are no box items (menu items without a vendor) configured. Please contact support.
                                        </div>
                                    </div>
                                );
                            }

                            return (
                            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    <Package size={14} /> Box Contents
                                </h4>

                                {/* Show all categories with box items */}
                                {categories.map(category => {
                                    // Filter items for this category - box items are universal (vendorId is null/empty)
                                    const availableItems = menuItems.filter(i =>
                                        (i.vendorId === null || i.vendorId === '') &&
                                        i.isActive &&
                                        i.categoryId === category.id
                                    );

                                    if (availableItems.length === 0) return null;

                                    const selectedItems = orderConfig.items || {};

                                    // Calculate total quota value for this category
                                    let categoryQuotaValue = 0;
                                    Object.entries(selectedItems).forEach(([itemId, qty]) => {
                                        const item = menuItems.find(i => i.id === itemId);
                                        if (item && item.categoryId === category.id) {
                                            const itemQuotaValue = item.quotaValue || 1;
                                            categoryQuotaValue += (qty as number) * itemQuotaValue;
                                        }
                                    });

                                    // Find quota requirement for this category (from box quotas - optional)
                                    const quota = orderConfig.boxTypeId ? activeBoxQuotas.find(q => q.categoryId === category.id) : null;
                                    const boxQuantity = orderConfig.boxQuantity || 1;
                                    const requiredQuotaValueFromBox = quota ? quota.targetValue * boxQuantity : null;
                                    
                                    // Check if category has a setValue requirement
                                    const requiredQuotaValueFromCategory = category.setValue !== undefined && category.setValue !== null ? category.setValue : null;
                                    
                                    // Use setValue if present, otherwise use box quota requirement
                                    const requiredQuotaValue = requiredQuotaValueFromCategory !== null ? requiredQuotaValueFromCategory : requiredQuotaValueFromBox;
                                    
                                    const meetsQuota = requiredQuotaValue !== null ? categoryQuotaValue === requiredQuotaValue : true;

                                    return (
                                        <div key={category.id} style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px', border: requiredQuotaValue !== null && !meetsQuota ? '2px solid var(--color-danger)' : '1px solid var(--border-color)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <span style={{ fontWeight: 600 }}>{category.name}</span>
                                                    {requiredQuotaValueFromCategory !== null && (
                                                        <span style={{ 
                                                            fontSize: '0.7rem', 
                                                            color: 'var(--color-primary)', 
                                                            background: 'var(--bg-app)',
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            fontWeight: 500
                                                        }}>
                                                            Set Value: {requiredQuotaValueFromCategory}
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    {requiredQuotaValue !== null && (
                                                        <span style={{
                                                            color: meetsQuota ? 'var(--color-success)' : 'var(--color-danger)',
                                                            fontSize: '0.8rem',
                                                            fontWeight: 500
                                                        }}>
                                                            Quota: {categoryQuotaValue} / {requiredQuotaValue}
                                                        </span>
                                                    )}
                                                    {categoryQuotaValue > 0 && requiredQuotaValue === null && (
                                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                                            Total: {categoryQuotaValue}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {requiredQuotaValue !== null && !meetsQuota && (
                                                <div style={{
                                                    marginBottom: '0.5rem',
                                                    padding: '0.5rem',
                                                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                    borderRadius: '4px',
                                                    fontSize: '0.75rem',
                                                    color: 'var(--color-danger)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.25rem'
                                                }}>
                                                    <AlertTriangle size={12} />
                                                    <span>You must have a total of {requiredQuotaValue} {category.name} points</span>
                                                </div>
                                            )}

                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                {availableItems.map(item => {
                                                    const qty = Number(selectedItems[item.id] || 0);
                                                    return (
                                                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-app)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                                            <span style={{ fontSize: '0.8rem' }}>{item.name} <span style={{ color: 'var(--text-tertiary)' }}>({item.quotaValue || 1})</span></span>
                                                            <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <button onClick={() => handleBoxItemChange(item.id, Math.max(0, qty - 1))} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                <button onClick={() => handleBoxItemChange(item.id, qty + 1)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Show uncategorized items if any */}
                                {(() => {
                                    const uncategorizedItems = menuItems.filter(i =>
                                        (i.vendorId === null || i.vendorId === '') &&
                                        i.isActive &&
                                        (!i.categoryId || i.categoryId === '')
                                    );

                                    if (uncategorizedItems.length === 0) return null;

                                    const selectedItems = orderConfig.items || {};

                                    return (
                                        <div style={{ marginTop: '1rem', marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                            <div style={{ marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Other Items</div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                {uncategorizedItems.map(item => {
                                                    const qty = Number(selectedItems[item.id] || 0);
                                                    return (
                                                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-app)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                                            <span style={{ fontSize: '0.8rem' }}>{item.name} <span style={{ color: 'var(--text-tertiary)' }}>({item.quotaValue || 1})</span></span>
                                                            <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <button onClick={() => handleBoxItemChange(item.id, Math.max(0, qty - 1))} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                <button onClick={() => handleBoxItemChange(item.id, qty + 1)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* Show message if no categories have items */}
                                {categories.every(category => {
                                    const hasItems = menuItems.some(i =>
                                        (i.vendorId === null || i.vendorId === '') &&
                                        i.isActive &&
                                        i.categoryId === category.id
                                    );
                                    return !hasItems;
                                }) && (
                                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                        No box items available. Please contact support.
                                    </div>
                                )}
                            </div>
                            );
                        })()}
                    </div>
                )}
            </div>

            {/* Previous Orders Shelf */}
            <div style={{
                marginTop: '24px',
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--border-color)',
                overflow: 'hidden'
            }}>
                <button
                    onClick={() => setShowPreviousOrders(!showPreviousOrders)}
                    style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '16px 20px',
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-primary)',
                        fontSize: '1.1rem',
                        fontWeight: '600',
                        cursor: 'pointer'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <History size={20} />
                        Previous Orders
                    </div>
                    {showPreviousOrders ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                </button>

                {showPreviousOrders && (
                    <div style={{ padding: '0 20px 20px 20px' }}>
                        <div style={{ height: '1px', background: 'var(--border-color)', marginBottom: '16px' }}></div>
                        {previousOrders && previousOrders.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {previousOrders.map((order: any) => (
                                    <div key={order.id} style={{
                                        padding: '16px',
                                        background: 'var(--bg-app)',
                                        borderRadius: '8px',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        border: '1px solid var(--border-color)'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                            <div style={{
                                                width: '40px',
                                                height: '40px',
                                                borderRadius: '50%',
                                                background: 'var(--bg-card)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                border: '1px solid var(--border-color)'
                                            }}>
                                                <Clock size={20} color="var(--text-secondary)" />
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                                                    Order from {new Date(order.created_at).toLocaleDateString()}
                                                </div>
                                                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', gap: '12px' }}>
                                                    <span>{(Object.values(order.items || {}).reduce((a: any, b: any) => a + b, 0) as number)} items</span>
                                                    <span>•</span>
                                                    <span>{order.status || 'Completed'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{
                                textAlign: 'center',
                                padding: '30px',
                                color: 'var(--text-secondary)',
                                background: 'var(--bg-app)',
                                borderRadius: '8px',
                                fontStyle: 'italic'
                            }}>
                                No previous orders found.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div >
    );
}
