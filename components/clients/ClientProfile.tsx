'use client';

import { useState, useEffect, Fragment, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ServiceType, AppSettings, DeliveryRecord, ItemCategory, BoxQuota, ClientFullDetails } from '@/lib/types';
import { updateClient, deleteClient, updateDeliveryProof, recordClientChange, getBoxQuotas, syncCurrentOrderToUpcoming, logNavigatorAction } from '@/lib/actions';
import { getClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getSettings, getCategories, getClients, invalidateClientData, invalidateReferenceData, getActiveOrderForClient, getUpcomingOrderForClient, getOrderHistory, getClientHistory, getBillingHistory, invalidateOrderData } from '@/lib/cached-data';
import { Save, ArrowLeft, Truck, Package, AlertTriangle, Upload, Trash2, Plus, Check, ClipboardList, History, CreditCard, Calendar, ChevronDown, ChevronUp, ShoppingCart, Loader2 } from 'lucide-react';
import styles from './ClientProfile.module.css';


interface Props {
    clientId: string;
    onClose?: () => void;
    initialData?: ClientFullDetails | null;
    // Lookups passed from parent to avoid re-fetching
    statuses?: ClientStatus[];
    navigators?: Navigator[];
    vendors?: Vendor[];
    menuItems?: MenuItem[];
    boxTypes?: BoxType[];
    currentUser?: { role: string; id: string } | null;
}

const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes'];


