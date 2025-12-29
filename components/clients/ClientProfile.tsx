'use client';

import { useState, useEffect, Fragment, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ServiceType, AppSettings, DeliveryRecord, ItemCategory, BoxQuota, CompletedOrderWithDeliveryProof } from '@/lib/types';
import { updateClient, deleteClient, updateDeliveryProof, recordClientChange, getBoxQuotas, syncCurrentOrderToUpcoming } from '@/lib/actions';
import { getClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getSettings, getCategories, getClients, invalidateClientData, invalidateReferenceData, getActiveOrderForClient, getUpcomingOrderForClient, getOrderHistory, getClientHistory, getBillingHistory, getCompletedOrdersWithDeliveryProof, invalidateOrderData } from '@/lib/cached-data';
import { Save, ArrowLeft, Truck, Package, AlertTriangle, Upload, Trash2, Plus, Check, ClipboardList, History, CreditCard, Calendar, ChevronDown, ChevronUp, ShoppingCart, Image } from 'lucide-react';
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
    const [completedOrdersWithDeliveryProof, setCompletedOrdersWithDeliveryProof] = useState<CompletedOrderWithDeliveryProof[]>([]);
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
            let configToSet: any = {};
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
                configToSet = upcomingOrderData;
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

            const [h, oh, bh, completedOrders] = await Promise.all([
                getClientHistory(clientId),
                getOrderHistory(clientId),
                getBillingHistory(clientId),
                getCompletedOrdersWithDeliveryProof(clientId)
            ]);
            setHistory(h);
            setOrderHistory(oh);
            setBillingHistory(bh);
            setCompletedOrdersWithDeliveryProof(completedOrders);
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
                    const configChanged = 
                        existingUpcomingOrder.caseId !== caseId ||
                        existingUpcomingOrder.serviceType !== serviceType ||
                        JSON.stringify(existingUpcomingOrder.vendorSelections || []) !== JSON.stringify(vendorSelections) ||
                        existingUpcomingOrder.vendorId !== vendorId ||
                        existingUpcomingOrder.boxTypeId !== boxTypeId ||
                        existingUpcomingOrder.boxQuantity !== boxQuantity ||
                        JSON.stringify(existingUpcomingOrder.items || {}) !== JSON.stringify(items) ||
                        JSON.stringify((existingUpcomingOrder as any).itemPrices || {}) !== JSON.stringify(itemPrices);
                    
                    if (configChanged) {
                        needsSave = true;
                    }
                }

                if (needsSave) {
                    // Ensure structure is correct
                    const cleanedOrderConfig = { ...orderConfig };
                    if (serviceType === 'Food') {
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
                invalidateOrderData(clientId); // Invalidate order cache after sync
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

    // Calculate total for a single item (quantity × priceEach)
    function getItemTotal(itemId: string, quantity: number): number {
        const item = menuItems.find(i => i.id === itemId);
        if (!item || item.priceEach === undefined) return 0;
        return item.priceEach * quantity;
    }

    // Calculate total for a vendor selection
    function getVendorSelectionTotal(selection: any): number {
        if (!selection.items) return 0;
        let total = 0;
        for (const [itemId, qty] of Object.entries(selection.items)) {
            total += getItemTotal(itemId, qty as number);
        }
        return total;
    }

    // Calculate overall total from all vendor selections
    function getOverallTotal(vendorSelections: any[]): number {
        if (!vendorSelections || vendorSelections.length === 0) return 0;
        let total = 0;
        for (const selection of vendorSelections) {
            total += getVendorSelectionTotal(selection);
        }
        return total;
    }

    // Calculate total for a single box item (quantity × price)
    function getBoxItemTotal(itemId: string, quantity: number): number {
        const itemPrices = orderConfig.itemPrices || {};
        let price = itemPrices[itemId];
        // Fallback to menu item's priceEach if no custom price is set
        if (price === undefined || price === null) {
            const item = menuItems.find(i => i.id === itemId);
            price = item?.priceEach;
        }
        if (price === undefined || price === null) return 0;
        return price * quantity;
    }

    // Calculate overall box total from all box items
    function getBoxItemsTotal(): number {
        const items = orderConfig.items || {};
        const itemPrices = orderConfig.itemPrices || {};
        let total = 0;
        for (const [itemId, qty] of Object.entries(items)) {
            const quantity = typeof qty === 'number' ? qty : 0;
            let price = itemPrices[itemId];
            // Fallback to menu item's priceEach if no custom price is set
            if (price === undefined || price === null) {
                const item = menuItems.find(i => i.id === itemId);
                price = item?.priceEach;
            }
            if (price !== undefined && price !== null && quantity > 0) {
                total += price * quantity;
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
        const itemPrices = orderConfig.itemPrices || {};

        // Validate that items with quantity have prices set in admin config
        Object.entries(selectedItems).forEach(([itemId, qty]) => {
            const quantity = qty as number;
            if (quantity > 0) {
                const item = menuItems.find(i => i.id === itemId);
                const hasPrice = item?.priceEach !== undefined && item?.priceEach !== null && item.priceEach > 0;
                
                if (!hasPrice) {
                    const itemName = item?.name || 'Unknown Item';
                    allValid = false;
                    summary.push(`${itemName}: Price must be set in admin config when quantity is set.`);
                }
            }
        });

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
        const currentPrices = { ...(orderConfig.itemPrices || {}) };
        
        if (qty > 0) {
            currentItems[itemId] = qty;
            // Always set price from menu item's priceEach (readonly from admin config)
            const item = menuItems.find(i => i.id === itemId);
            if (item && item.priceEach !== undefined && item.priceEach !== null) {
                currentPrices[itemId] = item.priceEach;
            }
        } else {
            delete currentItems[itemId];
            // Also remove price when quantity is removed
            delete currentPrices[itemId];
            setOrderConfig({ ...orderConfig, items: currentItems, itemPrices: currentPrices });
            return;
        }
        setOrderConfig({ ...orderConfig, items: currentItems, itemPrices: currentPrices });
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

    // Helper function to detect order configuration changes
    function detectOrderConfigChanges(oldConfig: any, newConfig: any): string[] {
        const changes: string[] = [];
        
        if (!oldConfig && !newConfig) return changes;
        if (!oldConfig && newConfig) {
            changes.push('Order configuration created');
            return changes;
        }
        if (oldConfig && !newConfig) {
            changes.push('Order configuration removed');
            return changes;
        }

        // Compare service type
        if (oldConfig.serviceType !== newConfig.serviceType) {
            changes.push(`Order Service Type: "${oldConfig.serviceType || 'None'}" -> "${newConfig.serviceType || 'None'}"`);
        }

        // Compare Food order configurations
        if (newConfig.serviceType === 'Food' || oldConfig.serviceType === 'Food') {
            const oldSelections = oldConfig.vendorSelections || [];
            const newSelections = newConfig.vendorSelections || [];
            
            // Compare vendor selections
            const oldVendorIds = new Set<string>(oldSelections.map((s: any) => s.vendorId).filter((id: string) => id));
            const newVendorIds = new Set<string>(newSelections.map((s: any) => s.vendorId).filter((id: string) => id));
            
            // Check for added/removed vendors
            newVendorIds.forEach((vendorId) => {
                if (!oldVendorIds.has(vendorId)) {
                    const vendor = vendors.find(v => v.id === vendorId);
                    changes.push(`Vendor added: ${vendor?.name || vendorId}`);
                }
            });
            oldVendorIds.forEach((vendorId) => {
                if (!newVendorIds.has(vendorId)) {
                    const vendor = vendors.find(v => v.id === vendorId);
                    changes.push(`Vendor removed: ${vendor?.name || vendorId}`);
                }
            });
            
            // Compare item quantities for each vendor
            oldSelections.forEach((oldSel: any) => {
                if (!oldSel.vendorId) return;
                const newSel = newSelections.find((s: any) => s.vendorId === oldSel.vendorId);
                const vendor = vendors.find(v => v.id === oldSel.vendorId);
                const vendorName = vendor?.name || oldSel.vendorId;
                
                if (!newSel) return; // Already handled as removed vendor
                
                const oldItems = oldSel.items || {};
                const newItems = newSel.items || {};
                const allItemIds = new Set([...Object.keys(oldItems), ...Object.keys(newItems)]);
                
                allItemIds.forEach((itemId: string) => {
                    const oldQty = oldItems[itemId] || 0;
                    const newQty = newItems[itemId] || 0;
                    if (oldQty !== newQty) {
                        const item = menuItems.find(m => m.id === itemId);
                        const itemName = item?.name || itemId;
                        changes.push(`${vendorName} - ${itemName}: ${oldQty} -> ${newQty}`);
                    }
                });
            });
            
            // Check for new vendors with items
            newSelections.forEach((newSel: any) => {
                if (!newSel.vendorId) return;
                if (!oldVendorIds.has(newSel.vendorId)) {
                    // New vendor, check if it has items
                    const items = Object.entries(newSel.items || {}).filter(([_, qty]) => (qty as number) > 0);
                    if (items.length > 0) {
                        const vendor = vendors.find(v => v.id === newSel.vendorId);
                        const vendorName = vendor?.name || newSel.vendorId;
                        items.forEach(([itemId, qty]) => {
                            const item = menuItems.find(m => m.id === itemId);
                            const itemName = item?.name || itemId;
                            changes.push(`${vendorName} - ${itemName}: 0 -> ${qty}`);
                        });
                    }
                }
            });
        }

        // Compare Box order configurations
        if (newConfig.serviceType === 'Boxes' || oldConfig.serviceType === 'Boxes') {
            if (oldConfig.boxTypeId !== newConfig.boxTypeId) {
                const oldBoxType = boxTypes.find(b => b.id === oldConfig.boxTypeId);
                const newBoxType = boxTypes.find(b => b.id === newConfig.boxTypeId);
                changes.push(`Box Type: "${oldBoxType?.name || oldConfig.boxTypeId || 'None'}" -> "${newBoxType?.name || newConfig.boxTypeId || 'None'}"`);
            }
            if (oldConfig.boxQuantity !== newConfig.boxQuantity) {
                changes.push(`Box Quantity: ${oldConfig.boxQuantity || 0} -> ${newConfig.boxQuantity || 0}`);
            }
            if (oldConfig.vendorId !== newConfig.vendorId) {
                const oldVendor = vendors.find(v => v.id === oldConfig.vendorId);
                const newVendor = vendors.find(v => v.id === newConfig.vendorId);
                changes.push(`Box Vendor: "${oldVendor?.name || oldConfig.vendorId || 'None'}" -> "${newVendor?.name || newConfig.vendorId || 'None'}"`);
            }
        }

        // Compare delivery distribution
        const oldDist = oldConfig.deliveryDistribution || {};
        const newDist = newConfig.deliveryDistribution || {};
        const distChanged = JSON.stringify(oldDist) !== JSON.stringify(newDist);
        if (distChanged) {
            changes.push('Delivery distribution changed');
        }

        return changes;
    }

    async function handleSave(): Promise<boolean> {
        if (!client) return false;

        const validation = validateOrder();
        if (!validation.isValid) {
            setValidationError({ show: true, messages: validation.messages });
            return false;
        }

        setSaving(true);

        // -- Change Detection for Client Profile Fields --
        const changes: string[] = [];
        
        // Basic client information
        if (client.fullName !== formData.fullName) changes.push(`Full Name: "${client.fullName}" -> "${formData.fullName}"`);
        if (client.address !== formData.address) changes.push(`Address: "${client.address}" -> "${formData.address}"`);
        if (client.email !== formData.email) changes.push(`Email: "${client.email || '(empty)'}" -> "${formData.email || '(empty)'}"`);
        if (client.phoneNumber !== formData.phoneNumber) changes.push(`Phone: "${client.phoneNumber}" -> "${formData.phoneNumber}"`);
        
        // Dates
        if (client.endDate !== formData.endDate) {
            const oldDate = client.endDate ? new Date(client.endDate).toLocaleDateString() : 'None';
            const newDate = formData.endDate ? new Date(formData.endDate).toLocaleDateString() : 'None';
            changes.push(`End Date: "${oldDate}" -> "${newDate}"`);
        }
        
        // Notes
        if (client.notes !== formData.notes) {
            const oldNotesPreview = client.notes ? (client.notes.length > 50 ? client.notes.substring(0, 50) + '...' : client.notes) : '(empty)';
            const newNotesPreview = formData.notes ? (formData.notes.length > 50 ? formData.notes.substring(0, 50) + '...' : formData.notes) : '(empty)';
            changes.push(`Notes: "${oldNotesPreview}" -> "${newNotesPreview}"`);
        }
        
        // Status and Navigator
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
        
        // Service type and food-specific
        if (client.serviceType !== formData.serviceType) changes.push(`Service Type: "${client.serviceType}" -> "${formData.serviceType}"`);
        if (client.approvedMealsPerWeek !== formData.approvedMealsPerWeek) changes.push(`Approved Meals: ${client.approvedMealsPerWeek || 0} -> ${formData.approvedMealsPerWeek || 0}`);
        
        // Screening fields
        if (client.screeningTookPlace !== formData.screeningTookPlace) changes.push(`Screening Took Place: ${client.screeningTookPlace} -> ${formData.screeningTookPlace}`);
        if (client.screeningSigned !== formData.screeningSigned) changes.push(`Screening Signed: ${client.screeningSigned} -> ${formData.screeningSigned}`);

        // -- Change Detection for Order Configuration --
        const orderConfigChanges = detectOrderConfigChanges(originalOrderConfig, orderConfig);
        changes.push(...orderConfigChanges);

        // Only update and record changes if there are actual changes
        if (changes.length === 0) {
            // No changes detected, don't update anything or save to order history
            setSaving(false);
            setMessage('No changes detected. Nothing was saved.');
            setTimeout(() => setMessage(null), 3000);
            return true;
        }

        const summary = changes.join(', ');

        // Update client profile (without activeOrder - that comes from orders table)
        const updateData: Partial<ClientProfile> = {
            ...formData
        };

        await updateClient(clientId, updateData);
        invalidateClientData(clientId); // Invalidate cache for this client
        invalidateClientData(); // Also invalidate client list cache
        await recordClientChange(clientId, summary);
        invalidateOrderData(clientId); // Invalidate order history cache after recording change

        // Sync Current Order Request to upcoming_orders table
        // Sync if order config exists and has a caseId
        const hasOrderChanges = orderConfig && orderConfig.caseId;
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
            invalidateOrderData(clientId); // Invalidate order cache after sync
            
            // Reload upcoming order to reflect changes
            const updatedUpcomingOrder = await getUpcomingOrderForClient(clientId);
            if (updatedUpcomingOrder) {
                setOrderConfig(updatedUpcomingOrder);
                setOriginalOrderConfig(JSON.parse(JSON.stringify(updatedUpcomingOrder))); // Update original for future comparisons
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

    const toggleBillingRow = (id: string) => {
        const newExpanded = new Set(expandedBillingRows);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedBillingRows(newExpanded);
    };

    const renderOrderDetails = (orderDetails: any) => {
        if (!orderDetails) return null;

        if (orderDetails.serviceType === 'Food' && orderDetails.vendorSelections) {
            // Calculate total from all items instead of using orderDetails.totalValue
            const calculatedTotal = orderDetails.vendorSelections.reduce((sum: number, vs: any) => {
                return sum + (vs.items || []).reduce((itemSum: number, item: any) => {
                    return itemSum + (item.totalValue || 0);
                }, 0);
            }, 0);
            
            // Calculate total items count
            const calculatedTotalItems = orderDetails.vendorSelections.reduce((sum: number, vs: any) => {
                return sum + (vs.items || []).reduce((itemSum: number, item: any) => {
                    return itemSum + (item.quantity || 0);
                }, 0);
            }, 0);
            
            return (
                <div style={{ padding: '12px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', marginTop: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.9rem', marginBottom: '12px', color: 'var(--text-primary)' }}>
                        <ShoppingCart size={16} />
                        <span>Order Items</span>
                    </div>
                    {orderDetails.vendorSelections.map((vs: any, idx: number) => (
                        <div key={idx} style={{ marginBottom: '12px', padding: '8px', background: 'var(--bg-surface-hover)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                            <div style={{ fontWeight: 500, marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid var(--border-color)', fontSize: '0.875rem' }}>
                                <strong>Vendor:</strong> {vs.vendorName}
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
                                <thead>
                                    <tr style={{ background: 'var(--bg-surface)' }}>
                                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Item</th>
                                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Quantity</th>
                                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Unit Value</th>
                                        <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vs.items.map((item: any, itemIdx: number) => (
                                        <tr key={itemIdx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>{item.menuItemName}</td>
                                            <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>{item.quantity}</td>
                                            <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>${item.unitValue.toFixed(2)}</td>
                                            <td style={{ padding: '6px 8px', color: 'var(--text-primary)' }}>${item.totalValue.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', paddingTop: '12px', borderTop: '2px solid var(--border-color)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                        <div><strong>Total Items:</strong> {calculatedTotalItems}</div>
                        <div><strong>Total Value:</strong> ${calculatedTotal.toFixed(2)}</div>
                    </div>
                </div>
            );
        } else if (orderDetails.serviceType === 'Boxes') {
            return (
                <div style={{ padding: '12px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', marginTop: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, fontSize: '0.9rem', marginBottom: '12px', color: 'var(--text-primary)' }}>
                        <Package size={16} />
                        <span>Box Order Details</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                        <div><strong>Vendor:</strong> {orderDetails.vendorName}</div>
                        <div><strong>Box Type:</strong> {orderDetails.boxTypeName}</div>
                        <div><strong>Quantity:</strong> {orderDetails.boxQuantity}</div>
                        <div><strong>Total Value:</strong> ${orderDetails.totalValue.toFixed(2)}</div>
                    </div>
                </div>
            );
        } else {
            return (
                <div style={{ padding: '12px', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', marginTop: '8px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '12px', color: 'var(--text-primary)' }}>
                        <span>Order Details</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                        <div><strong>Service Type:</strong> {orderDetails.serviceType}</div>
                        {orderDetails.totalValue && (
                            <div><strong>Total Value:</strong> ${orderDetails.totalValue.toFixed(2)}</div>
                        )}
                        {orderDetails.notes && (
                            <div><strong>Notes:</strong> {orderDetails.notes}</div>
                        )}
                    </div>
                </div>
            );
        }
    };

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
                                                                                const itemTotal = item.priceEach !== undefined ? getItemTotal(item.id, currentQty) : 0;
                                                                                return (
                                                                                    <div key={item.id} className={styles.menuItem}>
                                                                                        <div className={styles.itemInfo}>
                                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                                                <span>{item.name}</span>
                                                                                                <div style={{ display: 'flex', gap: '12px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                                                    {item.priceEach !== undefined && (
                                                                                                        <>
                                                                                                            <span className={styles.itemValue}>Price: ${item.priceEach.toFixed(2)}</span>
                                                                                                            {currentQty > 0 && itemTotal > 0 && (
                                                                                                                <span className={styles.itemValue} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                                                                                                    Total: ${itemTotal.toFixed(2)}
                                                                                                                </span>
                                                                                                            )}
                                                                                                        </>
                                                                                                    )}
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
                                                                        
                                                                        {/* Vendor Total (Price-based only) */}
                                                                        {(() => {
                                                                            const vendorTotal = getVendorSelectionTotal(selection);
                                                                            if (vendorTotal > 0) {
                                                                                return (
                                                                                    <div style={{
                                                                                        marginTop: 'var(--spacing-md)',
                                                                                        padding: '0.75rem',
                                                                                        backgroundColor: 'var(--bg-surface)',
                                                                                        borderRadius: 'var(--radius-sm)',
                                                                                        border: '1px solid var(--border-color)',
                                                                                        fontSize: '0.9rem',
                                                                                        textAlign: 'center',
                                                                                        fontWeight: 600,
                                                                                        color: 'var(--text-primary)'
                                                                                    }}>
                                                                                        Vendor Total (Price): ${vendorTotal.toFixed(2)}
                                                                                    </div>
                                                                                );
                                                                            }
                                                                            return null;
                                                                        })()}
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

                                            {/* Overall Total for Current Order Request */}
                                            {(() => {
                                                const overallTotal = getOverallTotal(orderConfig.vendorSelections || []);
                                                if (overallTotal > 0) {
                                                    return (
                                                        <div style={{
                                                            marginTop: 'var(--spacing-lg)',
                                                            padding: '1rem',
                                                            backgroundColor: 'var(--color-primary-bg)',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: '2px solid var(--color-primary)',
                                                            fontSize: '1rem',
                                                            textAlign: 'center',
                                                            fontWeight: 700,
                                                            color: 'var(--color-primary)'
                                                        }}>
                                                            Overall Total: ${overallTotal.toFixed(2)}
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}

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

                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                                {availableItems.map(item => {
                                                                    const selectedItems = orderConfig.items || {};
                                                                    const currentQty = selectedItems[item.id] || 0;
                                                                    // Always use menu item's priceEach (readonly from admin config)
                                                                    const itemPrice = item.priceEach !== undefined && item.priceEach !== null ? item.priceEach : 0;
                                                                    const itemTotal = itemPrice > 0 && currentQty > 0 ? itemPrice * currentQty : 0;
                                                                    const hasQtyButNoPrice = currentQty > 0 && itemPrice === 0;
                                                                    
                                                                    return (
                                                                        <div key={item.id} style={{ 
                                                                            display: 'flex', 
                                                                            alignItems: 'center', 
                                                                            justifyContent: 'space-between', 
                                                                            gap: '0.5rem', 
                                                                            background: hasQtyButNoPrice ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-app)', 
                                                                            padding: '6px 10px', 
                                                                            borderRadius: '4px', 
                                                                            border: hasQtyButNoPrice ? '1px solid rgba(239, 68, 68, 0.5)' : '1px solid var(--border-color)' 
                                                                        }}>
                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                                                                                <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>{item.name} <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}>({item.quotaValue || 1})</span></span>
                                                                                {hasQtyButNoPrice && (
                                                                                    <span style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 500 }}>
                                                                                        ⚠ Price not set in admin config
                                                                                    </span>
                                                                                )}
                                                                                {currentQty > 0 && itemTotal > 0 && (
                                                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                                                                        Total: ${itemTotal.toFixed(2)}
                                                                                    </span>
                                                                                )}
                                                                            </div>
                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
                                                                                    <label style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Price</label>
                                                                                    <span style={{ 
                                                                                        fontSize: '0.85rem', 
                                                                                        fontWeight: 500, 
                                                                                        color: hasQtyButNoPrice ? '#ef4444' : 'var(--text-primary)',
                                                                                        minWidth: '60px',
                                                                                        textAlign: 'right'
                                                                                    }}>
                                                                                        {itemPrice > 0 ? `$${itemPrice.toFixed(2)}` : 'N/A'}
                                                                                    </span>
                                                                                </div>
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                                    <label style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Qty</label>
                                                                                    <input
                                                                                        type="number"
                                                                                        min="0"
                                                                                        style={{ width: '50px', padding: '4px', fontSize: '0.8rem', textAlign: 'center' }}
                                                                                        value={currentQty || ''}
                                                                                        placeholder="0"
                                                                                        onChange={e => handleBoxItemChange(item.id, Number(e.target.value) || 0)}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                                {availableItems.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>No items available.</span>}
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
                                                        const vendorTotal = getVendorSelectionTotal(vendorSelection);

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
                                                                            const itemTotal = getItemTotal(itemId, qty);
                                                                            const itemPrice = item?.priceEach;

                                                                            return (
                                                                                <div key={itemId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', padding: '4px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>
                                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                                        <span>{itemName}</span>
                                                                                        {itemPrice !== undefined && (
                                                                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                                                                                ${itemPrice.toFixed(2)} each
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                                                                        <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Qty: {qty}</span>
                                                                                        {itemTotal > 0 && (
                                                                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                                                                                                ${itemTotal.toFixed(2)}
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {/* Vendor Total */}
                                                                        {vendorTotal > 0 && (
                                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', padding: '8px', marginTop: '4px', backgroundColor: 'var(--bg-app)', borderRadius: '4px', borderTop: '1px solid var(--border-color)', fontWeight: 600 }}>
                                                                                <span>Total ({vendorName}):</span>
                                                                                <span style={{ color: 'var(--color-primary)', fontSize: '0.95rem' }}>${vendorTotal.toFixed(2)}</span>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '4px' }}>
                                                                        No items selected
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                    
                                                    {/* Overall Total for This Week's Order */}
                                                    {(() => {
                                                        const overallTotal = getOverallTotal(order.vendorSelections || []);
                                                        if (overallTotal > 0) {
                                                            return (
                                                                <div style={{
                                                                    marginTop: 'var(--spacing-lg)',
                                                                    padding: '1rem',
                                                                    backgroundColor: 'var(--color-primary-bg)',
                                                                    borderRadius: 'var(--radius-md)',
                                                                    border: '2px solid var(--color-primary)',
                                                                    fontSize: '1rem',
                                                                    textAlign: 'center',
                                                                    fontWeight: 700,
                                                                    color: 'var(--color-primary)'
                                                                }}>
                                                                    Overall Total: ${overallTotal.toFixed(2)}
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
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
                                                        const boxItems = (order as any).items || {};
                                                        const boxItemPrices = (order as any).itemPrices || {};

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
                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 'var(--spacing-sm)' }}>
                                                                    {boxName} × {order.boxQuantity || 1}
                                                                </div>
                                                                
                                                                {/* Box Items List */}
                                                                {Object.keys(boxItems).length > 0 ? (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: 'var(--spacing-sm)' }}>
                                                                        {Object.entries(boxItems).map(([itemId, quantity]) => {
                                                                            const item = menuItems.find(m => m.id === itemId);
                                                                            const itemName = item?.name || 'Unknown Item';
                                                                            const qty = Number(quantity) || 0;
                                                                            if (qty === 0) return null;
                                                                            const itemPrice = boxItemPrices[itemId];
                                                                            const itemTotal = itemPrice !== undefined && itemPrice !== null ? itemPrice * qty : 0;

                                                                            return (
                                                                                <div key={itemId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', padding: '4px 8px', backgroundColor: 'var(--bg-app)', borderRadius: '4px' }}>
                                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                                                        <span>{itemName}</span>
                                                                                        {itemPrice !== undefined && itemPrice !== null && (
                                                                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                                                                                ${itemPrice.toFixed(2)} each
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                                                                        <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>Qty: {qty}</span>
                                                                                        {itemTotal > 0 && (
                                                                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.875rem' }}>
                                                                                                ${itemTotal.toFixed(2)}
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {/* Box Total */}
                                                                        {(() => {
                                                                            const boxTotal = Object.entries(boxItems).reduce((sum, [itemId, qty]) => {
                                                                                const quantity = typeof qty === 'number' ? qty : 0;
                                                                                const price = boxItemPrices[itemId];
                                                                                if (price !== undefined && price !== null && quantity > 0) {
                                                                                    return sum + (price * quantity);
                                                                                }
                                                                                return sum;
                                                                            }, 0);
                                                                            if (boxTotal > 0) {
                                                                                return (
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.9rem', padding: '8px', marginTop: '4px', backgroundColor: 'var(--bg-app)', borderRadius: '4px', borderTop: '1px solid var(--border-color)', fontWeight: 600 }}>
                                                                                        <span>Box Total:</span>
                                                                                        <span style={{ color: 'var(--color-primary)', fontSize: '0.95rem' }}>${boxTotal.toFixed(2)}</span>
                                                                                    </div>
                                                                                );
                                                                            }
                                                                            return null;
                                                                        })()}
                                                                    </div>
                                                                ) : null}
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
                                <div className={styles.animateFadeIn}>
                                    {completedOrdersWithDeliveryProof.length > 0 ? (
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--bg-surface-hover)', borderBottom: '2px solid var(--border-color)' }}>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Order ID</th>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Order Date</th>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Delivery Date</th>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Service Type</th>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Total Amount</th>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Order Items</th>
                                                        <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem', width: '200px' }}>Delivery Proof</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {completedOrdersWithDeliveryProof.map((order) => {
                                                        const deliveryDate = order.actualDeliveryDate || order.scheduledDeliveryDate;
                                                        const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-US', {
                                                            month: 'short',
                                                            day: 'numeric',
                                                            year: 'numeric'
                                                        }) : 'N/A';
                                                        const formattedDeliveryDate = deliveryDate ? new Date(deliveryDate).toLocaleDateString('en-US', {
                                                            month: 'short',
                                                            day: 'numeric',
                                                            year: 'numeric'
                                                        }) : 'N/A';
                                                        
                                                        // Format order items summary
                                                        const formatOrderItems = () => {
                                                            if (!order.orderDetails) return 'N/A';
                                                            
                                                            if (order.orderDetails.serviceType === 'Food' && order.orderDetails.vendorSelections) {
                                                                const items: string[] = [];
                                                                order.orderDetails.vendorSelections.forEach((vs: any) => {
                                                                    vs.items.forEach((item: any) => {
                                                                        items.push(`${item.menuItemName} (x${item.quantity})`);
                                                                    });
                                                                });
                                                                return items.length > 0 ? items.join(', ') : 'No items';
                                                            } else if (order.orderDetails.serviceType === 'Boxes' && order.orderDetails.boxTypeName) {
                                                                return `${order.orderDetails.boxTypeName} x${order.orderDetails.boxQuantity || 0}`;
                                                            }
                                                            return 'N/A';
                                                        };
                                                        
                                                        return (
                                                            <tr 
                                                                key={order.id}
                                                                style={{
                                                                    borderBottom: '1px solid var(--border-color)',
                                                                    transition: 'background-color 0.2s'
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.currentTarget.style.backgroundColor = '';
                                                                }}
                                                            >
                                                                <td style={{ padding: '12px', color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                                                                    {order.id.slice(0, 8)}...
                                                                </td>
                                                                <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{orderDate}</td>
                                                                <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{formattedDeliveryDate}</td>
                                                                <td style={{ padding: '12px' }}>
                                                                    <span className="badge" style={{
                                                                        fontSize: '0.75rem',
                                                                        padding: '4px 8px',
                                                                        borderRadius: '4px',
                                                                        fontWeight: 600,
                                                                        backgroundColor: 'var(--color-secondary)',
                                                                        color: 'white'
                                                                    }}>
                                                                        {order.serviceType}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>
                                                                    ${parseFloat((order.totalValue || 0).toString()).toFixed(2)}
                                                                </td>
                                                                <td style={{ padding: '12px', color: 'var(--text-secondary)', fontSize: '0.875rem', maxWidth: '300px' }}>
                                                                    <div style={{ 
                                                                        overflow: 'hidden', 
                                                                        textOverflow: 'ellipsis', 
                                                                        whiteSpace: 'nowrap',
                                                                        cursor: 'default'
                                                                    }} title={formatOrderItems()}>
                                                                        {formatOrderItems()}
                                                                    </div>
                                                                </td>
                                                                <td style={{ padding: '12px', textAlign: 'center' }}>
                                                                    {order.deliveryProofUrl ? (
                                                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                                                                            <a 
                                                                                href={order.deliveryProofUrl} 
                                                                                target="_blank" 
                                                                                rel="noopener noreferrer"
                                                                                style={{ 
                                                                                    display: 'inline-block',
                                                                                    color: 'var(--color-primary)', 
                                                                                    fontSize: '0.875rem',
                                                                                    textDecoration: 'none'
                                                                                }}
                                                                                onMouseEnter={(e) => {
                                                                                    e.currentTarget.style.textDecoration = 'underline';
                                                                                }}
                                                                                onMouseLeave={(e) => {
                                                                                    e.currentTarget.style.textDecoration = 'none';
                                                                                }}
                                                                            >
                                                                                <Image size={16} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                                                                View Image
                                                                            </a>
                                                                            <img 
                                                                                src={order.deliveryProofUrl} 
                                                                                alt="Delivery proof" 
                                                                                style={{
                                                                                    maxWidth: '150px',
                                                                                    maxHeight: '100px',
                                                                                    objectFit: 'contain',
                                                                                    border: '1px solid var(--border-color)',
                                                                                    borderRadius: '4px',
                                                                                    cursor: 'pointer'
                                                                                }}
                                                                                onClick={() => window.open(order.deliveryProofUrl, '_blank')}
                                                                                onError={(e) => {
                                                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    ) : (
                                                                        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>-</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div className={styles.empty}>No completed orders with delivery proof found.</div>
                                    )}
                                </div>
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
                                        <div style={{ overflowX: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                                <thead>
                                                    <tr style={{ background: 'var(--bg-surface-hover)', borderBottom: '2px solid var(--border-color)' }}>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Date</th>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Amount</th>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Status</th>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Navigator</th>
                                                        <th style={{ textAlign: 'left', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Remarks</th>
                                                        <th style={{ textAlign: 'center', padding: '12px', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.875rem', width: '80px' }}>Details</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {billingHistory.map((record) => {
                                                        const isExpanded = expandedBillingRows.has(record.id);
                                                        const hasOrderDetails = !!record.orderDetails;
                                                        const date = record.createdAt ? new Date(record.createdAt).toLocaleDateString('en-US', {
                                                            month: 'short',
                                                            day: 'numeric',
                                                            year: 'numeric'
                                                        }) : 'N/A';
                                                        
                                                        return (
                                                            <Fragment key={record.id}>
                                                                <tr 
                                                                    onClick={() => hasOrderDetails && toggleBillingRow(record.id)}
                                                                    style={{
                                                                        cursor: hasOrderDetails ? 'pointer' : 'default',
                                                                        borderBottom: '1px solid var(--border-color)',
                                                                        transition: 'background-color 0.2s'
                                                                    }}
                                                                    onMouseEnter={(e) => {
                                                                        if (hasOrderDetails) {
                                                                            e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                                                        }
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        e.currentTarget.style.backgroundColor = '';
                                                                    }}
                                                                >
                                                                    <td style={{ padding: '12px', color: 'var(--text-primary)' }}>{date}</td>
                                                                    <td style={{ padding: '12px', color: 'var(--text-primary)', fontWeight: 600 }}>
                                                                        ${parseFloat(record.amount?.toString() || '0').toFixed(2)}
                                                                    </td>
                                                                    <td style={{ padding: '12px' }}>
                                                                        <span className="badge" style={{
                                                                            backgroundColor: record.status === 'request sent' ? 'var(--color-warning)' :
                                                                                record.status === 'success' ? 'var(--color-success)' :
                                                                                record.status === 'failed' ? 'var(--color-danger)' :
                                                                                'var(--color-secondary)',
                                                                            fontSize: '0.75rem',
                                                                            padding: '4px 8px',
                                                                            borderRadius: '4px',
                                                                            fontWeight: 600
                                                                        }}>
                                                                            {record.status === 'request sent' ? 'REQUEST SENT' : record.status.toUpperCase()}
                                                                        </span>
                                                                    </td>
                                                                    <td style={{ padding: '12px', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                                                                        {record.navigator || 'Unassigned'}
                                                                    </td>
                                                                    <td style={{ padding: '12px', color: 'var(--text-secondary)', fontSize: '0.875rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {record.remarks || '-'}
                                                                    </td>
                                                                    <td style={{ padding: '12px', textAlign: 'center' }}>
                                                                        {hasOrderDetails ? (
                                                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', color: 'var(--color-primary)' }}>
                                                                                {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                                            </div>
                                                                        ) : (
                                                                            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>-</span>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                                {isExpanded && hasOrderDetails && (
                                                                    <tr>
                                                                        <td colSpan={6} style={{ padding: '0', background: 'var(--bg-surface-hover)' }}>
                                                                            <div style={{ padding: '16px', borderTop: '2px solid var(--border-color)' }}>
                                                                                <div style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid var(--border-color)' }}>
                                                                                    <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                        <CreditCard size={16} />
                                                                                        Billing Details
                                                                                    </h4>
                                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', fontSize: '0.875rem' }}>
                                                                                        <div>
                                                                                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Client</div>
                                                                                            <div style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{record.clientName || 'Unknown'}</div>
                                                                                        </div>
                                                                                        {record.orderId && (
                                                                                            <div>
                                                                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Order ID</div>
                                                                                                <div style={{ color: 'var(--text-primary)', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                                                                                                    {record.orderId.slice(0, 8)}...
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
                                                                                        {record.deliveryDate && (
                                                                                            <div>
                                                                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Delivery Date</div>
                                                                                                <div style={{ color: 'var(--text-primary)' }}>
                                                                                                    {new Date(record.deliveryDate).toLocaleDateString('en-US', {
                                                                                                        month: 'short',
                                                                                                        day: 'numeric',
                                                                                                        year: 'numeric'
                                                                                                    })}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
                                                                                        {record.remarks && (
                                                                                            <div style={{ gridColumn: '1 / -1' }}>
                                                                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '4px' }}>Remarks</div>
                                                                                                <div style={{ color: 'var(--text-primary)' }}>{record.remarks}</div>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                                {renderOrderDetails(record.orderDetails)}
                                                                            </div>
                                                                        </td>
                                                                    </tr>
                                                                )}
                                                            </Fragment>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
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
