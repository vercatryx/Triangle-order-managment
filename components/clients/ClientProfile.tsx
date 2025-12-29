'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ServiceType, AppSettings, ItemCategory, BoxQuota, ClientFullDetails } from '@/lib/types';
import { getClient, updateClient, deleteClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getSettings, getClientHistory, updateDeliveryProof, recordClientChange, getOrderHistory, getCategories, getBoxQuotas, getClients, syncCurrentOrderToUpcoming, getBillingHistory, getActiveOrderForClient, getUpcomingOrderForClient } from '@/lib/actions';
import { Save, ArrowLeft, Truck, Package, AlertTriangle, Upload, Trash2, Plus, Check, ClipboardList, History, CreditCard, Calendar } from 'lucide-react';
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
}

const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes', 'Cooking supplies', 'Care plan'];

export function ClientProfileDetail({ clientId: propClientId, onClose, initialData, statuses: initialStatuses, navigators: initialNavigators, vendors: initialVendors, menuItems: initialMenuItems, boxTypes: initialBoxTypes }: Props) {
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


    const [formData, setFormData] = useState<Partial<ClientProfile>>({});
    const [orderConfig, setOrderConfig] = useState<any>({}); // Current Order Request (from upcoming_orders)


    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<{ show: boolean, messages: string[] }>({ show: false, messages: [] });

    const [loading, setLoading] = useState(true);
    const [allClients, setAllClients] = useState<ClientProfile[]>([]);
    const [activeOrder, setActiveOrder] = useState<any>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [orderHistory, setOrderHistory] = useState<any[]>([]);
    const [billingHistory, setBillingHistory] = useState<any[]>([]);
    const [activeHistoryTab, setActiveHistoryTab] = useState<'deliveries' | 'audit' | 'billing'>('deliveries');

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

        // Handle upcoming order logic (reused from loadData)
        const upcomingOrderData = data.upcomingOrder;
        if (upcomingOrderData) {
            if (upcomingOrderData.serviceType === 'Food' && !upcomingOrderData.vendorSelections) {
                if (upcomingOrderData.vendorId) {
                    upcomingOrderData.vendorSelections = [{ vendorId: upcomingOrderData.vendorId, items: upcomingOrderData.menuSelections || {} }];
                } else {
                    upcomingOrderData.vendorSelections = [{ vendorId: '', items: {} }];
                }
            }
            setOrderConfig(upcomingOrderData);
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

        // Set order config from upcoming_orders table (Current Order Request)
        // If no upcoming order exists, initialize with default based on service type
        if (upcomingOrderData) {
            // Migration/Safety: Ensure vendorSelections exists for Food
            if (upcomingOrderData.serviceType === 'Food' && !upcomingOrderData.vendorSelections) {
                if (upcomingOrderData.vendorId) {
                    // Migrate old format
                    upcomingOrderData.vendorSelections = [{ vendorId: upcomingOrderData.vendorId, items: upcomingOrderData.menuSelections || {} }];
                } else {
                    upcomingOrderData.vendorSelections = [{ vendorId: '', items: {} }];
                }
            }
            setOrderConfig(upcomingOrderData);
        } else if (c) {
            // No upcoming order, initialize with default
            const defaultOrder: any = { serviceType: c.serviceType };
            if (c.serviceType === 'Food') {
                defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
            }
            setOrderConfig(defaultOrder);
        }
    }

// Effect: Auto-select Box Type when Vendor changes (for Boxes)
useEffect(() => {
    if (formData.serviceType === 'Boxes' && orderConfig.vendorId && boxTypes.length > 0) {
        // Find the box type for this vendor
        const vendorBox = boxTypes.find(b => b.vendorId === orderConfig.vendorId);
        if (vendorBox && orderConfig.boxTypeId !== vendorBox.id) {
            setOrderConfig((prev: any) => ({ ...prev, boxTypeId: vendorBox.id }));
        }
    }
}, [orderConfig.vendorId, formData.serviceType, boxTypes]);

// Effect: Load quotas when boxTypeId changes
useEffect(() => {
    if (orderConfig.boxTypeId) {
        getBoxQuotas(orderConfig.boxTypeId).then(quotas => {
            setActiveBoxQuotas(quotas);
        });
    } else {
        setActiveBoxQuotas([]);
    }
}, [orderConfig.boxTypeId]);

// Effect: Check and save Service Configuration when form is being edited
useEffect(() => {
    if (!client || !orderConfig || !orderConfig.caseId) return;

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
                const configChanged =
                    existingUpcomingOrder.caseId !== orderConfig.caseId ||
                    existingUpcomingOrder.serviceType !== formData.serviceType ||
                    JSON.stringify(existingUpcomingOrder.vendorSelections || []) !== JSON.stringify(orderConfig.vendorSelections || []) ||
                    existingUpcomingOrder.vendorId !== orderConfig.vendorId ||
                    existingUpcomingOrder.boxTypeId !== orderConfig.boxTypeId ||
                    existingUpcomingOrder.boxQuantity !== orderConfig.boxQuantity;

                if (configChanged) {
                    needsSave = true;
                }
            }

            if (needsSave) {
                // Ensure structure is correct
                const cleanedOrderConfig = { ...orderConfig };
                if (formData.serviceType === 'Food') {
                    // Remove empty selections or selections with no vendor
                    cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                        .filter((s: any) => s.vendorId)
                        .map((s: any) => ({
                            vendorId: s.vendorId,
                            items: s.items || {}
                        }));
                }

                // Create a temporary client object for syncCurrentOrderToUpcoming
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

                // Sync to upcoming_orders table
                await syncCurrentOrderToUpcoming(clientId, tempClient);
            }
        } catch (error) {
            console.error('Error checking/saving Service Configuration:', error);
        }
    }, 500); // 500ms debounce for check

    return () => clearTimeout(timeoutId);
}, [orderConfig.caseId, orderConfig.vendorSelections, orderConfig.vendorId, orderConfig.boxTypeId, orderConfig.boxQuantity, formData.serviceType, client, clientId]);

