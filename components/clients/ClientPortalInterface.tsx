'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ItemCategory, BoxQuota, MealCategory, MealItem } from '@/lib/types';
import { syncCurrentOrderToUpcoming, getBoxQuotas, invalidateOrderData, updateClient, saveClientFoodOrder, saveClientMealOrder, saveClientBoxOrder } from '@/lib/actions';
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
    boxOrder?: any;
}

export function ClientPortalInterface({ client: initialClient, statuses, navigators, vendors, menuItems, boxTypes, categories, upcomingOrder, activeOrder, previousOrders, mealCategories, mealItems, foodOrder, mealOrder, boxOrder }: Props) {
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

        } else if (serviceType === 'Boxes' && boxOrder) {
            console.log('[ClientPortal] Hydrating from boxOrder:', boxOrder);
            configToSet = { ...boxOrder, serviceType: 'Boxes' };
            if (!configToSet.caseId && client.activeOrder?.caseId) {
                configToSet.caseId = client.activeOrder.caseId;
            }
            source = 'boxOrder';

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

    }, [upcomingOrder, activeOrder, client, foodOrder, mealOrder, boxOrder]);

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

    // Auto-Save Logic - matching ClientProfile exactly
    // Manual Save Logic
    const handleSave = async () => {
        if (!client || !orderConfig) return;

        // For Food clients, caseId is required. For Boxes, it's optional
        if (serviceType === 'Food' && !caseId) return;

        // --- VALIDATION START ---

        // 1. Food Service Validation (Limits & Minimums)
        if (serviceType === 'Food' && orderConfig.vendorSelections) {
            let totalMeals = 0;
            const vendorCounts: { [key: string]: number } = {};

            for (const selection of orderConfig.vendorSelections) {
                if (!selection.vendorId) continue;
                let count = 0;

                // Logic mirrors FoodServiceWidget:
                if (selection.itemsByDay && Object.keys(selection.itemsByDay).length > 0) {
                    // Multi-day with explicit daily items
                    for (const dayItems of Object.values(selection.itemsByDay) as any[]) {
                        for (const qty of Object.values(dayItems)) count += Number(qty) || 0;
                    }
                } else if (selection.items) {
                    // Single-day or Flat items applied to multiple days
                    const itemCount = Object.values(selection.items).reduce((a: any, b: any) => a + (Number(b) || 0), 0) as number;
                    const daysCount = (selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0)
                        ? selection.selectedDeliveryDays.length
                        : ((client as any).delivery_days?.length || 1); // Fallback to client days or 1
                    count = itemCount * daysCount;
                }

                totalMeals += count;
                vendorCounts[selection.vendorId] = (vendorCounts[selection.vendorId] || 0) + count;
            }

            // Check Approved Limit
            const limit = client.approvedMealsPerWeek || 0;
            if (limit > 0 && totalMeals > limit) {
                setValidationError(`You have selected ${totalMeals} meals, but your weekly limit is ${limit}. Please reduce your order.`);
                return;
            }

            // Check Vendor Minimums (Per Day / Per Delivery)
            for (const selection of orderConfig.vendorSelections) {
                if (!selection.vendorId) continue;
                const vendor = vendors.find(v => v.id === selection.vendorId);
                if (!vendor) continue;
                const minMeals = vendor.minimumMeals || 0;
                if (minMeals === 0) continue;

                if (selection.itemsByDay && Object.keys(selection.itemsByDay).length > 0) {
                    // Multi-day: Check each selected day independently
                    const activeDays = selection.selectedDeliveryDays || [];
                    for (const day of activeDays) {
                        const dayItems = selection.itemsByDay[day] || {};
                        const dayCount = Object.values(dayItems).reduce((a: any, b: any) => a + (Number(b) || 0), 0) as number;

                        if (dayCount < minMeals) {
                            setValidationError(`${vendor.name} requires a minimum of ${minMeals} meals for ${day}. You have selected ${dayCount}.`);
                            return;
                        }
                    }
                } else if (selection.items) {
                    // Single/Flat Mode: The items represent the "per delivery" definition
                    const count = Object.values(selection.items).reduce((a: any, b: any) => a + (Number(b) || 0), 0) as number;
                    if (count < minMeals) {
                        setValidationError(`${vendor.name} requires a minimum of ${minMeals} meals per delivery. You have selected ${count}.`);
                        return;
                    }
                }
            }
        }

        // 2. Meal Service Validation (Exact Category Values)
        if (orderConfig.mealSelections) {
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
                        if (totalSelectedValue !== subCat.setValue) {
                            setValidationError(`${subCat.name}: Selected ${totalSelectedValue}, but required is ${subCat.setValue}.`);
                            return;
                        }
                    }
                }
            }
        }
        // --- VALIDATION END ---

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
                await saveClientBoxOrder(client.id, {
                    caseId: cleanedOrderConfig.caseId,
                    boxTypeId: cleanedOrderConfig.boxTypeId,
                    vendorId: cleanedOrderConfig.vendorId,
                    quantity: cleanedOrderConfig.boxQuantity,
                    items: cleanedOrderConfig.items
                });
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
        const currentItems = { ...(orderConfig.items || {}) };
        if (qty > 0) {
            currentItems[itemId] = qty;
        } else {
            delete currentItems[itemId];
        }
        setOrderConfig({ ...orderConfig, items: currentItems });
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
                                    : 'Standard Box Allocation'
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
                        />
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
                                                            const itemVal = item.quotaValue || 1;
                                                            // Check if adding this item would exceed the limit
                                                            // If requiredQuotaValue is null, there is no limit.
                                                            const canAdd = requiredQuotaValue === null || (categoryQuotaValue + itemVal <= requiredQuotaValue);

                                                            return (
                                                                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-app)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                                                    <span style={{ fontSize: '0.8rem' }}>
                                                                        {item.name}
                                                                        {(item.quotaValue || 1) > 1 && (
                                                                            <span style={{ color: 'var(--text-tertiary)', marginLeft: '4px' }}>
                                                                                (counts as {item.quotaValue || 1} meals)
                                                                            </span>
                                                                        )}
                                                                    </span>
                                                                    <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                        <button onClick={() => handleBoxItemChange(item.id, Math.max(0, qty - 1))} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                        <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                        <button
                                                                            onClick={() => {
                                                                                if (!canAdd) {
                                                                                    alert("Adding this item would exceed the category limit");
                                                                                    return;
                                                                                }
                                                                                handleBoxItemChange(item.id, qty + 1);
                                                                            }}
                                                                            className="btn btn-secondary"
                                                                            style={{
                                                                                padding: '2px 8px',
                                                                                opacity: canAdd ? 1 : 0.5,
                                                                                cursor: canAdd ? 'pointer' : 'not-allowed'
                                                                            }}
                                                                            title={!canAdd ? "Adding this item would exceed the category limit" : "Add item"}
                                                                        >+</button>
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
                                                                    <span style={{ fontSize: '0.8rem' }}>
                                                                        {item.name}
                                                                        {(item.quotaValue || 1) > 1 && (
                                                                            <span style={{ color: 'var(--text-tertiary)', marginLeft: '4px' }}>
                                                                                (counts as {item.quotaValue || 1} meals)
                                                                            </span>
                                                                        )}
                                                                    </span>
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
