'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ServiceType, AppSettings, DeliveryRecord, ItemCategory, BoxQuota } from '@/lib/types';
import { updateClient, deleteClient, getClientHistory, updateDeliveryProof, recordClientChange, getOrderHistory, getBoxQuotas, syncCurrentOrderToUpcoming, getBillingHistory, getActiveOrderForClient, getUpcomingOrderForClient } from '@/lib/actions';
import { getClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getSettings, getCategories, getClients, invalidateClientData, invalidateReferenceData } from '@/lib/cached-data';
import { Save, ArrowLeft, Truck, Package, AlertTriangle, Upload, Trash2, Plus, Check, ClipboardList, History, CreditCard, Calendar } from 'lucide-react';
import styles from './ClientProfile.module.css';
import { OrderHistoryItem } from './OrderHistoryItem';

interface Props {
    clientId: string;
    onClose?: () => void;
}

const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes', 'Cooking supplies', 'Care plan'];

export function ClientProfileDetail({ clientId: propClientId, onClose }: Props) {
    const router = useRouter();
    const params = useParams();
    const clientId = (params?.id as string) || propClientId;

    const [client, setClient] = useState<ClientProfile | null>(null);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [activeBoxQuotas, setActiveBoxQuotas] = useState<BoxQuota[]>([]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [history, setHistory] = useState<DeliveryRecord[]>([]);
    const [orderHistory, setOrderHistory] = useState<any[]>([]);
    const [billingHistory, setBillingHistory] = useState<any[]>([]);
    const [activeHistoryTab, setActiveHistoryTab] = useState<'deliveries' | 'audit' | 'billing'>('deliveries');
    const [allClients, setAllClients] = useState<ClientProfile[]>([]);

    const [formData, setFormData] = useState<Partial<ClientProfile>>({});
    const [orderConfig, setOrderConfig] = useState<any>({}); // Current Order Request (from upcoming_orders)
    const [activeOrder, setActiveOrder] = useState<any>(null); // This Week's Order (from orders table)

    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<{ show: boolean, messages: string[] }>({ show: false, messages: [] });

    useEffect(() => {
        loadData();
    }, [clientId]);

    async function loadData() {
        const [c, s, n, v, m, b, appSettings, catData, allClientsData, activeOrderData, upcomingOrderData] = await Promise.all([
            getClient(clientId),
            getStatuses(),
            getNavigators(),
            getVendors(),
            getMenuItems(),
            getBoxTypes(),
            getSettings(),
            getCategories(),
            getClients(),
            getActiveOrderForClient(clientId), // This Week's Order from orders table
            getUpcomingOrderForClient(clientId) // Current Order Request from upcoming_orders table
        ]);

        if (c) {
            setClient(c);
            setFormData(c);
            
            // Set active order from orders table (This Week's Order)
            setActiveOrder(activeOrderData);
            
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
            } else {
                // No upcoming order, initialize with default
                const defaultOrder: any = { serviceType: c.serviceType };
                if (c.serviceType === 'Food') {
                    defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
                }
                setOrderConfig(defaultOrder);
            }

            const [h, oh, bh] = await Promise.all([
                getClientHistory(clientId),
                getOrderHistory(clientId),
                getBillingHistory(clientId)
            ]);
            setHistory(h);
            setOrderHistory(oh);
            setBillingHistory(bh);
        }
        setStatuses(s);
        setNavigators(n);
        setVendors(v);
        setMenuItems(m);
        setBoxTypes(b);
        setSettings(appSettings);
        setCategories(catData);
        setAllClients(allClientsData);
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
                            lastUpdated: new Date().toISOString()
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
                        lastUpdated: new Date().toISOString()
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

    function isCutoffPassed() {
        return false; // MVP simplified
    }

    // Helper function to check if a date is in the current week
    function isInCurrentWeek(dateString: string): boolean {
        if (!dateString) return false;
        
        const date = new Date(dateString);
        const today = new Date();
        
        // Get the start of the week (Sunday)
        const startOfWeek = new Date(today);
        const day = startOfWeek.getDay();
        startOfWeek.setDate(today.getDate() - day);
        startOfWeek.setHours(0, 0, 0, 0);
        
        // Get the end of the week (Saturday)
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);
        
        return date >= startOfWeek && date <= endOfWeek;
    }

    // Check if current client has an active order (This Week's Order)
    // getActiveOrderForClient already filters for current week orders, so if activeOrder exists, it's valid
    const hasCurrentWeekOrder = activeOrder !== null;

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
                    return `${vendorName} (${itemCount})`;
                }).join(', ');
            content = `: ${vendorsSummary || 'None'} [Max ${limit}]`;
        } else if (st === 'Boxes') {
            const box = boxTypes.find(b => b.id === conf.boxTypeId);
            const vendorName = vendors.find(v => v.id === box?.vendorId)?.name || '-';
            const boxName = box?.name || 'Unknown Box';
            content = `: ${vendorName} - ${boxName} (x${conf.boxQuantity || 1})`;
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
            const currentTotal = getCurrentOrderTotalValue();
            const limit = formData.approvedMealsPerWeek || 0;
            if (currentTotal > limit) {
                return {
                    isValid: false,
                    messages: [`Order value (${currentTotal}) exceeds approved limit (${limit}).`]
                };
            }

            // Validate minimum order requirements (vendor-based, not item-based)
            const minimumOrderErrors: string[] = [];
            if (orderConfig.vendorSelections) {
                orderConfig.vendorSelections.forEach((selection: any, blockIndex: number) => {
                    if (!selection.items || !selection.vendorId) return;
                    
                    const vendor = vendors.find(v => v.id === selection.vendorId);
                    if (!vendor) return;
                    
                    // Calculate total quantity of all items from this vendor
                    let totalVendorQuantity = 0;
                    Object.entries(selection.items).forEach(([itemId, qty]) => {
                        const quantity = qty as number;
                        if (quantity > 0) {
                            totalVendorQuantity += quantity;
                        }
                    });
                    
                    // Only validate minimum if vendor has a minimum order requirement and total quantity > 0
                    if (vendor.minimumOrder && vendor.minimumOrder > 0 && totalVendorQuantity > 0 && totalVendorQuantity < vendor.minimumOrder) {
                        minimumOrderErrors.push(
                            `${vendor.name}: Minimum order is ${vendor.minimumOrder} items, but only ${totalVendorQuantity} items are ordered.`
                        );
                    }
                });
            }
            if (minimumOrderErrors.length > 0) {
                return {
                    isValid: false,
                    messages: minimumOrderErrors
                };
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
        invalidateClientData(clientId); // Invalidate cache for this client
        invalidateClientData(); // Also invalidate client list cache
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
        invalidateClientData(clientId); // Invalidate cache for this client
        invalidateClientData(); // Also invalidate client list cache
        await recordClientChange(clientId, summary);

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
                    lastUpdated: new Date().toISOString()
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

        // Refresh client and active order
        const updatedClient = await getClient(clientId);
        if (updatedClient) {
            setClient(updatedClient);
        }
        const updatedActiveOrder = await getActiveOrderForClient(clientId);
        setActiveOrder(updatedActiveOrder);

        // Refresh history
        const oh = await getOrderHistory(clientId);
        setOrderHistory(oh);

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
                                            <div className={styles.budget} style={{
                                                color: getCurrentOrderTotalValue() > (formData.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'inherit',
                                                backgroundColor: getCurrentOrderTotalValue() > (formData.approvedMealsPerWeek || 0) ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface-hover)'
                                            }}>
                                                Value: {getCurrentOrderTotalValue()} / {formData.approvedMealsPerWeek || 0}
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
                                                            {(() => {
                                                                const vendor = vendors.find(v => v.id === selection.vendorId);
                                                                // Calculate total quantity of all items from this vendor
                                                                let totalVendorQuantity = 0;
                                                                if (selection.items) {
                                                                    Object.values(selection.items).forEach((qty: any) => {
                                                                        const quantity = qty as number;
                                                                        if (quantity > 0) {
                                                                            totalVendorQuantity += quantity;
                                                                        }
                                                                    });
                                                                }
                                                                const vendorMinOrder = vendor?.minimumOrder || 0;
                                                                const isBelowVendorMinimum = vendorMinOrder > 0 && totalVendorQuantity > 0 && totalVendorQuantity < vendorMinOrder;
                                                                
                                                                return (
                                                                    <>
                                                                        {/* Vendor Minimum Order Display */}
                                                                        {vendorMinOrder > 0 && (
                                                                            <div style={{
                                                                                marginBottom: 'var(--spacing-md)',
                                                                                padding: '0.75rem',
                                                                                backgroundColor: isBelowVendorMinimum ? 'var(--color-danger-bg)' : 'var(--bg-surface-hover)',
                                                                                borderRadius: 'var(--radius-sm)',
                                                                                border: `1px solid ${isBelowVendorMinimum ? 'var(--color-danger)' : 'var(--border-color)'}`,
                                                                                fontSize: '0.9rem',
                                                                                textAlign: 'center'
                                                                            }}>
                                                                                <strong style={{ color: isBelowVendorMinimum ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                                                                                    Total Items: {totalVendorQuantity} / Minimum: {vendorMinOrder}
                                                                                </strong>
                                                                                {isBelowVendorMinimum && (
                                                                                    <div style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: 'var(--color-danger)' }}>
                                                                                        Minimum order requirement not met
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                        
                                                                        <div className={styles.menuList}>
                                                                            {getVendorMenuItems(selection.vendorId).map(item => {
                                                                                const currentQty = selection.items?.[item.id] || 0;
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
                                                                                                min={0}
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
                                                                    </>
                                                                );
                                                            })()}

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
                    {hasCurrentWeekOrder && activeOrder && (
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
                                            {/* Order Details */}
                                            {isFood && order.vendorSelections && order.vendorSelections.length > 0 && (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                    {order.vendorSelections.map((vendorSelection: any, idx: number) => {
                                                        const vendor = vendors.find(v => v.id === vendorSelection.vendorId);
                                                        const vendorName = vendor?.name || 'Unknown Vendor';
                                                        const nextDelivery = getNextDeliveryDate(vendorSelection.vendorId);
                                                        const items = vendorSelection.items || {};

                                                        return (
                                                            <div key={idx} style={{ padding: 'var(--spacing-sm)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                {/* Vendor Header with Next Delivery Date */}
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-sm)' }}>
                                                                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{vendorName}</div>
                                                                    {nextDelivery && (
                                                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 500 }}>
                                                                            Next delivery date: {nextDelivery.dayOfWeek}, {nextDelivery.date}
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                {/* Items List */}
                                                                {Object.keys(items).length > 0 ? (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                                        {Object.entries(items).map(([itemId, quantity]) => {
                                                                            const item = menuItems.find(m => m.id === itemId);
                                                                            const itemName = item?.name || 'Unknown Item';
                                                                            const qty = Number(quantity) || 0;
                                                                            if (qty === 0) return null;

                                                                            return (
                                                                                <div key={itemId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', padding: '4px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>
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

                                            {isBoxes && order.boxTypeId && (
                                                <div style={{ padding: 'var(--spacing-sm)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                    {(() => {
                                                        const box = boxTypes.find(b => b.id === order.boxTypeId);
                                                        const boxVendorId = box?.vendorId;
                                                        const vendor = boxVendorId ? vendors.find(v => v.id === boxVendorId) : null;
                                                        const vendorName = vendor?.name || 'Unknown Vendor';
                                                        const boxName = box?.name || 'Unknown Box';
                                                        const nextDelivery = boxVendorId ? getNextDeliveryDate(boxVendorId) : null;

                                                        return (
                                                            <>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--spacing-sm)' }}>
                                                                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{vendorName}</div>
                                                                    {nextDelivery && (
                                                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-primary)', fontWeight: 500 }}>
                                                                            Next delivery date: {nextDelivery.dayOfWeek}, {nextDelivery.date}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                    {boxName} × {order.boxQuantity || 1}
                                                                </div>
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

                    <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                        <div className={styles.historyHeader}>
                            <h3 className={styles.sectionTitle}>Order History</h3>
                            <div className={styles.tabs}>
                                <button
                                    className={`${styles.tab} ${activeHistoryTab === 'deliveries' ? styles.activeTab : ''}`}
                                    onClick={() => setActiveHistoryTab('deliveries')}
                                >
                                    <ClipboardList size={14} /> Deliveries
                                </button>
                                <button
                                    className={`${styles.tab} ${activeHistoryTab === 'audit' ? styles.activeTab : ''}`}
                                    onClick={() => setActiveHistoryTab('audit')}
                                >
                                    <History size={14} /> Change Log ({orderHistory.length})
                                </button>
                                <button
                                    className={`${styles.tab} ${activeHistoryTab === 'billing' ? styles.activeTab : ''}`}
                                    onClick={() => setActiveHistoryTab('billing')}
                                >
                                    <CreditCard size={14} /> Billing ({billingHistory.length})
                                </button>
                            </div>
                        </div>

                        <div className={styles.historyList}>
                            {activeHistoryTab === 'deliveries' ? (
                                <>
                                    {history.map(record => (
                                        <div key={record.id} className={styles.item} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                                <span style={{ fontWeight: 500 }}>{new Date(record.deliveryDate).toLocaleDateString()}</span>
                                                <span className="badge">{record.serviceType}</span>
                                            </div>
                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{record.itemsSummary}</div>

                                            <div style={{ width: '100%', marginTop: '8px', paddingTop: '8px' }}>
                                                {record.proofOfDeliveryImage ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <Check size={16} color="var(--color-success)" />
                                                        <a href={record.proofOfDeliveryImage} target="_blank" style={{ color: 'var(--color-primary)', fontSize: '0.875rem' }}>
                                                            Proof Uploaded
                                                        </a>
                                                    </div>
                                                ) : (
                                                    <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                                                        <input
                                                            placeholder="Paste Proof URL & Enter..."
                                                            className="input"
                                                            style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                                                            onKeyDown={async (e) => {
                                                                if (e.key === 'Enter') {
                                                                    await updateDeliveryProof(record.id, (e.target as HTMLInputElement).value);
                                                                    // reload
                                                                    const h = await getClientHistory(clientId);
                                                                    setHistory(h);
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    {history.length === 0 && <div className={styles.empty}>No deliveries recorded yet.</div>}
                                </>
                            ) : activeHistoryTab === 'audit' ? (
                                <div className={styles.animateFadeIn}>
                                    {orderHistory.map((log, idx) => (
                                        <div key={log.id || idx} className={styles.item} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '16px', borderBottom: '1px solid var(--border-color)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <History size={14} color="var(--color-primary)" />
                                                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{log.who}</span>
                                                </div>
                                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                                                    {new Date(log.timestamp).toLocaleString('en-US', {
                                                        month: 'short',
                                                        day: 'numeric',
                                                        year: 'numeric',
                                                        hour: '2-digit',
                                                        minute: '2-digit'
                                                    })}
                                                </span>
                                            </div>
                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.5' }}>
                                                {log.summary}
                                            </div>
                                        </div>
                                    ))}
                                    {orderHistory.length === 0 && <div className={styles.empty}>No changes recorded yet.</div>}
                                </div>
                            ) : (
                                <div className={styles.animateFadeIn}>
                                    {billingHistory.length > 0 ? (
                                        <>
                                            {/* Show current billing record (most recent) */}
                                            <div className={styles.item} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '12px', padding: '16px', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface-hover)' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <CreditCard size={16} color="var(--color-primary)" />
                                                        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Current Billing Record</span>
                                                    </div>
                                                    <span className="badge" style={{
                                                        backgroundColor: billingHistory[0].status === 'request sent' ? 'var(--color-warning)' :
                                                            billingHistory[0].status === 'success' ? 'var(--color-success)' :
                                                            billingHistory[0].status === 'failed' ? 'var(--color-danger)' :
                                                            'var(--color-secondary)'
                                                    }}>
                                                        {billingHistory[0].status === 'request sent' ? 'REQUEST SENT' : billingHistory[0].status.toUpperCase()}
                                                    </span>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', width: '100%' }}>
                                                    <div>
                                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Amount</div>
                                                        <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-primary)' }}>
                                                            ${parseFloat(billingHistory[0].amount?.toString() || '0').toFixed(2)}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Date</div>
                                                        <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                                            {new Date(billingHistory[0].createdAt).toLocaleDateString('en-US', {
                                                                month: 'short',
                                                                day: 'numeric',
                                                                year: 'numeric'
                                                            })}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Navigator</div>
                                                        <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{billingHistory[0].navigator || 'Unassigned'}</div>
                                                    </div>
                                                    <div>
                                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Client</div>
                                                        <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>{billingHistory[0].clientName || 'Unknown'}</div>
                                                    </div>
                                                    {billingHistory[0].orderId && (
                                                        <div>
                                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Order ID</div>
                                                            <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                                                                {billingHistory[0].orderId.slice(0, 8)}...
                                                            </div>
                                                        </div>
                                                    )}
                                                    {billingHistory[0].deliveryDate && (
                                                        <div>
                                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Delivery Date</div>
                                                            <div style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                                                {new Date(billingHistory[0].deliveryDate).toLocaleDateString('en-US', {
                                                                    month: 'short',
                                                                    day: 'numeric',
                                                                    year: 'numeric'
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                {billingHistory[0].remarks && (
                                                    <div style={{ width: '100%', marginTop: '8px', paddingTop: '12px', borderTop: '1px solid var(--border-color)' }}>
                                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Remarks</div>
                                                        <div style={{ color: 'var(--text-primary)', fontSize: '0.875rem', lineHeight: '1.5' }}>
                                                            {billingHistory[0].remarks}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                            
                                            {/* Show all billing history if there are more records */}
                                            {billingHistory.length > 1 && (
                                                <>
                                                    <div style={{ marginTop: '16px', marginBottom: '8px', padding: '8px 0', borderTop: '2px solid var(--border-color)' }}>
                                                        <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>All Billing Records</span>
                                                    </div>
                                                    {billingHistory.slice(1).map((record, idx) => (
                                                        <div key={record.id || idx} className={styles.item} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px', padding: '12px', borderBottom: '1px solid var(--border-color)' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <span style={{ fontWeight: 500 }}>{new Date(record.createdAt).toLocaleDateString()}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                                    <span style={{ fontWeight: 600 }}>${parseFloat(record.amount?.toString() || '0').toFixed(2)}</span>
                                                                    <span className="badge" style={{
                                                                        backgroundColor: record.status === 'request sent' ? 'var(--color-warning)' :
                                                                            record.status === 'success' ? 'var(--color-success)' :
                                                                            record.status === 'failed' ? 'var(--color-danger)' :
                                                                            'var(--color-secondary)'
                                                                    }}>
                                                                        {record.status === 'request sent' ? 'REQUEST SENT' : record.status.toUpperCase()}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                                {record.orderId && (
                                                                    <div>
                                                                        <span style={{ fontWeight: 500 }}>Order ID: </span>
                                                                        <span style={{ fontFamily: 'monospace' }}>{record.orderId.slice(0, 8)}...</span>
                                                                    </div>
                                                                )}
                                                                {record.deliveryDate && (
                                                                    <div>
                                                                        <span style={{ fontWeight: 500 }}>Delivery Date: </span>
                                                                        <span>{new Date(record.deliveryDate).toLocaleDateString('en-US', {
                                                                            month: 'short',
                                                                            day: 'numeric',
                                                                            year: 'numeric'
                                                                        })}</span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {record.remarks && (
                                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{record.remarks}</div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                        </>
                                    ) : (
                                        <div className={styles.empty}>No billing records found.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </section>
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