function UnitsModal({
    isOpen,
    onClose,
    onConfirm,
    saving
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (units: number) => void;
    saving: boolean;
}) {
    const [units, setUnits] = useState<string>('0');

    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} style={{ zIndex: 1000 }}>
            <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>Status Change Detected</h2>
                <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                    You are changing the client's status. How many units should be added?
                </p>
                <div style={{ marginBottom: '24px' }}>
                    <label className="label">Units Added</label>
                    <input
                        type="number"
                        className="input"
                        value={units}
                        onChange={e => setUnits(e.target.value)}
                        min="0"
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        onClick={() => onConfirm(parseInt(units) || 0)}
                        disabled={saving}
                    >
                        {saving ? <Loader2 className="spin" size={16} /> : 'Confirm & Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function ClientProfileDetail({ clientId: propClientId, onClose, initialData, statuses: initialStatuses, navigators: initialNavigators, vendors: initialVendors, menuItems: initialMenuItems, boxTypes: initialBoxTypes, currentUser }: Props) {
    const router = useRouter();
    const params = useParams();
    const clientId = (params?.id as string) || propClientId;

    const [client, setClient] = useState<ClientProfile | null>(null);
    const [statuses, setStatuses] = useState<ClientStatus[]>(initialStatuses || []);
    const [navigators, setNavigators] = useState<Navigator[]>(initialNavigators || []);
    const [vendors, setVendors] = useState<Vendor[]>(initialVendors || []);
    const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems || []);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>(initialBoxTypes || []);
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [activeBoxQuotas, setActiveBoxQuotas] = useState<BoxQuota[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [history, setHistory] = useState<DeliveryRecord[]>([]);
    const [orderHistory, setOrderHistory] = useState<any[]>([]);
    const [billingHistory, setBillingHistory] = useState<any[]>([]);
    const [activeHistoryTab, setActiveHistoryTab] = useState<'deliveries' | 'audit' | 'billing'>('deliveries');
    const [allClients, setAllClients] = useState<ClientProfile[]>([]);
    const [expandedBillingRows, setExpandedBillingRows] = useState<Set<string>>(new Set());

    const [formData, setFormData] = useState<Partial<ClientProfile>>({});
    const [orderConfig, setOrderConfig] = useState<any>({}); // Current Order Request (from upcoming_orders)
    const [originalOrderConfig, setOriginalOrderConfig] = useState<any>({}); // Original Order Request for comparison
    const [activeOrder, setActiveOrder] = useState<any>(null); // This Week's Order (from orders table)

    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<{ show: boolean, messages: string[] }>({ show: false, messages: [] });

    const [loading, setLoading] = useState(true);
    const [loadingOrderDetails, setLoadingOrderDetails] = useState(true);

    // Status Change Logic
    const [showUnitsModal, setShowUnitsModal] = useState(false);
    const [pendingStatusChange, setPendingStatusChange] = useState<{ oldStatus: string, newStatus: string } | null>(null);

    useEffect(() => {
        // If we have initialData AND we have the necessary lookups (passed as props), we can hydrate instantly without loading state.
        // However, if we are missing critical lookups (e.g. somehow props weren't passed), we should still trigger loadLookups.
        // Generally, ClientList passes everything.

        if (initialData && initialData.client.id === clientId) {
            hydrateFromInitialData(initialData);
            // If props were passed, we don't need to fetch standard lookups, but we might still need settings/categories/allClients
            // For simplicity, let's just fetch everything missing in background but show content immediately if we have the basics.
            // If we don't have vendors/statuses props, we probably should show loader or fetch fast.

            if (!initialStatuses || !initialVendors) {
                // Should hopefully not happen in ClientList usage, but handle it
                setLoading(true);
                loadLookups().then(() => setLoading(false));
            } else {
                // Still fetch auxiliary data that might not be in props (settings, categories, allClients)
                // But do NOT block UI
                setLoading(false);
                loadAuxiliaryData();
            }
        } else {
            setLoading(true);
            loadData().then(() => setLoading(false));
        }
    }, [clientId, initialData]);

    async function loadAuxiliaryData() {
        const [appSettings, catData, allClientsData] = await Promise.all([
            getSettings(),
            getCategories(),
            getClients()
        ]);
        setSettings(appSettings);
        setCategories(catData);
        setAllClients(allClientsData);
    }

    function hydrateFromInitialData(data: ClientFullDetails) {
        setClient(data.client);
        setFormData(data.client);

        // Set active order, history, order history, and billing history if available
        setActiveOrder(data.activeOrder || null);
        setHistory(data.history || []);
        setOrderHistory(data.orderHistory || []);
        setBillingHistory(data.billingHistory || []);
        setLoadingOrderDetails(false);

        // Handle upcoming order logic (reused from loadData)
        const upcomingOrderData = data.upcomingOrder;
        if (upcomingOrderData) {
            // Check if it's the multi-day format (object keyed by delivery day, not deliveryDayOrders)
            const isMultiDayFormat = upcomingOrderData && typeof upcomingOrderData === 'object' &&
                !upcomingOrderData.serviceType &&
                !upcomingOrderData.deliveryDayOrders &&
                Object.keys(upcomingOrderData).some(key => {
                    const val = (upcomingOrderData as any)[key];
                    return val && val.serviceType;
                });

            if (isMultiDayFormat) {
                // Convert to deliveryDayOrders format
                const deliveryDayOrders: any = {};
                for (const day of Object.keys(upcomingOrderData)) {
                    const dayOrder = (upcomingOrderData as any)[day];
                    if (dayOrder && dayOrder.serviceType) {
                        deliveryDayOrders[day] = {
                            vendorSelections: dayOrder.vendorSelections || []
                        };
                    }
                }
                setOrderConfig({
                    serviceType: (upcomingOrderData as any)[Object.keys(upcomingOrderData)[0]]?.serviceType || data.client.serviceType,
                    caseId: (upcomingOrderData as any)[Object.keys(upcomingOrderData)[0]]?.caseId,
                    deliveryDayOrders
                });
            } else if (upcomingOrderData.serviceType === 'Food' && !upcomingOrderData.vendorSelections && !upcomingOrderData.deliveryDayOrders) {
                if (upcomingOrderData.vendorId) {
                    upcomingOrderData.vendorSelections = [{ vendorId: upcomingOrderData.vendorId, items: upcomingOrderData.menuSelections || {} }];
                } else {
                    upcomingOrderData.vendorSelections = [{ vendorId: '', items: {} }];
                }
                setOrderConfig(upcomingOrderData);
            } else {
                setOrderConfig(upcomingOrderData);
            }
        } else {
            const defaultOrder: any = { serviceType: data.client.serviceType };
            if (data.client.serviceType === 'Food') {
                defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
            }
            setOrderConfig(defaultOrder);
        }
    }

    async function loadLookups() {
        const [s, n, v, m, b, appSettings, catData, allClientsData] = await Promise.all([
            getStatuses(),
            getNavigators(),
            getVendors(),
            getMenuItems(),
            getBoxTypes(),
            getSettings(),
            getCategories(),
            getClients()
        ]);
        setStatuses(s);
        setNavigators(n);
        setVendors(v);
        setMenuItems(m);
        setBoxTypes(b);
        setSettings(appSettings);
        setCategories(catData);
        setAllClients(allClientsData);
    }

    async function loadData() {
        setLoadingOrderDetails(true);
        const [c, s, n, v, m, b, appSettings, catData, allClientsData, upcomingOrderData, activeOrderData, historyData, orderHistoryData, billingHistoryData] = await Promise.all([
            getClient(clientId),
            getStatuses(),
            getNavigators(),
            getVendors(),
            getMenuItems(),
            getBoxTypes(),
            getSettings(),
            getCategories(),
            getClients(),
            getUpcomingOrderForClient(clientId),
            getActiveOrderForClient(clientId),
            getClientHistory(clientId),
            getOrderHistory(clientId),
            getBillingHistory(clientId)
        ]);

        if (c) {
            setClient(c);
        }
        setStatuses(s);
        setNavigators(n);
        setVendors(v);
        setMenuItems(m);
        setBoxTypes(b);
        setSettings(appSettings);
        setCategories(catData);
        setAllClients(allClientsData);
        setActiveOrder(activeOrderData);
        setHistory(historyData || []);
        setOrderHistory(orderHistoryData || []);
        setBillingHistory(billingHistoryData || []);
        setLoadingOrderDetails(false);

        // Set order config from upcoming_orders table (Current Order Request)
        // If no upcoming order exists, initialize with default based on service type
        if (c) {
            let configToSet: any = {};
            if (upcomingOrderData) {
                // Check if it's the multi-day format (object keyed by delivery day, not deliveryDayOrders)
                const isMultiDayFormat = upcomingOrderData && typeof upcomingOrderData === 'object' &&
                    !upcomingOrderData.serviceType &&
                    !upcomingOrderData.deliveryDayOrders &&
                    Object.keys(upcomingOrderData).some(key => {
                        const val = (upcomingOrderData as any)[key];
                        return val && val.serviceType;
                    });

                if (isMultiDayFormat) {
                    // Convert to deliveryDayOrders format
                    const deliveryDayOrders: any = {};
                    for (const day of Object.keys(upcomingOrderData)) {
                        const dayOrder = (upcomingOrderData as any)[day];
                        if (dayOrder && dayOrder.serviceType) {
                            deliveryDayOrders[day] = {
                                vendorSelections: dayOrder.vendorSelections || []
                            };
                        }
                    }
                    configToSet = {
                        serviceType: (upcomingOrderData as any)[Object.keys(upcomingOrderData)[0]]?.serviceType || c.serviceType,
                        caseId: (upcomingOrderData as any)[Object.keys(upcomingOrderData)[0]]?.caseId,
                        deliveryDayOrders
                    };
                } else if (upcomingOrderData.serviceType === 'Food' && !upcomingOrderData.vendorSelections && !upcomingOrderData.deliveryDayOrders) {
                    // Migration/Safety: Ensure vendorSelections exists for Food
                    if (upcomingOrderData.vendorId) {
                        // Migrate old format
                        upcomingOrderData.vendorSelections = [{ vendorId: upcomingOrderData.vendorId, items: upcomingOrderData.menuSelections || {} }];
                    } else {
                        upcomingOrderData.vendorSelections = [{ vendorId: '', items: {} }];
                    }
                    configToSet = upcomingOrderData;
                } else {
                    configToSet = upcomingOrderData;
                }
            } else {
                // No upcoming order, initialize with default
                const defaultOrder: any = { serviceType: c.serviceType };
                if (c.serviceType === 'Food') {
                    defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
                }
                configToSet = defaultOrder;
            }
            setOrderConfig(configToSet);
            setOriginalOrderConfig(JSON.parse(JSON.stringify(configToSet))); // Deep copy for comparison
        }
    }

    // Effect: Load quotas when boxTypeId changes, or auto-select first box type for Boxes service
    useEffect(() => {
        // If Boxes service is selected and no boxTypeId, auto-set it to first active box type
        if (formData.serviceType === 'Boxes' && !orderConfig.boxTypeId && boxTypes.length > 0) {
            const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
            if (firstActiveBoxType) {
                setOrderConfig((prev: any) => ({
                    ...prev,
                    boxTypeId: firstActiveBoxType.id,
                    boxQuantity: 1
                }));
            }
        }

        // Load quotas for the current boxTypeId
        if (orderConfig.boxTypeId) {
            getBoxQuotas(orderConfig.boxTypeId).then(quotas => {
                setActiveBoxQuotas(quotas);
            });
        } else {
            setActiveBoxQuotas([]);
        }
    }, [orderConfig.boxTypeId, formData.serviceType, boxTypes]);

    // Extract dependencies with defaults to ensure consistent array size
    const caseId = useMemo(() => orderConfig?.caseId ?? null, [orderConfig?.caseId]);
    const vendorSelections = useMemo(() => orderConfig?.vendorSelections ?? [], [orderConfig?.vendorSelections]);
    const vendorId = useMemo(() => orderConfig?.vendorId ?? null, [orderConfig?.vendorId]);
    const boxTypeId = useMemo(() => orderConfig?.boxTypeId ?? null, [orderConfig?.boxTypeId]);
    const boxQuantity = useMemo(() => orderConfig?.boxQuantity ?? null, [orderConfig?.boxQuantity]);
    const items = useMemo(() => (orderConfig as any)?.items ?? {}, [(orderConfig as any)?.items]);
    const itemPrices = useMemo(() => (orderConfig as any)?.itemPrices ?? {}, [(orderConfig as any)?.itemPrices]);
    const serviceType = useMemo(() => formData?.serviceType ?? null, [formData?.serviceType]);

    // Effect: Check and save Service Configuration when form is being edited
    useEffect(() => {
        if (!client || !orderConfig || !caseId) return;

        // Debounce check to avoid too many calls
        const timeoutId = setTimeout(async () => {
            try {
                // Check if there's an existing upcoming order
                const existingUpcomingOrder = await getUpcomingOrderForClient(clientId);

                // If no upcoming order exists, or if the data doesn't match, save it
                let needsSave = false;

                if (!existingUpcomingOrder) {
                    // No upcoming order exists, need to save
                    needsSave = true;
                } else {
                    // Compare key fields to see if data has changed
                    const hasDeliveryDayOrders = orderConfig.deliveryDayOrders && typeof orderConfig.deliveryDayOrders === 'object';
                    const existingHasDeliveryDayOrders = existingUpcomingOrder.deliveryDayOrders && typeof existingUpcomingOrder.deliveryDayOrders === 'object';

                    let configChanged =
                        existingUpcomingOrder.caseId !== caseId ||
                        existingUpcomingOrder.serviceType !== serviceType ||
                        existingUpcomingOrder.vendorId !== vendorId ||
                        existingUpcomingOrder.boxTypeId !== boxTypeId ||
                        existingUpcomingOrder.boxQuantity !== boxQuantity;

                    if (hasDeliveryDayOrders || existingHasDeliveryDayOrders) {
                        // Compare deliveryDayOrders
                        configChanged = configChanged ||
                            JSON.stringify(existingUpcomingOrder.deliveryDayOrders || {}) !== JSON.stringify(orderConfig.deliveryDayOrders || {});
                    } else {
                        // Compare vendorSelections (single day format)
                        configChanged = configChanged ||
                            JSON.stringify(existingUpcomingOrder.vendorSelections || []) !== JSON.stringify(vendorSelections) ||
                            JSON.stringify(existingUpcomingOrder.items || {}) !== JSON.stringify(items) ||
                            JSON.stringify((existingUpcomingOrder as any).itemPrices || {}) !== JSON.stringify(itemPrices);
                    }

                    if (configChanged) {
                        needsSave = true;
                    }
                }

                if (needsSave) {
                    // Don't validate during auto-save - only validate on explicit save/close
                    // This allows users to work on incomplete orders without being blocked

                    // Ensure structure is correct and convert per-vendor delivery days to deliveryDayOrders format
                    const cleanedOrderConfig = { ...orderConfig };
                    if (serviceType === 'Food') {
                        if (cleanedOrderConfig.deliveryDayOrders) {
                            // Clean multi-day format (already in deliveryDayOrders)
                            for (const day of Object.keys(cleanedOrderConfig.deliveryDayOrders)) {
                                cleanedOrderConfig.deliveryDayOrders[day].vendorSelections = (cleanedOrderConfig.deliveryDayOrders[day].vendorSelections || [])
                                    .filter((s: any) => s.vendorId)
                                    .map((s: any) => ({
                                        vendorId: s.vendorId,
                                        items: s.items || {}
                                    }));
                            }
                        } else if (cleanedOrderConfig.vendorSelections) {
                            // Check if any vendor has per-vendor delivery days (itemsByDay)
                            const hasPerVendorDeliveryDays = cleanedOrderConfig.vendorSelections.some((s: any) =>
                                s.selectedDeliveryDays && s.selectedDeliveryDays.length > 0 && s.itemsByDay
                            );

                            if (hasPerVendorDeliveryDays) {
                                // Convert per-vendor delivery days to deliveryDayOrders format
                                const deliveryDayOrders: any = {};

                                for (const selection of cleanedOrderConfig.vendorSelections) {
                                    if (!selection.vendorId || !selection.selectedDeliveryDays || !selection.itemsByDay) continue;

                                    for (const day of selection.selectedDeliveryDays) {
                                        if (!deliveryDayOrders[day]) {
                                            deliveryDayOrders[day] = { vendorSelections: [] };
                                        }

                                        // Add this vendor to this day with its items
                                        deliveryDayOrders[day].vendorSelections.push({
                                            vendorId: selection.vendorId,
                                            items: selection.itemsByDay[day] || {}
                                        });
                                    }
                                }

                                cleanedOrderConfig.deliveryDayOrders = deliveryDayOrders;
                                cleanedOrderConfig.vendorSelections = undefined;
                            } else {
                                // Clean single-day format (normal items, not itemsByDay)
                                cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                                    .filter((s: any) => s.vendorId)
                                    .map((s: any) => ({
                                        vendorId: s.vendorId,
                                        items: s.items || {}
                                    }));
                            }
                        }
                    }

                    // Create a temporary client object for syncCurrentOrderToUpcoming
                    const tempClient: ClientProfile = {
                        ...client,
                        ...formData,
                        activeOrder: {
                            ...cleanedOrderConfig,
                            serviceType: serviceType,
                            lastUpdated: new Date().toISOString()
                        }
                    } as ClientProfile;

                    // Sync to upcoming_orders table
                    await syncCurrentOrderToUpcoming(clientId, tempClient);
                    invalidateOrderData(clientId); // Invalidate order cache after sync
                }
            } catch (error) {
                console.error('Error checking/saving Service Configuration:', error);
            }
        }, 500); // 500ms debounce for check

        return () => clearTimeout(timeoutId);
    }, [caseId, vendorSelections, vendorId, boxTypeId, boxQuantity, items, itemPrices, serviceType, client, clientId]);

    // Effect: Load quotas when boxTypeId changes (duplicate - keeping in sync with above)
    useEffect(() => {
        // If Boxes service is selected and no boxTypeId, auto-set it to first active box type
        if (formData.serviceType === 'Boxes' && !orderConfig.boxTypeId && boxTypes.length > 0) {
            const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
            if (firstActiveBoxType) {
                setOrderConfig((prev: any) => ({
                    ...prev,
                    boxTypeId: firstActiveBoxType.id,
                    boxQuantity: 1
                }));
            }
        }

        // Load quotas for the current boxTypeId
        if (orderConfig.boxTypeId) {
            getBoxQuotas(orderConfig.boxTypeId).then(quotas => {
                setActiveBoxQuotas(quotas);
            });
        } else {
            setActiveBoxQuotas([]);
        }
    }, [orderConfig.boxTypeId, formData.serviceType, boxTypes]);


    // -- Logic Helpers --

    function getVendorMenuItems(vendorId: string) {
        return menuItems.filter(i => i.vendorId === vendorId && i.isActive);
    }

    function getCurrentOrderTotalValue(day: string | null = null) {
        const selections = getVendorSelectionsForDay(day);
        if (!selections) return 0;
        let total = 0;
        for (const selection of selections) {
            // Handle per-vendor delivery days (itemsByDay)
            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                for (const deliveryDay of selection.selectedDeliveryDays) {
                    const dayItems = selection.itemsByDay[deliveryDay] || {};
                    for (const [itemId, qty] of Object.entries(dayItems)) {
                        const item = menuItems.find(i => i.id === itemId);
                        total += (item ? item.value * (qty as number) : 0);
                    }
                }
            } else if (selection.items) {
                // Normal items structure
                for (const [itemId, qty] of Object.entries(selection.items)) {
                    const item = menuItems.find(i => i.id === itemId);
                    total += (item ? item.value * (qty as number) : 0);
                }
            }
        }
        return total;
    }

    // Calculate total meals (quantity) for a specific vendor
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

    // Calculate total meals across all vendors (for a specific day or all days)
    function getTotalMealCount(day: string | null = null): number {
        const selections = getVendorSelectionsForDay(day);
        if (!selections) return 0;
        let total = 0;
        for (const selection of selections) {
            // Handle per-vendor delivery days (itemsByDay)
            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                for (const deliveryDay of selection.selectedDeliveryDays) {
                    const dayItems = selection.itemsByDay[deliveryDay] || {};
                    total += Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
                }
            } else {
                total += getVendorMealCount(selection.vendorId, selection);
            }
        }
        return total;
    }

    // Get total meals across all delivery days (handles both formats)
    function getTotalMealCountAllDays(): number {
        // Check for per-vendor delivery days format
        const currentSelections = getVendorSelectionsForDay(null);
        let total = 0;

        for (const selection of currentSelections || []) {
            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                // Per-vendor delivery days format
                for (const day of selection.selectedDeliveryDays) {
                    const dayItems = selection.itemsByDay[day] || {};
                    total += Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
                }
            } else if (selection.items) {
                // Normal single-day format
                total += getVendorMealCount(selection.vendorId, selection);
            }
        }

        // Also check deliveryDayOrders format (for saved data)
        if (orderConfig.deliveryDayOrders) {
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                total += getTotalMealCount(day);
            }
        }

        return total;
    }

    // Get total value across all delivery days (handles both formats)
    function getCurrentOrderTotalValueAllDays(): number {
        // Check for per-vendor delivery days format
        const currentSelections = getVendorSelectionsForDay(null);
        let total = 0;

        for (const selection of currentSelections || []) {
            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                // Per-vendor delivery days format
                for (const day of selection.selectedDeliveryDays) {
                    const dayItems = selection.itemsByDay[day] || {};
                    for (const [itemId, qty] of Object.entries(dayItems)) {
                        const item = menuItems.find(i => i.id === itemId);
                        total += (item ? item.value * (qty as number) : 0);
                    }
                }
            } else if (selection.items) {
                // Normal single-day format
                for (const [itemId, qty] of Object.entries(selection.items)) {
                    const item = menuItems.find(i => i.id === itemId);
                    total += (item ? item.value * (qty as number) : 0);
                }
            }
        }

        // Also check deliveryDayOrders format (for saved data)
        if (orderConfig.deliveryDayOrders) {
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                total += getCurrentOrderTotalValue(day);
            }
        }

        return total;
    }

    function isCutoffPassed() {
        return false; // MVP simplified
    }

    function getBoxItemsTotal(): number {
        if (!orderConfig.items) return 0;
        let total = 0;
        for (const [itemId, qty] of Object.entries(orderConfig.items)) {
            const item = menuItems.find(i => i.id === itemId);
            total += (item ? item.value * (qty as number) : 0);
        }
        return total;
    }

    // Helper functions for displaying order info
    function getOrderSummaryText(client: ClientProfile) {
        if (!client.activeOrder) return '-';
        const st = client.serviceType;
        const conf = client.activeOrder;

        let content = '';

        if (st === 'Food') {
            const limit = client.approvedMealsPerWeek || 0;
            const vendorsSummary = (conf.vendorSelections || [])
                .map(v => {
                    const vendorName = vendors.find(ven => ven.id === v.vendorId)?.name || 'Unknown';
                    const itemCount = Object.values(v.items || {}).reduce((a: number, b: any) => a + Number(b), 0);
                    return itemCount > 0 ? `${vendorName} (${itemCount})` : '';
                }).filter(Boolean).join(', ');

            if (!vendorsSummary) return '';
            content = `: ${vendorsSummary} [Max ${limit}]`;
        } else if (st === 'Boxes') {
            const box = boxTypes.find(b => b.id === conf.boxTypeId);
            const vendorName = vendors.find(v => v.id === box?.vendorId)?.name || '-';

            const itemDetails = Object.entries(conf.items || {}).map(([id, qty]) => {
                const item = menuItems.find(i => i.id === id);
                return item ? `${item.name} x${qty}` : null;
            }).filter(Boolean).join(', ');

            const itemSuffix = itemDetails ? ` (${itemDetails})` : '';
            content = `: ${vendorName}${itemSuffix}`;
        }

        return `${st}${content}`;
    }

    function getStatusName(id: string) {
        return statuses.find(s => s.id === id)?.name || 'Unknown';
    }

    function getNavigatorName(id: string) {
        return navigators.find(n => n.id === id)?.name || 'Unassigned';
    }

    // Get the next delivery date for a vendor (first occurrence)
    function getNextDeliveryDate(vendorId: string): { dayOfWeek: string; date: string } | null {
        if (!vendorId) {
            return null;
        }

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

        if (deliveryDayNumbers.length === 0) {
            return null;
        }

        // Find the next delivery date (start from today, check next 14 days)
        for (let i = 0; i <= 14; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);
            const dayOfWeek = checkDate.getDay();

            if (deliveryDayNumbers.includes(dayOfWeek)) {
                return {
                    dayOfWeek: checkDate.toLocaleDateString('en-US', { weekday: 'long' }),
                    date: checkDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    })
                };
            }
        }

        return null;
    }

    function getNextDeliveryDateForVendor(vendorId: string): string | null {
        if (!vendorId) {
            return null;
        }

        const vendor = vendors.find(v => v.id === vendorId);
        if (!vendor || !vendor.deliveryDays || vendor.deliveryDays.length === 0) {
            return null;
        }

        // Find the next delivery date
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset time to start of day

        // Map day names to day of week (0 = Sunday, 1 = Monday, etc.)
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

        if (deliveryDayNumbers.length === 0) {
            return null;
        }

        // Check the next 21 days to find the second (next next) delivery day (start from tomorrow)
        let foundCount = 0;
        for (let i = 1; i <= 21; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);
            const dayOfWeek = checkDate.getDay();

            if (deliveryDayNumbers.includes(dayOfWeek)) {
                foundCount++;
                // Return the second occurrence (next next delivery day)
                if (foundCount === 2) {
                    return checkDate.toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                }
            }
        }

        return null;
    }

    // Box Logic Helpers
    function getBoxValidationSummary() {
        if (!activeBoxQuotas.length) return { isValid: true, messages: [] };

        const summary: string[] = [];
        let allValid = true;
        const selectedItems = orderConfig.items || {};

        activeBoxQuotas.forEach(quota => {
            const category = categories.find(c => c.id === quota.categoryId);
            if (!category) return;

            // Calculate current total for this category
            let currentTotal = 0;
            Object.entries(selectedItems).forEach(([itemId, qty]) => {
                const item = menuItems.find(i => i.id === itemId);
                if (item && item.categoryId === quota.categoryId) {
                    currentTotal += (item.quotaValue || 1) * (qty as number);
                }
            });

            if (currentTotal !== quota.targetValue) {
                allValid = false;
                summary.push(`${category.name}: Selected ${currentTotal} / Target ${quota.targetValue}`);
            }
        });

        return { isValid: allValid, messages: summary };
    }

    function validateOrder(): { isValid: boolean, messages: string[] } {
        if (formData.serviceType === 'Food') {
            const messages: string[] = [];

            // Check total meals against client maximum
            const totalMeals = getTotalMealCountAllDays();
            const clientMax = formData.approvedMealsPerWeek || 0;
            if (totalMeals > clientMax) {
                messages.push(`Total meals (${totalMeals}) exceeds client maximum (${clientMax}).`);
            }

            // Check each vendor meets their minimum requirement (across all delivery days)
            if (orderConfig.deliveryDayOrders) {
                // Multi-day format
                for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                    const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                    for (const selection of daySelections) {
                        if (!selection.vendorId) continue;

                        const vendor = vendors.find(v => v.id === selection.vendorId);
                        if (!vendor) continue;

                        const vendorMinimum = vendor.minimumMeals || 0;
                        if (vendorMinimum > 0) {
                            const vendorMealCount = getVendorMealCount(selection.vendorId, selection);
                            if (vendorMealCount < vendorMinimum) {
                                messages.push(`${vendor.name} (${day}): ${vendorMealCount} meals selected, but minimum is ${vendorMinimum}.`);
                            }
                        }
                    }
                }
            } else if (orderConfig.vendorSelections) {
                // Single day format
                for (const selection of orderConfig.vendorSelections) {
                    if (!selection.vendorId) continue;

                    const vendor = vendors.find(v => v.id === selection.vendorId);
                    if (!vendor) continue;

                    const vendorMinimum = vendor.minimumMeals || 0;
                    if (vendorMinimum > 0) {
                        const vendorMealCount = getVendorMealCount(selection.vendorId, selection);
                        if (vendorMealCount < vendorMinimum) {
                            messages.push(`${vendor.name}: ${vendorMealCount} meals selected, but minimum is ${vendorMinimum}.`);
                        }
                    }
                }
            }

            if (messages.length > 0) {
                return { isValid: false, messages };
            }
        }

        if (formData.serviceType === 'Boxes' && orderConfig.boxTypeId) {
            return getBoxValidationSummary();
        }

        return { isValid: true, messages: [] };
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

    async function handleDelete() {
        if (!confirm('Are you sure you want to delete this client? This action cannot be undone.')) return;

        setSaving(true);
        await deleteClient(clientId);
        setSaving(false);

        if (onClose) {
            onClose();
        } else {
            router.push('/clients');
        }
    }

    // Old handleSave removed


    async function handleBack() {
        // If used as a page (not modal), we want to try to save before leaving.
        // If validation fails, handleSave will return false and show the error modal.
        // The user effectively stays on the page.
        if (onClose) {
            await handleSaveAndClose();
        } else {
            const saved = await handleSave();
            if (saved) {
                router.push('/clients');
            }
        }
    }

    function handleDiscardChanges() {
        setValidationError({ show: false, messages: [] });
        // Discarding means we just exit without saving
        if (onClose) {
            onClose();
        } else {
            router.push('/clients');
        }
    }

    // -- Event Handlers --

    function handleServiceChange(type: ServiceType) {
        if (formData.serviceType === type) return;

        // Check if there is existing configuration to warn about
        const hasConfig = orderConfig.caseId ||
            orderConfig.vendorSelections?.some((s: any) => s.vendorId) ||
            orderConfig.vendorId;

        if (hasConfig) {
            const confirmSwitch = window.confirm(
                'Switching service types will erase the current service configuration. Are you sure you want to proceed?'
            );
            if (!confirmSwitch) return;
        }

        setFormData({ ...formData, serviceType: type });
        // Reset order config for new type completely, ensuring caseId is reset too
        // The user must enter a NEW case ID for the new service type.
        if (type === 'Food') {
            setOrderConfig({ serviceType: type, vendorSelections: [{ vendorId: '', items: {} }] });
        } else {
            setOrderConfig({ serviceType: type, items: {} });
        }
    }

    // Helper: Get all delivery days from selected vendors
    function getAllDeliveryDaysFromVendors(vendorSelections: any[]): string[] {
        const allDays = new Set<string>();
        for (const selection of vendorSelections || []) {
            if (selection.vendorId) {
                const vendor = vendors.find(v => v.id === selection.vendorId);
                if (vendor && vendor.deliveryDays) {
                    vendor.deliveryDays.forEach(day => allDays.add(day));
                }
            }
        }
        return Array.from(allDays).sort();
    }

    // Helper: Check if we need multi-day format (any vendor has multiple delivery days)
    function needsMultiDayFormat(vendorSelections: any[]): boolean {
        for (const selection of vendorSelections || []) {
            if (selection.vendorId) {
                const vendor = vendors.find(v => v.id === selection.vendorId);
                if (vendor && vendor.deliveryDays && vendor.deliveryDays.length > 1) {
                    return true;
                }
            }
        }
        return false;
    }

    // Helper: Get vendor selections for a specific delivery day (or all if single day)
    function getVendorSelectionsForDay(day: string | null): any[] {
        if (!orderConfig.deliveryDayOrders) {
            return orderConfig.vendorSelections || [];
        }
        if (day && orderConfig.deliveryDayOrders[day]) {
            return orderConfig.deliveryDayOrders[day].vendorSelections || [];
        }
        return [];
    }

    // Helper: Update vendor selections for a specific delivery day
    function setVendorSelectionsForDay(day: string | null, vendorSelections: any[]) {
        // Check if we're already in multi-day format
        if (orderConfig.deliveryDayOrders) {
            // Multi-day format - update specific day
            const deliveryDayOrders = { ...orderConfig.deliveryDayOrders };
            if (day) {
                deliveryDayOrders[day] = { vendorSelections };
            } else {
                // If day is null but we're in multi-day format, this shouldn't happen
                // But handle it gracefully by updating all days (shouldn't be needed)
                console.warn('setVendorSelectionsForDay called with null day in multi-day format');
            }
            setOrderConfig({ ...orderConfig, deliveryDayOrders });
        } else if (day && needsMultiDayFormat(vendorSelections)) {
            // Need to switch to multi-day format
            const allDays = getAllDeliveryDaysFromVendors(vendorSelections);
            const deliveryDayOrders: any = {};
            for (const deliveryDay of allDays) {
                deliveryDayOrders[deliveryDay] = {
                    vendorSelections: vendorSelections
                        .filter(sel => {
                            if (!sel.vendorId) return true; // Keep empty slots
                            const vendor = vendors.find(v => v.id === sel.vendorId);
                            return vendor && vendor.deliveryDays && vendor.deliveryDays.includes(deliveryDay);
                        })
                        .map(sel => ({ ...sel }))
                };
            }
            setOrderConfig({ ...orderConfig, deliveryDayOrders, vendorSelections: undefined });
        } else {
            // Single day format
            setOrderConfig({ ...orderConfig, vendorSelections });
        }
    }

    function addVendorBlock(day: string | null = null) {
        const currentSelections = getVendorSelectionsForDay(day);
        const newSelections = [...currentSelections, { vendorId: '', items: {} }];
        setVendorSelectionsForDay(day, newSelections);
    }

    function removeVendorBlock(index: number, day: string | null = null) {
        const current = [...getVendorSelectionsForDay(day)];
        current.splice(index, 1);
        setVendorSelectionsForDay(day, current);
    }

    function updateVendorSelection(index: number, field: string, value: any, day: string | null = null) {
        const current = [...getVendorSelectionsForDay(day)];
        current[index] = { ...current[index], [field]: value };

        // If changing vendor, clear items for that vendor
        if (field === 'vendorId') {
            current[index].items = {};

            // If we're in single-day format and the vendor has multiple delivery days,
            // we'll show the selection UI (handled in render), but don't auto-switch format
            // The user will select which days they want, then we'll create orders for those days
        }

        // Normal update
        setVendorSelectionsForDay(day, current);
    }

    function updateItemQuantity(blockIndex: number, itemId: string, qty: number, day: string | null = null) {
        const current = [...getVendorSelectionsForDay(day)];
        const items = { ...(current[blockIndex].items || {}) };
        if (qty > 0) {
            items[itemId] = qty;
        } else {
            delete items[itemId];
        }
        current[blockIndex].items = items;
        setVendorSelectionsForDay(day, current);
    }

    if (!client) {
        return <div>Loading...</div>;
    }

    const content = (
        <div className={`${styles.container} ${onClose ? styles.inModal : ''}`}>
            <header className={styles.header}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {onClose ? (
                            <button className="btn btn-secondary" onClick={handleDiscardChanges} style={{ marginRight: '8px' }}>
                                <ArrowLeft size={16} /> Back
                            </button>
                        ) : (
                            <button className="btn btn-secondary" onClick={handleDiscardChanges} style={{ marginRight: '8px' }}>
                                <ArrowLeft size={16} /> Back
                            </button>
                        )}
                        <h1 className={styles.title}>{formData.fullName || 'Client Profile'}</h1>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button className="btn btn-secondary" onClick={() => router.push(`/clients/${clientId}/billing`)} style={{ marginRight: '8px' }}>
                            <CreditCard size={16} /> Billing
                        </button>
                        {!onClose && (
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                <Save size={16} /> Save Changes
                            </button>
                        )}
                    </div>
                </div>
            </header>

            <div className={styles.grid}>
                <div className={styles.column}>
                    <section className={styles.card}>
                        <h3 className={styles.sectionTitle}>Client Details</h3>

                        <div className={styles.formGroup}>
                            <label className="label">Full Name</label>
                            <input className="input" value={formData.fullName} onChange={e => setFormData({ ...formData, fullName: e.target.value })} />
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label">Status</label>
                            <select className="input" value={formData.statusId} onChange={e => setFormData({ ...formData, statusId: e.target.value })}>
                                {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label">Assigned Navigator</label>
                            <select className="input" value={formData.navigatorId} onChange={e => setFormData({ ...formData, navigatorId: e.target.value })}>
                                <option value="">Unassigned</option>
                                {navigators.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label">Address</label>
                            <input className="input" value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label">Phone</label>
                            <input className="input" value={formData.phoneNumber} onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })} />
                            <div style={{ height: '1rem' }} /> {/* Spacer */}
                            <label className="label">Email</label>
                            <input className="input" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                        </div>

                        <div className={styles.formGroup}>
                            <label className="label">General Notes</label>
                            <textarea className="input" style={{ height: '100px' }} value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} />
                        </div>

                        <div className={styles.checkboxTitle}>Screening</div>
                        <div className={styles.row}>
                            <label className={styles.checkboxLabel}>
                                <input type="checkbox" checked={formData.screeningTookPlace} onChange={e => setFormData({ ...formData, screeningTookPlace: e.target.checked })} />
                                Took Place
                            </label>
                            <label className={styles.checkboxLabel}>
                                <input type="checkbox" checked={formData.screeningSigned} onChange={e => setFormData({ ...formData, screeningSigned: e.target.checked })} />
                                Signed
                            </label>
                        </div>
                    </section>
                </div>

                <div className={styles.column}>
                    <section className={styles.card}>
                        <h3 className={styles.sectionTitle}>Service Configuration</h3>

                        <div className={styles.formGroup}>
                            <label className="label">Service Type</label>
                            <div className={styles.serviceTypes}>
                                {SERVICE_TYPES.map(type => (
                                    <button
                                        key={type}
                                        className={`${styles.serviceBtn} ${formData.serviceType === type ? styles.activeService : ''}`}
                                        onClick={() => handleServiceChange(type)}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                        </div>



                        <div className={styles.formGroup}>
                            <label className="label">Case ID (Required)</label>
                            <input
                                className="input"
                                value={orderConfig.caseId || ''}
                                placeholder="Enter Case ID to enable configuration..."
                                onChange={e => setOrderConfig({ ...orderConfig, caseId: e.target.value })}
                            />
                        </div>

                        {!orderConfig.caseId && (
                            <div className={styles.alert} style={{ marginTop: '16px', backgroundColor: 'var(--bg-surface-hover)' }}>
                                <AlertTriangle size={16} />
                                Please enter a Case ID to configure the service.
                            </div>
                        )}

                        {orderConfig.caseId && (
                            <>
                                {formData.serviceType === 'Food' && (
                                    <div className="animate-fade-in">
                                        <div className={styles.formGroup}>
                                            <label className="label">Approved Meals Per Week</label>
                                            <input
                                                type="number"
                                                className="input"
                                                value={formData.approvedMealsPerWeek || 0}
                                                onChange={e => setFormData({ ...formData, approvedMealsPerWeek: Number(e.target.value) })}
                                            />
                                        </div>

                                        <div className={styles.divider} />

                                        <div className={styles.orderHeader}>
                                            <h4>Current Order Request</h4>
                                            <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                <div className={styles.budget} style={{
                                                    color: getTotalMealCountAllDays() > (formData.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'inherit',
                                                    backgroundColor: getTotalMealCountAllDays() > (formData.approvedMealsPerWeek || 0) ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface-hover)'
                                                }}>
                                                    Meals: {getTotalMealCountAllDays()} / {formData.approvedMealsPerWeek || 0}
                                                </div>
                                                <div className={styles.budget} style={{
                                                    color: getCurrentOrderTotalValueAllDays() > (formData.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'inherit',
                                                    backgroundColor: getCurrentOrderTotalValueAllDays() > (formData.approvedMealsPerWeek || 0) ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface-hover)'
                                                }}>
                                                    Value: {getCurrentOrderTotalValueAllDays()} / {formData.approvedMealsPerWeek || 0}
                                                </div>
                                            </div>
                                        </div>

                                        {isCutoffPassed() && <div className={styles.alert}><AlertTriangle size={16} /> Cutoff passed. Changes will apply to next cycle.</div>}

                                        {/* Vendor list with per-vendor delivery day selection */}
                                        {(() => {
                                            // Check if we're already in multi-day format (from saved data)
                                            const isAlreadyMultiDay = orderConfig.deliveryDayOrders && typeof orderConfig.deliveryDayOrders === 'object';

                                            if (isAlreadyMultiDay) {
                                                // Convert saved deliveryDayOrders back to per-vendor format for editing
                                                const deliveryDays = Object.keys(orderConfig.deliveryDayOrders).sort();
                                                const vendorSelections: any[] = [];

                                                // Group by vendor
                                                const vendorsByDay: { [day: string]: any[] } = {};
                                                for (const day of deliveryDays) {
                                                    const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                                                    for (const sel of daySelections) {
                                                        if (!sel.vendorId) continue;
                                                        if (!vendorsByDay[day]) vendorsByDay[day] = [];
                                                        vendorsByDay[day].push(sel);
                                                    }
                                                }

                                                // Convert to per-vendor format
                                                const vendorMap = new Map<string, any>();
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

                                                // Use converted format or fall back to normal
                                                const currentSelections = Array.from(vendorMap.values()).length > 0
                                                    ? Array.from(vendorMap.values())
                                                    : getVendorSelectionsForDay(null);

                                                return (
                                                    <div className={styles.vendorsList}>
                                                        {(currentSelections || []).map((selection: any, index: number) => {
                                                            const vendor = selection.vendorId ? vendors.find(v => v.id === selection.vendorId) : null;
                                                            const vendorHasMultipleDays = vendor && vendor.deliveryDays && vendor.deliveryDays.length > 1;
                                                            const vendorDeliveryDays = vendor?.deliveryDays || [];
                                                            const vendorSelectedDays = (selection.selectedDeliveryDays || []) as string[];

                                                            return (
                                                                <div key={index} className={styles.vendorBlock}>
                                                                    <div className={styles.vendorHeader}>
                                                                        <select
                                                                            className="input"
                                                                            value={selection.vendorId}
                                                                            onChange={e => updateVendorSelection(index, 'vendorId', e.target.value, null)}
                                                                        >
                                                                            <option value="">Select Vendor...</option>
                                                                            {vendors.filter(v => v.serviceTypes.includes('Food') && v.isActive).map(v => (
                                                                                <option key={v.id} value={v.id} disabled={currentSelections.some((s: any, i: number) => i !== index && s.vendorId === v.id)}>
                                                                                    {v.name}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => removeVendorBlock(index, null)} title="Remove Vendor">
                                                                            <Trash2 size={16} />
                                                                        </button>
                                                                    </div>

                                                                    {selection.vendorId && vendorHasMultipleDays && (
                                                                        <div style={{
                                                                            marginBottom: '1rem',
                                                                            padding: '0.75rem',
                                                                            backgroundColor: 'var(--bg-surface-hover)',
                                                                            borderRadius: 'var(--radius-sm)',
                                                                            border: '1px solid var(--border-color)'
                                                                        }}>
                                                                            <div style={{
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '0.5rem',
                                                                                marginBottom: '0.75rem',
                                                                                fontSize: '0.9rem',
                                                                                fontWeight: 500
                                                                            }}>
                                                                                <Calendar size={16} />
                                                                                <span>Select delivery days for {vendor?.name}:</span>
                                                                            </div>
                                                                            <div style={{
                                                                                display: 'flex',
                                                                                flexWrap: 'wrap',
                                                                                gap: '0.5rem'
                                                                            }}>
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

                                                                                                // Update selection with new delivery days
                                                                                                const updated = [...currentSelections];
                                                                                                updated[index] = {
                                                                                                    ...updated[index],
                                                                                                    selectedDeliveryDays: newSelected,
                                                                                                    // Initialize items for each selected day
                                                                                                    itemsByDay: (() => {
                                                                                                        const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                        if (!isSelected) {
                                                                                                            // Adding a day - initialize empty items
                                                                                                            itemsByDay[day] = {};
                                                                                                        } else {
                                                                                                            // Removing a day - clean up
                                                                                                            delete itemsByDay[day];
                                                                                                        }
                                                                                                        return itemsByDay;
                                                                                                    })()
                                                                                                };
                                                                                                setOrderConfig({
                                                                                                    ...orderConfig,
                                                                                                    vendorSelections: updated,
                                                                                                    deliveryDayOrders: undefined // Clear old format
                                                                                                });
                                                                                            }}
                                                                                            style={{
                                                                                                padding: '0.5rem 1rem',
                                                                                                borderRadius: 'var(--radius-sm)',
                                                                                                border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                                                                                backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--bg-app)',
                                                                                                color: isSelected ? 'white' : 'var(--text-primary)',
                                                                                                cursor: 'pointer',
                                                                                                fontSize: '0.85rem',
                                                                                                fontWeight: isSelected ? 600 : 400,
                                                                                                transition: 'all 0.2s'
                                                                                            }}
                                                                                        >
                                                                                            {day}
                                                                                            {isSelected && <Check size={14} style={{ marginLeft: '0.25rem', display: 'inline', verticalAlign: 'middle' }} />}
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {selection.vendorId && (() => {
                                                                        const vendorMinimum = vendor?.minimumMeals || 0;

                                                                        // If vendor has multiple days and days are selected, show forms for each day
                                                                        if (vendorHasMultipleDays && vendorSelectedDays.length > 0) {
                                                                            return (
                                                                                <>
                                                                                    {vendorSelectedDays.map((day: string) => {
                                                                                        const dayItems = (selection.itemsByDay || {})[day] || {};
                                                                                        const dayMealCount = Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
                                                                                        const meetsMinimum = vendorMinimum === 0 || dayMealCount >= vendorMinimum;

                                                                                        return (
                                                                                            <div key={day} style={{
                                                                                                marginBottom: '1.5rem',
                                                                                                padding: '1rem',
                                                                                                border: '1px solid var(--border-color)',
                                                                                                borderRadius: 'var(--radius-md)',
                                                                                                backgroundColor: 'var(--bg-surface-hover)'
                                                                                            }}>
                                                                                                <div style={{
                                                                                                    display: 'flex',
                                                                                                    alignItems: 'center',
                                                                                                    justifyContent: 'space-between',
                                                                                                    marginBottom: '0.75rem',
                                                                                                    paddingBottom: '0.75rem',
                                                                                                    borderBottom: '1px solid var(--border-color)'
                                                                                                }}>
                                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                                        <Calendar size={16} />
                                                                                                        <strong>{day}</strong>
                                                                                                    </div>
                                                                                                    {vendorMinimum > 0 && (
                                                                                                        <div style={{
                                                                                                            fontSize: '0.85rem',
                                                                                                            color: meetsMinimum ? 'var(--text-primary)' : 'var(--color-danger)',
                                                                                                            fontWeight: 500
                                                                                                        }}>
                                                                                                            Meals: {dayMealCount} / {vendorMinimum} min
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>

                                                                                                {vendorMinimum > 0 && !meetsMinimum && (
                                                                                                    <div style={{
                                                                                                        marginBottom: '0.75rem',
                                                                                                        padding: '0.5rem',
                                                                                                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                                                                        borderRadius: 'var(--radius-sm)',
                                                                                                        border: '1px solid var(--color-danger)',
                                                                                                        fontSize: '0.8rem',
                                                                                                        color: 'var(--color-danger)'
                                                                                                    }}>
                                                                                                        <AlertTriangle size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                                                                                                        Minimum {vendorMinimum} meals required for {day}
                                                                                                    </div>
                                                                                                )}

                                                                                                <div className={styles.menuItems}>
                                                                                                    {getVendorMenuItems(selection.vendorId).map((item) => (
                                                                                                        <div key={item.id} className={styles.menuItem}>
                                                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                                <input
                                                                                                                    type="number"
                                                                                                                    min="0"
                                                                                                                    className={styles.qtyInput}
                                                                                                                    value={dayItems[item.id] || ''}
                                                                                                                    onChange={e => {
                                                                                                                        const qty = Number(e.target.value) || 0;
                                                                                                                        const updated = [...currentSelections];
                                                                                                                        const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                        if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                                                        if (qty > 0) {
                                                                                                                            itemsByDay[day][item.id] = qty;
                                                                                                                        } else {
                                                                                                                            delete itemsByDay[day][item.id];
                                                                                                                        }
                                                                                                                        updated[index] = {
                                                                                                                            ...updated[index],
                                                                                                                            itemsByDay
                                                                                                                        };
                                                                                                                        setOrderConfig({
                                                                                                                            ...orderConfig,
                                                                                                                            vendorSelections: updated,
                                                                                                                            deliveryDayOrders: undefined // Clear old format
                                                                                                                        });
                                                                                                                    }}
                                                                                                                    placeholder="0"
                                                                                                                />
                                                                                                                <span>{item.name}</span>
                                                                                                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>${item.value}</span>
                                                                                                            </label>
                                                                                                        </div>
                                                                                                    ))}
                                                                                                    {getVendorMenuItems(selection.vendorId).length === 0 && <span className={styles.hint}>No active menu items.</span>}
                                                                                                </div>
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </>
                                                                            );
                                                                        }

                                                                        // Single delivery day or no multiple days - show normal item selection
                                                                        const vendorMealCount = getVendorMealCount(selection.vendorId, selection);
                                                                        const meetsMinimum = vendorMinimum === 0 || vendorMealCount >= vendorMinimum;

                                                                        return (
                                                                            <>
                                                                                {vendorMinimum > 0 && (
                                                                                    <div style={{
                                                                                        marginBottom: '0.75rem',
                                                                                        padding: '0.5rem 0.75rem',
                                                                                        backgroundColor: meetsMinimum ? 'var(--bg-surface-hover)' : 'rgba(239, 68, 68, 0.1)',
                                                                                        borderRadius: 'var(--radius-sm)',
                                                                                        border: `1px solid ${meetsMinimum ? 'var(--border-color)' : 'var(--color-danger)'}`,
                                                                                        fontSize: '0.85rem'
                                                                                    }}>
                                                                                        <div style={{
                                                                                            display: 'flex',
                                                                                            justifyContent: 'space-between',
                                                                                            alignItems: 'center',
                                                                                            color: meetsMinimum ? 'var(--text-primary)' : 'var(--color-danger)',
                                                                                            fontWeight: 500
                                                                                        }}>
                                                                                            <span>Minimum meals required: {vendorMinimum}</span>
                                                                                            <span>
                                                                                                Meals selected: <strong>{vendorMealCount}</strong>
                                                                                            </span>
                                                                                        </div>
                                                                                        {!meetsMinimum && (
                                                                                            <div style={{
                                                                                                marginTop: '0.25rem',
                                                                                                fontSize: '0.8rem',
                                                                                                color: 'var(--color-danger)'
                                                                                            }}>
                                                                                                <AlertTriangle size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                                                                                                You must order at least {vendorMinimum} meals from {vendor?.name}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                )}
                                                                                <div className={styles.menuItems}>
                                                                                    {getVendorMenuItems(selection.vendorId).map((item) => (
                                                                                        <div key={item.id} className={styles.menuItem}>
                                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                <input
                                                                                                    type="number"
                                                                                                    min="0"
                                                                                                    className={styles.qtyInput}
                                                                                                    value={selection.items?.[item.id] || ''}
                                                                                                    onChange={e => updateItemQuantity(index, item.id, Number(e.target.value) || 0, null)}
                                                                                                    placeholder="0"
                                                                                                />
                                                                                                <span>{item.name}</span>
                                                                                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>${item.value}</span>
                                                                                            </label>
                                                                                        </div>
                                                                                    ))}
                                                                                    {getVendorMenuItems(selection.vendorId).length === 0 && <span className={styles.hint}>No active menu items.</span>}
                                                                                </div>
                                                                            </>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            );
                                                        })}
                                                        <button className="btn btn-secondary" onClick={() => addVendorBlock(null)} style={{ marginTop: '0.5rem' }}>
                                                            <Plus size={16} /> Add Vendor
                                                        </button>
                                                    </div>
                                                );
                                            } else {
                                                // Single form - show vendors with per-vendor delivery day selection
                                                const currentSelections = getVendorSelectionsForDay(null);
                                                return (
                                                    <div className={styles.vendorsList}>
                                                        {(currentSelections || []).map((selection: any, index: number) => {
                                                            const vendor = selection.vendorId ? vendors.find(v => v.id === selection.vendorId) : null;
                                                            const vendorHasMultipleDays = vendor && vendor.deliveryDays && vendor.deliveryDays.length > 1;
                                                            const vendorDeliveryDays = vendor?.deliveryDays || [];

                                                            // Get selected delivery days for this vendor
                                                            const vendorSelectedDays = (selection.selectedDeliveryDays || []) as string[];

                                                            return (
                                                                <div key={index} className={styles.vendorBlock}>
                                                                    <div className={styles.vendorHeader}>
                                                                        <select
                                                                            className="input"
                                                                            value={selection.vendorId}
                                                                            onChange={e => updateVendorSelection(index, 'vendorId', e.target.value, null)}
                                                                        >
                                                                            <option value="">Select Vendor...</option>
                                                                            {vendors.filter(v => v.serviceTypes.includes('Food') && v.isActive).map(v => (
                                                                                <option key={v.id} value={v.id} disabled={currentSelections.some((s: any, i: number) => i !== index && s.vendorId === v.id)}>
                                                                                    {v.name}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => removeVendorBlock(index, null)} title="Remove Vendor">
                                                                            <Trash2 size={16} />
                                                                        </button>
                                                                    </div>

                                                                    {selection.vendorId && vendorHasMultipleDays && (
                                                                        <div style={{
                                                                            marginBottom: '1rem',
                                                                            padding: '0.75rem',
                                                                            backgroundColor: 'var(--bg-surface-hover)',
                                                                            borderRadius: 'var(--radius-sm)',
                                                                            border: '1px solid var(--border-color)'
                                                                        }}>
                                                                            <div style={{
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '0.5rem',
                                                                                marginBottom: '0.75rem',
                                                                                fontSize: '0.9rem',
                                                                                fontWeight: 500
                                                                            }}>
                                                                                <Calendar size={16} />
                                                                                <span>Select delivery days for {vendor?.name}:</span>
                                                                            </div>
                                                                            <div style={{
                                                                                display: 'flex',
                                                                                flexWrap: 'wrap',
                                                                                gap: '0.5rem'
                                                                            }}>
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

                                                                                                // Update selection with new delivery days
                                                                                                const updated = [...currentSelections];
                                                                                                updated[index] = {
                                                                                                    ...updated[index],
                                                                                                    selectedDeliveryDays: newSelected,
                                                                                                    // Initialize items for each selected day
                                                                                                    itemsByDay: (() => {
                                                                                                        const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                        if (!isSelected) {
                                                                                                            // Adding a day - initialize empty items
                                                                                                            itemsByDay[day] = {};
                                                                                                        } else {
                                                                                                            // Removing a day - clean up
                                                                                                            delete itemsByDay[day];
                                                                                                        }
                                                                                                        return itemsByDay;
                                                                                                    })()
                                                                                                };
                                                                                                setOrderConfig({
                                                                                                    ...orderConfig,
                                                                                                    vendorSelections: updated
                                                                                                });
                                                                                            }}
                                                                                            style={{
                                                                                                padding: '0.5rem 1rem',
                                                                                                borderRadius: 'var(--radius-sm)',
                                                                                                border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                                                                                backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--bg-app)',
                                                                                                color: isSelected ? 'white' : 'var(--text-primary)',
                                                                                                cursor: 'pointer',
                                                                                                fontSize: '0.85rem',
                                                                                                fontWeight: isSelected ? 600 : 400,
                                                                                                transition: 'all 0.2s'
                                                                                            }}
                                                                                        >
                                                                                            {day}
                                                                                            {isSelected && <Check size={14} style={{ marginLeft: '0.25rem', display: 'inline', verticalAlign: 'middle' }} />}
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        </div>
                                                                    )}

                                                                    {selection.vendorId && (() => {
                                                                        const vendorMinimum = vendor?.minimumMeals || 0;

                                                                        // If vendor has multiple days and days are selected, show forms for each day
                                                                        if (vendorHasMultipleDays && vendorSelectedDays.length > 0) {
                                                                            return (
                                                                                <>
                                                                                    {vendorSelectedDays.map((day: string) => {
                                                                                        const dayItems = (selection.itemsByDay || {})[day] || {};
                                                                                        const dayMealCount = Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
                                                                                        const meetsMinimum = vendorMinimum === 0 || dayMealCount >= vendorMinimum;

                                                                                        return (
                                                                                            <div key={day} style={{
                                                                                                marginBottom: '1.5rem',
                                                                                                padding: '1rem',
                                                                                                border: '1px solid var(--border-color)',
                                                                                                borderRadius: 'var(--radius-md)',
                                                                                                backgroundColor: 'var(--bg-surface-hover)'
                                                                                            }}>
                                                                                                <div style={{
                                                                                                    display: 'flex',
                                                                                                    alignItems: 'center',
                                                                                                    justifyContent: 'space-between',
                                                                                                    marginBottom: '0.75rem',
                                                                                                    paddingBottom: '0.75rem',
                                                                                                    borderBottom: '1px solid var(--border-color)'
                                                                                                }}>
                                                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                                        <Calendar size={16} />
                                                                                                        <strong>{day}</strong>
                                                                                                    </div>
                                                                                                    {vendorMinimum > 0 && (
                                                                                                        <div style={{
                                                                                                            fontSize: '0.85rem',
                                                                                                            color: meetsMinimum ? 'var(--text-primary)' : 'var(--color-danger)',
                                                                                                            fontWeight: 500
                                                                                                        }}>
                                                                                                            Meals: {dayMealCount} / {vendorMinimum} min
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>

                                                                                                {vendorMinimum > 0 && !meetsMinimum && (
                                                                                                    <div style={{
                                                                                                        marginBottom: '0.75rem',
                                                                                                        padding: '0.5rem',
                                                                                                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                                                                        borderRadius: 'var(--radius-sm)',
                                                                                                        border: '1px solid var(--color-danger)',
                                                                                                        fontSize: '0.8rem',
                                                                                                        color: 'var(--color-danger)'
                                                                                                    }}>
                                                                                                        <AlertTriangle size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                                                                                                        Minimum {vendorMinimum} meals required for {day}
                                                                                                    </div>
                                                                                                )}

                                                                                                <div className={styles.menuItems}>
                                                                                                    {getVendorMenuItems(selection.vendorId).map((item) => (
                                                                                                        <div key={item.id} className={styles.menuItem}>
                                                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                                <input
                                                                                                                    type="number"
                                                                                                                    min="0"
                                                                                                                    className={styles.qtyInput}
                                                                                                                    value={dayItems[item.id] || ''}
                                                                                                                    onChange={e => {
                                                                                                                        const qty = Number(e.target.value) || 0;
                                                                                                                        const updated = [...currentSelections];
                                                                                                                        const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                        if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                                                        if (qty > 0) {
                                                                                                                            itemsByDay[day][item.id] = qty;
                                                                                                                        } else {
                                                                                                                            delete itemsByDay[day][item.id];
                                                                                                                        }
                                                                                                                        updated[index] = {
                                                                                                                            ...updated[index],
                                                                                                                            itemsByDay
                                                                                                                        };
                                                                                                                        setOrderConfig({
                                                                                                                            ...orderConfig,
                                                                                                                            vendorSelections: updated
                                                                                                                        });
                                                                                                                    }}
                                                                                                                    placeholder="0"
                                                                                                                />
                                                                                                                <span>{item.name}</span>
                                                                                                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>${item.value}</span>
                                                                                                            </label>
                                                                                                        </div>
                                                                                                    ))}
                                                                                                    {getVendorMenuItems(selection.vendorId).length === 0 && <span className={styles.hint}>No active menu items.</span>}
                                                                                                </div>
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </>
                                                                            );
                                                                        }

                                                                        // Single delivery day or no multiple days - show normal item selection
                                                                        const vendorMealCount = getVendorMealCount(selection.vendorId, selection);
                                                                        const meetsMinimum = vendorMinimum === 0 || vendorMealCount >= vendorMinimum;

                                                                        return (
                                                                            <>
                                                                                {vendorMinimum > 0 && (
                                                                                    <div style={{
                                                                                        marginBottom: '0.75rem',
                                                                                        padding: '0.5rem 0.75rem',
                                                                                        backgroundColor: meetsMinimum ? 'var(--bg-surface-hover)' : 'rgba(239, 68, 68, 0.1)',
                                                                                        borderRadius: 'var(--radius-sm)',
                                                                                        border: `1px solid ${meetsMinimum ? 'var(--border-color)' : 'var(--color-danger)'}`,
                                                                                        fontSize: '0.85rem'
                                                                                    }}>
                                                                                        <div style={{
                                                                                            display: 'flex',
                                                                                            justifyContent: 'space-between',
                                                                                            alignItems: 'center',
                                                                                            color: meetsMinimum ? 'var(--text-primary)' : 'var(--color-danger)',
                                                                                            fontWeight: 500
                                                                                        }}>
                                                                                            <span>Minimum meals required: {vendorMinimum}</span>
                                                                                            <span>
                                                                                                Meals selected: <strong>{vendorMealCount}</strong>
                                                                                            </span>
                                                                                        </div>
                                                                                        {!meetsMinimum && (
                                                                                            <div style={{
                                                                                                marginTop: '0.25rem',
                                                                                                fontSize: '0.8rem',
                                                                                                color: 'var(--color-danger)'
                                                                                            }}>
                                                                                                <AlertTriangle size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                                                                                                You must order at least {vendorMinimum} meals from {vendor?.name}
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                )}
                                                                                <div className={styles.menuItems}>
                                                                                    {getVendorMenuItems(selection.vendorId).map((item) => (
                                                                                        <div key={item.id} className={styles.menuItem}>
                                                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                <input
                                                                                                    type="number"
                                                                                                    min="0"
                                                                                                    className={styles.qtyInput}
                                                                                                    value={selection.items?.[item.id] || ''}
                                                                                                    onChange={e => updateItemQuantity(index, item.id, Number(e.target.value) || 0, null)}
                                                                                                    placeholder="0"
                                                                                                />
                                                                                                <span>{item.name}</span>
                                                                                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>${item.value}</span>
                                                                                            </label>
                                                                                        </div>
                                                                                    ))}
                                                                                    {getVendorMenuItems(selection.vendorId).length === 0 && <span className={styles.hint}>No active menu items.</span>}
                                                                                </div>
                                                                            </>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            );
                                                        })}
                                                        <button className="btn btn-secondary" onClick={() => addVendorBlock(null)} style={{ marginTop: '0.5rem' }}>
                                                            <Plus size={16} /> Add Vendor
                                                        </button>
                                                    </div>
                                                );
                                            }
                                        })()}
                                    </div>
                                )}

                                {formData.serviceType === 'Boxes' && (
                                    <div className="animate-fade-in">
                                        <div className={styles.formGroup}>
                                            <label className="label">Vendor</label>
                                            <select
                                                className="input"
                                                value={orderConfig.vendorId || ''}
                                                onChange={e => {
                                                    const newVendorId = e.target.value;
                                                    // Auto-select the first active box type when vendor is selected
                                                    const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
                                                    setOrderConfig({
                                                        ...orderConfig,
                                                        vendorId: newVendorId,
                                                        boxTypeId: firstActiveBoxType?.id || '', // Auto-select first active box type
                                                        boxQuantity: 1 // Default quantity
                                                    });
                                                }}
                                            >
                                                <option value="">Select Vendor...</option>
                                                {vendors.filter(v => v.serviceTypes.includes('Boxes') && v.isActive).map(v => (
                                                    <option key={v.id} value={v.id}>{v.name}</option>
                                                ))}
                                            </select>
                                        </div>

                                        {/* Next Delivery Date for this vendor */}
                                        {orderConfig.vendorId && (() => {
                                            const nextDeliveryDate = getNextDeliveryDateForVendor(orderConfig.vendorId);
                                            if (nextDeliveryDate) {
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
                                                        <strong style={{ color: 'var(--text-primary)' }}>Take Effect Date:</strong> {nextDeliveryDate}
                                                    </div>
                                                );
                                            }
                                            return null;
                                        })()}

                                        <div style={{ display: 'none' }}>
                                            <label className="label">Quantity</label>
                                            <input
                                                type="number"
                                                className="input"
                                                value={orderConfig.boxQuantity || 1}
                                                readOnly
                                                style={{ display: 'none' }}
                                            />
                                        </div>

                                        {/* Box Content Selection */}
                                        {orderConfig.boxTypeId && activeBoxQuotas.length > 0 && (
                                            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <Package size={14} /> Box Contents
                                                </h4>

                                                {activeBoxQuotas.map(quota => {
                                                    const category = categories.find(c => c.id === quota.categoryId);
                                                    if (!category) return null;

                                                    // Filter items for this category - box items are universal (vendorId is null/empty)
                                                    const availableItems = menuItems.filter(i =>
                                                        (i.vendorId === null || i.vendorId === '') &&
                                                        i.isActive &&
                                                        i.categoryId === quota.categoryId
                                                    );

                                                    // Calculate current count
                                                    let currentCount = 0;
                                                    const selectedItems = orderConfig.items || {};
                                                    Object.entries(selectedItems).forEach(([itemId, qty]) => {
                                                        const item = menuItems.find(i => i.id === itemId);
                                                        if (item && item.categoryId === quota.categoryId) {
                                                            currentCount += (item.quotaValue || 1) * (qty as number);
                                                        }
                                                    });

                                                    const isMet = currentCount === quota.targetValue;
                                                    const isOver = currentCount > quota.targetValue;

                                                    return (
                                                        <div key={quota.id} style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                                                <span style={{ fontWeight: 600 }}>{category.name}</span>
                                                                <span style={{
                                                                    color: isMet ? 'var(--color-success)' : (isOver ? 'var(--color-danger)' : 'var(--color-warning)'),
                                                                    fontWeight: 600
                                                                }}>
                                                                    {currentCount} / {quota.targetValue}
                                                                </span>
                                                            </div>

                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                                {availableItems.map(item => (
                                                                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-app)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                                                        <span style={{ fontSize: '0.8rem' }}>{item.name} <span style={{ color: 'var(--text-tertiary)' }}>({item.quotaValue || 1})</span></span>
                                                                        <input
                                                                            type="number"
                                                                            min="0"
                                                                            style={{ width: '40px', padding: '2px', fontSize: '0.8rem', textAlign: 'center' }}
                                                                            value={selectedItems[item.id] || ''}
                                                                            placeholder="0"
                                                                            onChange={e => handleBoxItemChange(item.id, Number(e.target.value))}
                                                                        />
                                                                    </div>
                                                                ))}
                                                                {availableItems.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>No items available.</span>}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </section>

                    {/* This Week's Order Panel */}
                    <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                            <Calendar size={18} />
                            <h3 className={styles.sectionTitle} style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                                This Week's Order
                            </h3>
                        </div>
                        {loadingOrderDetails ? (
                            <div className={styles.loadingContainer}>
                                <div className={styles.spinner}></div>
                                <p className={styles.loadingText}>Loading order details...</p>
                            </div>
                        ) : activeOrder ? (
                            <div>
                                {(() => {
                                    // Handle both single order (backward compatibility) and multiple orders
                                    const isMultiple = activeOrder.multiple === true && Array.isArray(activeOrder.orders);
                                    const ordersToDisplay = isMultiple ? activeOrder.orders : [activeOrder];

                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                            {ordersToDisplay.map((order: any, orderIdx: number) => {
                                                const isFood = order.serviceType === 'Food';
                                                const isBoxes = order.serviceType === 'Boxes';

                                                return (
                                                    <div key={orderIdx} style={isMultiple ? {
                                                        padding: 'var(--spacing-md)',
                                                        backgroundColor: 'var(--bg-surface)',
                                                        borderRadius: 'var(--radius-md)',
                                                        border: '1px solid var(--border-color)'
                                                    } : {}}>
                                                        {isMultiple && (
                                                            <div style={{
                                                                marginBottom: 'var(--spacing-md)',
                                                                paddingBottom: 'var(--spacing-sm)',
                                                                borderBottom: '1px solid var(--border-color)',
                                                                fontSize: '0.9rem',
                                                                fontWeight: 600,
                                                                color: 'var(--text-secondary)'
                                                            }}>
                                                                Order {orderIdx + 1} of {ordersToDisplay.length}
                                                                {order.scheduledDeliveryDate && (
                                                                    <span style={{ marginLeft: 'var(--spacing-sm)', fontSize: '0.85rem', fontWeight: 400 }}>
                                                                        • Scheduled: {new Date(order.scheduledDeliveryDate).toLocaleDateString()}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        )}
                                                        <div>
                                                            {/* Food Order Display - Show vendors first, then items grouped by vendor */}
                                                            {isFood && order.vendorSelections && order.vendorSelections.length > 0 && (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                                    {order.vendorSelections.map((vendorSelection: any, idx: number) => {
                                                                        const vendor = vendors.find(v => v.id === vendorSelection.vendorId);
                                                                        const vendorName = vendor?.name || 'Unknown Vendor';
                                                                        const nextDelivery = getNextDeliveryDate(vendorSelection.vendorId);
                                                                        const items = vendorSelection.items || {};

                                                                        return (
                                                                            <div key={idx} style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                                {/* Vendor Header */}
                                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-sm)', paddingBottom: 'var(--spacing-sm)', borderBottom: '1px solid var(--border-color)' }}>
                                                                                    <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--color-primary)' }}>{vendorName}</div>
                                                                                    {nextDelivery && (
                                                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                                                            Next delivery: {nextDelivery.dayOfWeek}, {nextDelivery.date}
                                                                                        </div>
                                                                                    )}
                                                                                </div>

                                                                            </div>
                                                                        );
                                                                    })}

                                                                    {/* Overall Box Total */}
                                                                    {(() => {
                                                                        const boxTotal = getBoxItemsTotal();
                                                                        if (boxTotal > 0) {
                                                                            return (
                                                                                <div style={{
                                                                                    marginTop: 'var(--spacing-md)',
                                                                                    padding: '1rem',
                                                                                    backgroundColor: 'var(--color-primary-bg)',
                                                                                    borderRadius: 'var(--radius-md)',
                                                                                    border: '2px solid var(--color-primary)',
                                                                                    fontSize: '1rem',
                                                                                    textAlign: 'center',
                                                                                    fontWeight: 700,
                                                                                    color: 'var(--color-primary)'
                                                                                }}>
                                                                                    Box Total: ${boxTotal.toFixed(2)}
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return null;
                                                                    })()}
                                                                </div>
                                                            )}

                                                            {/* Boxes Order Display - Show vendor, box type, and all items */}
                                                            {isBoxes && order.boxTypeId && (
                                                                <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                    {(() => {
                                                                        const box = boxTypes.find(b => b.id === order.boxTypeId);
                                                                        const boxVendorId = box?.vendorId;
                                                                        const vendor = boxVendorId ? vendors.find(v => v.id === boxVendorId) : null;
                                                                        const vendorName = vendor?.name || 'Unknown Vendor';
                                                                        const boxName = box?.name || 'Unknown Box';
                                                                        const nextDelivery = boxVendorId ? getNextDeliveryDate(boxVendorId) : null;
                                                                        const items = order.items || {};

                                                                        return (
                                                                            <>
                                                                                {/* Vendor and Box Type Header */}
                                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-sm)', paddingBottom: 'var(--spacing-sm)', borderBottom: '1px solid var(--border-color)' }}>
                                                                                    <div>
                                                                                        <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--color-primary)' }}>{vendorName}</div>
                                                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                                                            {boxName} × {order.boxQuantity || 1}
                                                                                        </div>
                                                                                    </div>
                                                                                    {nextDelivery && (
                                                                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                                                            Next delivery: {nextDelivery.dayOfWeek}, {nextDelivery.date}
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            </>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()}
                            </div>
                        ) : (
                            <div className={styles.empty}>
                                No active order for this week.
                            </div>
                        )}
                    </section>
                </div >
            </div >
            {
                onClose && (
                    <div className={styles.bottomAction}>
                        <button
                            className="btn btn-primary"
                            onClick={handleSaveAndClose}
                            disabled={saving}
                            style={{
                                width: '200px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                opacity: saving ? 0.7 : 1,
                                cursor: saving ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {saving ? (
                                <>
                                    <Loader2
                                        size={16}
                                        style={{
                                            animation: 'spin 1s linear infinite',
                                            display: 'inline-block'
                                        }}
                                    />
                                    Saving...
                                </>
                            ) : (
                                'Save'
                            )}
                        </button>
                    </div>
                )
            }
        </div>
    );

    async function handleSave(): Promise<boolean> {
        console.time('handleSave:total');
        console.time('handleSave:pre-check');
        if (!client) {
            console.timeEnd('handleSave:pre-check');
            console.timeEnd('handleSave:total');
            return false;
        }

        // Validate Order Config before saving (if we have config)
        if (orderConfig && orderConfig.caseId) {
            console.time('handleSave:validate');
            const validation = validateOrder();
            console.timeEnd('handleSave:validate');
            if (!validation.isValid) {
                setValidationError({ show: true, messages: validation.messages });
                console.timeEnd('handleSave:pre-check');
                console.timeEnd('handleSave:total');
                return false;
            }
        }

        // Check for Status Change by Navigator
        // Check for Status Change by Navigator
        if (currentUser?.role === 'navigator' && formData.statusId !== client.statusId) {
            console.timeEnd('handleSave:pre-check');
            console.log('Detected status change, showing modal');

            try {
                const oldStatusName = getStatusName(client.statusId);
                const newStatusName = getStatusName(formData.statusId!);
                setPendingStatusChange({ oldStatus: oldStatusName, newStatus: newStatusName });
                setShowUnitsModal(true);
                return false; // Intercepted
            } catch (e) {
                console.error('Error in status change logic:', e);
            }
        }


        return await executeSave(0);
    }

    async function executeSave(unitsAdded: number = 0): Promise<boolean> {
        if (!client) return false;
        setSaving(true);
        setMessage(null);

        try {
            // Log Navigator Action if applicable
            if (currentUser?.role === 'navigator' && pendingStatusChange && unitsAdded >= 0) {
                await logNavigatorAction({
                    navigatorId: currentUser.id,
                    clientId: clientId,
                    oldStatus: pendingStatusChange.oldStatus,
                    newStatus: pendingStatusChange.newStatus,
                    unitsAdded: unitsAdded
                });
            }

            // -- Change Detection --
            const changes: string[] = [];
            if (client.fullName !== formData.fullName) changes.push(`Full Name: "${client.fullName}" -> "${formData.fullName}"`);
            if (client.address !== formData.address) changes.push(`Address: "${client.address}" -> "${formData.address}"`);
            if (client.email !== formData.email) changes.push(`Email: "${client.email}" -> "${formData.email}"`);
            if (client.phoneNumber !== formData.phoneNumber) changes.push(`Phone: "${client.phoneNumber}" -> "${formData.phoneNumber}"`);
            if (client.notes !== formData.notes) changes.push('Notes updated');
            if (client.statusId !== formData.statusId) {
                const oldStatus = statuses.find(s => s.id === client.statusId)?.name || 'Unknown';
                const newStatus = statuses.find(s => s.id === formData.statusId)?.name || 'Unknown';
                changes.push(`Status: "${oldStatus}" -> "${newStatus}"`);
            }
            if (client.navigatorId !== formData.navigatorId) {
                const oldNav = navigators.find(n => n.id === client.navigatorId)?.name || 'Unassigned';
                const newNav = navigators.find(n => n.id === formData.navigatorId)?.name || 'Unassigned';
                changes.push(`Navigator: "${oldNav}" -> "${newNav}"`);
            }
            if (client.serviceType !== formData.serviceType) changes.push(`Service Type: "${client.serviceType}" -> "${formData.serviceType}"`);
            if (client.approvedMealsPerWeek !== formData.approvedMealsPerWeek) changes.push(`Approved Meals: ${client.approvedMealsPerWeek} -> ${formData.approvedMealsPerWeek}`);
            if (client.screeningTookPlace !== formData.screeningTookPlace) changes.push(`Screening Took Place: ${client.screeningTookPlace} -> ${formData.screeningTookPlace}`);
            if (client.screeningSigned !== formData.screeningSigned) changes.push(`Screening Signed: ${client.screeningSigned} -> ${formData.screeningSigned}`);

            // Check if order configuration changed
            const hasOrderChanges = orderConfig && orderConfig.caseId;
            if (hasOrderChanges) {
                changes.push('Order configuration changed');
            }

            const summary = changes.length > 0 ? changes.join(', ') : 'No functional changes detected (re-saved profile)';

            // Update client profile
            const updateData: Partial<ClientProfile> = { ...formData };
            await updateClient(clientId, updateData);
            await recordClientChange(clientId, summary, 'Admin');

            // Sync Current Order Request
            if (hasOrderChanges) {
                const cleanedOrderConfig = { ...orderConfig };
                if (formData.serviceType === 'Food') {
                    if (cleanedOrderConfig.deliveryDayOrders) {
                        for (const day of Object.keys(cleanedOrderConfig.deliveryDayOrders)) {
                            cleanedOrderConfig.deliveryDayOrders[day].vendorSelections = (cleanedOrderConfig.deliveryDayOrders[day].vendorSelections || [])
                                .filter((s: any) => s.vendorId)
                                .map((s: any) => ({ vendorId: s.vendorId, items: s.items || {} }));
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
                                    if (!deliveryDayOrders[day]) deliveryDayOrders[day] = { vendorSelections: [] };
                                    const dayItems = selection.itemsByDay[day] || {};
                                    const hasItems = Object.keys(dayItems).length > 0 && Object.values(dayItems).some((qty: any) => (Number(qty) || 0) > 0);
                                    if (hasItems) {
                                        deliveryDayOrders[day].vendorSelections.push({ vendorId: selection.vendorId, items: dayItems });
                                    }
                                }
                            }
                            // Clean up days with no vendors
                            const daysWithVendors = Object.keys(deliveryDayOrders).filter(day =>
                                deliveryDayOrders[day].vendorSelections && deliveryDayOrders[day].vendorSelections.length > 0
                            );
                            if (daysWithVendors.length > 0) {
                                const cleanedDeliveryDayOrders: any = {};
                                for (const day of daysWithVendors) cleanedDeliveryDayOrders[day] = deliveryDayOrders[day];
                                cleanedOrderConfig.deliveryDayOrders = cleanedDeliveryDayOrders;
                                cleanedOrderConfig.vendorSelections = undefined;
                            }
                        } else {
                            cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                                .filter((s: any) => s.vendorId)
                                .map((s: any) => ({ vendorId: s.vendorId, items: s.items || {} }));
                        }
                    }
                }

                const tempClient: ClientProfile = {
                    ...client,
                    ...formData,
                    activeOrder: {
                        ...cleanedOrderConfig,
                        serviceType: formData.serviceType,
                        lastUpdated: new Date().toISOString(),
                        updatedBy: 'Admin'
                    }
                } as ClientProfile;

                await syncCurrentOrderToUpcoming(clientId, tempClient);

                // Reload upcoming order
                const updatedUpcomingOrder = await getUpcomingOrderForClient(clientId);
                if (updatedUpcomingOrder) {
                    setOrderConfig(updatedUpcomingOrder);
                }
            }

            if (onClose) {
                onClose();
            } else {
                setMessage('Changes saved successfully.');
                setTimeout(() => setMessage(null), 3000);
                const updatedClient = await getClient(clientId);
                if (updatedClient) {
                    setClient(updatedClient);
                    loadData();
                }
            }
            return true;
        } catch (error) {
            setMessage('Error saving changes.');
            console.error(error);
            return false;
        } finally {
            setSaving(false);
            setShowUnitsModal(false);
            setPendingStatusChange(null);
        }
    }

    async function handleSaveAndClose() {
        const saved = await handleSave();
        if (saved && onClose) {
            onClose();
        }
    }

    if (onClose) {
        return (
            <>
                <div className={styles.modalOverlay} onClick={() => {
                    // Try to save and close when clicking overlay
                    handleSaveAndClose();
                }}>
                    <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                        {content}
                    </div>
                </div>
                {validationError.show && (
                    <div className={styles.modalOverlay} style={{ zIndex: 200 }}>
                        <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                                <AlertTriangle size={24} />
                                Cannot Save Order
                            </h2>
                            <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                                The current order configuration is invalid and cannot be saved.
                            </p>
                            <div style={{ background: 'var(--bg-surface-hover)', padding: '12px', borderRadius: '8px', marginBottom: '24px' }}>
                                <ul style={{ listStyle: 'disc', paddingLeft: '20px', margin: 0 }}>
                                    {validationError.messages.map((msg, i) => (
                                        <li key={i} style={{ marginBottom: '4px', color: 'var(--text-primary)' }}>{msg}</li>
                                    ))}
                                </ul>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => setValidationError({ show: false, messages: [] })}
                                >
                                    Return to Editing
                                </button>
                                <button
                                    className="btn"
                                    style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
                                    onClick={handleDiscardChanges}
                                >
                                    Discard Changes & Exit
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                <UnitsModal
                    isOpen={showUnitsModal}
                    onClose={() => setShowUnitsModal(false)}
                    onConfirm={executeSave}
                    saving={saving}
                />
            </>
        );
    } else {
        return (
            <>
                {content}
                {validationError.show && (
                    <div className={styles.modalOverlay} style={{ zIndex: 200 }}>
                        <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                                <AlertTriangle size={24} />
                                Cannot Save Order
                            </h2>
                            <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                                The current order configuration is invalid and cannot be saved.
                            </p>
                            <div style={{ background: 'var(--bg-surface-hover)', padding: '12px', borderRadius: '8px', marginBottom: '24px' }}>
                                <ul style={{ listStyle: 'disc', paddingLeft: '20px', margin: 0 }}>
                                    {validationError.messages.map((msg, i) => (
                                        <li key={i} style={{ marginBottom: '4px', color: 'var(--text-primary)' }}>{msg}</li>
                                    ))}
                                </ul>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => setValidationError({ show: false, messages: [] })}
                                >
                                    Return to Editing
                                </button>
                                <button
                                    className="btn"
                                    style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
                                    onClick={handleDiscardChanges}
                                >
                                    Discard Changes & Exit
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                <UnitsModal
                    isOpen={showUnitsModal}
                    onClose={() => setShowUnitsModal(false)}
                    onConfirm={executeSave}
                    saving={saving}
                />
            </>
        );
    }
}
