'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ItemCategory, BoxQuota, MealCategory, MealItem, AppSettings } from '@/lib/types';
import { syncCurrentOrderToUpcoming, getBoxQuotas, invalidateOrderData, updateClient, saveClientFoodOrder, saveClientMealOrder, saveClientBoxOrder } from '@/lib/actions';
import { getSettings } from '@/lib/cached-data';
import { getNextDeliveryDate as getNextDeliveryDateUtil, getTakeEffectDate, formatDeliveryDate } from '@/lib/order-dates';
import { isMeetingMinimum, isExceedingMaximum, isMeetingExactTarget } from '@/lib/utils';
import { Package, Truck, User, Loader2, Info, Plus, Calendar, AlertTriangle, Check, Trash2, Construction } from 'lucide-react';
import styles from './ClientProfile.module.css';
import FoodServiceWidget from './FoodServiceWidget';

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
    mealCategories: MealCategory[];
    mealItems: MealItem[];
    foodOrder?: any;
    mealOrder?: any;
    boxOrders?: any[];
}

export function ClientPortalInterface({ client: initialClient, statuses, navigators, vendors, menuItems, boxTypes, categories, upcomingOrder, activeOrder, previousOrders, mealCategories, mealItems, foodOrder, mealOrder, boxOrders }: Props) {
    const router = useRouter();
    const [client, setClient] = useState<ClientProfile>(initialClient);
    const [activeBoxQuotas, setActiveBoxQuotas] = useState<BoxQuota[]>([]);


    // Profile State
    const [profileData, setProfileData] = useState({
        fullName: initialClient.fullName,
        email: initialClient.email || '',
        phoneNumber: initialClient.phoneNumber || '',
        secondaryPhoneNumber: initialClient.secondaryPhoneNumber || '',
        address: initialClient.address || ''
    });
    const [originalProfileData, setOriginalProfileData] = useState({
        fullName: initialClient.fullName,
        email: initialClient.email || '',
        phoneNumber: initialClient.phoneNumber || '',
        secondaryPhoneNumber: initialClient.secondaryPhoneNumber || '',
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
    const [validationError, setValidationError] = useState<string | null>(null);

    const [settings, setSettings] = useState<AppSettings | null>(null);
    useEffect(() => {
        getSettings().then(setSettings);
    }, []);

    // Sync profile data when initialClient changes
    useEffect(() => {
        setProfileData({
            fullName: initialClient.fullName,
            email: initialClient.email || '',
            phoneNumber: initialClient.phoneNumber || '',
            secondaryPhoneNumber: initialClient.secondaryPhoneNumber || '',
            address: initialClient.address || ''
        });
        setOriginalProfileData({
            fullName: initialClient.fullName,
            email: initialClient.email || '',
            phoneNumber: initialClient.phoneNumber || '',
            secondaryPhoneNumber: initialClient.secondaryPhoneNumber || '',
            address: initialClient.address || ''
        });
        setClient(initialClient);
    }, [initialClient]);

    // Track if we've already initialized to prevent overwriting user changes
    const hasInitializedRef = useRef(false);
    const lastSavedTimestampRef = useRef<string | null>(null);
    const lastUpcomingOrderIdRef = useRef<string | null>(null);

    // Initialize order config - PRIORITIZE NEW INDEPENDENT TABLES
    useEffect(() => {
        if (!client) return;

        let configToSet: any = {};
        let source = '';

        // Priority 0: New Independent Tables (if available and matching service type)
        const serviceType = client.serviceType;

        if (serviceType === 'Food' && foodOrder) {
            console.log('[ClientPortal] Hydrating from foodOrder:', foodOrder);
            let foodOrderForUI = { ...foodOrder } as any;

            // Convert deliveryDayOrders from DB back to vendorSelections with itemsByDay for UI
            if (foodOrderForUI.deliveryDayOrders && !foodOrderForUI.vendorSelections) {
                const vendorMap = new Map<string, any>();
                for (const [day, dayData] of Object.entries(foodOrderForUI.deliveryDayOrders)) {
                    const vendorSelections = (dayData as any).vendorSelections || [];
                    for (const selection of vendorSelections) {
                        if (!selection.vendorId) continue;
                        if (!vendorMap.has(selection.vendorId)) {
                            vendorMap.set(selection.vendorId, {
                                vendorId: selection.vendorId,
                                items: {},
                                selectedDeliveryDays: [],
                                itemsByDay: {}
                            });
                        }
                        const vendor = vendorMap.get(selection.vendorId)!;
                        vendor.selectedDeliveryDays.push(day);
                        vendor.itemsByDay[day] = selection.items || {};
                    }
                }
                foodOrderForUI.vendorSelections = Array.from(vendorMap.values());
                delete foodOrderForUI.deliveryDayOrders; // Clean up legacy format to avoid confusion
            }

            configToSet = { ...foodOrderForUI, serviceType: 'Food' };
            if (!configToSet.caseId && client.activeOrder?.caseId) {
                configToSet.caseId = client.activeOrder.caseId;
            }

            // Merge mealSelections if available (e.g. Breakfast)
            if (mealOrder && mealOrder.mealSelections) {
                configToSet.mealSelections = mealOrder.mealSelections;
            }
            source = 'foodOrder';

        } else if (serviceType === 'Meal' && mealOrder) {
            console.log('[ClientPortal] Hydrating from mealOrder:', mealOrder);
            configToSet = { ...mealOrder, serviceType: 'Meal' };
            if (!configToSet.caseId && client.activeOrder?.caseId) {
                configToSet.caseId = client.activeOrder.caseId;
            }
            source = 'mealOrder';

        } else if (serviceType === 'Boxes' && boxOrders && boxOrders.length > 0) {
            console.log('[ClientPortal] Hydrating from boxOrders:', boxOrders);
            configToSet = {
                boxOrders,
                serviceType: 'Boxes',
                caseId: boxOrders[0].caseId || client.activeOrder?.caseId
            };
            source = 'boxOrders';

        } else {
            // Fallback to Legacy Logic
            // ... (keep existing fallback logic for safety)

            // Get the upcoming order ID and timestamp for comparison
            const upcomingOrderId = upcomingOrder ? (
                typeof upcomingOrder === 'object' && !(upcomingOrder as any).serviceType ?
                    (upcomingOrder as any)['default']?.id :
                    (upcomingOrder as any)?.id
            ) : null;

            const upcomingOrderTimestamp = upcomingOrder ? (
                typeof upcomingOrder === 'object' && !(upcomingOrder as any).serviceType ?
                    (upcomingOrder as any)['default']?.lastUpdated :
                    (upcomingOrder as any)?.lastUpdated
            ) : null;

            const clientActiveOrderTimestamp = (client?.activeOrder as any)?.lastUpdated;
            const upcomingOrderUnchanged = upcomingOrderId === lastUpcomingOrderIdRef.current;
            const clientActiveOrderIsNewer = clientActiveOrderTimestamp && upcomingOrderTimestamp &&
                new Date(clientActiveOrderTimestamp) > new Date(upcomingOrderTimestamp);

            const shouldPreferClientActiveOrder = hasInitializedRef.current &&
                upcomingOrderUnchanged &&
                clientActiveOrderIsNewer &&
                client.activeOrder;

            if (shouldPreferClientActiveOrder) {
                configToSet = { ...client.activeOrder };
                if (!configToSet.serviceType) configToSet.serviceType = client.serviceType;
                source = 'client.activeOrder (cached)';
            } else if (upcomingOrder) {
                source = 'upcomingOrder';
                // ... (existing upcomingOrder logic) ...
                // Minimal copy of upcoming logic:
                const isMultiDayFormat = upcomingOrder && typeof upcomingOrder === 'object' &&
                    !upcomingOrder.serviceType &&
                    !upcomingOrder.deliveryDayOrders &&
                    Object.keys(upcomingOrder).some(key => {
                        const val = (upcomingOrder as any)[key];
                        return val && val.serviceType;
                    });

                if (isMultiDayFormat) {
                    const deliveryDayOrders: any = {};
                    for (const day of Object.keys(upcomingOrder)) {
                        const dayOrder = (upcomingOrder as any)[day];
                        if (dayOrder && dayOrder.serviceType) {
                            deliveryDayOrders[day] = { vendorSelections: dayOrder.vendorSelections || [] };
                        }
                    }
                    const firstDayKey = Object.keys(upcomingOrder)[0];
                    const firstDayOrder = (upcomingOrder as any)[firstDayKey];
                    configToSet = {
                        serviceType: firstDayOrder?.serviceType || client.serviceType,
                        caseId: firstDayOrder?.caseId,
                        deliveryDayOrders
                    };
                } else {
                    configToSet = upcomingOrder;
                }
            } else if (activeOrder) {
                source = 'activeOrder';
                configToSet = { ...activeOrder };
                if (!configToSet.serviceType) configToSet.serviceType = client.serviceType;
            } else if (client.activeOrder) {
                source = 'client.activeOrder';
                configToSet = { ...client.activeOrder };
                if (!configToSet.serviceType) configToSet.serviceType = client.serviceType;
            } else {
                source = 'default';
                const defaultOrder: any = { serviceType: client.serviceType };
                if (client.serviceType === 'Food') {
                    defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
                }
                configToSet = defaultOrder;
            }
        }

        console.log(`[ClientPortal] Initialized orderConfig from source: ${source}`);
        setOrderConfig(configToSet);
        const deepCopy = JSON.parse(JSON.stringify(configToSet));
        setOriginalOrderConfig(deepCopy);
        hasInitializedRef.current = true;

        // Update ref for upcoming order
        const currentUpcomingOrderId = upcomingOrder ? (
            typeof upcomingOrder === 'object' && !(upcomingOrder as any).serviceType ?
                (upcomingOrder as any)['default']?.id :
                (upcomingOrder as any)?.id
        ) : null;
        lastUpcomingOrderIdRef.current = currentUpcomingOrderId;

    }, [upcomingOrder, activeOrder, client, foodOrder, mealOrder, boxOrders]);

    // Box Logic - Load quotas for all active box types to support multiple boxes with different types
    useEffect(() => {
        async function loadQuotas() {
            if (client.serviceType !== 'Boxes' || boxTypes.length === 0) {
                // Optimization: only load if needed (though existing cached data makes it cheap)
                // But wait, if we switch tabs, we might want quotas ready? 
                // ClientProfile loads them on mount if boxTypes exist.
                // Let's stick to loading if serviceType is Boxes or just load them if boxTypes are present to be safe/ready.
                // Actually ClientProfile: if (boxTypes.length > 0) loadQuotas();
                // Here, let's load if boxTypes exist, regardless of current tab, so it's ready if they switch.
            }

            if (boxTypes.length === 0) return;

            const allQuotas: BoxQuota[] = [];
            for (const bt of boxTypes) {
                if (bt.isActive) {
                    try {
                        const quotas = await getBoxQuotas(bt.id);
                        allQuotas.push(...quotas);
                    } catch (e) {
                        console.error(`Error loading quotas for box type ${bt.id}`, e);
                    }
                }
            }
            setActiveBoxQuotas(allQuotas);
        }

        loadQuotas();
    }, [boxTypes, client.serviceType]);

    // Extract dependencies for auto-save
    const caseId = useMemo(() => orderConfig?.caseId ?? null, [orderConfig?.caseId]);
    const vendorSelections = useMemo(() => orderConfig?.vendorSelections ?? [], [orderConfig?.vendorSelections]);
    const vendorId = useMemo(() => orderConfig?.vendorId ?? null, [orderConfig?.vendorId]);
    const boxTypeId = useMemo(() => orderConfig?.boxTypeId ?? null, [orderConfig?.boxTypeId]);
    const boxQuantity = useMemo(() => orderConfig?.boxQuantity ?? null, [orderConfig?.boxQuantity]);
    const items = useMemo(() => (orderConfig as any)?.items ?? {}, [JSON.stringify((orderConfig as any)?.items)]);
    const itemPrices = useMemo(() => (orderConfig as any)?.itemPrices ?? {}, [(orderConfig as any)?.itemPrices]);
    const serviceType = client.serviceType;

    // Auto-Save Logic - matching ClientProfile exactly
    // State-based Validation
    const [validationStatus, setValidationStatus] = useState({
        isValid: true,
        totalValue: 0,
        error: null as string | null
    });

    // Real-time Validation Effect
    useEffect(() => {
        validateOrder();
    }, [orderConfig, client.approvedMealsPerWeek, client.serviceType]);

    function validateOrder() {
        if (!client || !orderConfig) return;
        const serviceType = client.serviceType;
        let isValid = true;
        let error: string | null = null;
        let totalValue = 0;

        // 1. Food Service Validation (Limits & Minimums)
        if (serviceType === 'Food' && orderConfig.vendorSelections) {

            // Calculate Total Value
            console.log('--- [VALIDATION TRACE START] ---');
            for (const selection of orderConfig.vendorSelections) {
                if (!selection.vendorId) continue;

                console.log(`Processing Vendor: ${selection.vendorId}`);

                if (selection.itemsByDay && selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0) {
                    // Multi-day
                    const activeDays = selection.selectedDeliveryDays || [];
                    console.log(`  > Mode: MULTI-DAY. Days: ${activeDays.join(', ')}`);

                    for (const day of activeDays) {
                        const dayItems = selection.itemsByDay[day] || {};
                        console.log(`    > Day: ${day}, Items:`, dayItems);
                        for (const [itemId, qty] of Object.entries(dayItems)) {
                            const item = menuItems.find(i => i.id === itemId);
                            const val = (item?.value || 0);
                            const q = (Number(qty) || 0);
                            const subtotal = val * q;
                            totalValue += subtotal;
                            console.log(`      + Item ${item?.name} (${itemId}): Val ${val} * Qty ${q} = ${subtotal}. (Running Total: ${totalValue})`);
                        }
                    }
                } else if (selection.items) {
                    // Single/Flat Mode
                    const daysCount = (selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0)
                        ? selection.selectedDeliveryDays.length
                        : ((client as any).delivery_days?.length || 1);

                    console.log(`  > Mode: FLAT. Days Count: ${daysCount} (Source: ${selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0 ? 'Selection' : 'Client Default'})`);
                    console.log(`  > Selection Days:`, selection.selectedDeliveryDays);
                    console.log(`  > Client Days:`, (client as any).delivery_days);

                    for (const [itemId, qty] of Object.entries(selection.items)) {
                        const item = menuItems.find(i => i.id === itemId);
                        // Using standardized calculation consistent with display requirements
                        const val = (item?.value || 0);
                        const q = (Number(qty) || 0);
                        const subtotal = val * q * daysCount;
                        totalValue += subtotal;
                        console.log(`      + Item ${item?.name} (${itemId}): Val ${val} * Qty ${q} * Days ${daysCount} = ${subtotal}. (Running Total: ${totalValue})`);
                    }
                }
            }
            console.log(`--- [VALIDATION TRACE END] Final Total: ${totalValue} ---`);

            // Check Approved Limit
            const limit = client.approvedMealsPerWeek || 0;
            if (limit > 0 && isExceedingMaximum(totalValue, limit)) {
                error = `Total value selected (${totalValue.toFixed(2)}) exceeds approved value per week (${limit}). Please reduce your order.`;
                isValid = false;
            }

            // Check Vendor Minimums (if generic limit check passed)
            if (isValid) {
                for (const selection of orderConfig.vendorSelections) {
                    if (!selection.vendorId) continue;
                    const vendor = vendors.find(v => v.id === selection.vendorId);
                    if (!vendor) continue;
                    const minMeals = vendor.minimumMeals || 0;
                    if (minMeals === 0) continue;

                    if (selection.itemsByDay && Object.keys(selection.itemsByDay).length > 0) {
                        const activeDays = selection.selectedDeliveryDays || [];
                        for (const day of activeDays) {
                            const dayItems = selection.itemsByDay[day] || {};
                            let dayValue = 0;
                            for (const [itemId, qty] of Object.entries(dayItems)) {
                                const item = menuItems.find(i => i.id === itemId);
                                dayValue += (item?.value || 0) * (Number(qty) || 0);
                            }

                            if (!isMeetingMinimum(dayValue, minMeals)) {
                                error = `${vendor.name} requires a minimum value of ${minMeals} for ${day}. You have selected ${dayValue}.`;
                                isValid = false;
                                break;
                            }
                        }
                    } else if (selection.items) {
                        let countValue = 0;
                        for (const [itemId, qty] of Object.entries(selection.items)) {
                            const item = menuItems.find(i => i.id === itemId);
                            countValue += (item?.value || 0) * (Number(qty) || 0);
                        }

                        if (!isMeetingMinimum(countValue, minMeals)) {
                            error = `${vendor.name} requires a minimum value of ${minMeals} per delivery. You have selected ${countValue}.`;
                            isValid = false;
                        }
                    }
                    if (!isValid) break;
                }
            }
        }

        // 2. Meal Service Validation
        if (isValid && orderConfig.mealSelections) {
            for (const [mealType, config] of Object.entries(orderConfig.mealSelections) as [string, any][]) {
                const subCategories = mealCategories.filter(c => c.mealType === mealType);
                for (const subCat of subCategories) {
                    if (subCat.setValue !== undefined && subCat.setValue !== null) {
                        let totalSelectedValue = 0;
                        if (config.items) {
                            const catItems = mealItems.filter(i => i.categoryId === subCat.id);
                            for (const [itemId, qty] of Object.entries(config.items)) {
                                const item = catItems.find(i => i.id === itemId);
                                if (item) {
                                    totalSelectedValue += ((item.value || 0) * (qty as number));
                                }
                            }
                        }
                        if (!isMeetingExactTarget(totalSelectedValue, subCat.setValue)) {
                            error = `${subCat.name}: Selected ${totalSelectedValue}, but required is ${subCat.setValue}.`;
                            isValid = false;
                            break;
                        }
                    }
                }
                if (!isValid) break;
            }
        }

        setValidationStatus({ isValid, totalValue, error });
        setValidationError(error);
    }


    // Manual Save Logic
    const handleSave = async () => {
        if (!client || !orderConfig) return;

        // For Food clients, caseId is required. For Boxes, it's optional
        if (serviceType === 'Food' && !caseId) return;

        // Use Pre-calculated validation status
        if (!validationStatus.isValid) {
            // Error is already in state/display
            alert(`Save Blocked: ${validationStatus.error} \n\nCheck the Console for calculation details.`);
            console.error("SAVE BLOCKED. Validation Status:", validationStatus);
            console.log("Order Config at blocked save:", orderConfig);

            // RE-RUN LOGGING LOOP MANUALLY TO SHOW USER
            console.log('--- [MANUAL SAVE VALIDATION TRACE START] ---');
            let manualTotal = 0;
            if (serviceType === 'Food' && orderConfig.vendorSelections) {
                for (const selection of orderConfig.vendorSelections) {
                    if (!selection.vendorId) continue;

                    console.log(`Processing Vendor: ${selection.vendorId}`);

                    if (selection.itemsByDay && selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0) {
                        // Multi-day
                        const activeDays = selection.selectedDeliveryDays || [];
                        console.log(`  > Mode: MULTI-DAY. Days: ${activeDays.join(', ')}`);

                        for (const day of activeDays) {
                            const dayItems = selection.itemsByDay[day] || {};
                            console.log(`    > Day: ${day}, Items:`, dayItems);
                            for (const [itemId, qty] of Object.entries(dayItems)) {
                                const item = menuItems.find(i => i.id === itemId);
                                const val = (item?.value || 0);
                                const q = (Number(qty) || 0);
                                const subtotal = val * q;
                                manualTotal += subtotal;
                                console.log(`      + Item ${item?.name} (${itemId}): Val ${val} * Qty ${q} = ${subtotal}. (Running Total: ${manualTotal})`);
                            }
                        }
                    } else if (selection.items) {
                        // Single/Flat Mode
                        const daysCount = (selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0)
                            ? selection.selectedDeliveryDays.length
                            : ((client as any).delivery_days?.length || 1);

                        console.log(`  > Mode: FLAT. Days Count: ${daysCount} (Source: ${selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0 ? 'Selection' : 'Client Default'})`);
                        console.log(`  > Selection Days:`, selection.selectedDeliveryDays);
                        console.log(`  > Client Days:`, (client as any).delivery_days);

                        for (const [itemId, qty] of Object.entries(selection.items)) {
                            const item = menuItems.find(i => i.id === itemId);
                            const val = (item?.value || 0);
                            const q = (Number(qty) || 0);
                            const subtotal = val * q * daysCount;
                            manualTotal += subtotal;
                            console.log(`      + Item ${item?.name} (${itemId}): Val ${val} * Qty ${q} * Days ${daysCount} = ${subtotal}. (Running Total: ${manualTotal})`);
                        }
                    }
                }
            }
            console.log(`--- [MANUAL SAVE VALIDATION TRACE END] Final Total: ${manualTotal} ---`);

            return;
        }

        try {
            // Ensure structure is correct and convert per-vendor delivery days to deliveryDayOrders format
            const cleanedOrderConfig = { ...orderConfig };

            // CRITICAL: Always preserve caseId at the top level for both Food and Boxes
            cleanedOrderConfig.caseId = orderConfig.caseId;

            if (serviceType === 'Food') {
                if (cleanedOrderConfig.vendorSelections) {
                    // UNIFIED LOGIC: Always convert vendorSelections to deliveryDayOrders
                    // This handles New Vendors, Single-Day, and Multi-Day uniformly.

                    // DEBUG LOGGING START
                    console.log('DEBUG: Processing vendorSelections (Unified):', cleanedOrderConfig.vendorSelections);

                    const deliveryDayOrders: any = {};
                    const selections = Array.isArray(cleanedOrderConfig.vendorSelections) ? cleanedOrderConfig.vendorSelections : [];

                    for (const selection of selections) {
                        console.log('DEBUG: Processing selection:', selection);

                        if (!selection.vendorId) {
                            console.log('DEBUG: Skipping (no vendorId)');
                            continue;
                        }

                        // Fallback logic: If no specific days selected (e.g. single day vendor or new), use client defaults
                        const daysToApply = (selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0)
                            ? selection.selectedDeliveryDays
                            : (client as any).delivery_days || ['Monday']; // Default to Monday if client has no days

                        console.log('DEBUG: daysToApply for vendor ' + selection.vendorId + ':', daysToApply);

                        for (const day of daysToApply) {
                            if (!deliveryDayOrders[day]) deliveryDayOrders[day] = { vendorSelections: [] };

                            // Items can be in itemsByDay[day] OR flat items (fallback)
                            const dayItems = (selection.itemsByDay && selection.itemsByDay[day])
                                ? selection.itemsByDay[day]
                                : (selection.items || {}); /* Fallback to flat items for single-day/new vendors */

                            console.log('DEBUG: Day ' + day + ' items:', dayItems);

                            const hasItems = Object.keys(dayItems).length > 0 && Object.values(dayItems).some((qty: any) => (Number(qty) || 0) > 0);
                            if (hasItems) {
                                console.log('DEBUG: Adding items to deliveryDayOrders');
                                deliveryDayOrders[day].vendorSelections.push({
                                    vendorId: selection.vendorId,
                                    items: dayItems
                                });
                            } else {
                                console.log('DEBUG: Skipping day (no items)');
                            }
                        }
                    }
                    console.log('DEBUG: Final deliveryDayOrders:', deliveryDayOrders);
                    // DEBUG LOGGING END

                    // Clean up days with no vendors
                    const daysWithVendors = Object.keys(deliveryDayOrders).filter(day =>
                        deliveryDayOrders[day].vendorSelections && deliveryDayOrders[day].vendorSelections.length > 0
                    );

                    if (daysWithVendors.length > 0) {
                        const cleanedDeliveryDayOrders: any = {};
                        for (const day of daysWithVendors) cleanedDeliveryDayOrders[day] = deliveryDayOrders[day];
                        cleanedOrderConfig.deliveryDayOrders = cleanedDeliveryDayOrders;
                    } else {
                        // CRITICAL FIX: If no days having vendors, we must explicitly set empty object
                        cleanedOrderConfig.deliveryDayOrders = {};
                    }

                    // Remove the transient vendorSelections used for UI state
                    cleanedOrderConfig.vendorSelections = undefined;
                } else if (cleanedOrderConfig.deliveryDayOrders) {
                    // Legacy/Fallback Path: Only use existing deliveryDayOrders if NO vendorSelections exists
                    // Clean multi-day format (already in deliveryDayOrders)
                    for (const day of Object.keys(cleanedOrderConfig.deliveryDayOrders)) {
                        cleanedOrderConfig.deliveryDayOrders[day].vendorSelections = (cleanedOrderConfig.deliveryDayOrders[day].vendorSelections || [])
                            .filter((s: any) => s.vendorId)
                            .map((s: any) => ({
                                vendorId: s.vendorId,
                                items: s.items || {}
                            }));
                    }
                }
            } else if (serviceType === 'Boxes') {
                // For Boxes: Explicitly preserve all critical fields
                cleanedOrderConfig.vendorId = orderConfig.vendorId;
                cleanedOrderConfig.caseId = orderConfig.caseId; // Also set above
                cleanedOrderConfig.boxTypeId = orderConfig.boxTypeId;
                cleanedOrderConfig.boxQuantity = orderConfig.boxQuantity || 1;
                cleanedOrderConfig.items = orderConfig.items || {};
                cleanedOrderConfig.itemPrices = orderConfig.itemPrices || {};
            }

            // Create a temporary client object for syncCurrentOrderToUpcoming
            const tempClient: ClientProfile = {
                ...client,
                activeOrder: {
                    ...cleanedOrderConfig,
                    serviceType: serviceType,
                    lastUpdated: new Date().toISOString(),
                    updatedBy: 'Client'
                }
            } as ClientProfile;

            setSaving(true);
            setMessage('Saving...');

            // Sync to new independent tables first (mimicking ClientProfile)
            if (serviceType === 'Food') {
                await saveClientFoodOrder(client.id, {
                    caseId: cleanedOrderConfig.caseId,
                    deliveryDayOrders: cleanedOrderConfig.deliveryDayOrders || {}
                });
            }

            // Save meal orders independently (if exists) - allowing Food + Breakfast combo
            if (serviceType === 'Meal' || cleanedOrderConfig.mealSelections) {
                // Save meal orders if service type is Meal OR if there are meal selections
                // Note: We intentionally save empty objects {} to clear data if user deleted all meals
                if (cleanedOrderConfig.mealSelections) {
                    console.log('DEBUG: Saving Meal Order:', cleanedOrderConfig.mealSelections);
                    await saveClientMealOrder(client.id, {
                        caseId: cleanedOrderConfig.caseId,
                        mealSelections: cleanedOrderConfig.mealSelections
                    });
                }
            }

            if (serviceType === 'Boxes') {
                await saveClientBoxOrder(client.id, (cleanedOrderConfig.boxOrders || []).map((box: any) => ({
                    ...box,
                    caseId: cleanedOrderConfig.caseId
                })));
            }

            // Sync to upcoming_orders table
            await syncCurrentOrderToUpcoming(client.id, tempClient);

            // Refresh the router to refetch server data
            router.refresh();

            // After saving, update originalOrderConfig to prevent re-saving
            const savedConfig = JSON.parse(JSON.stringify(orderConfig));
            setOriginalOrderConfig(savedConfig);

            // Track the save timestamp to prevent re-initialization from stale data
            const saveTimestamp = new Date().toISOString();
            lastSavedTimestampRef.current = saveTimestamp;

            setSaving(false);
            setMessage('Saved');
            setTimeout(() => setMessage(null), 2000);
        } catch (error: any) {
            console.error('Error saving Service Configuration:', error);
            setSaving(false);
            const errorMessage = error?.message || 'Error saving';
            setMessage(errorMessage);
            setTimeout(() => setMessage(null), 5000);
        }
    };

    const handleDiscard = () => {
        // Reset order config to original
        setOrderConfig(JSON.parse(JSON.stringify(originalOrderConfig)));
        setMessage('Changes discarded');
        setTimeout(() => setMessage(null), 2000);
    };

    // Auto-Save Profile Logic - DISABLED: Profile editing is not allowed in client portal
    // useEffect(() => {
    //     if (!client) return;

    //     const profileChanged =
    //         profileData.fullName !== originalProfileData.fullName ||
    //         profileData.email !== originalProfileData.email ||
    //         profileData.phoneNumber !== originalProfileData.phoneNumber ||
    //         profileData.secondaryPhoneNumber !== originalProfileData.secondaryPhoneNumber ||
    //         profileData.address !== originalProfileData.address;

    //     if (!profileChanged) return;

    //     const timeoutId = setTimeout(async () => {
    //         try {
    //             setSavingProfile(true);
    //             setProfileMessage('Saving...');

    //             await updateClient(client.id, {
    //                 fullName: profileData.fullName,
    //                 email: profileData.email || null,
    //                 phoneNumber: profileData.phoneNumber || '',
    //                 secondaryPhoneNumber: profileData.secondaryPhoneNumber || null,
    //                 address: profileData.address || ''
    //             });

    //             setOriginalProfileData({ ...profileData });
    //             setSavingProfile(false);
    //             setProfileMessage('Saved');
    //             setTimeout(() => setProfileMessage(null), 2000);
    //         } catch (error) {
    //             console.error('Error saving profile:', error);
    //             setSavingProfile(false);
    //             setProfileMessage('Error saving');
    //         }
    //     }, 1000);

    //     return () => clearTimeout(timeoutId);
    // }, [profileData, originalProfileData, client]);


    // -- LOGIC HELPERS --

    function handleBoxItemChange(itemId: string, qty: number) {
        // Legacy/Fallback for flat items if needed, but we are moving to multi-box
        const currentItems = { ...(orderConfig.items || {}) };
        if (qty > 0) {
            currentItems[itemId] = qty;
        } else {
            delete currentItems[itemId];
        }
        setOrderConfig({ ...orderConfig, items: currentItems });
    }

    // --- Box Order Helpers (Multi-Box Support) ---

    function getNextDeliveryDateForVendor(vendorId: string): string | null {
        const deliveryDate = getNextDeliveryDateUtil(vendorId, vendors);
        if (!deliveryDate) return null;
        return formatDeliveryDate(deliveryDate);
    }

    function handleAddBox() {
        const currentBoxes = orderConfig.boxOrders || [];
        const limit = client.authorizedAmount;
        if (limit && currentBoxes.length >= limit) return;

        const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
        setOrderConfig({
            ...orderConfig,
            boxOrders: [
                ...currentBoxes,
                {
                    boxTypeId: firstActiveBoxType?.id || '',
                    vendorId: firstActiveBoxType?.vendorId || '',
                    quantity: 1,
                    items: {}
                }
            ]
        });
    }

    function handleRemoveBox(index: number) {
        const currentBoxes = [...(orderConfig.boxOrders || [])];
        if (currentBoxes.length <= 1) {
            // Keep at least one box (reset to default)
            const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
            setOrderConfig({
                ...orderConfig,
                boxOrders: [{
                    boxTypeId: firstActiveBoxType?.id || '',
                    vendorId: firstActiveBoxType?.vendorId || '',
                    quantity: 1,
                    items: {}
                }]
            });
            return;
        }
        currentBoxes.splice(index, 1);
        setOrderConfig({ ...orderConfig, boxOrders: currentBoxes });
    }

    function handleBoxUpdate(index: number, field: string, value: any) {
        const currentBoxes = [...(orderConfig.boxOrders || [])];
        if (!currentBoxes[index]) return;

        currentBoxes[index] = { ...currentBoxes[index], [field]: value };

        // Logic to sync vendor/boxType dependencies
        if (field === 'vendorId') {
            const validBoxType = boxTypes.find(bt => bt.isActive && bt.vendorId === value);
            if (validBoxType) {
                currentBoxes[index].boxTypeId = validBoxType.id;
            }
        }

        setOrderConfig({ ...orderConfig, boxOrders: currentBoxes });
    }

    function handleBoxItemUpdate(boxIndex: number, itemId: string, quantity: number) {
        const currentBoxes = [...(orderConfig.boxOrders || [])];
        if (!currentBoxes[boxIndex]) return;

        const currentItems = { ...(currentBoxes[boxIndex].items || {}) };
        if (quantity > 0) {
            currentItems[itemId] = quantity;
        } else {
            delete currentItems[itemId];
        }

        currentBoxes[boxIndex] = { ...currentBoxes[boxIndex], items: currentItems };
        setOrderConfig({ ...orderConfig, boxOrders: currentBoxes });
    }


    const configChanged = JSON.stringify(orderConfig) !== JSON.stringify(originalOrderConfig);

    return (
        <div className={styles.container}>
            <div className={styles.wideGrid}>
                {/* Access Profile - Read Only */}
                <div className={styles.card}>
                    <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <User size={20} />
                            Profile Information
                        </div>
                    </div>
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
                            <div>
                                <label className="label">Full Name</label>
                                <input
                                    type="text"
                                    className="input"
                                    value={profileData.fullName}
                                    disabled
                                    readOnly
                                    style={{ background: 'var(--bg-app)', opacity: 0.8, cursor: 'not-allowed' }}
                                />
                            </div>
                            <div>
                                <label className="label">Email Address</label>
                                <input
                                    type="email"
                                    className="input"
                                    value={profileData.email}
                                    disabled
                                    readOnly
                                    style={{ background: 'var(--bg-app)', opacity: 0.8, cursor: 'not-allowed' }}
                                />
                            </div>
                            <div>
                                <label className="label">Phone Number</label>
                                <input
                                    type="tel"
                                    className="input"
                                    value={profileData.phoneNumber}
                                    disabled
                                    readOnly
                                    style={{ background: 'var(--bg-app)', opacity: 0.8, cursor: 'not-allowed' }}
                                />
                            </div>
                        </div>
                        <div className={styles.formGridSplit}>
                            <div>
                                <label className="label">Secondary Phone Number</label>
                                <input
                                    type="tel"
                                    className="input"
                                    value={profileData.secondaryPhoneNumber}
                                    disabled
                                    readOnly
                                    style={{ background: 'var(--bg-app)', opacity: 0.8, cursor: 'not-allowed' }}
                                />
                            </div>
                            <div>
                                <label className="label">Delivery Address</label>
                                <textarea
                                    className="input"
                                    rows={1}
                                    value={profileData.address}
                                    disabled
                                    readOnly
                                    style={{ resize: 'vertical', minHeight: '42px', background: 'var(--bg-app)', opacity: 0.8, cursor: 'not-allowed' }}
                                />
                            </div>
                        </div>
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
                                    : `Auth amount of boxes: ${client.authorizedAmount || 'Standard Box Allocation'}`
                                }
                            </div>
                        </div>
                    </div>
                </div>




                {/* Current Order Request - Editable */}
                <div className={styles.card} style={{ marginTop: '6rem' }}>
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
                            <div>Update your order preferences below.</div>
                            {(() => {
                                if (client.serviceType === 'Boxes') {
                                    return (
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                            Your changes may not take effect until next week.
                                        </div>
                                    );
                                }

                                if (client.serviceType === 'Food') {
                                    const uniqueVendorIds = new Set<string>();

                                    // Collect vendors from either format
                                    if (orderConfig.deliveryDayOrders) {
                                        Object.values(orderConfig.deliveryDayOrders).forEach((dayOrder: any) => {
                                            if (dayOrder.vendorSelections) {
                                                dayOrder.vendorSelections.forEach((s: any) => s.vendorId && uniqueVendorIds.add(s.vendorId));
                                            }
                                        });
                                    } else if (orderConfig.vendorSelections) {
                                        orderConfig.vendorSelections.forEach((s: any) => s.vendorId && uniqueVendorIds.add(s.vendorId));
                                    }

                                    const messages: string[] = [];
                                    uniqueVendorIds.forEach(vId => {
                                        const v = vendors.find(vend => vend.id === vId);
                                        if (v) {
                                            const cutoff = v.cutoffHours || 0; // Default to 0 if not set, or maybe don't show? 
                                            // User said "write by each vendor that changes must be made by however many hours".
                                            // If cutoff is 0, arguably "Changes take effect immediately" or just show 0 hours?
                                            // Let's show it if it exists or even if 0 to be explicit.
                                            messages.push(`Orders for ${v.name} must be placed ${cutoff} hours before delivery.`);
                                        }
                                    });

                                    if (messages.length > 0) {
                                        return (
                                            <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {messages.map((msg, i) => (
                                                    <div key={i}>{msg}</div>
                                                ))}
                                            </div>
                                        );
                                    }
                                }

                                return null;
                            })()}
                        </div>
                    </div>

                    {client.serviceType === 'Food' && (
                        <FoodServiceWidget
                            orderConfig={orderConfig}
                            setOrderConfig={setOrderConfig}
                            client={client}
                            vendors={vendors}
                            menuItems={menuItems}
                            mealCategories={mealCategories}
                            mealItems={mealItems}
                            isClientPortal={true}
                            validationStatus={validationStatus}
                        />
                    )}

                    {client.serviceType === 'Boxes' && (
                        <div>
                            {(() => {
                                const currentBoxes = orderConfig.boxOrders || [];
                                // Fallback if no boxes exist yet (should have been hydrated)
                                if (currentBoxes.length === 0) return null;

                                return (
                                    <div>
                                        {currentBoxes.map((box: any, index: number) => (
                                            <div key={index} style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                                                <div style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    marginBottom: '1rem',
                                                    borderBottom: '1px solid var(--border-color)',
                                                    paddingBottom: '0.5rem'
                                                }}>
                                                    <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <Package size={16} /> Box #{index + 1}
                                                    </h4>
                                                    {currentBoxes.length > 1 && (
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost btn-sm"
                                                            onClick={() => handleRemoveBox(index)}
                                                            style={{ color: 'var(--color-danger)', fontSize: '0.8rem', padding: '4px 8px' }}
                                                        >
                                                            <Trash2 size={14} style={{ marginRight: '4px' }} /> Remove
                                                        </button>
                                                    )}
                                                </div>



                                                {/* Take Effect Date */}
                                                {box.vendorId && settings && (() => {
                                                    const nextDate = getNextDeliveryDateForVendor(box.vendorId);
                                                    if (nextDate) {
                                                        const takeEffect = getTakeEffectDate(settings, new Date(nextDate));
                                                        return (
                                                            <div style={{
                                                                marginTop: 'var(--spacing-md)',
                                                                padding: '0.75rem',
                                                                backgroundColor: 'var(--bg-surface-hover)',
                                                                borderRadius: 'var(--radius-sm)',
                                                                border: '1px solid var(--border-color)',
                                                                fontSize: '0.85rem',
                                                                color: 'var(--text-secondary)',
                                                                textAlign: 'center'
                                                            }}>
                                                                <strong style={{ color: 'var(--text-primary)' }}>Take Effect Date:</strong> {takeEffect?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })} (always a Sunday)
                                                            </div>
                                                        );
                                                    }
                                                    return (
                                                        <div style={{
                                                            marginTop: 'var(--spacing-md)',
                                                            padding: '0.75rem',
                                                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                            borderRadius: 'var(--radius-sm)',
                                                            border: '1px solid var(--color-danger)',
                                                            fontSize: '0.85rem',
                                                            color: 'var(--color-danger)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '0.5rem',
                                                            textAlign: 'center',
                                                            justifyContent: 'center'
                                                        }}>
                                                            <AlertTriangle size={16} />
                                                            <span><strong>Warning:</strong> Check vendor delivery days.</span>
                                                        </div>
                                                    );
                                                })()}

                                                {/* Box Content Selection */}
                                                <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                                    {box.vendorId && !getNextDeliveryDateForVendor(box.vendorId) ? (
                                                        <div style={{
                                                            padding: '1.5rem',
                                                            backgroundColor: 'var(--bg-surface-active)',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: '1px dashed var(--color-danger)',
                                                            color: 'var(--text-secondary)',
                                                            textAlign: 'center',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            alignItems: 'center',
                                                            gap: '0.5rem',
                                                            opacity: 0.7
                                                        }}>
                                                            <AlertTriangle size={24} color="var(--color-danger)" />
                                                            <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>Action Required</span>
                                                            <span style={{ fontSize: '0.9rem' }}>
                                                                Vendor has no upcoming delivery dates.
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {/* Categories Loop */}
                                                            {categories.map(category => {
                                                                const availableItems = menuItems.filter(i =>
                                                                    (i.vendorId === null || i.vendorId === '') &&
                                                                    i.isActive &&
                                                                    i.categoryId === category.id
                                                                );

                                                                if (availableItems.length === 0) return null;

                                                                const selectedItems = box.items || {};

                                                                // Calculate quota for THIS box/category
                                                                let categoryQuotaValue = 0;
                                                                Object.entries(selectedItems).forEach(([itemId, qty]) => {
                                                                    const item = menuItems.find(i => i.id === itemId);
                                                                    if (item && item.categoryId === category.id) {
                                                                        const itemQuotaValue = item.quotaValue || 1;
                                                                        categoryQuotaValue += (qty as number) * itemQuotaValue;
                                                                    }
                                                                });

                                                                // Quota checks
                                                                let requiredQuotaValue: number | null = null;
                                                                if (category.setValue !== undefined && category.setValue !== null) {
                                                                    requiredQuotaValue = category.setValue;
                                                                } else if (box.boxTypeId) {
                                                                    // Here we use activeBoxQuotas state if available, OR we can fetch it?
                                                                    // ClientPortalInterface has activeBoxQuotas state but it was driven by orderConfig.boxTypeId (singular).
                                                                    // Ideally we should use the quotas for THIS box's type.
                                                                    // We might not have them loaded if multiple boxes have different types.
                                                                    // Use activeBoxQuotas fallback or just ignore generic quotas for now to be safe/simple,
                                                                    // OR try to find it from activeBoxQuotas if it matches.
                                                                    // Realistically, for Client Portal, we might assume one box type usually used, or we need to refactor quota loading.
                                                                    // ClientProfile fetches ALL quotas or fetches on change.
                                                                    // For now, let's use category.setValue which is most important, and maybe activeBoxQuotas if boxTypeId matches orderConfig.boxTypeId (legacy).
                                                                    // Replicating ClientProfile logic:
                                                                    const quota = activeBoxQuotas.find(q => q.boxTypeId === box.boxTypeId && q.categoryId === category.id);
                                                                    if (quota) {
                                                                        requiredQuotaValue = quota.targetValue;
                                                                    }
                                                                }

                                                                const meetsQuota = requiredQuotaValue !== null ? isMeetingExactTarget(categoryQuotaValue, requiredQuotaValue) : true;

                                                                return (
                                                                    <div key={category.id} style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px', border: requiredQuotaValue !== null && !meetsQuota ? '2px solid var(--color-danger)' : '1px solid var(--border-color)' }}>
                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                                                            <span style={{ fontWeight: 600 }}>{category.name}</span>
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
                                                                                        <span style={{ fontSize: '0.8rem' }}>
                                                                                            {item.name}
                                                                                            {(item.quotaValue || 1) !== 1 && (
                                                                                                <span style={{ color: 'var(--text-tertiary)', marginLeft: '4px' }}>
                                                                                                    (counts as {item.quotaValue || 1} meals)
                                                                                                </span>
                                                                                            )}
                                                                                        </span>
                                                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                            <button onClick={() => handleBoxItemUpdate(index, item.id, Math.max(0, qty - 1))} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                                            <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                                            <button onClick={() => handleBoxItemUpdate(index, item.id, qty + 1)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}

                                                            {/* Uncategorized */}
                                                            {(() => {
                                                                const uncategorizedItems = menuItems.filter(i =>
                                                                    (i.vendorId === null || i.vendorId === '') &&
                                                                    i.isActive &&
                                                                    (!i.categoryId || i.categoryId === '')
                                                                );
                                                                if (uncategorizedItems.length === 0) return null;
                                                                const selectedItems = box.items || {};
                                                                return (
                                                                    <div style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px' }}>
                                                                        <div style={{ marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Uncategorized</div>
                                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                                            {uncategorizedItems.map(item => {
                                                                                const qty = Number(selectedItems[item.id] || 0);
                                                                                return (
                                                                                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-app)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                                                                        <span style={{ fontSize: '0.8rem' }}>
                                                                                            {item.name}
                                                                                            {(item.quotaValue || 1) !== 1 && (
                                                                                                <span style={{ color: 'var(--text-tertiary)', marginLeft: '4px' }}>
                                                                                                    (counts as {item.quotaValue || 1} meals)
                                                                                                </span>
                                                                                            )}
                                                                                        </span>
                                                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                            <button onClick={() => handleBoxItemUpdate(index, item.id, Math.max(0, qty - 1))} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                                            <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                                            <button onClick={() => handleBoxItemUpdate(index, item.id, qty + 1)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })()}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        ))}

                                        {/* Add Box Button */}
                                        {(!client.authorizedAmount || currentBoxes.length < client.authorizedAmount) && (
                                            <button
                                                type="button"
                                                className="btn btn-outline"
                                                style={{ width: '100%', borderStyle: 'dashed', padding: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
                                                onClick={handleAddBox}
                                            >
                                                <Plus size={16} /> Add Another Box
                                            </button>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* Spacer to prevent content from being hidden behind fixed save bar */}
                    {(configChanged || saving) && (
                        <div style={{ height: 'clamp(140px, 20vh, 200px)' }} />
                    )}
                </div>
            </div>

            {/* Fixed Floating Save Section at Bottom of Viewport */}
            {(configChanged || saving) && (
                <>
                    <style>{`
                        @media (max-width: 768px) {
                            .save-bar-container {
                                padding: 0.75rem 1rem !important;
                            }
                            .save-bar-content {
                                flex-direction: column !important;
                                gap: 0.75rem !important;
                            }
                            .save-bar-warning {
                                flex-direction: row !important;
                                gap: 0.5rem !important;
                                min-width: unset !important;
                            }
                            .save-bar-icon {
                                width: 20px !important;
                                height: 20px !important;
                            }
                            .save-bar-title {
                                font-size: 0.9rem !important;
                                margin-bottom: 0.125rem !important;
                            }
                            .save-bar-message {
                                font-size: 0.8rem !important;
                            }
                            .save-bar-buttons {
                                width: 100% !important;
                                flex-direction: column !important;
                                gap: 0.75rem !important;
                            }
                            .save-bar-button {
                                width: 100% !important;
                                font-size: 1rem !important;
                                padding: 12px 20px !important;
                                min-width: unset !important;
                            }
                            .save-bar-button-primary {
                                font-size: 1.1rem !important;
                                padding: 14px 24px !important;
                            }
                        }
                        @media (min-width: 769px) {
                            .save-bar-container {
                                padding: 1.5rem 2rem;
                            }
                            .save-bar-content {
                                gap: 1.5rem;
                            }
                            .save-bar-warning {
                                gap: 12px;
                            }
                            .save-bar-title {
                                font-size: 1.25rem;
                            }
                            .save-bar-message {
                                font-size: 0.95rem;
                            }
                            .save-bar-button {
                                font-size: 1.1rem;
                                padding: 14px 28px;
                            }
                            .save-bar-button-primary {
                                font-size: 1.25rem;
                                padding: 16px 40px;
                            }
                        }
                    `}</style>
                    <div className="save-bar-container" style={{
                        position: 'fixed',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        backgroundColor: saving ? '#d1fae5' : '#fef3c7',
                        borderTop: saving ? '4px solid #10b981' : '4px solid #f59e0b',
                        boxShadow: saving ? '0 -10px 30px -5px rgba(16, 185, 129, 0.4)' : '0 -10px 30px -5px rgba(245, 158, 11, 0.4)',
                        zIndex: 1000,
                        backdropFilter: 'blur(10px)'
                    }}>
                        <div className="save-bar-content" style={{
                            maxWidth: '1200px',
                            margin: '0 auto',
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap'
                        }}>
                            <div className="save-bar-warning" style={{
                                display: 'flex',
                                alignItems: 'center',
                                flex: 1
                            }}>
                                {saving ? (
                                    <>
                                        <Loader2 className="save-bar-icon animate-spin" size={24} style={{ color: '#059669', flexShrink: 0 }} />
                                        <div style={{ flex: 1 }}>
                                            <div className="save-bar-title" style={{
                                                fontWeight: 700,
                                                color: '#059669',
                                                marginBottom: '0.25rem'
                                            }}>
                                                💾 SAVING CHANGES...
                                            </div>
                                            <div className="save-bar-message" style={{
                                                color: '#047857',
                                                fontWeight: 600
                                            }}>
                                                Please wait while your changes are being saved to the database
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle className="save-bar-icon" size={24} style={{ color: '#92400e', flexShrink: 0 }} />
                                        <div style={{ flex: 1 }}>
                                            <div className="save-bar-title" style={{
                                                fontWeight: 700,
                                                color: '#92400e',
                                                marginBottom: '0.25rem'
                                            }}>
                                                ⚠️ UNSAVED CHANGES
                                            </div>
                                            <div className="save-bar-message" style={{
                                                color: '#78350f',
                                                fontWeight: 600
                                            }}>
                                                Your changes will NOT be saved unless you click "Save Changes"
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="save-bar-buttons" style={{ display: 'flex', flexWrap: 'wrap' }}>
                                <button
                                    onClick={handleDiscard}
                                    disabled={saving}
                                    className="btn btn-secondary save-bar-button"
                                    style={{
                                        fontWeight: 600,
                                        border: '2px solid var(--border-color)',
                                        opacity: saving ? 0.5 : 1,
                                        cursor: saving ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    Discard
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving}
                                    className="btn btn-primary save-bar-button save-bar-button-primary"
                                    style={{
                                        fontWeight: 700,
                                        boxShadow: saving ? '0 4px 8px -2px rgba(0, 0, 0, 0.2)' : '0 8px 16px -4px rgba(0, 0, 0, 0.3)',
                                        backgroundColor: saving ? '#10b981' : '#f59e0b',
                                        border: saving ? '2px solid #059669' : '2px solid #d97706',
                                        color: '#1f2937',
                                        transform: saving ? 'scale(1)' : 'scale(1.05)',
                                        transition: 'all 0.2s',
                                        opacity: saving ? 0.9 : 1,
                                        cursor: saving ? 'wait' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        justifyContent: 'center'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!saving) {
                                            e.currentTarget.style.transform = 'scale(1.08)';
                                            e.currentTarget.style.boxShadow = '0 12px 24px -4px rgba(0, 0, 0, 0.4)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!saving) {
                                            e.currentTarget.style.transform = 'scale(1.05)';
                                            e.currentTarget.style.boxShadow = '0 8px 16px -4px rgba(0, 0, 0, 0.3)';
                                        }
                                    }}
                                >
                                    {saving ? (
                                        <>
                                            <Loader2 className="animate-spin" size={20} />
                                            SAVING...
                                        </>
                                    ) : (
                                        'SAVE CHANGES'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
            {validationError && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    zIndex: 2000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(4px)'
                }}>
                    <div className="animate-in zoom-in-95 duration-200" style={{
                        backgroundColor: 'white',
                        padding: '24px',
                        borderRadius: '12px',
                        maxWidth: '400px',
                        width: '90%',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        border: '1px solid #fee2e2'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                            <div style={{
                                backgroundColor: '#fee2e2',
                                padding: '10px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <AlertTriangle size={24} color="#dc2626" />
                            </div>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: '#1f2937' }}>Order Issue</h3>
                        </div>

                        <p style={{ color: '#4b5563', lineHeight: 1.5, marginBottom: '24px', fontSize: '1rem' }}>
                            {validationError}
                        </p>

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setValidationError(null)}
                                className="btn btn-primary"
                                style={{
                                    backgroundColor: '#dc2626',
                                    border: 'none',
                                    padding: '10px 20px',
                                    fontWeight: 600
                                }}
                            >
                                I Understand
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}
