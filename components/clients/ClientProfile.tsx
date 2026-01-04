'use client';

import { useState, useEffect, Fragment, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ServiceType, AppSettings, DeliveryRecord, ItemCategory, ClientFullDetails, BoxQuota } from '@/lib/types';
import { updateClient, addClient, deleteClient, updateDeliveryProof, recordClientChange, syncCurrentOrderToUpcoming, logNavigatorAction, getBoxQuotas, saveEquipmentOrder, getRegularClients, getDependentsByParentId } from '@/lib/actions';
import { getSingleForm, getClientSubmissions } from '@/lib/form-actions';
import { getClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getSettings, getCategories, getEquipment, getClients, invalidateClientData, invalidateReferenceData, getActiveOrderForClient, getUpcomingOrderForClient, getOrderHistory, getClientHistory, getBillingHistory, invalidateOrderData } from '@/lib/cached-data';
import { Save, ArrowLeft, Truck, Package, AlertTriangle, Upload, Trash2, Plus, Check, ClipboardList, History, CreditCard, Calendar, ChevronDown, ChevronUp, ShoppingCart, Loader2, FileText, Square, CheckSquare, Wrench } from 'lucide-react';
import FormFiller from '@/components/forms/FormFiller';
import { FormSchema } from '@/lib/form-types';
import SubmissionsList from './SubmissionsList';
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

// Min/Max validation for approved meals per week
const MIN_APPROVED_MEALS_PER_WEEK = 1;
const MAX_APPROVED_MEALS_PER_WEEK = 100;


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

    useEffect(() => {
        console.log('[UnitsModal] isOpen changed to:', isOpen);
    }, [isOpen]);

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

function DeleteConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    clientName,
    deleting
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    clientName: string;
    deleting: boolean;
}) {
    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} style={{ zIndex: 1000 }}>
            <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', color: '#dc2626' }}>Delete Client</h2>
                <p style={{ marginBottom: '24px', color: 'var(--text-secondary)' }}>
                    Are you sure you want to delete <strong>{clientName}</strong>? This action cannot be undone and will permanently remove all client data.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button className="btn" onClick={onClose} disabled={deleting}>Cancel</button>
                    <button
                        className={`btn ${styles.deleteButton}`}
                        onClick={onConfirm}
                        disabled={deleting}
                    >
                        {deleting ? <Loader2 className="spin" size={16} /> : <><Trash2 size={16} /> Delete Client</>}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function ClientProfileDetail({ clientId: propClientId, onClose, initialData, statuses: initialStatuses, navigators: initialNavigators, vendors: initialVendors, menuItems: initialMenuItems, boxTypes: initialBoxTypes, currentUser }: Props) {
    const router = useRouter();
    const params = useParams();
    const propClientIdValue = (params?.id as string) || propClientId;
    
    // Track the actual clientId (starts as prop, updates to real ID after creating new client)
    const [actualClientId, setActualClientId] = useState<string>(propClientIdValue);
    const clientId = actualClientId;
    const isNewClient = clientId === 'new';

    const [client, setClient] = useState<ClientProfile | null>(null);
    const [statuses, setStatuses] = useState<ClientStatus[]>(initialStatuses || []);
    const [navigators, setNavigators] = useState<Navigator[]>(initialNavigators || []);
    const [vendors, setVendors] = useState<Vendor[]>(initialVendors || []);
    const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems || []);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>(initialBoxTypes || []);
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [boxQuotas, setBoxQuotas] = useState<BoxQuota[]>([]);
    const [equipment, setEquipment] = useState<any[]>([]);
    const [showEquipmentOrder, setShowEquipmentOrder] = useState(false);
    const [equipmentOrder, setEquipmentOrder] = useState<{ vendorId: string; equipmentId: string } | null>(null);
    const [submittingEquipmentOrder, setSubmittingEquipmentOrder] = useState(false);

    // Refresh vendors when equipment order section is opened to ensure we have latest data
    useEffect(() => {
        if (showEquipmentOrder) {
            getVendors().then(v => setVendors(v));
        }
    }, [showEquipmentOrder]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [history, setHistory] = useState<DeliveryRecord[]>([]);
    const [orderHistory, setOrderHistory] = useState<any[]>([]);
    const [billingHistory, setBillingHistory] = useState<any[]>([]);
    const [activeHistoryTab, setActiveHistoryTab] = useState<'deliveries' | 'audit' | 'billing'>('deliveries');
    const [allClients, setAllClients] = useState<ClientProfile[]>([]);
    const [expandedBillingRows, setExpandedBillingRows] = useState<Set<string>>(new Set());
    const [regularClients, setRegularClients] = useState<ClientProfile[]>([]);
    const [parentClientSearch, setParentClientSearch] = useState('');
    const [dependents, setDependents] = useState<ClientProfile[]>([]);

    const [formData, setFormData] = useState<Partial<ClientProfile>>({});
    const [orderConfig, setOrderConfig] = useState<any>({}); // Current Order Request (from upcoming_orders)
    const [originalOrderConfig, setOriginalOrderConfig] = useState<any>({}); // Original Order Request for comparison
    const [activeOrder, setActiveOrder] = useState<any>(null); // Recent Orders (from orders table)

    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<{ show: boolean, messages: string[] }>({ show: false, messages: [] });

    const [loading, setLoading] = useState(true);
    const [loadingOrderDetails, setLoadingOrderDetails] = useState(true);

    // Form Filler State
    const [isFillingForm, setIsFillingForm] = useState(false);
    const [formSchema, setFormSchema] = useState<FormSchema | null>(null);
    const [loadingForm, setLoadingForm] = useState(false);
    const [submissions, setSubmissions] = useState<any[]>([]);
    const [loadingSubmissions, setLoadingSubmissions] = useState(false);

    // Status Change Logic
    const [showUnitsModal, setShowUnitsModal] = useState(false);
    const [pendingStatusChange, setPendingStatusChange] = useState<{ oldStatus: string, newStatus: string } | null>(null);

    // Delete Confirmation Modal
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    // Debug: Log when modal state changes
    useEffect(() => {
        console.log('[ClientProfile] showUnitsModal changed to:', showUnitsModal);
    }, [showUnitsModal]);

    useEffect(() => {
        // Handle new client case - initialize with defaults
        if (isNewClient) {
            setLoading(true);
            // Load lookups but don't load client data
            loadLookups().then(() => {
                // Initialize with default values
                const initialStatusId = (initialStatuses || statuses)[0]?.id || '';
                const defaultNavigatorId = (initialNavigators || navigators).find(n => n.isActive)?.id || '';
                
                const defaultClient: Partial<ClientProfile> = {
                    fullName: '',
                    email: '',
                    address: '',
                    phoneNumber: '',
                    secondaryPhoneNumber: null,
                    navigatorId: defaultNavigatorId,
                    endDate: '',
                    screeningTookPlace: false,
                    screeningSigned: false,
                    notes: '',
                    statusId: initialStatusId,
                    serviceType: 'Food',
                    approvedMealsPerWeek: 21
                };
                
                setFormData(defaultClient);
                setClient(defaultClient as ClientProfile);
                setOrderConfig({ serviceType: 'Food', vendorSelections: [{ vendorId: '', items: {} }] });
                setOriginalOrderConfig({});
                setLoading(false);
                setLoadingOrderDetails(false);
            });
            return;
        }

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
                loadAuxiliaryData(initialData.client);
            }
        } else {
            setLoading(true);
            loadData().then(() => setLoading(false));
        }
    }, [clientId, initialData, isNewClient]);

    useEffect(() => {
        // Load submissions for this client
        if (clientId) {
            loadSubmissions();
        }
    }, [clientId]);

    async function loadSubmissions() {
        setLoadingSubmissions(true);
        try {
            const result = await getClientSubmissions(clientId);
            if (result.success && result.data) {
                setSubmissions(result.data);
            }
        } catch (error) {
            console.error('Failed to load submissions:', error);
        } finally {
            setLoadingSubmissions(false);
        }
    }


    async function loadAuxiliaryData(clientToCheck?: ClientProfile) {
        const [appSettings, catData, allClientsData, regularClientsData] = await Promise.all([
            getSettings(),
            getCategories(),
            getClients(),
            getRegularClients()
        ]);
        setSettings(appSettings);
        setCategories(catData);
        setAllClients(allClientsData);
        setRegularClients(regularClientsData);

        // Load dependents if this is a regular client (not a dependent)
        const clientForDependents = clientToCheck || client;
        if (clientForDependents && !clientForDependents.parentClientId) {
            const dependentsData = await getDependentsByParentId(clientForDependents.id);
            setDependents(dependentsData);
        }
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
                // Check if it's Boxes - if so, flatten it to single order config
                const firstDayKey = Object.keys(upcomingOrderData)[0];
                const firstDayOrder = (upcomingOrderData as any)[firstDayKey];

                if (firstDayOrder?.serviceType === 'Boxes') {
                    setOrderConfig(firstDayOrder);
                } else {
                    setOrderConfig({
                        serviceType: firstDayOrder?.serviceType || data.client.serviceType,
                        caseId: firstDayOrder?.caseId,
                        deliveryDayOrders
                    });
                }
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
        } else if (data.client.activeOrder) {
            // No upcoming order, but we have active_order from clients table - use that
            // This ensures vendorId, items, and other Boxes data are preserved even if sync to upcoming_orders failed
            const activeOrderConfig = { ...data.client.activeOrder };
            // Ensure serviceType matches client's service type
            if (!activeOrderConfig.serviceType) {
                activeOrderConfig.serviceType = data.client.serviceType;
            }
            setOrderConfig(activeOrderConfig);
        } else {
            const defaultOrder: any = { serviceType: data.client.serviceType };
            if (data.client.serviceType === 'Food') {
                defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
            }
            setOrderConfig(defaultOrder);
        }
    }

    async function loadLookups() {
        const [s, n, v, m, b, appSettings, catData, eData, allClientsData, regularClientsData] = await Promise.all([
            getStatuses(),
            getNavigators(),
            getVendors(),
            getMenuItems(),
            getBoxTypes(),
            getSettings(),
            getCategories(),
            getEquipment(),
            getClients(),
            getRegularClients()
        ]);
        setStatuses(s);
        setNavigators(n);
        setVendors(v);
        setMenuItems(m);
        setBoxTypes(b);
        setSettings(appSettings);
        setCategories(catData);
        setEquipment(eData);
        setAllClients(allClientsData);
        setRegularClients(regularClientsData);
    }

    async function loadData() {
        setLoadingOrderDetails(true);
        const [c, s, n, v, m, b, appSettings, catData, eData, allClientsData, regularClientsData, upcomingOrderData, activeOrderData, historyData, orderHistoryData, billingHistoryData] = await Promise.all([
            getClient(clientId),
            getStatuses(),
            getNavigators(),
            getVendors(),
            getMenuItems(),
            getBoxTypes(),
            getSettings(),
            getCategories(),
            getEquipment(),
            getClients(),
            getRegularClients(),
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
        setEquipment(eData);
        setAllClients(allClientsData);
        setRegularClients(regularClientsData);
        setActiveOrder(activeOrderData);
        setHistory(historyData || []);
        setOrderHistory(orderHistoryData || []);
        setBillingHistory(billingHistoryData || []);
        setLoadingOrderDetails(false);

        // Load dependents if this is a regular client (not a dependent)
        if (c && !c.parentClientId) {
            const dependentsData = await getDependentsByParentId(c.id);
            setDependents(dependentsData);
        }

        // Set order config from upcoming_orders table (Current Order Request)
        // If no upcoming order exists, fall back to active_order from clients table
        // If no active_order exists, initialize with default based on service type
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
                    // Check if it's Boxes - if so, flatten it to single order config
                    const firstDayKey = Object.keys(upcomingOrderData)[0];
                    const firstDayOrder = (upcomingOrderData as any)[firstDayKey];

                    if (firstDayOrder?.serviceType === 'Boxes') {
                        configToSet = firstDayOrder;
                    } else {
                        configToSet = {
                            serviceType: firstDayOrder?.serviceType || c.serviceType,
                            caseId: firstDayOrder?.caseId,
                            deliveryDayOrders
                        };
                    }
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
            } else if (c.activeOrder) {
                // No upcoming order, but we have active_order from clients table - use that
                // This ensures vendorId, items, and other Boxes data are preserved even if sync to upcoming_orders failed
                configToSet = { ...c.activeOrder };
                // Ensure serviceType matches client's service type
                if (!configToSet.serviceType) {
                    configToSet.serviceType = c.serviceType;
                }
            } else {
                // No upcoming order and no active_order, initialize with default
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

    // Effect: Initialize box quantity when Boxes service is selected
    useEffect(() => {
        // If Boxes service is selected and no boxQuantity, set default to 1
        if (formData.serviceType === 'Boxes' && !orderConfig.boxQuantity) {
            setOrderConfig((prev: any) => ({
                ...prev,
                boxQuantity: 1
            }));
        }
    }, [formData.serviceType]);

    // Extract dependencies with defaults to ensure consistent array size
    const caseId = useMemo(() => orderConfig?.caseId ?? null, [orderConfig?.caseId]);
    const vendorSelections = useMemo(() => orderConfig?.vendorSelections ?? [], [orderConfig?.vendorSelections]);
    const vendorId = useMemo(() => orderConfig?.vendorId ?? null, [orderConfig?.vendorId]);
    const boxTypeId = useMemo(() => orderConfig?.boxTypeId ?? null, [orderConfig?.boxTypeId]);
    const boxQuantity = useMemo(() => orderConfig?.boxQuantity ?? null, [orderConfig?.boxQuantity]);
    const items = useMemo(() => (orderConfig as any)?.items ?? {}, [(orderConfig as any)?.items]);
    const itemPrices = useMemo(() => (orderConfig as any)?.itemPrices ?? {}, [(orderConfig as any)?.itemPrices]);
    const serviceType = useMemo(() => formData?.serviceType ?? null, [formData?.serviceType]);

    // Auto-save effect removed for optimization


    // Initialize parentClientSearch when formData changes (always call this hook before any conditional returns)
    useEffect(() => {
        if (client?.parentClientId && formData.parentClientId && !parentClientSearch) {
            const parent = regularClients.find(c => c.id === formData.parentClientId);
            if (parent) {
                setParentClientSearch(parent.fullName);
            }
        }
    }, [formData.parentClientId, client?.parentClientId, regularClients, parentClientSearch]);

    // Effect: Load quotas when boxTypeId changes
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

        // Load box quotas when boxTypeId changes
        if (formData.serviceType === 'Boxes' && orderConfig.boxTypeId) {
            getBoxQuotas(orderConfig.boxTypeId).then(quotas => {
                setBoxQuotas(quotas);
            }).catch(err => {
                console.error('Error loading box quotas:', err);
                setBoxQuotas([]);
            });
        } else {
            setBoxQuotas([]);
        }
    }, [formData.serviceType, orderConfig.boxTypeId, boxTypes]);


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
                        const itemPrice = item ? (item.priceEach ?? item.value) : 0;
                        total += itemPrice * (qty as number);
                    }
                }
            } else if (selection.items) {
                // Normal items structure
                for (const [itemId, qty] of Object.entries(selection.items)) {
                    const item = menuItems.find(i => i.id === itemId);
                    const itemPrice = item ? (item.priceEach ?? item.value) : 0;
                    total += itemPrice * (qty as number);
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
                        const itemPrice = item ? (item.priceEach ?? item.value) : 0;
                        total += itemPrice * (qty as number);
                    }
                }
            } else if (selection.items) {
                // Normal single-day format
                for (const [itemId, qty] of Object.entries(selection.items)) {
                    const item = menuItems.find(i => i.id === itemId);
                    const itemPrice = item ? (item.priceEach ?? item.value) : 0;
                    total += itemPrice * (qty as number);
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

    /**
     * Calculate the next delivery date (first occurrence) for a vendor as a Date object
     */
    function getNextDeliveryDateObject(vendorId: string): Date | null {
        if (!vendorId) return null;

        const vendor: any = vendors.find(v => v.id === vendorId);
        const days = vendor?.deliveryDays || vendor?.delivery_days;
        if (!vendor || !days || days.length === 0) {
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

        const deliveryDayNumbers = days
            .map((day: any) => dayNameToNumber[day])
            .filter((num: any) => num !== undefined) as number[];

        if (deliveryDayNumbers.length === 0) return null;

        // Find the first occurrence (next delivery day, starting from today)
        for (let i = 0; i <= 14; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);
            if (deliveryDayNumbers.includes(checkDate.getDay())) {
                return checkDate;
            }
        }

        return null;
    }

    /**
     * Calculate the take effect date (second occurrence) for a vendor as a Date object
     */
    function getTakeEffectDateObject(vendorId: string): Date | null {
        if (!vendorId) return null;

        const vendor: any = vendors.find(v => v.id === vendorId);
        const days = vendor?.deliveryDays || vendor?.delivery_days;
        if (!vendor || !days || days.length === 0) {
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

        const deliveryDayNumbers = days
            .map((day: any) => dayNameToNumber[day])
            .filter((num: any) => num !== undefined) as number[];

        if (deliveryDayNumbers.length === 0) return null;

        // Find the second occurrence (next next delivery day, starting from tomorrow)
        let foundCount = 0;
        for (let i = 1; i <= 21; i++) {
            const checkDate = new Date(today);
            checkDate.setDate(today.getDate() + i);
            if (deliveryDayNumbers.includes(checkDate.getDay())) {
                foundCount++;
                if (foundCount === 2) {
                    return checkDate;
                }
            }
        }

        return null;
    }

    /**
     * Get the earliest delivery date across all vendors in the order
     */
    function getEarliestDeliveryDateForOrder(): Date | null {
        if (!orderConfig || !orderConfig.caseId) return null;

        const deliveryDates: Date[] = [];

        if (formData.serviceType === 'Food' && orderConfig.vendorSelections) {
            for (const selection of orderConfig.vendorSelections) {
                if (selection.vendorId) {
                    const date = getNextDeliveryDateObject(selection.vendorId);
                    if (date) deliveryDates.push(date);
                }
            }
        } else if (formData.serviceType === 'Boxes' && orderConfig.vendorId) {
            const date = getNextDeliveryDateObject(orderConfig.vendorId);
            if (date) deliveryDates.push(date);
        }

        if (deliveryDates.length === 0) return null;
        return new Date(Math.min(...deliveryDates.map(d => d.getTime())));
    }

    /**
     * Get the earliest take effect date across all vendors in the order
     */
    function getEarliestTakeEffectDateForOrder(): Date | null {
        if (!orderConfig || !orderConfig.caseId) return null;

        const takeEffectDates: Date[] = [];

        if (formData.serviceType === 'Food' && orderConfig.vendorSelections) {
            for (const selection of orderConfig.vendorSelections) {
                if (selection.vendorId) {
                    const date = getTakeEffectDateObject(selection.vendorId);
                    if (date) takeEffectDates.push(date);
                }
            }
        } else if (formData.serviceType === 'Boxes' && orderConfig.vendorId) {
            const date = getTakeEffectDateObject(orderConfig.vendorId);
            if (date) takeEffectDates.push(date);
        }

        if (takeEffectDates.length === 0) return null;
        return new Date(Math.min(...takeEffectDates.map(d => d.getTime())));
    }

    /**
     * Check if the cutoff date has passed relative to the next delivery date
     */
    function isCutoffPassed(): boolean {
        if (!settings) return false;
        if (!orderConfig || !orderConfig.caseId) return false;

        const nextDeliveryDate = getEarliestDeliveryDateForOrder();
        if (!nextDeliveryDate) return false;

        // Calculate cutoff date/time for the next delivery
        const cutoffDayName = settings.weeklyCutoffDay;
        const cutoffTimeStr = settings.weeklyCutoffTime || '17:00';
        const [cutoffHours, cutoffMinutes] = cutoffTimeStr.split(':').map(Number);

        const dayNameToNumber: { [key: string]: number } = {
            'Sunday': 0,
            'Monday': 1,
            'Tuesday': 2,
            'Wednesday': 3,
            'Thursday': 4,
            'Friday': 5,
            'Saturday': 6
        };

        const cutoffDayNumber = dayNameToNumber[cutoffDayName];
        if (cutoffDayNumber === undefined) return false;

        // Find the cutoff date before the next delivery date
        // Count backwards from delivery date to find the most recent cutoff day
        const cutoffDate = new Date(nextDeliveryDate);
        let daysBack = 0;
        while (daysBack < 14) {
            const checkDate = new Date(nextDeliveryDate);
            checkDate.setDate(nextDeliveryDate.getDate() - daysBack);

            if (checkDate.getDay() === cutoffDayNumber) {
                cutoffDate.setTime(checkDate.getTime());
                cutoffDate.setHours(cutoffHours, cutoffMinutes, 0, 0);
                break;
            }
            daysBack++;
        }

        const now = new Date();
        return now > cutoffDate;
    }

    function getBoxItemsTotal(): number {
        if (!orderConfig.items) return 0;
        let total = 0;
        for (const [itemId, qty] of Object.entries(orderConfig.items)) {
            const item = menuItems.find(i => i.id === itemId);
            const itemPrice = item ? (item.priceEach ?? item.value) : 0;
            total += itemPrice * (qty as number);
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
            // Check vendorId from order config first, then fall back to boxType
            const box = boxTypes.find(b => b.id === conf.boxTypeId);
            const vendorId = conf.vendorId || box?.vendorId;
            const vendorName = vendors.find(v => v.id === vendorId)?.name || '-';

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
        // No quota validation needed - removed box types
        // Users can select any items they want without quota requirements
        return { isValid: true, messages: [] };
    }

    function validateOrder(): { isValid: boolean, messages: string[] } {
        if (formData.serviceType === 'Food') {
            const messages: string[] = [];

            // Check total order value against approved meals per week
            const totalValue = getCurrentOrderTotalValueAllDays();
            const approvedMeals = formData.approvedMealsPerWeek || 0;
            if (approvedMeals > 0 && totalValue > approvedMeals) {
                messages.push(`Total order value (${totalValue}) exceeds approved meals per week (${approvedMeals}).`);
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

        if (formData.serviceType === 'Boxes') {
            const messages: string[] = [];

            // Validate box category quotas - each category must have exactly the required quota value
            if (orderConfig.boxTypeId && boxQuotas.length > 0 && orderConfig.items) {
                const selectedItems = orderConfig.items || {};
                const boxQuantity = orderConfig.boxQuantity || 1;

                // Check each quota requirement
                for (const quota of boxQuotas) {
                    // Calculate total quota value for this category
                    let categoryQuotaValue = 0;

                    // Sum up (item quantity * item quotaValue) for all items in this category
                    for (const [itemId, qty] of Object.entries(selectedItems)) {
                        const item = menuItems.find(i => i.id === itemId);
                        if (item && item.categoryId === quota.categoryId) {
                            const itemQuotaValue = item.quotaValue || 1;
                            categoryQuotaValue += (qty as number) * itemQuotaValue;
                        }
                    }

                    // Calculate required quota value (targetValue * boxQuantity)
                    const requiredQuotaValue = quota.targetValue * boxQuantity;

                    // Check if it matches exactly
                    if (categoryQuotaValue !== requiredQuotaValue) {
                        const category = categories.find(c => c.id === quota.categoryId);
                        const categoryName = category?.name || 'Unknown Category';
                        messages.push(
                            `Category "${categoryName}" requires exactly ${requiredQuotaValue} quota value, but you have ${categoryQuotaValue}. ` +
                            `Please adjust items in this category to match exactly.`
                        );
                    }
                }
            }

            // Validate category set values - categories with setValue must have exactly that quota value
            if (orderConfig.items) {
                const selectedItems = orderConfig.items || {};

                // Check each category that has a setValue
                for (const category of categories) {
                    if (category.setValue !== undefined && category.setValue !== null) {
                        // Calculate total quota value for this category
                        let categoryQuotaValue = 0;

                        // Sum up (item quantity * item quotaValue) for all items in this category
                        for (const [itemId, qty] of Object.entries(selectedItems)) {
                            const item = menuItems.find(i => i.id === itemId);
                            if (item && item.categoryId === category.id) {
                                const itemQuotaValue = item.quotaValue || 1;
                                categoryQuotaValue += (qty as number) * itemQuotaValue;
                            }
                        }

                        // Check if it matches exactly the setValue
                        if (categoryQuotaValue !== category.setValue) {
                            messages.push(
                                `You must have a total of ${category.setValue} ${category.name} points, but you have ${categoryQuotaValue}. ` +
                                `Please adjust items in this category to match exactly.`
                            );
                        }
                    }
                }
            }

            if (messages.length > 0) {
                return { isValid: false, messages };
            }

            return { isValid: true, messages: [] };
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
        setSaving(true);
        await deleteClient(clientId);
        setSaving(false);
        setShowDeleteModal(false);

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

    // -- Form Filler Handlers --
    async function handleOpenScreeningForm() {
        setLoadingForm(true);
        try {
            const response = await getSingleForm();
            if (response.success && response.data) {
                setFormSchema(response.data);
                setIsFillingForm(true);
            } else {
                alert('No Screening Form configured.');
            }
        } catch (error) {
            console.error('Failed to load form:', error);
            alert('Failed to load form. Please try again.');
        } finally {
            setLoadingForm(false);
        }
    }

    function handleCloseScreeningForm() {
        setIsFillingForm(false);
        setFormSchema(null);
    }

    // Don't show anything until all data is loaded
    if (loading || loadingOrderDetails || !client) {
        return (
            <div className={styles.loadingContainer} style={{ minHeight: '400px' }}>
                <div className={styles.spinner}></div>
                <p className={styles.loadingText}>Loading client profile...</p>
            </div>
        );
    }

    // Render Form Filler if active
    if (isFillingForm && formSchema) {
        return (
            <div className={`${styles.container} ${onClose ? styles.inModal : ''}`} style={{ padding: 0 }}>
                <FormFiller schema={formSchema} onBack={handleCloseScreeningForm} clientId={clientId} />
            </div>
        );
    }

    const isDependent = !!client?.parentClientId;
    const filteredRegularClients = regularClients.filter(c =>
        c.fullName.toLowerCase().includes(parentClientSearch.toLowerCase()) && c.id !== clientId
    );
    const selectedParentClient = formData.parentClientId ? regularClients.find(c => c.id === formData.parentClientId) : null;

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
                        <h1 className={styles.title}>{formData.fullName || (isDependent ? 'Dependent Profile' : 'Client Profile')}</h1>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                            className={`btn ${styles.deleteButton}`}
                            onClick={() => setShowDeleteModal(true)}
                            style={{ marginRight: '8px' }}
                        >
                            <Trash2 size={16} /> Delete {isDependent ? 'Dependent' : 'Client'}
                        </button>
                        {!onClose && (
                            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                <Save size={16} /> Save Changes
                            </button>
                        )}
                    </div>
                </div>
            </header>

            {isDependent ? (
                // Simplified view for dependents
                <div className={styles.grid}>
                    <div className={styles.column}>
                        <section className={styles.card}>
                            <h3 className={styles.sectionTitle}>Dependent Details</h3>

                            <div className={styles.formGroup}>
                                <label className="label">Dependent Name</label>
                                <input className="input" value={formData.fullName || ''} onChange={e => setFormData({ ...formData, fullName: e.target.value })} />
                            </div>

                            <div className={styles.formGroup}>
                                <label className="label">Parent Client</label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        className="input"
                                        placeholder="Search for client..."
                                        value={parentClientSearch}
                                        onChange={e => setParentClientSearch(e.target.value)}
                                        style={{ marginBottom: '0.5rem' }}
                                    />
                                    <div style={{
                                        maxHeight: '300px',
                                        overflowY: 'auto',
                                        overflowX: 'hidden',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        backgroundColor: 'var(--bg-surface)'
                                    }}>
                                        {filteredRegularClients.length === 0 ? (
                                            <div style={{ padding: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                                                No clients found
                                            </div>
                                        ) : (
                                            filteredRegularClients.map(c => (
                                                <div
                                                    key={c.id}
                                                    onClick={() => {
                                                        setFormData({ ...formData, parentClientId: c.id });
                                                        setParentClientSearch(c.fullName);
                                                    }}
                                                    style={{
                                                        padding: '0.75rem',
                                                        cursor: 'pointer',
                                                        backgroundColor: formData.parentClientId === c.id ? 'var(--bg-surface-hover)' : 'transparent',
                                                        borderBottom: '1px solid var(--border-color)',
                                                        transition: 'background-color 0.2s'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        if (formData.parentClientId !== c.id) {
                                                            e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                                        }
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        if (formData.parentClientId !== c.id) {
                                                            e.currentTarget.style.backgroundColor = 'transparent';
                                                        }
                                                    }}
                                                >
                                                    {c.fullName}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                    {selectedParentClient && (
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            Selected: {selectedParentClient.fullName}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            ) : (
                // Regular client view
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
                                <label className="label">Secondary Phone</label>
                                <input className="input" value={formData.secondaryPhoneNumber || ''} onChange={e => setFormData({ ...formData, secondaryPhoneNumber: e.target.value })} />
                                <div style={{ height: '1rem' }} /> {/* Spacer */}
                                <label className="label">Email</label>
                                <input className="input" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                            </div>

                            <div className={styles.formGroup}>
                                <label className="label">General Notes</label>
                                <textarea className="input" style={{ height: '100px' }} value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })} />
                            </div>

                            {dependents.length > 0 && (
                                <div className={styles.formGroup}>
                                    <label className="label">Dependents ({dependents.length})</label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {dependents.map(dependent => (
                                            <div
                                                key={dependent.id}
                                                onClick={() => {
                                                    if (onClose) {
                                                        onClose();
                                                        // Navigate to dependent in a new view or update the current view
                                                        // For now, we'll just close and let the user click on it from the list
                                                    } else {
                                                        router.push(`/clients/${dependent.id}`);
                                                    }
                                                }}
                                                style={{
                                                    padding: '0.75rem',
                                                    border: '1px solid var(--border-color)',
                                                    borderRadius: 'var(--radius-md)',
                                                    backgroundColor: 'var(--bg-surface)',
                                                    cursor: 'pointer',
                                                    transition: 'background-color 0.2s'
                                                }}
                                                onMouseEnter={(e) => {
                                                    e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                                }}
                                                onMouseLeave={(e) => {
                                                    e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
                                                }}
                                            >
                                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                                    {dependent.fullName}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className={styles.formGroup}>
                                <label className="label">Screening Status</label>
                                <div style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '12px 16px',
                                    borderRadius: 'var(--radius-md)',
                                    fontSize: '1rem',
                                    fontWeight: 500,
                                    backgroundColor: (() => {
                                        const status = client?.screeningStatus || 'not_started';
                                        switch (status) {
                                            case 'waiting_approval': return 'rgba(234, 179, 8, 0.1)';
                                            case 'approved': return 'rgba(34, 197, 94, 0.1)';
                                            case 'rejected': return 'rgba(239, 68, 68, 0.1)';
                                            default: return 'var(--bg-surface-hover)';
                                        }
                                    })(),
                                    color: (() => {
                                        const status = client?.screeningStatus || 'not_started';
                                        switch (status) {
                                            case 'waiting_approval': return '#eab308';
                                            case 'approved': return 'var(--color-success)';
                                            case 'rejected': return 'var(--color-danger)';
                                            default: return 'var(--text-tertiary)';
                                        }
                                    })(),
                                    border: '1px solid var(--border-color)'
                                }}>
                                    {(() => {
                                        const status = client?.screeningStatus || 'not_started';
                                        switch (status) {
                                            case 'not_started': return <><Square size={18} /> Not Started</>;
                                            case 'waiting_approval': return <><CheckSquare size={18} /> Pending Approval</>;
                                            case 'approved': return <><CheckSquare size={18} /> Approved</>;
                                            case 'rejected': return <><Square size={18} /> Rejected</>;
                                            default: return <><Square size={18} /> Not Started</>;
                                        }
                                    })()}
                                </div>
                                <p style={{
                                    fontSize: '0.85rem',
                                    color: 'var(--text-tertiary)',
                                    marginTop: '8px',
                                    fontStyle: 'italic'
                                }}>
                                    Status updates automatically when screening forms are submitted and reviewed.
                                </p>
                            </div>

                        </section>

                        {dependents.length > 0 && (
                            <section className={styles.card}>
                                <h3 className={styles.sectionTitle}>Dependents ({dependents.length})</h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {dependents.map(dependent => (
                                        <div
                                            key={dependent.id}
                                            onClick={() => {
                                                if (onClose) {
                                                    onClose();
                                                    // Navigate to dependent in a new view or update the current view
                                                    // For now, we'll just close and let the user click on it from the list
                                                } else {
                                                    router.push(`/clients/${dependent.id}`);
                                                }
                                            }}
                                            style={{
                                                padding: '0.75rem',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: 'var(--radius-md)',
                                                backgroundColor: 'var(--bg-surface)',
                                                cursor: 'pointer',
                                                transition: 'background-color 0.2s'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
                                            }}
                                        >
                                            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                                {dependent.fullName}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* Screening Form Submissions */}
                        <section className={styles.card}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Screening Form Submissions</h3>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleOpenScreeningForm}
                                    disabled={loadingForm}
                                    style={{ fontSize: '14px' }}
                                >
                                    {loadingForm ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                    Fill Screening Form
                                </button>
                            </div>
                            {loadingSubmissions ? (
                                <div style={{ textAlign: 'center', padding: '20px' }}>
                                    <Loader2 size={24} className="animate-spin" />
                                </div>
                            ) : (
                                <SubmissionsList submissions={submissions} />
                            )}
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
                                                        color: getCurrentOrderTotalValueAllDays() > (formData.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'inherit',
                                                        backgroundColor: getCurrentOrderTotalValueAllDays() > (formData.approvedMealsPerWeek || 0) ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface-hover)'
                                                    }}>
                                                        Value: {getCurrentOrderTotalValueAllDays()} / {formData.approvedMealsPerWeek || 0}
                                                    </div>
                                                </div>
                                            </div>

                                            {isCutoffPassed() && (() => {
                                                const takeEffectDate = getEarliestTakeEffectDateForOrder();
                                                const nextDeliveryDate = getEarliestDeliveryDateForOrder();
                                                return (
                                                    <div className={styles.alert} style={{
                                                        backgroundColor: 'rgba(251, 191, 36, 0.1)',
                                                        border: '1px solid rgba(251, 191, 36, 0.3)',
                                                        color: 'var(--text-primary)',
                                                        padding: 'var(--spacing-md)',
                                                        borderRadius: 'var(--radius-sm)',
                                                        marginBottom: 'var(--spacing-md)'
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--spacing-sm)' }}>
                                                            <AlertTriangle size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
                                                            <div style={{ flex: 1 }}>
                                                                <div style={{ fontWeight: 600, marginBottom: 'var(--spacing-xs)' }}>
                                                                    Cutoff Date Passed
                                                                </div>
                                                                <div style={{ fontSize: '0.9rem', lineHeight: '1.5' }}>
                                                                    Your changes will not take effect for the upcoming delivery{nextDeliveryDate ? ` (${nextDeliveryDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })})` : ''}.
                                                                </div>
                                                                {takeEffectDate && (
                                                                    <div style={{ fontSize: '0.9rem', marginTop: 'var(--spacing-xs)', fontWeight: 500 }}>
                                                                        This order will take effect on {takeEffectDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.
                                                                    </div>
                                                                )}
                                                                <div style={{ fontSize: '0.85rem', marginTop: 'var(--spacing-xs)', color: 'var(--text-secondary)' }}>
                                                                    View the Recent Orders section below to see what will be delivered this week.
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}
                                            {orderConfig && orderConfig.caseId && !isCutoffPassed() && (() => {
                                                const nextDeliveryDate = getEarliestDeliveryDateForOrder();
                                                if (!nextDeliveryDate) return null;
                                                return (
                                                    <div style={{
                                                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                                                        border: '1px solid rgba(34, 197, 94, 0.3)',
                                                        color: 'var(--text-primary)',
                                                        padding: 'var(--spacing-md)',
                                                        borderRadius: 'var(--radius-sm)',
                                                        marginBottom: 'var(--spacing-md)'
                                                    }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                                            <Check size={18} style={{ color: '#22c55e', flexShrink: 0 }} />
                                                            <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                                                This order will take effect on {nextDeliveryDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })()}

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

                                                                            // If vendor has multiple days but no days are selected, don't show menu items
                                                                            if (vendorHasMultipleDays && vendorSelectedDays.length === 0) {
                                                                                return null;
                                                                            }

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
                                                                                                        {getVendorMenuItems(selection.vendorId).map((item) => {
                                                                                                            const qty = Number(dayItems[item.id] || 0);
                                                                                                            return (
                                                                                                                <div key={item.id} className={styles.menuItem}>
                                                                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                                        <span>{item.name} <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue || 1})</span></span>
                                                                                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                                                            <button onClick={() => {
                                                                                                                                const updated = [...currentSelections];
                                                                                                                                const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                                if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                                                                const newQty = Math.max(0, qty - 1);
                                                                                                                                if (newQty > 0) {
                                                                                                                                    itemsByDay[day][item.id] = newQty;
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
                                                                                                                            }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                                                                            <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                                                                            <button onClick={() => {
                                                                                                                                const updated = [...currentSelections];
                                                                                                                                const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                                if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                                                                itemsByDay[day][item.id] = qty + 1;
                                                                                                                                updated[index] = {
                                                                                                                                    ...updated[index],
                                                                                                                                    itemsByDay
                                                                                                                                };
                                                                                                                                setOrderConfig({
                                                                                                                                    ...orderConfig,
                                                                                                                                    vendorSelections: updated,
                                                                                                                                    deliveryDayOrders: undefined // Clear old format
                                                                                                                                });
                                                                                                                            }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                                                                        </div>
                                                                                                                    </label>
                                                                                                                </div>
                                                                                                            );
                                                                                                        })}
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
                                                                                        {getVendorMenuItems(selection.vendorId).map((item) => {
                                                                                            const qty = Number(selection.items?.[item.id] || 0);
                                                                                            return (
                                                                                                <div key={item.id} className={styles.menuItem}>
                                                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                        <span>{item.name} <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue || 1})</span></span>
                                                                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                                            <button onClick={() => updateItemQuantity(index, item.id, Math.max(0, qty - 1), null)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                                                            <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                                                            <button onClick={() => updateItemQuantity(index, item.id, qty + 1, null)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                                                        </div>
                                                                                                    </label>
                                                                                                </div>
                                                                                            );
                                                                                        })}
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

                                                                            // If vendor has multiple days but no days are selected, don't show menu items
                                                                            if (vendorHasMultipleDays && vendorSelectedDays.length === 0) {
                                                                                return null;
                                                                            }

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
                                                                                                        {getVendorMenuItems(selection.vendorId).map((item) => {
                                                                                                            const qty = Number(dayItems[item.id] || 0);
                                                                                                            return (
                                                                                                                <div key={item.id} className={styles.menuItem}>
                                                                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                                        <span>{item.name} <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue || 1})</span></span>
                                                                                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                                                            <button onClick={() => {
                                                                                                                                const updated = [...currentSelections];
                                                                                                                                const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                                if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                                                                const newQty = Math.max(0, qty - 1);
                                                                                                                                if (newQty > 0) {
                                                                                                                                    itemsByDay[day][item.id] = newQty;
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
                                                                                                                            }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                                                                            <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                                                                            <button onClick={() => {
                                                                                                                                const updated = [...currentSelections];
                                                                                                                                const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                                if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                                                                itemsByDay[day][item.id] = qty + 1;
                                                                                                                                updated[index] = {
                                                                                                                                    ...updated[index],
                                                                                                                                    itemsByDay
                                                                                                                                };
                                                                                                                                setOrderConfig({
                                                                                                                                    ...orderConfig,
                                                                                                                                    vendorSelections: updated
                                                                                                                                });
                                                                                                                            }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                                                                        </div>
                                                                                                                    </label>
                                                                                                                </div>
                                                                                                            );
                                                                                                        })}
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
                                                                                        {getVendorMenuItems(selection.vendorId).map((item) => {
                                                                                            const qty = Number(selection.items?.[item.id] || 0);
                                                                                            return (
                                                                                                <div key={item.id} className={styles.menuItem}>
                                                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                        <span>{item.name} <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue || 1})</span></span>
                                                                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                                            <button onClick={() => updateItemQuantity(index, item.id, Math.max(0, qty - 1), null)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                                                            <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                                                            <button onClick={() => updateItemQuantity(index, item.id, qty + 1, null)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                                                        </div>
                                                                                                    </label>
                                                                                                </div>
                                                                                            );
                                                                                        })}
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
                                                        <span><strong>Warning:</strong> This vendor has no delivery days configured. Orders will NOT be created.</span>
                                                    </div>
                                                );
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
                                            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <Package size={14} /> Box Contents
                                                </h4>

                                                {/* Check if vendor has delivery days */}
                                                {orderConfig.vendorId && !getNextDeliveryDateForVendor(orderConfig.vendorId) ? (
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
                                                            Please configure <strong>Delivery Days</strong> for this vendor in Settings before adding items.
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {/* Show all categories with box items */}
                                                        {categories.map(category => {
                                                            // Filter items for this category
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

                                                            // Find quota requirement for this category (from box quotas)
                                                            const quota = boxQuotas.find(q => q.categoryId === category.id);
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
                                                                                    <span style={{ fontSize: '0.8rem' }}>{item.name} <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue || 1})</span></span>
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
                                                                <div style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px' }}>
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                                                        <span style={{ fontWeight: 600 }}>Uncategorized</span>
                                                                    </div>

                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                                        {uncategorizedItems.map(item => {
                                                                            const qty = Number(selectedItems[item.id] || 0);
                                                                            return (
                                                                                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-app)', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }}>
                                                                                    <span style={{ fontSize: '0.8rem' }}>{item.name} <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue || 1})</span></span>
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
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Equipment Order Section - Always visible */}
                                    <div className={styles.divider} style={{ marginTop: '2rem', marginBottom: '1rem' }} />
                                    <div style={{ marginTop: '1rem' }}>
                                        <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <Wrench size={14} /> Equipment Order
                                        </h4>
                                        {!showEquipmentOrder ? (
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => setShowEquipmentOrder(true)}
                                                style={{ width: '100%' }}
                                            >
                                                Equipment Order
                                            </button>
                                        ) : (
                                            <div style={{
                                                padding: '1rem',
                                                backgroundColor: 'var(--bg-surface-hover)',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--border-color)'
                                            }}>
                                                <div className={styles.formGroup}>
                                                    <label className="label">Vendor</label>
                                                    <select
                                                        className="input"
                                                        value={equipmentOrder?.vendorId || ''}
                                                        onChange={e => setEquipmentOrder({
                                                            ...equipmentOrder,
                                                            vendorId: e.target.value,
                                                            equipmentId: '' // Reset equipment selection when vendor changes
                                                        })}
                                                    >
                                                        <option value="">Select Vendor...</option>
                                                        {vendors
                                                            .filter(v => {
                                                                const hasEquipment = v.serviceTypes && v.serviceTypes.includes('Equipment');
                                                                const isActive = v.isActive;
                                                                return hasEquipment && isActive;
                                                            })
                                                            .map(v => (
                                                                <option key={v.id} value={v.id}>{v.name}</option>
                                                            ))}
                                                    </select>
                                                    {vendors.filter(v => v.serviceTypes && v.serviceTypes.includes('Equipment') && v.isActive).length === 0 && (
                                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.5rem', fontStyle: 'italic' }}>
                                                            No active vendors with Equipment service type found. Please create a vendor with Equipment service type in the admin panel.
                                                        </p>
                                                    )}
                                                </div>

                                                {equipmentOrder?.vendorId && (
                                                    <div className={styles.formGroup}>
                                                        <label className="label">Equipment Item</label>
                                                        <select
                                                            className="input"
                                                            value={equipmentOrder?.equipmentId || ''}
                                                            onChange={e => setEquipmentOrder({
                                                                ...equipmentOrder,
                                                                equipmentId: e.target.value
                                                            })}
                                                        >
                                                            <option value="">Select Equipment Item...</option>
                                                            {equipment.map(eq => (
                                                                <option key={eq.id} value={eq.id}>
                                                                    {eq.name} - ${eq.price.toFixed(2)}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                )}

                                                {equipmentOrder?.equipmentId && (
                                                    <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                                                        <button
                                                            className="btn btn-primary"
                                                            onClick={async () => {
                                                                if (!equipmentOrder.vendorId || !equipmentOrder.equipmentId) {
                                                                    alert('Please select both vendor and equipment item');
                                                                    return;
                                                                }
                                                                try {
                                                                    setSubmittingEquipmentOrder(true);
                                                                    await saveEquipmentOrder(
                                                                        clientId,
                                                                        equipmentOrder.vendorId,
                                                                        equipmentOrder.equipmentId,
                                                                        orderConfig.caseId
                                                                    );
                                                                    setMessage('Equipment order submitted successfully!');
                                                                    setTimeout(() => setMessage(null), 3000);
                                                                    setShowEquipmentOrder(false);
                                                                    setEquipmentOrder(null);
                                                                    // Reload data to show the new order in Recent Orders section
                                                                    setLoadingOrderDetails(true);
                                                                    const [activeOrderData, orderHistoryData] = await Promise.all([
                                                                        getActiveOrderForClient(clientId),
                                                                        getOrderHistory(clientId)
                                                                    ]);
                                                                    setActiveOrder(activeOrderData);
                                                                    setOrderHistory(orderHistoryData || []);
                                                                    setLoadingOrderDetails(false);
                                                                } catch (error: any) {
                                                                    alert(`Error submitting equipment order: ${error.message || 'Unknown error'}`);
                                                                } finally {
                                                                    setSubmittingEquipmentOrder(false);
                                                                }
                                                            }}
                                                            disabled={submittingEquipmentOrder}
                                                        >
                                                            {submittingEquipmentOrder ? 'Submitting...' : 'Submit Equipment Order'}
                                                        </button>
                                                        <button
                                                            className="btn btn-secondary"
                                                            onClick={() => {
                                                                setShowEquipmentOrder(false);
                                                                setEquipmentOrder(null);
                                                            }}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </section>

                        {/* Recent Orders Panel */}
                        <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                                <Calendar size={18} />
                                <h3 className={styles.sectionTitle} style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                                    Recent Orders
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
                                                    const isEquipment = order.serviceType === 'Equipment';

                                                    return (
                                                        <div key={orderIdx} style={isMultiple ? {
                                                            padding: 'var(--spacing-md)',
                                                            backgroundColor: 'var(--bg-surface)',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: '1px solid var(--border-color)'
                                                        } : {}}>
                                                            <div style={{
                                                                marginBottom: 'var(--spacing-md)',
                                                                paddingBottom: 'var(--spacing-sm)',
                                                                borderBottom: '1px solid var(--border-color)',
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                flexWrap: 'wrap',
                                                                gap: '8px'
                                                            }}>
                                                                <div style={{
                                                                    fontSize: '0.9rem',
                                                                    fontWeight: 600,
                                                                    color: 'var(--text-secondary)'
                                                                }}>
                                                                    {order.orderNumber ? `Order #${order.orderNumber}` : `Order ${orderIdx + 1}`}
                                                                    {isMultiple && !order.orderNumber && ` of ${ordersToDisplay.length}`}
                                                                    {order.scheduledDeliveryDate && (
                                                                        <span style={{ marginLeft: 'var(--spacing-sm)', fontSize: '0.85rem', fontWeight: 400 }}>
                                                                            • Scheduled: {new Date(order.scheduledDeliveryDate).toLocaleDateString()}
                                                                        </span>
                                                                    )}
                                                                </div>

                                                                {/* Proof of Delivery / Status */}
                                                                <div style={{ fontSize: '0.85rem' }}>
                                                                    {order.proofOfDelivery ? (
                                                                        <a
                                                                            href={order.proofOfDelivery}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            style={{
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '4px',
                                                                                color: 'var(--color-primary)',
                                                                                fontWeight: 500,
                                                                                textDecoration: 'none'
                                                                            }}
                                                                        >
                                                                            View Proof of Delivery
                                                                        </a>
                                                                    ) : (
                                                                        <span style={{
                                                                            color: 'var(--text-tertiary)',
                                                                            fontStyle: 'italic',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px'
                                                                        }}>
                                                                            Not yet delivered
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                {/* Service Type Header */}
                                                                <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                                    {isFood ? 'Food' : isBoxes ? 'Boxes' : isEquipment ? 'Equipment' : 'Unknown Service'}
                                                                </div>

                                                                {/* Food Order Display - Show vendors first, then items grouped by vendor */}
                                                                {isFood && (
                                                                    <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                        {order.vendorSelections && order.vendorSelections.length > 0 ? (
                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                                                {order.vendorSelections.map((vendorSelection: any, idx: number) => {
                                                                                    const vendor = vendors.find(v => v.id === vendorSelection.vendorId);
                                                                                    const vendorName = vendor?.name || 'Unassigned';
                                                                                    const nextDelivery = getNextDeliveryDate(vendorSelection.vendorId);
                                                                                    const items = vendorSelection.items || {};

                                                                                    return (
                                                                                        <div key={idx} style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                                            {/* Vendor Header */}
                                                                                            <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                                                {vendorName}
                                                                                            </div>
                                                                                            {/* Items List */}
                                                                                            {Object.keys(items).length > 0 ? (
                                                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                                                                    {Object.entries(items).map(([itemId, qty]: [string, any]) => {
                                                                                                        const item = menuItems.find(i => i.id === itemId);
                                                                                                        return item ? (
                                                                                                            <div key={itemId} style={{ marginBottom: '4px' }}>
                                                                                                                {item.name} × {qty}
                                                                                                            </div>
                                                                                                        ) : null;
                                                                                                    })}
                                                                                                </div>
                                                                                            ) : (
                                                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                                                                                    No items selected
                                                                                                </div>
                                                                                            )}
                                                                                            {nextDelivery && (
                                                                                                <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                                                                    Next delivery: {nextDelivery.dayOfWeek}, {nextDelivery.date}
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        ) : (
                                                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                                                                No vendors or items selected
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* Boxes Order Display - Show vendor, box type, and all items */}
                                                                {isBoxes && order.boxTypeId && (
                                                                    <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                        {(() => {
                                                                            const box = boxTypes.find(b => b.id === order.boxTypeId);
                                                                            // Get vendorId from order first, then fall back to box.vendorId
                                                                            const boxVendorId = order.vendorId || box?.vendorId || null;
                                                                            const vendor = boxVendorId ? vendors.find(v => v.id === boxVendorId) : null;
                                                                            const vendorName = vendor?.name || 'Unassigned';
                                                                            const boxName = box?.name || 'Unknown Box';
                                                                            const nextDelivery = boxVendorId ? getNextDeliveryDate(boxVendorId) : null;
                                                                            const items = order.items || {};

                                                                            return (
                                                                                <>
                                                                                    {/* Vendor */}
                                                                                    <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                                        {vendorName}
                                                                                    </div>
                                                                                    {/* Box Type and Quantity */}
                                                                                    <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                                                        {boxName} × {order.boxQuantity || 1}
                                                                                    </div>
                                                                                    {/* Items List */}
                                                                                    {Object.keys(items).length > 0 ? (
                                                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                                                            {Object.entries(items).map(([itemId, qty]: [string, any]) => {
                                                                                                const item = menuItems.find(i => i.id === itemId);
                                                                                                return item ? (
                                                                                                    <div key={itemId} style={{ marginBottom: '4px' }}>
                                                                                                        {item.name} × {qty}
                                                                                                    </div>
                                                                                                ) : null;
                                                                                            })}
                                                                                        </div>
                                                                                    ) : (
                                                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                                                                            No items selected
                                                                                        </div>
                                                                                    )}
                                                                                    {nextDelivery && (
                                                                                        <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                                                            Next delivery: {nextDelivery.dayOfWeek}, {nextDelivery.date}
                                                                                        </div>
                                                                                    )}
                                                                                </>
                                                                            );
                                                                        })()}
                                                                    </div>
                                                                )}

                                                                {/* Equipment Order Display */}
                                                                {isEquipment && (
                                                                    <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                        {(() => {
                                                                            // Parse equipment details from order notes or orderDetails
                                                                            let equipmentDetails: any = null;
                                                                            try {
                                                                                if (order.orderDetails?.equipmentSelection) {
                                                                                    equipmentDetails = order.orderDetails.equipmentSelection;
                                                                                } else if (order.notes) {
                                                                                    const parsed = JSON.parse(order.notes);
                                                                                    if (parsed.equipmentName) {
                                                                                        equipmentDetails = parsed;
                                                                                    }
                                                                                }
                                                                            } catch (e) {
                                                                                console.error('Error parsing equipment order:', e);
                                                                            }

                                                                            const vendorId = equipmentDetails?.vendorId;
                                                                            const vendor = vendorId ? vendors.find(v => v.id === vendorId) : null;
                                                                            const vendorName = vendor?.name || 'Unknown Vendor';
                                                                            const equipmentName = equipmentDetails?.equipmentName || 'Unknown Equipment';
                                                                            const price = equipmentDetails?.price || order.totalValue || 0;
                                                                            const nextDelivery = vendorId ? getNextDeliveryDate(vendorId) : null;

                                                                            return (
                                                                                <>
                                                                                    {/* Vendor */}
                                                                                    <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                                        {vendorName}
                                                                                    </div>
                                                                                    {/* Equipment Item */}
                                                                                    <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                        <Wrench size={14} />
                                                                                        <span>{equipmentName}</span>
                                                                                        <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--color-primary)' }}>
                                                                                            ${price.toFixed(2)}
                                                                                        </span>
                                                                                    </div>
                                                                                    {nextDelivery && (
                                                                                        <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                                                                            Next delivery: {nextDelivery.dayOfWeek}, {nextDelivery.date}
                                                                                        </div>
                                                                                    )}
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
                                    No recent orders.
                                </div>
                            )}
                        </section>
                    </div>
                </div>
            )}
            {
                onClose && (
                    <div className={styles.bottomAction} style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                        <button
                            className="btn"
                            onClick={handleDiscardChanges}
                            disabled={saving}
                            style={{
                                width: '200px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                background: 'none',
                                border: '1px solid var(--border-color)',
                                color: 'var(--text-secondary)',
                                opacity: saving ? 0.7 : 1,
                                cursor: saving ? 'not-allowed' : 'pointer'
                            }}
                        >
                            Discard Changes
                        </button>
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
        if (!client && !isNewClient) {
            console.timeEnd('handleSave:pre-check');
            console.timeEnd('handleSave:total');
            return false;
        }

        // Validate approvedMealsPerWeek min/max bounds
        // Allow 0/undefined (can be under min), but if > 0, must be within min/max bounds
        const approvedMeals = formData.approvedMealsPerWeek ?? 0;

        // If value is > 0, validate it's within bounds (0 is always allowed)
        if (approvedMeals > 0) {
            if (approvedMeals < MIN_APPROVED_MEALS_PER_WEEK) {
                setValidationError({
                    show: true,
                    messages: [`Approved meals per week (${approvedMeals}) must be at least ${MIN_APPROVED_MEALS_PER_WEEK}.`]
                });
                console.timeEnd('handleSave:pre-check');
                console.timeEnd('handleSave:total');
                return false;
            }
            if (approvedMeals > MAX_APPROVED_MEALS_PER_WEEK) {
                setValidationError({
                    show: true,
                    messages: [`Approved meals per week (${approvedMeals}) must be at most ${MAX_APPROVED_MEALS_PER_WEEK}.`]
                });
                console.timeEnd('handleSave:pre-check');
                console.timeEnd('handleSave:total');
                return false;
            }
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
        // Only show units modal if the new status requires units on change
        // Skip this check for new clients
        if (!isNewClient && client) {
            console.log('[handleSave] Status change check:', {
                userRole: currentUser?.role,
                isNavigator: currentUser?.role === 'navigator',
                oldStatusId: client.statusId,
                newStatusId: formData.statusId,
                statusChanged: formData.statusId !== client.statusId,
                statusesCount: statuses.length,
                allStatuses: statuses.map(s => ({ id: s.id, name: s.name, requiresUnitsOnChange: s.requiresUnitsOnChange }))
            });

            if (currentUser?.role === 'navigator' && formData.statusId !== client.statusId) {
                const newStatus = statuses.find(s => s.id === formData.statusId);
                console.log('[handleSave] Found new status:', {
                    statusId: formData.statusId,
                    statusFound: !!newStatus,
                    statusName: newStatus?.name,
                    requiresUnitsOnChange: newStatus?.requiresUnitsOnChange,
                    fullStatus: newStatus
                });

                // Only show modal if the new status has requiresUnitsOnChange enabled
                if (newStatus?.requiresUnitsOnChange) {
                    console.timeEnd('handleSave:pre-check');
                    console.log('[handleSave] Detected status change to status that requires units, showing modal');

                    try {
                        const oldStatusName = getStatusName(client.statusId);
                        const newStatusName = getStatusName(formData.statusId!);
                        setPendingStatusChange({ oldStatus: oldStatusName, newStatus: newStatusName });
                        setShowUnitsModal(true);
                        console.log('[handleSave] Modal state set to true, returning false to intercept');
                        return false; // Intercepted
                    } catch (e) {
                        console.error('[handleSave] Error in status change logic:', e);
                    }
                } else {
                    // Status change doesn't require units, proceed with save
                    console.log('[handleSave] Status change detected but new status does not require units. requiresUnitsOnChange:', newStatus?.requiresUnitsOnChange);
                }
            } else {
                console.log('[handleSave] Status change check failed:', {
                    userRole: currentUser?.role,
                    isNavigator: currentUser?.role === 'navigator',
                    statusChanged: formData.statusId !== client.statusId
                });
            }
        }


        return await executeSave(0);
    }

    async function executeSave(unitsAdded: number = 0): Promise<boolean> {
        if (!client && !isNewClient) return false;
        setSaving(true);
        setMessage(null);

        try {
            // Handle new client creation
            if (isNewClient) {
                // Prepare client data with defaults
                const initialStatusId = (initialStatuses || statuses)[0]?.id || '';
                const defaultNavigatorId = (initialNavigators || navigators).find(n => n.isActive)?.id || '';
                
                const clientData: Omit<ClientProfile, 'id' | 'createdAt' | 'updatedAt'> = {
                    fullName: formData.fullName || '',
                    email: formData.email || '',
                    address: formData.address || '',
                    phoneNumber: formData.phoneNumber || '',
                    secondaryPhoneNumber: formData.secondaryPhoneNumber || null,
                    navigatorId: formData.navigatorId || defaultNavigatorId,
                    endDate: formData.endDate || '',
                    screeningTookPlace: formData.screeningTookPlace || false,
                    screeningSigned: formData.screeningSigned || false,
                    notes: formData.notes || '',
                    statusId: formData.statusId || initialStatusId,
                    serviceType: formData.serviceType || 'Food',
                    approvedMealsPerWeek: formData.approvedMealsPerWeek || 21,
                    activeOrder: orderConfig && orderConfig.caseId ? orderConfig : undefined
                };

                const newClient = await addClient(clientData);
                if (newClient) {
                    // Update state with the newly created client
                    setActualClientId(newClient.id);
                    setClient(newClient);
                    setFormData(newClient);
                    invalidateClientData();
                    setMessage('Client created successfully.');
                    
                    // If there's an order config, sync it
                    if (orderConfig && orderConfig.caseId) {
                        await syncCurrentOrderToUpcoming(newClient.id, newClient, true);
                    }
                    
                    setSaving(false);
                    return true;
                } else {
                    setSaving(false);
                    return false;
                }
            }

            // Existing client update logic
            if (!client) {
                setSaving(false);
                return false;
            }

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
            if ((client.secondaryPhoneNumber || '') !== (formData.secondaryPhoneNumber || '')) {
                changes.push(`Secondary Phone: "${client.secondaryPhoneNumber || ''}" -> "${formData.secondaryPhoneNumber || ''}"`);
            }
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
            // We defer this call until after we've prepared the activeOrder above if needed
            // But wait, the order config block is BELOW this. We need to move the updateClient call down or move the prep up.
            // Actually, let's keep it simple: 
            // 1. Calculate changes
            // 2. Prepare updateData
            // 3. IF order changes, add activeOrder to updateData
            // 4. Call updateClient once

            // Checking order changes again...
            // The original code called updateClient BEFORE calculating cleanedOrderConfig.
            // This means we need to restructure a bit.

            let updateData: Partial<ClientProfile> = { ...formData };

            await recordClientChange(clientId, summary, 'Admin');

            // Sync Current Order Request
            const hasOrderConfigChanges = JSON.stringify(orderConfig) !== JSON.stringify(originalOrderConfig);
            if (hasOrderConfigChanges || hasOrderChanges) {
                const cleanedOrderConfig = { ...orderConfig };

                // CRITICAL: Always preserve caseId at the top level for both Food and Boxes
                cleanedOrderConfig.caseId = orderConfig.caseId;

                if (formData.serviceType === 'Food') {
                    // For Food service: Ensure vendorId and items are preserved in all vendor selections
                    if (cleanedOrderConfig.deliveryDayOrders) {
                        // Multi-day format: Clean and preserve vendor selections for each day
                        for (const day of Object.keys(cleanedOrderConfig.deliveryDayOrders)) {
                            cleanedOrderConfig.deliveryDayOrders[day].vendorSelections = (cleanedOrderConfig.deliveryDayOrders[day].vendorSelections || [])
                                .filter((s: any) => s.vendorId) // Only keep selections with a vendor
                                .map((s: any) => ({
                                    vendorId: s.vendorId, // Preserve vendor ID
                                    items: s.items || {} // Preserve items
                                }));
                        }
                    } else if (cleanedOrderConfig.vendorSelections) {
                        // Check if we have per-vendor delivery days (itemsByDay format)
                        const hasPerVendorDeliveryDays = cleanedOrderConfig.vendorSelections.some((s: any) =>
                            s.selectedDeliveryDays && s.selectedDeliveryDays.length > 0 && s.itemsByDay
                        );

                        if (hasPerVendorDeliveryDays) {
                            // Convert per-vendor delivery days to deliveryDayOrders format
                            const deliveryDayOrders: any = {};
                            for (const selection of cleanedOrderConfig.vendorSelections) {
                                if (!selection.vendorId || !selection.selectedDeliveryDays || !selection.itemsByDay) continue;

                                for (const day of selection.selectedDeliveryDays) {
                                    if (!deliveryDayOrders[day]) deliveryDayOrders[day] = { vendorSelections: [] };
                                    const dayItems = selection.itemsByDay[day] || {};
                                    const hasItems = Object.keys(dayItems).length > 0 && Object.values(dayItems).some((qty: any) => (Number(qty) || 0) > 0);
                                    if (hasItems) {
                                        // Preserve vendorId and items for this day
                                        deliveryDayOrders[day].vendorSelections.push({
                                            vendorId: selection.vendorId,
                                            items: dayItems
                                        });
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
                            // Single-day format: Clean and preserve vendor selections
                            cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                                .filter((s: any) => s.vendorId) // Only keep selections with a vendor
                                .map((s: any) => ({
                                    vendorId: s.vendorId, // Preserve vendor ID
                                    items: s.items || {} // Preserve items
                                }));
                        }
                    }
                } else if (formData.serviceType === 'Boxes') {
                    // For Boxes: Explicitly preserve all critical fields
                    cleanedOrderConfig.vendorId = orderConfig.vendorId; // Preserve vendor ID
                    cleanedOrderConfig.caseId = orderConfig.caseId; // Preserve case ID (also set above)
                    cleanedOrderConfig.boxTypeId = orderConfig.boxTypeId; // Preserve box type
                    cleanedOrderConfig.boxQuantity = orderConfig.boxQuantity || 1; // Preserve quantity
                    cleanedOrderConfig.items = orderConfig.items || {}; // Preserve items
                    cleanedOrderConfig.itemPrices = orderConfig.itemPrices || {}; // Preserve item prices
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

                // Add activeOrder to updateData so updateClient handles the full save + sync efficiently
                // efficiently with only ONE revalidation
                updateData.activeOrder = tempClient.activeOrder;
            }

            // CRITICAL: Execute the single update call
            await updateClient(clientId, updateData);

            // Reload upcoming order if we had order changes
            if (hasOrderConfigChanges || hasOrderChanges) {
                const updatedUpcomingOrder = await getUpcomingOrderForClient(clientId);
                if (updatedUpcomingOrder) {
                    setOrderConfig(updatedUpcomingOrder);
                    setOriginalOrderConfig(JSON.parse(JSON.stringify(updatedUpcomingOrder)));
                }
            }

            // Show cutoff-aware confirmation message if order was saved
            let confirmationMessage = 'Changes saved successfully.';
            if (hasOrderChanges && orderConfig && orderConfig.caseId) {
                const cutoffPassed = isCutoffPassed();
                const takeEffectDate = getEarliestTakeEffectDateForOrder();
                const nextDeliveryDate = getEarliestDeliveryDateForOrder();

                if (cutoffPassed && takeEffectDate) {
                    confirmationMessage = `Order saved. The cutoff date has passed, so this order will take effect on ${takeEffectDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}. View Recent Orders section to see what will be delivered this week.`;
                } else if (nextDeliveryDate) {
                    confirmationMessage = `Order saved successfully. This order will take effect on ${nextDeliveryDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`;
                }
            }

            if (onClose) {
                onClose();
            } else {
                setMessage(confirmationMessage);
                setTimeout(() => setMessage(null), 6000); // Longer timeout for longer messages
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
                    <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
                        {saving && (
                            <div className={styles.savingOverlay}>
                                <div className={styles.savingIndicator}>
                                    <Loader2 size={48} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                                    <p className={styles.savingText}>Saving changes...</p>
                                </div>
                            </div>
                        )}
                        <div style={{ filter: saving ? 'blur(4px)' : 'none', pointerEvents: saving ? 'none' : 'auto' }}>
                            {content}
                        </div>
                    </div>
                </div>
                {validationError.show && (
                    <div className={styles.modalOverlay} style={{ zIndex: 200 }}>
                        <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                                <AlertTriangle size={24} />
                                Cannot Save
                            </h2>
                            <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                                Please fix the following errors before saving:
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
                    onClose={() => {
                        setShowUnitsModal(false);
                        setPendingStatusChange(null);
                    }}
                    onConfirm={executeSave}
                    saving={saving}
                />
                <DeleteConfirmationModal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    onConfirm={handleDelete}
                    clientName={formData.fullName || 'this client'}
                    deleting={saving}
                />
            </>
        );
    } else {
        return (
            <>
                <div style={{ position: 'relative' }}>
                    {saving && (
                        <div className={styles.savingOverlay}>
                            <div className={styles.savingIndicator}>
                                <Loader2 size={48} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                                <p className={styles.savingText}>Saving changes...</p>
                            </div>
                        </div>
                    )}
                    <div style={{ filter: saving ? 'blur(4px)' : 'none', pointerEvents: saving ? 'none' : 'auto' }}>
                        {content}
                    </div>
                </div>
                {validationError.show && (
                    <div className={styles.modalOverlay} style={{ zIndex: 200 }}>
                        <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                                <AlertTriangle size={24} />
                                Cannot Save
                            </h2>
                            <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                                Please fix the following errors before saving:
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
                    onClose={() => {
                        setShowUnitsModal(false);
                        setPendingStatusChange(null);
                    }}
                    onConfirm={executeSave}
                    saving={saving}
                />
                <DeleteConfirmationModal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    onConfirm={handleDelete}
                    clientName={formData.fullName || 'this client'}
                    deleting={saving}
                />
            </>
        );
    }
}
