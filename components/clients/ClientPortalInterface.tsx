'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ItemCategory, BoxQuota, MealCategory, MealItem, AppSettings } from '@/lib/types';
import { getBoxQuotas, invalidateOrderData, updateClient, updateClientUpcomingOrder } from '@/lib/actions';
import { getSettings } from '@/lib/cached-data';
import { getNextDeliveryDate as getNextDeliveryDateUtil, getTakeEffectDate, formatDeliveryDate, calculateVendorEffectiveDate } from '@/lib/order-dates';
import { isMeetingMinimum, isExceedingMaximum, isMeetingExactTarget, getItemPoints } from '@/lib/utils';
import { Package, Truck, User, Loader2, Info, Plus, Calendar, AlertTriangle, Check, Trash2, Construction, History, ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';
import styles from './ClientProfile.module.css';
import FoodServiceWidget from './FoodServiceWidget';
import ClientPortalSidebar from './ClientPortalSidebar';
import ClientPortalHeader from './ClientPortalHeader';
import ClientPortalOrderSummary from './ClientPortalOrderSummary';
import MenuItemCard from './MenuItemCard';
import stylesClientPortal from './ClientPortal.module.css';

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
    mealCategories: MealCategory[];
    mealItems: MealItem[];
    foodOrder?: any;
    mealOrder?: any;
    boxOrders?: any[];
}