// Effect: Sync Current Order Request to upcoming_orders table in real-time (debounced)
useEffect(() => {
    if (!client || !orderConfig || !orderConfig.caseId) return;

    // Debounce: wait 1 second after user stops typing before syncing
    const timeoutId = setTimeout(async () => {
        try {
            // Ensure structure is correct
            const cleanedOrderConfig = { ...orderConfig };
            if (formData.serviceType === 'Food') {
                // Remove empty selections or selections with no vendor
                cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                    .filter((s: any) => s.vendorId)
                    .map((s: any) => ({
                        vendorId: s.vendorId,
                        items: s.items || {}
                    }));
            }

            // Create a temporary client object for syncCurrentOrderToUpcoming
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

            // Sync to upcoming_orders table
            await syncCurrentOrderToUpcoming(clientId, tempClient);
        } catch (error) {
            console.error('Error syncing to upcoming_orders:', error);
        }
    }, 1000); // 1 second debounce

    return () => clearTimeout(timeoutId);
}, [orderConfig, client, formData, clientId]);


// -- Logic Helpers --

function getVendorMenuItems(vendorId: string) {
    return menuItems.filter(i => i.vendorId === vendorId && i.isActive);
}

function getCurrentOrderTotalValue() {
    if (!orderConfig.vendorSelections) return 0;
    let total = 0;
    for (const selection of orderConfig.vendorSelections) {
        if (!selection.items) continue;
        for (const [itemId, qty] of Object.entries(selection.items)) {
            const item = menuItems.find(i => i.id === itemId);
            total += (item ? item.value * (qty as number) : 0);
        }
    }
    return total;
}

// Calculate total meals (quantity) for a specific vendor
function getVendorMealCount(vendorId: string, selection: any): number {
    if (!selection || !selection.items) return 0;
    let total = 0;
    for (const [itemId, qty] of Object.entries(selection.items)) {
        total += (qty as number) || 0;
    }
    return total;
}