export function ClientPortalInterface({ client: initialClient, statuses, navigators, vendors, menuItems, boxTypes, categories, upcomingOrder, activeOrder, mealCategories, mealItems, foodOrder, mealOrder, boxOrders }: Props) {
    console.error(">>> [HEARTBEAT] ClientPortalInterface Rendered <<<");
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

    // Collapsible sections state


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

    // Initialize order config from clients.upcoming_order (single source)
    useEffect(() => {
        if (!client) return;

        let configToSet: any = {};

        if (upcomingOrder && typeof upcomingOrder === 'object') {
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
                    configToSet = { ...upcomingOrder };
                }
            if (!configToSet.serviceType) configToSet.serviceType = client.serviceType;
        } else {
            const defaultOrder: any = { serviceType: client.serviceType };
            if (client.serviceType === 'Food') {
                defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
            }
            configToSet = defaultOrder;
        }


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

    }, [upcomingOrder, activeOrder, client]);

    // Box Logic - Load quotas for all active box types to support multiple boxes with different types
    useEffect(() => {
        async function loadQuotas() {
            const effectiveType = orderConfig?.serviceType ?? client.serviceType;
            if (effectiveType !== 'Boxes' || boxTypes.length === 0) {
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
    }, [boxTypes, client.serviceType, orderConfig?.serviceType]);

    // Extract dependencies for auto-save
    const caseId = useMemo(() => orderConfig?.caseId ?? null, [orderConfig?.caseId]);
    const vendorSelections = useMemo(() => orderConfig?.vendorSelections ?? [], [orderConfig?.vendorSelections]);
    const vendorId = useMemo(() => orderConfig?.vendorId ?? null, [orderConfig?.vendorId]);
    const boxTypeId = useMemo(() => orderConfig?.boxTypeId ?? null, [orderConfig?.boxTypeId]);
    const boxQuantity = useMemo(() => orderConfig?.boxQuantity ?? null, [orderConfig?.boxQuantity]);
    const items = useMemo(() => (orderConfig as any)?.items ?? {}, [JSON.stringify((orderConfig as any)?.items)]);
    const itemPrices = useMemo(() => (orderConfig as any)?.itemPrices ?? {}, [(orderConfig as any)?.itemPrices]);
    // Use order's service type when we have upcoming order data, so portal shows Boxes/Food based on actual order not client row
    const serviceType = orderConfig?.serviceType ?? client.serviceType;

    // --- Auto-Scroll Logic ---
    const prevVendorCountRef = useRef(0);
    const prevMealKeysRef = useRef<string[]>([]);
    const prevBoxCountRef = useRef(0);

    // Watch for Vendor Additions
    useEffect(() => {
        const currentVendorCount = orderConfig.vendorSelections ? orderConfig.vendorSelections.length : 0;


        if (currentVendorCount > prevVendorCountRef.current) {
            setTimeout(() => {
                const newIndex = currentVendorCount - 1;
                const elementId = `vendor-block-${newIndex}`;
                const element = document.getElementById(elementId);


                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    setTimeout(() => {
                        const elRetry = document.getElementById(elementId);

                        if (elRetry) elRetry.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 300);
                }
            }, 400);
        }
        prevVendorCountRef.current = currentVendorCount;
    }, [orderConfig.vendorSelections?.length]);

    // Watch for Meal Type Additions
    useEffect(() => {
        const currentKeys = Object.keys(orderConfig.mealSelections || {});
        const prevKeys = prevMealKeysRef.current;


        if (currentKeys.length > prevKeys.length) {
            const newKey = currentKeys.find(k => !prevKeys.includes(k));


            if (newKey) {
                setTimeout(() => {
                    const elementId = `meal-block-${newKey}`;
                    const element = document.getElementById(elementId);


                    if (element) {
                        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    } else {
                        setTimeout(() => {
                            const elRetry = document.getElementById(elementId);

                            if (elRetry) elRetry.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 300);
                    }
                }, 400);
            }
        }
        prevMealKeysRef.current = currentKeys;
    }, [orderConfig.mealSelections]);

    // Watch for Box Additions
    useEffect(() => {
        const currentBoxCount = orderConfig.boxOrders ? orderConfig.boxOrders.length : 0;


        if (currentBoxCount > prevBoxCountRef.current) {
            setTimeout(() => {
                const newIndex = currentBoxCount - 1;
                const elementId = `box-block-${newIndex}`;
                const element = document.getElementById(elementId);


                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                    setTimeout(() => {
                        const elRetry = document.getElementById(elementId);

                        if (elRetry) elRetry.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, 300);
                }
            }, 400);
        }
        prevBoxCountRef.current = currentBoxCount;
    }, [orderConfig.boxOrders?.length]);


    // Auto-Save Logic - matching ClientProfile exactly
    // State-based Validation
    const [validationStatus, setValidationStatus] = useState({
        isValid: true,
        totalValue: 0,
        error: null as string | null
    });

    // Calculate total meal count for header
    const totalMealCount = useMemo(() => {
        let total = 0;
        const countedItemIdsGlobally = new Set<string>();

        try {
            if (orderConfig.serviceType === 'Food') {
                // Vendors
                if (orderConfig.vendorSelections) {
                    orderConfig.vendorSelections.forEach((sel: any) => {
                        // Skip if no vendorId to match validation logic, but let's be careful.
                        // Actually, header SHOULD match what's visible. If visible but no ID, still count it?
                        // The user said "Header is 21 (correct)". So let's keep it as is but add logs.

                        if (sel.itemsByDay && sel.selectedDeliveryDays) {
                            sel.selectedDeliveryDays.forEach((day: string) => {
                                const items = sel.itemsByDay[day] || {};
                                Object.entries(items).forEach(([id, qty]) => {
                                    countedItemIdsGlobally.add(id);
                                    const item = menuItems.find(i => i.id === id);
                                    total += (Number(qty) || 0) * getItemPoints(item);
                                });
                            });
                        } else if (sel.items) {
                            const multiplier = (sel.selectedDeliveryDays?.length || (client as any).delivery_days?.length || 1);
                            Object.entries(sel.items).forEach(([id, qty]) => {
                                countedItemIdsGlobally.add(id);
                                const item = menuItems.find(i => i.id === id);
                                total += (Number(qty) || 0) * getItemPoints(item) * multiplier;
                            });
                        }
                    });
                }
                // Meals
                if (orderConfig.mealSelections) {
                    Object.values(orderConfig.mealSelections).forEach((conf: any) => {
                        if (conf.items) {
                            Object.entries(conf.items).forEach(([id, qty]) => {
                                // De-duplicate if already in vendor loop
                                if (countedItemIdsGlobally.has(id)) return;

                                const item = mealItems.find(i => i.id === id);
                                total += (Number(qty) || 0) * getItemPoints(item);
                            });
                        }
                    });
                }
            } else if (orderConfig.serviceType === 'Meal') {
                if (orderConfig.mealSelections) {
                    Object.values(orderConfig.mealSelections).forEach((conf: any) => {
                        if (conf.items) {
                            Object.entries(conf.items).forEach(([id, qty]) => {
                                const item = mealItems.find(i => i.id === id);
                                total += (Number(qty) || 0) * getItemPoints(item);
                            });
                        }
                    });
                }
            }
        } catch (e) {
            console.error('[totalMealCount] Calculation Error:', e);
        }
        return total;
    }, [orderConfig, menuItems, mealItems, client]);

    // Real-time Validation Effect
    useEffect(() => {
        validateOrder();
    }, [orderConfig, orderConfig?.serviceType, client.approvedMealsPerWeek, client.serviceType, totalMealCount, menuItems, mealItems]);

    function validateOrder() {
        try {
            if (!client || !orderConfig) {

                return;
            }
            const effectiveType = orderConfig?.serviceType ?? client.serviceType;
            let isValid = true;
            let error: string | null = null;
            let totalValue = totalMealCount;



            // Detailed Trace to Console


            if (effectiveType === 'Food' && orderConfig.vendorSelections) {
                // Check Vendor Minimums
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
                                dayValue += getItemPoints(item) * (Number(qty) || 0);
                            }
                            // Only require minimum for days that have items; skip days with 0
                            if (dayValue > 0 && !isMeetingMinimum(dayValue, minMeals)) {
                                error = `${vendor.name} requires a minimum value of ${minMeals} for ${day}. You have selected ${dayValue}.`;
                                isValid = false;
                                break;
                            }
                        }
                    } else if (selection.items) {
                        let countValue = 0;
                        for (const [itemId, qty] of Object.entries(selection.items)) {
                            const item = menuItems.find(i => i.id === itemId);
                            countValue += getItemPoints(item) * (Number(qty) || 0);
                        }

                        if (!isMeetingMinimum(countValue, minMeals)) {
                            error = `${vendor.name} requires a minimum value of ${minMeals} per delivery. You have selected ${countValue}.`;
                            isValid = false;
                        }
                    }
                    if (!isValid) break;
                }
            }

            // Check Approved Limit
            const limit = client.approvedMealsPerWeek || 0;
            if (limit > 0 && isExceedingMaximum(totalValue, limit)) {
                error = `Total value selected (${totalValue.toFixed(2)}) exceeds approved value per week (${limit}). Please reduce your order.`;
                isValid = false;
            }

            // 2. Meal Service Validation (Exact Targets per Category)
            if (isValid && orderConfig.mealSelections) {
                for (const [uniqueKey, config] of Object.entries(orderConfig.mealSelections) as [string, any][]) {
                    const mealType = config.mealType || uniqueKey.split('_')[0];
                    const catsForThisType = mealCategories.filter(c => c.mealType === mealType);

                    for (const cat of catsForThisType) {
                        if (cat.setValue !== undefined && cat.setValue !== null) {
                            let selectedValue = 0;
                            if (config.items) {
                                Object.entries(config.items).forEach(([itemId, qty]) => {
                                    const item = mealItems.find(i => i.id === itemId);
                                    if (item && item.categoryId === cat.id) {
                                        selectedValue += getItemPoints(item) * (Number(qty) || 0);
                                    }
                                });
                            }

                            if (!isMeetingExactTarget(selectedValue, cat.setValue)) {
                                isValid = false;
                                error = `Please select exactly ${cat.setValue} items for ${mealType} - ${cat.name}. (Current: ${selectedValue})`;
                                break;
                            }
                        }
                    }
                    if (!isValid) break;
                }
            }

            // 3. Box Service Validation
            if (isValid && effectiveType === 'Boxes' && orderConfig.boxOrders) {
                orderConfig.boxOrders.forEach((box: any, boxIdx: number) => {
                    if (!isValid) return;

                    categories.forEach(category => {
                        if (!isValid) return;

                        const selectedItems = box.items || {};
                        let categoryQuotaValue = 0;

                        Object.entries(selectedItems).forEach(([itemId, qty]) => {
                            const item = menuItems.find(i => i.id === itemId);
                            if (item && item.categoryId === category.id) {
                                const itemQuotaValue = item.quotaValue || 1;
                                categoryQuotaValue += (qty as number) * itemQuotaValue;
                            }
                        });

                        let requiredQuotaValue: number | null = null;
                        if (category.setValue !== undefined && category.setValue !== null) {
                            requiredQuotaValue = category.setValue;
                        } else if (box.boxTypeId) {
                            const quota = activeBoxQuotas.find(q => q.boxTypeId === box.boxTypeId && q.categoryId === category.id);
                            if (quota) {
                                requiredQuotaValue = quota.targetValue;
                            }
                        }

                        if (requiredQuotaValue !== null && !isMeetingExactTarget(categoryQuotaValue, requiredQuotaValue)) {
                            error = `Box #${boxIdx + 1} - ${category.name}: Selected ${categoryQuotaValue} pts, but required is ${requiredQuotaValue} pts.`;
                            isValid = false;
                        }
                    });
                });
            }

            setValidationStatus({ isValid, totalValue, error });
        } catch (err) {
            console.error("[validateOrder] CRASHED:", err);
            setValidationStatus(prev => ({ ...prev, isValid: false, error: "Validation system crashed. Check console." }));
        }
    }

    // Manual Save Logic
    const handleSave = async () => {
        if (!client || !orderConfig) {
            console.error("[handleSave] Component data missing");
            return;
        }

        const effectiveType = orderConfig?.serviceType ?? client.serviceType;
        const caseId = orderConfig?.caseId || (client as any).caseID || (client.upcomingOrder as any)?.caseId;

        console.error("!!! [handleSave] CALLED !!!", { validationStatus, totalMealCount });
        console.log("DEBUG: Full orderConfig:", JSON.stringify(orderConfig, null, 2));
        console.log("DEBUG: serviceType:", effectiveType);
        console.log("DEBUG: caseId:", caseId);

        if (effectiveType === 'Meal') {
            console.log("DEBUG: Checking Meal Selections:", orderConfig?.mealSelections);
            if (orderConfig?.mealSelections) {
                Object.entries(orderConfig.mealSelections).forEach(([key, val]) => {
                    console.log(`DEBUG: Meal Selection [${key}]:`, val);
                });
            } else {
                console.log("DEBUG: No mealSelections found in orderConfig");
            }
        }

        // For Food clients, caseId is required. For Boxes, it's optional
        if (effectiveType === 'Food' && !caseId) {
            console.error("[handleSave] Missing caseId for Food client");
            setValidationError("Missing Case ID. Please contact support.");
            return;
        }

        // Use Pre-calculated validation status
        if (!validationStatus.isValid) {
            // Trigger the detailed modal when user attempts to save an invalid order
            setValidationError(validationStatus.error);
            return;
        }

        try {
            // Ensure structure is correct and convert per-vendor delivery days to deliveryDayOrders format
            const cleanedOrderConfig = { ...orderConfig };

            // CRITICAL: Always preserve caseId at the top level for both Food and Boxes
            cleanedOrderConfig.caseId = orderConfig.caseId;

            // Generate the order snapshot for the history (BEFORE any mutations)
            const orderSnapshot = generateOrderSnapshot(cleanedOrderConfig as any);

            if (effectiveType === 'Food') {
                // Single shape only: persist vendorSelections (no deliveryDayOrders).
                if (Array.isArray(cleanedOrderConfig.vendorSelections)) {
                    cleanedOrderConfig.vendorSelections = cleanedOrderConfig.vendorSelections
                        .filter((s: any) => s?.vendorId)
                        .map((s: any) => ({
                            vendorId: s.vendorId,
                            items: s.items || {},
                            itemsByDay: s.itemsByDay && typeof s.itemsByDay === 'object' ? s.itemsByDay : {},
                            selectedDeliveryDays: Array.isArray(s.selectedDeliveryDays) ? s.selectedDeliveryDays : [],
                            itemNotes: s.itemNotes || {},
                            itemNotesByDay: s.itemNotesByDay && typeof s.itemNotesByDay === 'object' ? s.itemNotesByDay : {}
                        }));
                }
                delete cleanedOrderConfig.deliveryDayOrders;
            } else if (effectiveType === 'Boxes') {
                // For Boxes: Explicitly preserve all critical fields
                cleanedOrderConfig.boxOrders = orderConfig.boxOrders || [];

                // Populate top-level fields from the first box for backward compatibility and sync
                if (cleanedOrderConfig.boxOrders.length > 0) {
                    const firstBox = cleanedOrderConfig.boxOrders[0];
                    cleanedOrderConfig.vendorId = firstBox.vendorId;
                    cleanedOrderConfig.boxTypeId = firstBox.boxTypeId;
                    cleanedOrderConfig.boxQuantity = firstBox.quantity || 1;
                    cleanedOrderConfig.items = firstBox.items || {};
                } else {
                    cleanedOrderConfig.vendorId = orderConfig.vendorId;
                    cleanedOrderConfig.boxTypeId = orderConfig.boxTypeId;
                    cleanedOrderConfig.boxQuantity = orderConfig.boxQuantity || 1;
                    cleanedOrderConfig.items = orderConfig.items || {};
                }

                cleanedOrderConfig.caseId = orderConfig.caseId;
                cleanedOrderConfig.itemPrices = orderConfig.itemPrices || {};
            }

            const payload = {
                ...cleanedOrderConfig,
                serviceType: effectiveType,
                notes: cleanedOrderConfig.notes
            };

            setSaving(true);
            setMessage('Saving...');

            await updateClientUpcomingOrder(client.id, payload);

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

    function generateOrderSnapshot(config: any | undefined): string {
        if (!config) return 'No order configuration';
        let snapshot = `Service: ${config.serviceType || 'Not Set'}${config.caseId ? ` | Case ID: ${config.caseId}` : ''}\n`;

        // Helper to get item name
        const getItemName = (id: string, isMeal = false) => {
            if (isMeal) return (mealItems || []).find(i => i.id === id)?.name || id;
            return (menuItems || []).find(i => i.id === id)?.name || id;
        };

        // Helper to get vendor name
        const getVendorName = (id: string) => (vendors || []).find(v => v.id === id)?.name || id;

        // Helper to get box type name
        const getBoxTypeName = (id: string) => (boxTypes || []).find(b => b.id === id)?.name || id;

        // 1. PRIMARY SERVICE SECTION
        let primarySection = '';
        if (config.serviceType === 'Boxes') {
            const boxes = config.boxOrders || [];
            if (boxes.length > 0) {
                primarySection = boxes.map((box: any, i: number) => {
                    const items = box.items || {};
                    const itemDetails = Object.keys(items)
                        .map(itemId => `  - ${items[itemId]}x ${getItemName(itemId)}`)
                        .join('\n');
                    const vendorName = getVendorName(box.vendorId);
                    const boxTypeName = getBoxTypeName(box.boxTypeId);
                    return `Box ${i + 1}: ${boxTypeName} (Qty: ${box.quantity || 1}) [Vendor: ${vendorName}]\n${itemDetails || '  - No items'}`;
                }).join('\n');
            } else if (config.boxTypeId) {
                const items = (config as any).items || {};
                const itemDetails = Object.keys(items)
                    .map(itemId => `  - ${items[itemId]}x ${getItemName(itemId)}`)
                    .join('\n');
                const vendorName = getVendorName((config as any).vendorId);
                const boxTypeName = getBoxTypeName(config.boxTypeId);
                primarySection = `Box: ${boxTypeName} (Qty: ${(config as any).boxQuantity || 1}) [Vendor: ${vendorName}]\n${itemDetails || '  - No items'}`;
            }
        } else if (config.serviceType === 'Food') {
            const days = (config as any).deliveryDayOrders || {};
            const dayKeys = Object.keys(days).sort();

            if (dayKeys.length > 0) {
                primarySection = dayKeys.map(day => {
                    const selections = days[day]?.vendorSelections || [];
                    const vendorDetails = selections.map((vs: any) => {
                        const items = vs.items || {};
                        const itemDetails = Object.keys(items)
                            .map(itemId => `    - ${items[itemId]}x ${getItemName(itemId)}`)
                            .join('\n');
                        return `  Vendor [${getVendorName(vs.vendorId)}]:\n${itemDetails || '    - No items'}`;
                    }).join('\n');
                    return `${day}:\n${vendorDetails || '  - No vendors'}`;
                }).join('\n');
            } else if ((config as any).vendorSelections && (config as any).vendorSelections.length > 0) {
                primarySection = (config as any).vendorSelections.map((vs: any) => {
                    let itemDetails = '';

                    // Handle itemsByDay (Multi-day format in vendorSelections)
                    if (vs.itemsByDay && Object.keys(vs.itemsByDay).length > 0) {
                        const days = Object.keys(vs.itemsByDay).sort();
                        itemDetails = days.map(day => {
                            const dayItems = vs.itemsByDay[day] || {};
                            const dayDetails = Object.keys(dayItems)
                                .map(itemId => `    - ${dayItems[itemId]}x ${getItemName(itemId)}`)
                                .join('\n');
                            return `  ${day}:\n${dayDetails || '    - No items'}`;
                        }).join('\n');
                    } else {
                        // Standard items
                        const items = vs.items || {};
                        itemDetails = Object.keys(items)
                            .map(itemId => `  - ${items[itemId]}x ${getItemName(itemId)}`)
                            .join('\n');
                    }

                    return `Vendor [${getVendorName(vs.vendorId)}]:\n${itemDetails || '  - No items'}`;
                }).join('\n');
            }
        } else if (config.serviceType === 'Custom') {
            primarySection = `Custom Order: ${(config as any).custom_name || (config as any).description || 'Unnamed'}\n`;
            primarySection += `Price: $${(config as any).custom_price || (config as any).totalValue || 0}\n`;
            primarySection += `Vendor: ${getVendorName((config as any).vendorId)}`;
        }

        if (primarySection) {
            snapshot += primarySection + '\n';
        }

        // 2. MEAL SELECTIONS SECTION (CUMULATIVE)
        const meals = (config as any).mealSelections || {};
        const mealTypes = Object.keys(meals).sort();
        if (mealTypes.length > 0) {
            const mealSection = `\nMeal Selections:\n` + mealTypes.map(mKey => {
                const meal = meals[mKey];
                const items = meal.items || {};
                const itemDetails = Object.keys(items)
                    .map(itemId => `  - ${items[itemId]}x ${getItemName(itemId, true)}`)
                    .join('\n');
                return `${meal.mealType || mKey} [${getVendorName(meal.vendorId)}]:\n${itemDetails || '  - No items'}`;
            }).join('\n');
            snapshot += mealSection;
        }

        return snapshot.trim();
    }

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
        const limit = client.approvedMealsPerWeek;
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

    function handleBoxItemUpdate(boxIndex: number, itemId: string, quantity: number, note?: string) {
        const currentBoxes = [...(orderConfig.boxOrders || [])];
        if (!currentBoxes[boxIndex]) return;

        const currentItems = { ...(currentBoxes[boxIndex].items || {}) };
        const currentNotes = { ...(currentBoxes[boxIndex].itemNotes || {}) };

        if (quantity > 0) {
            currentItems[itemId] = quantity;
            if (note !== undefined) {
                if (note.trim() === '') {
                    delete currentNotes[itemId];
                } else {
                    currentNotes[itemId] = note;
                }
            }
        } else {
            delete currentItems[itemId];
            delete currentNotes[itemId];
        }

        currentBoxes[boxIndex] = {
            ...currentBoxes[boxIndex],
            items: currentItems,
            itemNotes: currentNotes
        };
        setOrderConfig({ ...orderConfig, boxOrders: currentBoxes });
    }


    const configChanged = JSON.stringify(orderConfig) !== JSON.stringify(originalOrderConfig);



    // Handlers needed for Header
    const handleAddVendorBlock = () => {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            newConfig.vendorSelections = newConfig.vendorSelections ? [...newConfig.vendorSelections] : [];
            newConfig.vendorSelections.push({
                vendorId: '',
                items: {}
            });
            return newConfig;
        });
    };

    const handleAddMeal = (mealType: string) => {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            // Shallow copy mealSelections to allow change detection
            newConfig.mealSelections = { ...(newConfig.mealSelections || {}) };

            const uniqueKey = `${mealType}_${Date.now()}`;
            newConfig.mealSelections[uniqueKey] = {
                mealType,
                vendorId: '',
                items: {}
            };
            return newConfig;
        });
    };

    // Calculate take effect date
    const takingEffectDate = useMemo(() => {
        // --- EFFECTIVE DATE CALCULATION FOR HEADER ---
        let headerEffectiveDate: React.ReactNode = null;

        if (serviceType === 'Food') {
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

            const dates: React.ReactNode[] = [];
            uniqueVendorIds.forEach(vId => {
                const v = vendors.find(vend => vend.id === vId);
                if (v) {
                    const cutoff = v.cutoffDays || 0;
                    const effectiveDate = calculateVendorEffectiveDate(cutoff);
                    const dateString = effectiveDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
                    dates.push(
                        <div key={v.id} style={{ lineHeight: '1.2' }}>
                            Changes for <strong>{v.name}</strong>: <strong>{dateString}</strong>
                        </div>
                    );
                }
            });

            if (dates.length > 0) {
                headerEffectiveDate = <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.9rem' }}>{dates}</div>;
            }
        } else if (settings && serviceType !== 'Boxes') {
            // const nextDate = getNextDeliveryDateUtil(client, settings); // Broken signature
            const takeEffect = getTakeEffectDate(settings, new Date());
            if (takeEffect) {
                headerEffectiveDate = takeEffect.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
            }
        }

        return headerEffectiveDate;
    }, [settings, client, serviceType, orderConfig.deliveryDayOrders, orderConfig.vendorSelections, vendors]);

    // --- SEARCH STATE ---
    const [searchTerm, setSearchTerm] = useState('');

    return (
        <div className={stylesClientPortal.portalContainer}>
            {/* Left Sidebar */}
            <ClientPortalSidebar client={client} serviceType={serviceType} />

            {/* Main Content Area */}
            <div className={stylesClientPortal.mainColumn}>

                {/* Sticky Header */}
                <ClientPortalHeader
                    client={client}
                    serviceType={serviceType}
                    totalMealCount={totalMealCount}
                    approvedLimit={client.approvedMealsPerWeek}
                    validationError={validationStatus.error}
                    takingEffectDate={takingEffectDate}
                    onAddVendor={handleAddVendorBlock}
                    onAddMeal={handleAddMeal}
                    mealCategories={mealCategories}
                    orderConfig={orderConfig}
                />

                {/* Scrollable Content */}
                <div className={stylesClientPortal.scrollableContent}>

                    <div className={styles.alert} style={{ marginBottom: '1rem' }}>
                        <Info size={16} />
                        <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                            PLEASE NOTE: ANY CHANGES TO AN ORDER NEEDS TO BE SUBMITTED BY TUESDAY 11:59 PM TO TAKE EFFECT FOR THE FOLLOWING WEEK

                        </div>
                    </div>

                    {(serviceType === 'Food' || serviceType === 'Meal') && (
                        <FoodServiceWidget
                            orderConfig={orderConfig}
                            setOrderConfig={setOrderConfig}
                            client={client}
                            vendors={vendors}
                            menuItems={menuItems}
                            mealCategories={mealCategories}
                            mealItems={mealItems}
                            isClientPortal={true}
                            serviceType={serviceType}
                            validationStatus={validationStatus}
                        />
                    )}

                    {serviceType === 'Boxes' && (
                        <div>
                            {(() => {
                                const currentBoxes = orderConfig.boxOrders || [];
                                if (currentBoxes.length === 0) return null;

                                return (
                                    <div>
                                        {currentBoxes.map((box: any, index: number) => (
                                            <div key={index} id={`box-block-${index}`} style={{ marginBottom: '2rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
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

                                                {/* Box Content Selection Reuse */}
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
                                                            {categories.map(category => {
                                                                const availableItems = menuItems.filter(i =>
                                                                    ((i.vendorId === null || i.vendorId === '') || i.vendorId === box.vendorId) &&
                                                                    i.isActive &&
                                                                    i.categoryId === category.id &&
                                                                    (searchTerm === '' || i.name.toLowerCase().includes(searchTerm.toLowerCase()))
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

                                                                let requiredQuotaValue: number | null = null;
                                                                if (category.setValue !== undefined && category.setValue !== null) {
                                                                    requiredQuotaValue = category.setValue;
                                                                } else if (box.boxTypeId) {
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

                                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                                                                            {availableItems.map(item => (
                                                                                <MenuItemCard
                                                                                    key={item.id}
                                                                                    item={item}
                                                                                    quantity={selectedItems[item.id] || 0}
                                                                                    note={box.itemNotes?.[item.id] || ''}
                                                                                    onQuantityChange={(qty) => handleBoxItemUpdate(index, item.id, qty)}
                                                                                    onNoteChange={(note) => handleBoxItemUpdate(index, item.id, selectedItems[item.id] || 0, note)}
                                                                                />
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        ))}

                                        {(!client.approvedMealsPerWeek || currentBoxes.length < client.approvedMealsPerWeek) && (
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


                </div>
            </div>

            {/* Right Sidebar - Summary */}
            <ClientPortalOrderSummary
                orderConfig={orderConfig}
                vendors={vendors}
                menuItems={menuItems}
                mealCategories={mealCategories}
                mealItems={mealItems}
            />

            {
                (configChanged || saving) && (
                    <>
                        <style>{`
                            @media (max-width: 768px) {
                                .save-bar-container { padding: 0.75rem 1rem !important; }
                                .save-bar-content { flex-direction: column !important; gap: 0.75rem !important; }
                            }
                        `}</style>
                        <div className="save-bar-container" style={{
                            position: 'fixed', bottom: 0, left: 0, right: 0,
                            backgroundColor: saving ? '#d1fae5' : '#fef3c7',
                            borderTop: saving ? '4px solid #10b981' : '4px solid #f59e0b',
                            boxShadow: saving ? '0 -10px 30px -5px rgba(16, 185, 129, 0.4)' : '0 -10px 30px -5px rgba(245, 158, 11, 0.4)',
                            zIndex: 1000, backdropFilter: 'blur(10px)',
                            display: 'flex', flexDirection: 'column'
                        }}>
                            <div className="save-bar-content" style={{ maxWidth: '1200px', width: '100%', margin: '0 auto', display: 'flex', alignItems: 'center', padding: '12px 24px' }}>
                                <div style={{ flex: 1, fontWeight: 600, color: saving ? '#065f46' : '#92400e' }}>
                                    {saving ? 'SAVING CHANGES...' : 'UNSAVED CHANGES'}
                                </div>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <button onClick={handleDiscard} className="btn btn-secondary" disabled={saving} style={{ padding: '8px 16px', borderRadius: '6px' }}>Discard</button>
                                    <button onClick={handleSave} className="btn btn-primary" disabled={saving} style={{ padding: '8px 16px', borderRadius: '6px', background: 'var(--color-primary)', color: 'white', border: 'none' }}>{saving ? 'Saving...' : 'Save Changes'}</button>
                                </div>
                            </div>

                            {/* Inline Error Banner */}
                            {!validationStatus.isValid && validationStatus.error && (
                                <div style={{
                                    backgroundColor: '#fee2e2',
                                    color: '#991b1b',
                                    padding: '8px 24px',
                                    fontSize: '0.85rem',
                                    fontWeight: 500,
                                    borderTop: '1px solid #fecaca',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px'
                                }}>
                                    <AlertTriangle size={14} />
                                    <span>{validationStatus.error}</span>
                                </div>
                            )}
                        </div>
                    </>
                )
            }

            {
                validationError && (
                    <div style={{
                        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 2000,
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        <div style={{ background: 'white', padding: '24px', borderRadius: '8px', maxWidth: '400px' }}>
                            <h3>Order Issue</h3>
                            <p>{validationError}</p>
                            <button onClick={() => setValidationError(null)} className="btn btn-primary">I Understand</button>
                        </div>
                    </div>
                )
            }
        </div>
    );
};