// Calculate total meals across all vendors
function getTotalMealCount(): number {
    if (!orderConfig.vendorSelections) return 0;
    let total = 0;
    for (const selection of orderConfig.vendorSelections) {
        total += getVendorMealCount(selection.vendorId, selection);
    }
    return total;
}

function isCutoffPassed() {
    return false; // MVP simplified
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

if (!client) return <div>Loading...</div>;

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
        const totalMeals = getTotalMealCount();
        const clientMax = formData.approvedMealsPerWeek || 0;
        if (totalMeals > clientMax) {
            messages.push(`Total meals (${totalMeals}) exceeds client maximum (${clientMax}).`);
        }
        
        // Check each vendor meets their minimum requirement
        if (orderConfig.vendorSelections) {
            for (const selection of orderConfig.vendorSelections) {
                if (!selection.vendorId) continue; // Skip empty vendor selections
                
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

async function handleSave(): Promise<boolean> {
    if (!client) return false;

    const validation = validateOrder();
    if (!validation.isValid) {
        setValidationError({ show: true, messages: validation.messages });
        return false;
    }

    setSaving(true);

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

    // Update client profile (without activeOrder - that comes from orders table)
    const updateData: Partial<ClientProfile> = {
        ...formData
    };

    await updateClient(clientId, updateData);
    await recordClientChange(clientId, summary, 'Admin');

    // Sync Current Order Request to upcoming_orders table
    if (hasOrderChanges) {
        // Ensure structure is correct
        const cleanedOrderConfig = { ...orderConfig };
        if (formData.serviceType === 'Food') {
            // Remove empty selections or selections with no vendor
            cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                .filter((s: any) => s.vendorId)
                .map((s: any) => ({
                    vendorId: s.vendorId,
                    items: s.items || {}
                }));
        }

        // Create a temporary client object for syncCurrentOrderToUpcoming
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

        // Sync to upcoming_orders table
        await syncCurrentOrderToUpcoming(clientId, tempClient);

        // Reload upcoming order to reflect changes
        const updatedUpcomingOrder = await getUpcomingOrderForClient(clientId);
        if (updatedUpcomingOrder) {
            setOrderConfig(updatedUpcomingOrder);
        }
    }

    // Refresh client
    const updatedClient = await getClient(clientId);
    if (updatedClient) {
        setClient(updatedClient);
    }

    setSaving(false);
    setMessage('Client profile updated.');
    setTimeout(() => setMessage(null), 3000);
    return true;
}

async function handleSaveAndClose() {
    const saved = await handleSave();
    if (saved && onClose) {
        onClose();
    }
}

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

function addVendorBlock() {
    setOrderConfig({
        ...orderConfig,
        vendorSelections: [...(orderConfig.vendorSelections || []), { vendorId: '', items: {} }]
    });
}

function removeVendorBlock(index: number) {
    const current = [...(orderConfig.vendorSelections || [])];
    current.splice(index, 1);
    setOrderConfig({ ...orderConfig, vendorSelections: current });
}

function updateVendorSelection(index: number, field: string, value: any) {
    const current = [...(orderConfig.vendorSelections || [])];
    current[index] = { ...current[index], [field]: value };
    // If changing vendor, maybe clear items?
    if (field === 'vendorId') {
        current[index].items = {};
    }
    setOrderConfig({ ...orderConfig, vendorSelections: current });
}

function updateItemQuantity(blockIndex: number, itemId: string, qty: number) {
    const current = [...(orderConfig.vendorSelections || [])];
    const items = { ...(current[blockIndex].items || {}) };
    if (qty > 0) {
        items[itemId] = qty;
    } else {
        delete items[itemId];
    }
    current[blockIndex].items = items;
    setOrderConfig({ ...orderConfig, vendorSelections: current });
}

const content = (
    <div className={onClose ? '' : styles.container}>
        <header className={styles.header}>
            <button className={styles.backBtn} onClick={handleBack}>
                <ArrowLeft size={20} /> {onClose ? 'Close' : 'Back to List'}
            </button>
            <h1 className={styles.title}>{formData.fullName}</h1>
            <div className={styles.actions}>
                {message && <span className={styles.successMessage}>{message}</span>}
                <button className="btn" onClick={handleDelete} style={{ marginRight: '8px', backgroundColor: '#ef4444', color: 'white', border: 'none' }}>
                    <Trash2 size={16} /> Delete
                </button>
                <button className="btn btn-secondary" onClick={() => router.push(`/clients/${clientId}/billing`)} style={{ marginRight: '8px' }}>
                    <CreditCard size={16} /> Billing
                </button>
                {!onClose && (
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        <Save size={16} /> Save Changes
                    </button>
                )}
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
                                                color: getTotalMealCount() > (formData.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'inherit',
                                                backgroundColor: getTotalMealCount() > (formData.approvedMealsPerWeek || 0) ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface-hover)'
                                            }}>
                                                Meals: {getTotalMealCount()} / {formData.approvedMealsPerWeek || 0}
                                            </div>
                                            <div className={styles.budget} style={{
                                                color: getCurrentOrderTotalValue() > (formData.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'inherit',
                                                backgroundColor: getCurrentOrderTotalValue() > (formData.approvedMealsPerWeek || 0) ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface-hover)'
                                            }}>
                                                Value: {getCurrentOrderTotalValue()} / {formData.approvedMealsPerWeek || 0}
                                            </div>
                                        </div>
                                    </div>

                                    {isCutoffPassed() && <div className={styles.alert}><AlertTriangle size={16} /> Cutoff passed. Changes will apply to next cycle.</div>}

                                    {/* Multi-Vendor Configuration */}
                                    <div className={styles.vendorsList}>
                                        {(orderConfig.vendorSelections || []).map((selection: any, index: number) => (
                                            <div key={index} className={styles.vendorBlock}>
                                                <div className={styles.vendorHeader}>
                                                    <select
                                                        className="input"
                                                        value={selection.vendorId}
                                                        onChange={e => updateVendorSelection(index, 'vendorId', e.target.value)}
                                                    >
                                                        <option value="">Select Vendor...</option>
                                                        {vendors.filter(v => v.serviceType === 'Food' && v.isActive).map(v => (
                                                            <option key={v.id} value={v.id} disabled={orderConfig.vendorSelections.some((s: any, i: number) => i !== index && s.vendorId === v.id)}>
                                                                {v.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => removeVendorBlock(index)} title="Remove Vendor">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>

                                                {selection.vendorId && (
                                                    <>
                                                        {/* Vendor Minimum Requirement Display */}
                                                        {(() => {
                                                            const vendor = vendors.find(v => v.id === selection.vendorId);
                                                            const vendorMinimum = vendor?.minimumMeals || 0;
                                                            if (vendorMinimum > 0) {
                                                                const vendorMealCount = getVendorMealCount(selection.vendorId, selection);
                                                                const meetsMinimum = vendorMealCount >= vendorMinimum;
                                                                return (
                                                                    <div style={{
                                                                        marginBottom: '0.75rem',
                                                                        padding: '0.5rem 0.75rem',
                                                                        backgroundColor: meetsMinimum ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                                        borderRadius: 'var(--radius-sm)',
                                                                        border: `1px solid ${meetsMinimum ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                                                                        fontSize: '0.85rem',
                                                                        display: 'flex',
                                                                        justifyContent: 'space-between',
                                                                        alignItems: 'center'
                                                                    }}>
                                                                        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                                                            Minimum Required: <strong>{vendorMinimum}</strong> meals
                                                                        </span>
                                                                        <span style={{
                                                                            color: meetsMinimum ? 'var(--color-success)' : 'var(--color-danger)',
                                                                            fontWeight: 600
                                                                        }}>
                                                                            Current: {vendorMealCount} {meetsMinimum ? '✓' : '✗'}
                                                                        </span>
                                                                    </div>
                                                                );
                                                            }
                                                            return null;
                                                        })()}
                                                        <div className={styles.menuList}>
                                                            {getVendorMenuItems(selection.vendorId).map(item => {
                                                                return (
                                                                    <div key={item.id} className={styles.menuItem}>
                                                                        <div className={styles.itemInfo}>
                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                                <span>{item.name}</span>
                                                                                <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                                    <span className={styles.itemValue}>Value: {item.value}</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                        <div className={styles.quantityControl}>
                                                                            <input
                                                                                type="number"
                                                                                className={styles.qtyInput}
                                                                                min="0"
                                                                                value={selection.items?.[item.id] || ''}
                                                                                placeholder="0"
                                                                                onChange={e => updateItemQuantity(index, item.id, parseInt(e.target.value) || 0)}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                            {getVendorMenuItems(selection.vendorId).length === 0 && <span className={styles.hint}>No active menu items.</span>}
                                                        </div>

                                                        {/* Next Delivery Date for this vendor */}
                                                        {(() => {
                                                            const nextDeliveryDate = getNextDeliveryDateForVendor(selection.vendorId);
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
                                                    </>
                                                )}
                                            </div>
                                        ))}

                                        <button className={styles.addVendorBtn} onClick={addVendorBlock}>
                                            <Plus size={14} /> Add Vendor
                                        </button>
                                    </div>
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
                                                setOrderConfig({
                                                    ...orderConfig,
                                                    vendorId: newVendorId,
                                                    boxTypeId: '' // Reset box selection when vendor changes
                                                });
                                            }}
                                        >
                                            <option value="">Select Vendor...</option>
                                            {vendors.filter(v => v.serviceType === 'Boxes' && v.isActive).map(v => (
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

                                                // Filter items for this category and vendor
                                                const availableItems = menuItems.filter(i =>
                                                    i.vendorId === orderConfig.vendorId &&
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
                {activeOrder && (
                    <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                            <Calendar size={18} />
                            <h3 className={styles.sectionTitle} style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                                This Week's Order
                            </h3>
                        </div>
                        <div>
                            {(() => {
                                const order = activeOrder;
                                const isFood = order.serviceType === 'Food';
                                const isBoxes = order.serviceType === 'Boxes';

                                return (
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

                                                            {/* Items List */}
                                                            {Object.keys(items).length > 0 ? (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                                    {Object.entries(items).map(([itemId, quantity]) => {
                                                                        const item = menuItems.find(m => m.id === itemId);
                                                                        const itemName = item?.name || 'Unknown Item';
                                                                        const qty = Number(quantity) || 0;
                                                                        if (qty === 0) return null;

                                                                        return (
                                                                            <div key={itemId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', padding: '6px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>
                                                                                <span>{itemName}</span>
                                                                                <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Qty: {qty}</span>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            ) : (
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '4px' }}>
                                                                    No items selected
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
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

                                                            {/* Items List */}
                                                            {Object.keys(items).length > 0 ? (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: 'var(--spacing-sm)' }}>
                                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                                        Box Contents:
                        </div>
                                                                    {Object.entries(items).map(([itemId, quantity]) => {
                                                                        const item = menuItems.find(m => m.id === itemId);
                                                                        const itemName = item?.name || 'Unknown Item';
                                                                        const qty = Number(quantity) || 0;
                                                                        if (qty === 0) return null;

                                                                        return (
                                                                            <div key={itemId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', padding: '6px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>
                                                                                <span>{itemName}</span>
                                                                                <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Qty: {qty}</span>
                                        </div>
                                                                        );
                                                                    })}
                                                </div>
                                            ) : (
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '4px', marginTop: 'var(--spacing-sm)' }}>
                                                                    No items in box
                                                </div>
                                            )}
                                                        </>
                                                    );
                                                })()}
                                                    </div>
                                                )}

                                        {!isFood && !isBoxes && (
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '4px' }}>
                                                No order details available
                                                                </div>
                                                            )}
                                                                </div>
                                );
                            })()}
                    </div>
                </section>
                )}
            </div >
        </div >
        {
            onClose && (
                <div className={styles.bottomAction}>
                    <button className="btn btn-primary" onClick={handleSaveAndClose} style={{ width: '200px' }}>
                        Close
                    </button>
                </div>
            )
        }
    </div>
);

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
        </>
    );
}

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
    </>
);
}
