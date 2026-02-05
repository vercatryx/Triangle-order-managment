'use client';

import { useState, useEffect, Fragment, useMemo, useRef, ReactNode } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ServiceType, AppSettings, DeliveryRecord, ItemCategory, ClientFullDetails, BoxQuota, MealCategory, MealItem, ClientFoodOrder, ClientMealOrder, ClientBoxOrder, Equipment, OrderConfiguration } from '@/lib/types';
import { updateClient, addClient, deleteClient, updateDeliveryProof, recordClientChange, logNavigatorAction, getBoxQuotas, saveEquipmentOrder, getRegularClients, getDependentsByParentId, addDependent, checkClientNameExists, getClientFullDetails, saveClientCustomOrder, getEquipment, getClientProfileData, appendOrderHistory, updateClientUpcomingOrder } from '@/lib/actions';
import { getSingleForm, getClientSubmissions } from '@/lib/form-actions';
import { getClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getSettings, getCategories, getClients, invalidateClientData, invalidateReferenceData, getActiveOrderForClient, getUpcomingOrderForClient, getOrderHistory, getClientHistory, getBillingHistory, invalidateOrderData, getMealCategories, getMealItems, getRecentOrdersForClient, getClientsLight } from '@/lib/cached-data';
import { areAnyDeliveriesLocked, getEarliestEffectiveDate, getLockedWeekDescription } from '@/lib/weekly-lock';
import {
    getNextDeliveryDate as getNextDeliveryDateUtil,
    getNextDeliveryDateForDay,
    getTakeEffectDate,
    getAllDeliveryDatesForOrder,
    formatDeliveryDate
} from '@/lib/order-dates';
import { isMeetingMinimum, isExceedingMaximum, isMeetingExactTarget } from '@/lib/utils';
import { Save, ArrowLeft, Truck, Package, AlertTriangle, Upload, Trash2, Plus, Check, ClipboardList, History, CreditCard, Calendar, ChevronDown, ChevronUp, ShoppingCart, Loader2, FileText, Square, CheckSquare, Wrench, Info, Construction, ChevronRight, X, RotateCcw } from 'lucide-react';
import FormFiller from '@/components/forms/FormFiller';
import { FormSchema } from '@/lib/form-types';
import TextareaAutosize from 'react-textarea-autosize';
import SubmissionsList from './SubmissionsList';
import styles from './ClientProfile.module.css';
import FoodServiceWidget from './FoodServiceWidget';
import MenuItemCard from './MenuItemCard';


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
    settings?: AppSettings | null;
    categories?: ItemCategory[];
    mealCategories?: MealCategory[];
    mealItems?: MealItem[];
    equipment?: Equipment[];
    allClients?: any[];
    regularClients?: any[];
    currentUser?: { role: string; id: string } | null;
    onBackgroundSave?: (clientId: string, clientName: string, saveAction: () => Promise<void>) => void;
}

const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes', 'Custom'];

// Min/Max validation for approved meals per week
const MIN_APPROVED_MEALS_PER_WEEK = 1;
const MAX_APPROVED_MEALS_PER_WEEK = 500;


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

function DuplicateNameConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    clientName,
    creating
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    clientName: string;
    creating: boolean;
}) {
    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} style={{ zIndex: 1000 }}>
            <div className={styles.modalContent} style={{ maxWidth: '450px', height: 'auto', padding: '24px' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', color: 'var(--color-warning)' }}>Duplicate Client Name</h2>
                <p style={{ marginBottom: '24px', color: 'var(--text-secondary)' }}>
                    A client with the name <strong>{clientName}</strong> already exists. Do you want to create another client with the same name?
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button className="btn" onClick={onClose} disabled={creating}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        onClick={onConfirm}
                        disabled={creating}
                    >
                        {creating ? <Loader2 className="spin" size={16} /> : 'Yes, Create Another'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function EmptyOrderConfirmModal({
    isOpen,
    onClose,
    onConfirm,
    saving
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    saving: boolean;
}) {
    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} style={{ zIndex: 1000 }} onClick={onClose}>
            <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', color: 'var(--text-primary)' }}>Save with empty order?</h2>
                <p style={{ marginBottom: '24px', color: 'var(--text-secondary)' }}>
                    This client has no items in their order. Do you want to save the client with an empty order?
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        onClick={onConfirm}
                        disabled={saving}
                    >
                        {saving ? <Loader2 className="spin" size={16} /> : 'Yes, save as empty'}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function ClientProfileDetail({
    clientId: propClientId,
    onClose,
    initialData,
    statuses: initialStatuses,
    navigators: initialNavigators,
    vendors: initialVendors,
    menuItems: initialMenuItems,
    boxTypes: initialBoxTypes,
    settings: initialSettings,
    categories: initialCategories,
    mealCategories: initialMealCategories,
    mealItems: initialMealItems,
    equipment: initialEquipment,
    allClients: initialAllClients,
    regularClients: initialRegularClients,
    currentUser,
    onBackgroundSave
}: Props): ReactNode {

    const router = useRouter();
    const params = useParams();
    const propClientIdValue = (params?.id as string) || propClientId;

    // Track the actual clientId (starts as prop, updates to real ID after creating new client)
    const [actualClientId, setActualClientId] = useState<string>(propClientIdValue);
    const clientId = actualClientId;
    const isNewClient = clientId === 'new';

    // Track if we just created a new client to prevent useEffect from overwriting orderConfig
    const justCreatedClientRef = useRef<boolean>(false);

    const [client, setClient] = useState<ClientProfile | null>(null);
    const [statuses, setStatuses] = useState<ClientStatus[]>(initialStatuses || []);
    const [navigators, setNavigators] = useState<Navigator[]>(initialNavigators || []);
    const [vendors, setVendors] = useState<Vendor[]>(initialVendors || []);
    const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems || []);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>(initialBoxTypes || []);
    const [categories, setCategories] = useState<ItemCategory[]>(initialCategories || []);
    const [mealCategories, setMealCategories] = useState<MealCategory[]>(initialMealCategories || []);
    const [mealItems, setMealItems] = useState<MealItem[]>(initialMealItems || []);
    const [boxQuotas, setBoxQuotas] = useState<BoxQuota[]>([]);
    const [equipment, setEquipment] = useState<any[]>(initialEquipment || []);
    const [showEquipmentOrder, setShowEquipmentOrder] = useState(false);
    const [equipmentOrder, setEquipmentOrder] = useState<{ vendorId: string; equipmentId: string; caseId: string } | null>(null);
    const [submittingEquipmentOrder, setSubmittingEquipmentOrder] = useState(false);

    // State to track which category shelf is open (format: "boxIndex-categoryId")
    const [openCategoryShelf, setOpenCategoryShelf] = useState<string | null>(null);

    // Helper to generate category shelf ID
    const getCategoryShelfId = (boxIndex: number, categoryId: string) => `box-${boxIndex}-cat-${categoryId}`;

    // Helper to check if a category shelf is open
    const isCategoryShelfOpen = (boxIndex: number, categoryId: string) => {
        return openCategoryShelf === getCategoryShelfId(boxIndex, categoryId);
    };

    // Helper to toggle category shelf (only one can be open per box)
    const toggleCategoryShelf = (boxIndex: number, categoryId: string) => {
        const shelfId = getCategoryShelfId(boxIndex, categoryId);
        // If clicking the same shelf, close it. Otherwise, open the new one (automatically closes any other in this box)
        if (openCategoryShelf === shelfId) {
            setOpenCategoryShelf(null);
        } else {
            // Open this shelf (this automatically closes any other shelf since only one can be open)
            setOpenCategoryShelf(shelfId);
        }
    };

    // Same shelf state for Upcoming (new column) section so both sections can have independent open/close
    const [openNewColumnCategoryShelf, setOpenNewColumnCategoryShelf] = useState<string | null>(null);
    const getNewColumnCategoryShelfId = (boxIndex: number, categoryId: string) => `newColumn-box-${boxIndex}-cat-${categoryId}`;
    const isNewColumnCategoryShelfOpen = (boxIndex: number, categoryId: string) =>
        openNewColumnCategoryShelf === getNewColumnCategoryShelfId(boxIndex, categoryId);
    const toggleNewColumnCategoryShelf = (boxIndex: number, categoryId: string) => {
        const shelfId = getNewColumnCategoryShelfId(boxIndex, categoryId);
        if (openNewColumnCategoryShelf === shelfId) {
            setOpenNewColumnCategoryShelf(null);
        } else {
            setOpenNewColumnCategoryShelf(shelfId);
        }
    };

    const [settings, setSettings] = useState<AppSettings | null>(initialSettings || null);
    const [history, setHistory] = useState<DeliveryRecord[]>([]);
    const [orderHistory, setOrderHistory] = useState<any[]>([]);
    const [billingHistory, setBillingHistory] = useState<any[]>([]);
    const [activeHistoryTab, setActiveHistoryTab] = useState<'deliveries' | 'audit' | 'billing'>('deliveries');
    const [clientOrderHistory, setClientOrderHistory] = useState<any[]>([]);
    const [orderHistoryRestoringId, setOrderHistoryRestoringId] = useState<string | null>(null); // actionId of entry being restored
    const [orderHistoryRestoreMessage, setOrderHistoryRestoreMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [orderHistoryExpanded, setOrderHistoryExpanded] = useState<boolean>(false); // Default closed when opening client profile
    const [recentOrdersExpanded, setRecentOrdersExpanded] = useState<boolean>(false);
    const [historyExpanded, setHistoryExpanded] = useState<boolean>(false);
    const [billingHistoryExpanded, setBillingHistoryExpanded] = useState<boolean>(false);
    const [allClients, setAllClients] = useState<any[]>(initialAllClients || []); // optimization: lightweight list
    const [expandedBillingRows, setExpandedBillingRows] = useState<Set<string>>(new Set());
    const [regularClients, setRegularClients] = useState<any[]>(initialRegularClients || []); // optimization: lightweight list
    const [parentClientSearch, setParentClientSearch] = useState('');
    const [showParentSearch, setShowParentSearch] = useState(false);
    const [dependents, setDependents] = useState<ClientProfile[]>([]);

    // Lazy Loading State
    const [historyLoaded, setHistoryLoaded] = useState(false);
    const [loadingHistory, setLoadingHistory] = useState(false);

    const [formData, setFormData] = useState<Partial<ClientProfile>>({});
    const [orderConfig, setOrderConfig] = useState<any>({}); // Current Order Request (from upcoming_orders)
    const [originalOrderConfig, setOriginalOrderConfig] = useState<any>({}); // Original Order Request for comparison

    // New column: clients.upcoming_order (JSON) — load/save only this column, same UI as current order
    const [newColumnOrderConfig, setNewColumnOrderConfig] = useState<any>({});
    const [savingNewColumn, setSavingNewColumn] = useState(false);

    // Track which client we last loaded upcoming order for — only sync when client changes (don't overwrite during editing)
    const lastUpcomingOrderClientIdRef = useRef<string | null>(null);

    // Sync new-column order from client.upcomingOrder when client loads. Loads ONLY from clients.upcoming_order column.
    // Normalize deliveryDayOrders → vendorSelections so the widget can add/subtract items. Only runs when navigating to a different client.
    useEffect(() => {
        const raw = (client as any)?.upcomingOrder;
        if (!client?.id || raw === undefined) return;
        // Only load when we switch to a different client — prevents overwriting user edits
        if (lastUpcomingOrderClientIdRef.current === client.id) return;
        lastUpcomingOrderClientIdRef.current = client.id;

        const parsed = raw && typeof raw === 'object' ? (typeof raw.serviceType === 'string' || raw.caseId || Object.keys(raw).length > 0 ? raw : {}) : {};
        let config: any = parsed ? { ...parsed } : {};
        const st = config.serviceType;

        if (st === 'Boxes') {
            // Normalize Boxes per UPCOMING_ORDER_SCHEMA: serviceType, caseId, boxOrders, notes
            const rawBoxOrders = config.boxOrders ?? config.box_orders;
            const boxOrdersArray = Array.isArray(rawBoxOrders) ? rawBoxOrders : [];
            config = {
                serviceType: 'Boxes',
                caseId: config.caseId ?? config.case_id ?? '',
                boxOrders: boxOrdersArray.map((box: any) => ({
                    boxTypeId: box.boxTypeId ?? box.box_type_id ?? '',
                    vendorId: box.vendorId ?? box.vendor_id ?? '',
                    quantity: typeof box.quantity === 'number' ? box.quantity : (parseInt(box.quantity, 10) || 1),
                    items: box.items && typeof box.items === 'object' ? box.items : {},
                    itemNotes: box.itemNotes && typeof box.itemNotes === 'object' ? box.itemNotes : {}
                })),
                notes: config.notes ?? ''
            };
            if (config.boxOrders.length === 0) {
                config.boxOrders = [{ boxTypeId: '', vendorId: '', quantity: 1, items: {}, itemNotes: {} }];
            }
        } else if (st === 'Food' || st === 'Meal') {
            // Normalize: if we have deliveryDayOrders but no vendorSelections, convert so widget can edit
            const hasVendorSelections = config.vendorSelections && config.vendorSelections.length > 0 && config.vendorSelections.some((s: any) => s?.vendorId || (s?.items && Object.keys(s.items || {}).length > 0));
            if (!hasVendorSelections && config.deliveryDayOrders && typeof config.deliveryDayOrders === 'object' && Object.keys(config.deliveryDayOrders).length > 0) {
                const vendorMap = new Map<string, any>();
                for (const day of Object.keys(config.deliveryDayOrders).sort()) {
                    const dayOrder = config.deliveryDayOrders[day];
                    const daySelections = dayOrder?.vendorSelections || [];
                    for (const sel of daySelections) {
                        if (!sel.vendorId) continue;
                        if (!vendorMap.has(sel.vendorId)) {
                            vendorMap.set(sel.vendorId, {
                                vendorId: sel.vendorId,
                                selectedDeliveryDays: [],
                                itemsByDay: {},
                                itemNotesByDay: {}
                            });
                        }
                        const v = vendorMap.get(sel.vendorId);
                        if (!v.selectedDeliveryDays.includes(day)) v.selectedDeliveryDays.push(day);
                        v.itemsByDay[day] = sel.items || {};
                        v.itemNotesByDay[day] = sel.itemNotes || {};
                    }
                }
                config = { ...config, vendorSelections: Array.from(vendorMap.values()) };
            }
            const hasVendorData = (config.vendorSelections && config.vendorSelections.length > 0) ||
                (config.deliveryDayOrders && Object.keys(config.deliveryDayOrders || {}).length > 0) ||
                (config.mealSelections && Object.keys(config.mealSelections || {}).length > 0);
            if (config.caseId && !hasVendorData) {
                config = { ...config, serviceType: st || config.serviceType, vendorSelections: [{ vendorId: '', items: {} }] };
            }
        }
        setNewColumnOrderConfig(config);
    }, [client?.id, (client as any)?.upcomingOrder]);

    // When new-column section shows Boxes and boxOrders is empty, initialize one empty box. Use functional update to avoid overwriting loaded data (React batching).
    useEffect(() => {
        const st = newColumnOrderConfig.serviceType || formData.serviceType;
        if (st !== 'Boxes') return;
        setNewColumnOrderConfig((prev: any) => {
            if (prev.serviceType && prev.serviceType !== 'Boxes') return prev;
            if (prev.boxOrders && prev.boxOrders.length > 0) return prev; // Already loaded from DB, don't overwrite
            const firstActiveBoxType = boxTypes?.find((bt: any) => bt.isActive);
            return {
                ...prev,
                serviceType: 'Boxes',
                boxOrders: [{ boxTypeId: firstActiveBoxType?.id || '', vendorId: firstActiveBoxType?.vendorId || '', quantity: 1, items: {}, itemNotes: {} }]
            };
        });
    }, [formData.serviceType, newColumnOrderConfig.serviceType, boxTypes]);

    // Debug: Log when orderConfig changes
    useEffect(() => {
        if (clientId) {
            console.log(`[ClientProfile] orderConfig changed for ${clientId}:`, {
                hasOrderConfig: !!orderConfig,
                orderConfigKeys: orderConfig ? Object.keys(orderConfig) : [],
                serviceType: orderConfig?.serviceType,
                caseId: orderConfig?.caseId,
                hasVendorSelections: !!orderConfig?.vendorSelections,
                vendorSelectionsLength: orderConfig?.vendorSelections?.length,
                id: orderConfig?.id
            });
        }
    }, [orderConfig, clientId]);

    // --- INDEPENDENT ORDER CONFIGS ---
    const [foodOrderConfig, setFoodOrderConfig] = useState<Partial<ClientFoodOrder> | null>(null);
    const [originalFoodOrderConfig, setOriginalFoodOrderConfig] = useState<Partial<ClientFoodOrder> | null>(null);

    const [mealOrderConfig, setMealOrderConfig] = useState<Partial<ClientMealOrder> | null>(null);
    const [originalMealOrderConfig, setOriginalMealOrderConfig] = useState<Partial<ClientMealOrder> | null>(null);

    const [boxOrderConfig, setBoxOrderConfig] = useState<Partial<ClientBoxOrder>[] | null>(null);
    const [originalBoxOrderConfig, setOriginalBoxOrderConfig] = useState<Partial<ClientBoxOrder>[] | null>(null);

    const [activeOrder, setActiveOrder] = useState<any>(null); // Recent Orders (from orders table)


    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);

    const [loading, setLoading] = useState(true);
    const [loadingOrderDetails, setLoadingOrderDetails] = useState(true);
    const [loadingRecentOrders, setLoadingRecentOrders] = useState(false);

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

    // Duplicate Name Confirmation Modal
    const [showDuplicateNameModal, setShowDuplicateNameModal] = useState(false);
    const [pendingClientData, setPendingClientData] = useState<Omit<ClientProfile, 'id' | 'createdAt' | 'updatedAt'> | null>(null);

    // Empty Order Confirmation Modal (save client with no order items)
    const [showEmptyOrderConfirmModal, setShowEmptyOrderConfirmModal] = useState(false);
    const pendingEmptyOrderSaveRef = useRef<(() => void) | null>(null);

    // Dependent Creation State
    const [showAddDependentForm, setShowAddDependentForm] = useState(false);
    const [dependentName, setDependentName] = useState('');
    const [dependentDob, setDependentDob] = useState('');
    const [dependentCin, setDependentCin] = useState('');
    const [creatingDependent, setCreatingDependent] = useState(false);



    useEffect(() => {
        console.log(`[ClientProfile] useEffect triggered for clientId: ${clientId}`, {
            isNewClient,
            hasInitialData: !!initialData,
            initialDataClientId: initialData?.client?.id,
            matchesClientId: initialData?.client?.id === clientId
        });

        // Handle new client case - initialize with defaults
        if (isNewClient) {
            console.log(`[ClientProfile] Initializing new client`);
            setLoading(true);
            // Load lookups but don't load client data
            const loaderPromise = (initialStatuses && initialNavigators && initialVendors && initialMenuItems && initialBoxTypes)
                ? Promise.resolve()
                : loadLookups();

            loaderPromise.then(() => {
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
                    approvedMealsPerWeek: 21,
                    authorizedAmount: null,
                    expirationDate: null
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

        // If we just created this client, skip reloading to preserve the orderConfig we just set
        if (justCreatedClientRef.current) {
            console.log(`[ClientProfile] Skipping reload for just-created client: ${clientId}`);
            justCreatedClientRef.current = false; // Reset the flag
            return;
        }



        // Always fetch fresh data from the server and show loading until it's ready (do not paint from cache).
        console.log(`[ClientProfile] Loading fresh data for ${clientId}`);
        setLoading(true);
        loadData().then(() => setLoading(false));
    }, [clientId, isNewClient]);

    useEffect(() => {
        // Load submissions for this client
        if (clientId) {
            loadSubmissions();
        }
    }, [clientId]);

    // Effect: Initialize box quantity when Boxes service is selected
    useEffect(() => {
        // If Boxes service is selected and no boxOrders, initialize it
        if (formData.serviceType === 'Boxes' && (!orderConfig.boxOrders || orderConfig.boxOrders.length === 0)) {
            const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
            setOrderConfig((prev: any) => ({
                ...prev,
                boxOrders: [{
                    boxTypeId: firstActiveBoxType?.id || '',
                    vendorId: firstActiveBoxType?.vendorId || '',
                    quantity: 1,
                    items: {}
                }]
            }));
        }
    }, [formData.serviceType, boxTypes]);

    // Extract dependencies with defaults to ensure consistent array size
    const caseId = useMemo(() => orderConfig?.caseId ?? null, [orderConfig?.caseId]);
    const vendorSelections = useMemo(() => orderConfig?.vendorSelections ?? [], [orderConfig?.vendorSelections]);
    const vendorId = useMemo(() => orderConfig?.vendorId ?? null, [orderConfig?.vendorId]);
    const boxTypeId = useMemo(() => orderConfig?.boxTypeId ?? null, [orderConfig?.boxTypeId]);
    const boxQuantity = useMemo(() => orderConfig?.boxQuantity ?? null, [orderConfig?.boxQuantity]);
    const items = useMemo(() => (orderConfig as any)?.items ?? {}, [(orderConfig as any)?.items]);
    const itemPrices = useMemo(() => (orderConfig as any)?.itemPrices ?? {}, [(orderConfig as any)?.itemPrices]);
    const serviceType = useMemo(() => formData?.serviceType ?? null, [formData?.serviceType]);

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
        // Load box quotas if we have boxes
        if (formData.serviceType === 'Boxes' && orderConfig.boxOrders && orderConfig.boxOrders.length > 0) {
            // Loading quotas for the first box type for now, as UI usually shows one quota section
            const firstBoxTypeId = orderConfig.boxOrders[0].boxTypeId;
            if (firstBoxTypeId) {
                getBoxQuotas(firstBoxTypeId).then(quotas => {
                    setBoxQuotas(quotas);
                }).catch(err => {
                    console.error('Error loading box quotas:', err);
                    setBoxQuotas([]);
                });
            }
        } else {
            setBoxQuotas([]);
        }
    }, [formData.serviceType, orderConfig.boxOrders, boxTypes]);

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
        const [appSettings, catData, allClientsData, regularClientsData, mealCatData, mealItemData] = await Promise.all([
            getSettings(),
            getCategories(),
            getClientsLight(), // Optimized: getClientsLight
            getRegularClients(),
            getMealCategories(),
            getMealItems()
        ]);
        setSettings(appSettings);
        setCategories(catData);
        setAllClients(allClientsData);
        setRegularClients(regularClientsData);
        setMealCategories(mealCatData);
        setMealItems(mealItemData);

        // Load dependents if this is a regular client (not a dependent)
        const clientForDependents = clientToCheck || client;
        if (clientForDependents && !clientForDependents.parentClientId) {
            const dependentsData = await getDependentsByParentId(clientForDependents.id);
            setDependents(dependentsData);
        }
    }

    function hydrateFromInitialData(data: ClientFullDetails) {
        console.log(`[ClientProfile] hydrateFromInitialData() called for clientId: ${data.client?.id}`, {
            hasClient: !!data.client,
            hasActiveOrder: !!data.activeOrder,
            hasUpcomingOrder: !!data.upcomingOrder,
            hasFoodOrder: !!data.foodOrder,
            hasMealOrder: !!data.mealOrder,
            hasBoxOrders: !!data.boxOrders,
            boxOrdersCount: data.boxOrders?.length || 0,
            serviceType: data.client?.serviceType,
            upcomingOrderType: typeof data.upcomingOrder,
            upcomingOrderKeys: data.upcomingOrder ? Object.keys(data.upcomingOrder) : []
        });
        // 1. Run legacy logic first to handle basic hydration and backward compatibility
        _hydrateFromInitialDataLegacy(data);

        // 2. Apply Independent Order Overrides

        // Food
        console.log(`[ClientProfile] Processing food order for ${data.client?.id}:`, {
            hasFoodOrder: !!data.foodOrder,
            foodOrderSize: data.foodOrder ? JSON.stringify(data.foodOrder).length : 0
        });
        if (data.foodOrder) {
            // Convert deliveryDayOrders format from DB back to vendorSelections with itemsByDay for UI
            let foodOrderForUI = { ...data.foodOrder } as any;

            console.log(`[ClientProfile] Food order structure for ${data.client?.id}:`, {
                hasDeliveryDayOrders: !!foodOrderForUI.deliveryDayOrders,
                hasVendorSelections: !!foodOrderForUI.vendorSelections,
                deliveryDayOrdersKeys: foodOrderForUI.deliveryDayOrders ? Object.keys(foodOrderForUI.deliveryDayOrders) : [],
                vendorSelectionsCount: foodOrderForUI.vendorSelections?.length || 0,
                deliveryDayOrdersType: typeof foodOrderForUI.deliveryDayOrders,
                vendorSelectionsType: typeof foodOrderForUI.vendorSelections,
                foodOrderKeys: Object.keys(foodOrderForUI)
            });

            // Convert if we have deliveryDayOrders and either no vendorSelections or empty vendorSelections
            if (foodOrderForUI.deliveryDayOrders && (!foodOrderForUI.vendorSelections || (Array.isArray(foodOrderForUI.vendorSelections) && foodOrderForUI.vendorSelections.length === 0))) {
                console.log(`[ClientProfile] Converting deliveryDayOrders to vendorSelections for ${data.client?.id}`);

                // Build a map of vendors across all days
                const vendorMap = new Map<string, any>();

                for (const [day, dayData] of Object.entries(foodOrderForUI.deliveryDayOrders)) {
                    const vendorSelections = (dayData as any).vendorSelections || [];
                    console.log(`[ClientProfile] Processing day ${day} for ${data.client?.id}:`, {
                        vendorSelectionsCount: vendorSelections.length,
                        dayDataType: typeof dayData,
                        dayDataKeys: dayData ? Object.keys(dayData) : []
                    });

                    for (const selection of vendorSelections) {
                        if (!selection.vendorId) {
                            console.log(`[ClientProfile] Skipping selection without vendorId for ${data.client?.id} on day ${day}`);
                            continue;
                        }

                        if (!vendorMap.has(selection.vendorId)) {
                            vendorMap.set(selection.vendorId, {
                                vendorId: selection.vendorId,
                                items: {},
                                selectedDeliveryDays: [],
                                itemsByDay: {},
                                itemNotesByDay: {}
                            });
                        }

                        const vendor = vendorMap.get(selection.vendorId)!;
                        if (!vendor.selectedDeliveryDays.includes(day)) {
                            vendor.selectedDeliveryDays.push(day);
                        }
                        vendor.itemsByDay[day] = selection.items || {};

                        // Populate item notes
                        if (!vendor.itemNotesByDay) vendor.itemNotesByDay = {};
                        vendor.itemNotesByDay[day] = selection.itemNotes || {};
                    }
                }

                console.log(`[ClientProfile] Vendor map created for ${data.client?.id}:`, {
                    vendorCount: vendorMap.size,
                    vendorIds: Array.from(vendorMap.keys())
                });
                foodOrderForUI.vendorSelections = Array.from(vendorMap.values());
            } else {
                console.log(`[ClientProfile] Skipping conversion for ${data.client?.id}:`, {
                    hasDeliveryDayOrders: !!foodOrderForUI.deliveryDayOrders,
                    hasVendorSelections: !!foodOrderForUI.vendorSelections
                });
            }

            console.log(`[ClientProfile] Setting food order config for ${data.client?.id}:`, {
                vendorSelectionsCount: foodOrderForUI.vendorSelections?.length || 0,
                serviceType: data.client.serviceType
            });
            setFoodOrderConfig(foodOrderForUI);
            setOriginalFoodOrderConfig(JSON.parse(JSON.stringify(foodOrderForUI)));

            // If current service type is Food, force this config (override legacy)
            if (data.client.serviceType === 'Food') {
                console.log(`[ClientProfile] Setting orderConfig to Food for ${data.client?.id}`);
                const conf: any = { ...foodOrderForUI, serviceType: 'Food' };
                if (!conf.caseId && data.client.upcomingOrder?.caseId) {
                    conf.caseId = data.client.upcomingOrder.caseId;
                }

                // CRITICAL: Merge mealSelections from mealOrder if it exists
                if (data.mealOrder && data.mealOrder.mealSelections) {

                    conf.mealSelections = data.mealOrder.mealSelections;
                }

                setOrderConfig(conf);
                setOriginalOrderConfig(JSON.parse(JSON.stringify(conf)));
                console.log(`[ClientProfile] OrderConfig set for Food service ${data.client?.id}`);
            }
        } else {
            console.log(`[ClientProfile] No food order for ${data.client?.id}`);
            setFoodOrderConfig(null);
            setOriginalFoodOrderConfig(null);
        }


        // Meal
        console.log(`[ClientProfile] Processing meal order for ${data.client?.id}:`, {
            hasMealOrder: !!data.mealOrder,
            serviceType: data.client.serviceType
        });
        if (data.mealOrder) {
            // Meal orders are already in the correct format (mealSelections)
            // No conversion needed - just set directly


            setMealOrderConfig(data.mealOrder);
            setOriginalMealOrderConfig(JSON.parse(JSON.stringify(data.mealOrder)));

            if (data.client.serviceType === 'Meal') {
                const conf: any = { ...data.mealOrder, serviceType: 'Meal' };
                if (!conf.caseId && data.client.upcomingOrder?.caseId) {
                    conf.caseId = data.client.upcomingOrder.caseId;
                }
                setOrderConfig(conf);
                setOriginalOrderConfig(JSON.parse(JSON.stringify(conf)));
            }
        } else {
            setMealOrderConfig(null);
            setOriginalMealOrderConfig(null);
        }


        // Boxes
        console.log(`[ClientProfile] Processing box orders for ${data.client?.id}:`, {
            hasBoxOrders: !!data.boxOrders,
            boxOrdersCount: data.boxOrders?.length || 0,
            serviceType: data.client.serviceType,
            firstBox: data.boxOrders && data.boxOrders.length > 0 ? data.boxOrders[0] : undefined, // DUMP THE BOX CONTENT
            firstBoxItemNotes: data.boxOrders && data.boxOrders.length > 0 && data.boxOrders[0] ? data.boxOrders[0].itemNotes : undefined
        });
        if (data.boxOrders && data.boxOrders.length > 0) {
            console.log(`[ClientProfile] Setting box order config for ${data.client?.id} with ${data.boxOrders.length} boxes`);
            setBoxOrderConfig(data.boxOrders);
            setOriginalBoxOrderConfig(JSON.parse(JSON.stringify(data.boxOrders)));

            if (data.client.serviceType === 'Boxes') {
                console.log(`[ClientProfile] Setting orderConfig to Boxes for ${data.client?.id}`);
                const conf: any = {
                    boxOrders: data.boxOrders,
                    serviceType: 'Boxes',
                    caseId: data.client.upcomingOrder?.caseId
                };
                setOrderConfig(conf);
                setOriginalOrderConfig(JSON.parse(JSON.stringify(conf)));
                console.log(`[ClientProfile] OrderConfig set for Boxes service ${data.client?.id}`);
            }
        } else {
            console.log(`[ClientProfile] No box orders for ${data.client?.id}`);
            setBoxOrderConfig(null);
            setOriginalBoxOrderConfig(null);
        }

        // Custom
        console.log(`[ClientProfile] Processing custom order for ${data.client?.id}:`, {
            serviceType: data.client.serviceType,
            isCustom: data.client.serviceType === 'Custom'
        });
        // Check if the client has a Custom active order or if the loaded upcoming order is Custom
        if (data.client.serviceType === 'Custom') {
            // Try to find custom order data in upcomingOrder first (most recent)
            const upcoming = data.upcomingOrder as any;

            // Check if upcoming order is the multi-day object format (though Custom is single-day, safety check)
            // or direct object
            let customData = upcoming;

            // If upcoming is keyed by day, grab the first valid entry
            if (upcoming && !upcoming.serviceType && typeof upcoming === 'object') {
                const firstKey = Object.keys(upcoming)[0];
                if (firstKey) customData = upcoming[firstKey];
            }

            if (customData && customData.serviceType === 'Custom') {

                const conf = {
                    serviceType: 'Custom',
                    caseId: customData.caseId || data.client.upcomingOrder?.caseId,
                    custom_name: customData.custom_name || customData.notes, // custom_name comes from local-db, notes from direct DB?
                    custom_price: customData.custom_price || customData.totalValue,
                    vendorId: customData.vendorId,
                    deliveryDay: customData.deliveryDay,
                    // Ensure mapped fields are present for form
                    description: customData.custom_name || customData.notes,
                    totalValue: customData.custom_price || customData.totalValue
                };
                setOrderConfig(conf);
                setOriginalOrderConfig(JSON.parse(JSON.stringify(conf)));
            } else if (data.client.upcomingOrder && data.client.upcomingOrder.serviceType === 'Custom') {
                const conf = { ...data.client.upcomingOrder };
                setOrderConfig(conf);
                setOriginalOrderConfig(JSON.parse(JSON.stringify(conf)));
            }
        }

        // Order details are fully applied; safe to hide loading
        setLoadingOrderDetails(false);
    }

    function _hydrateFromInitialDataLegacy(data: ClientFullDetails) {
        console.log(`[ClientProfile] _hydrateFromInitialDataLegacy() called for clientId: ${data.client?.id}`);
        setClient(data.client);
        setFormData(data.client);

        // Set active order, history, order history, and billing history if available
        setActiveOrder(data.activeOrder || null);
        setHistory(data.history || []);
        setOrderHistory(data.orderHistory || []);
        setBillingHistory(data.billingHistory || []);

        // Load order_history from client data
        // NOTE: The data comes from getClient/mapClientFromDB which maps 'order_history' to 'orderHistory'
        try {
            // Check both locations just in case, prioritize camelCase from mapped object
            const orderHistoryData = (data.client as any)?.orderHistory || (data.client as any)?.order_history;
            if (orderHistoryData) {
                const parsed = Array.isArray(orderHistoryData) ? orderHistoryData : JSON.parse(orderHistoryData);
                // Ensure unique IDs if missing
                const processed = parsed.map((e: any, i: number) => ({ ...e, actionId: e.actionId || `${i}-${Date.now()}` }));
                setClientOrderHistory(processed.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) || []);
            } else {
                setClientOrderHistory([]);
            }
        } catch (e) {
            console.warn('Error parsing order_history:', e);
            setClientOrderHistory([]);
        }

        console.log(`[ClientProfile] Basic data set for ${data.client?.id}:`, {
            activeOrder: !!data.activeOrder,
            historyCount: data.history?.length || 0,
            orderHistoryCount: data.orderHistory?.length || 0,
            billingHistoryCount: data.billingHistory?.length || 0
        });

        // Handle upcoming order logic (reused from loadData)
        const upcomingOrderData = data.upcomingOrder;
        const foodOrderData = data.foodOrder;
        const mealOrderData = data.mealOrder;
        const boxOrdersData = data.boxOrders;

        console.log(`[ClientProfile] Processing upcoming order for ${data.client?.id}:`, {
            hasUpcomingOrder: !!upcomingOrderData,
            hasFoodOrder: !!foodOrderData,
            hasMealOrder: !!mealOrderData,
            hasBoxOrders: !!boxOrdersData,
            upcomingOrderType: typeof upcomingOrderData,
            isObject: upcomingOrderData && typeof upcomingOrderData === 'object',
            keys: upcomingOrderData && typeof upcomingOrderData === 'object' ? Object.keys(upcomingOrderData) : [],
            serviceType: (upcomingOrderData as any)?.serviceType,
            vendorSelections: (upcomingOrderData as any)?.vendorSelections,
            vendorSelectionsLength: (upcomingOrderData as any)?.vendorSelections?.length,
            vendorSelectionsIsArray: Array.isArray((upcomingOrderData as any)?.vendorSelections),
            deliveryDayOrders: (upcomingOrderData as any)?.deliveryDayOrders,
            fullUpcomingOrder: JSON.stringify(upcomingOrderData, null, 2)
        });

        // IMPORTANT: Check if upcomingOrderData is actually valid
        // An empty object {} or null should not be treated as having an upcoming order
        // But an object with keys (even if vendorSelections is empty) is valid
        const hasValidUpcomingOrder = upcomingOrderData &&
            typeof upcomingOrderData === 'object' &&
            (upcomingOrderData.serviceType || upcomingOrderData.caseId || upcomingOrderData.id || Object.keys(upcomingOrderData).length > 0);

        // Use clients.upcoming_order as single source
        if (hasValidUpcomingOrder) {

            // Check if it's the multi-day format
            const isMultiDayFormat = upcomingOrderData && typeof upcomingOrderData === 'object' &&
                !upcomingOrderData.serviceType &&
                !upcomingOrderData.deliveryDayOrders &&
                Object.keys(upcomingOrderData).some(key => {
                    const val = (upcomingOrderData as any)[key];
                    return val && val.serviceType;
                });

            if (isMultiDayFormat) {
                const deliveryDayOrders: any = {};
                const aggregatedMealSelections: any = {};
                for (const day of Object.keys(upcomingOrderData)) {
                    const dayOrder = (upcomingOrderData as any)[day];
                    if (dayOrder && dayOrder.serviceType) {
                        deliveryDayOrders[day] = { vendorSelections: dayOrder.vendorSelections || [] };
                        if (dayOrder.mealSelections) {
                            Object.entries(dayOrder.mealSelections).forEach(([key, val]) => {
                                if (!aggregatedMealSelections[key]) aggregatedMealSelections[key] = val;
                            });
                        }
                    }
                }
                const firstDayKey = Object.keys(upcomingOrderData)[0];
                const firstDayOrder = (upcomingOrderData as any)[firstDayKey];
                if (firstDayOrder?.serviceType === 'Boxes') {
                    setOrderConfig(firstDayOrder);
                } else {
                    setOrderConfig({
                        serviceType: firstDayOrder?.serviceType || data.client.serviceType,
                        caseId: firstDayOrder?.caseId,
                        deliveryDayOrders,
                        mealSelections: aggregatedMealSelections
                    });
                }
            } else if (upcomingOrderData.serviceType === 'Food' && (!upcomingOrderData.vendorSelections || upcomingOrderData.vendorSelections.length === 0) && !upcomingOrderData.deliveryDayOrders) {
                if (upcomingOrderData.vendorId) {
                    upcomingOrderData.vendorSelections = [{ vendorId: upcomingOrderData.vendorId, items: upcomingOrderData.menuSelections || {} }];
                } else if (!upcomingOrderData.vendorSelections || upcomingOrderData.vendorSelections.length === 0) {
                    upcomingOrderData.vendorSelections = [{ vendorId: '', items: {} }];
                }
                setOrderConfig({ ...upcomingOrderData, vendorSelections: upcomingOrderData.vendorSelections });
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

        // Fix for Boxes: If vendorId is missing but boxTypeId exists, try to find vendor from boxType
        // This handles cases where vendorId wasn't saved/synced correctly but boxType was
        if (data.client.serviceType === 'Boxes') {
            setOrderConfig((prev: any) => {
                const conf = { ...prev };

                // Migrate legacy fields to boxOrders array if array is missing
                if (!conf.boxOrders || conf.boxOrders.length === 0) {
                    const legacyBox = {
                        boxTypeId: conf.boxTypeId || '',
                        vendorId: conf.vendorId || '',
                        quantity: conf.boxQuantity || 1,
                        items: conf.items || {}
                    };

                    // Only add if there is actual data
                    if (legacyBox.boxTypeId || legacyBox.vendorId) {
                        conf.boxOrders = [legacyBox];
                    } else {
                        // Default empty box
                        const firstActiveBoxType = boxTypes?.find((bt: any) => bt.isActive);
                        conf.boxOrders = [{
                            boxTypeId: firstActiveBoxType?.id || '',
                            vendorId: firstActiveBoxType?.vendorId || '',
                            quantity: 1,
                            items: {}
                        }];
                    }
                }

                // Ensure legacy fields are synced for backward compat/other logic (optional, but keeping consistent)
                if (conf.boxOrders && conf.boxOrders.length > 0) {
                    conf.vendorId = conf.boxOrders[0].vendorId;
                    conf.boxTypeId = conf.boxOrders[0].boxTypeId;
                    conf.boxQuantity = conf.boxOrders[0].quantity;
                    conf.items = conf.boxOrders[0].items;
                }

                return conf;
            });
        }

        // DEBUG LOG: Final decision for Profile (Sidebar)
        // Note: orderConfig state update is async, so we can't log 'orderConfig' here directly.
        // But we know what logic path we took above.
        console.log(`[PROFILE_DEBUG] _hydrateFromInitialDataLegacy completed for ${data.client?.id}`);


    }

    async function loadLookups() {
        const [
            s, n, v, m, b, appSettings, catData, eData, allClientsData, regularClientsData, mealCatData, mealItemData
        ] = await Promise.all([
            initialStatuses ? Promise.resolve(initialStatuses) : getStatuses(),
            initialNavigators ? Promise.resolve(initialNavigators) : getNavigators(),
            initialVendors ? Promise.resolve(initialVendors) : getVendors(),
            initialMenuItems ? Promise.resolve(initialMenuItems) : getMenuItems(),
            initialBoxTypes ? Promise.resolve(initialBoxTypes) : getBoxTypes(),
            initialSettings ? Promise.resolve(initialSettings) : getSettings(),
            initialCategories ? Promise.resolve(initialCategories) : getCategories(),
            initialEquipment ? Promise.resolve(initialEquipment) : getEquipment(),
            initialAllClients ? Promise.resolve(initialAllClients) : getClientsLight(),
            initialRegularClients ? Promise.resolve(initialRegularClients) : getRegularClients(),
            initialMealCategories ? Promise.resolve(initialMealCategories) : getMealCategories(),
            initialMealItems ? Promise.resolve(initialMealItems) : getMealItems()
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
        setMealCategories(mealCatData);
        setMealItems(mealItemData);
    }

    async function loadData() {
        console.log(`[ClientProfile] loadData() called for clientId: ${clientId}`);
        setLoadingOrderDetails(true);

        // Load lookups and client data in parallel
        // Load lookups and client data in parallel
        await Promise.all([
            loadLookups(),
            (async () => {
                try {
                    console.log(`[ClientProfile] Fetching client profile data for: ${clientId}`);
                    const startTime = Date.now();
                    const details = await getClientProfileData(clientId);
                    const fetchTime = Date.now() - startTime;
                    console.log(`[ClientProfile] getClientProfileData completed in ${fetchTime}ms for ${clientId}`, {
                        hasDetails: !!details,
                        hasClient: !!details?.client,
                        hasActiveOrder: !!details?.activeOrder,
                        hasUpcomingOrder: !!details?.upcomingOrder,
                        upcomingOrderType: typeof details?.upcomingOrder,
                        upcomingOrderServiceType: (details?.upcomingOrder as any)?.serviceType,
                        upcomingOrderVendorSelections: (details?.upcomingOrder as any)?.vendorSelections,
                        upcomingOrderVendorSelectionsLength: (details?.upcomingOrder as any)?.vendorSelections?.length,
                        hasFoodOrder: !!details?.foodOrder,
                        hasMealOrder: !!details?.mealOrder,
                        hasBoxOrders: !!details?.boxOrders,
                        boxOrdersCount: details?.boxOrders?.length || 0
                    });

                    if (details) {
                        // Mock missing history for initial hydration
                        const fullDetailsInit: any = {
                            ...details,
                            history: [],
                            orderHistory: [],
                            billingHistory: [],
                            submissions: []
                        };
                        console.log(`[ClientProfile] Hydrating initial data for ${clientId}`);
                        hydrateFromInitialData(fullDetailsInit);

                        // Trigger Lazy Load of History
                        console.log(`[ClientProfile] Triggering lazy load of history for ${clientId}`);
                        loadHistoryLazy();

                        // Clear loading only after hydration state has been committed
                        queueMicrotask(() => {
                            setLoading(false);
                            setLoadingOrderDetails(false);
                        });
                    } else {
                        console.warn(`[ClientProfile] No details returned for clientId: ${clientId}`);
                        setLoading(false);
                        setLoadingOrderDetails(false);
                    }
                } catch (error) {
                    console.error(`[ClientProfile] Error in loadData for ${clientId}:`, error);
                    setLoading(false);
                    setLoadingOrderDetails(false);
                }
            })()
        ]);

        console.log(`[ClientProfile] loadData() completed for clientId: ${clientId}`);
    }

    async function loadHistoryLazy() {
        if (historyLoaded || loadingHistory) {
            console.log(`[ClientProfile] loadHistoryLazy() skipped for ${clientId} - historyLoaded: ${historyLoaded}, loadingHistory: ${loadingHistory}`);
            return;
        }
        console.log(`[ClientProfile] loadHistoryLazy() starting for ${clientId}`);
        setLoadingHistory(true);
        try {
            const startTime = Date.now();
            // Fetch in parallel - also fetch client to get updated order_history JSONB column
            const [h, oh, bh, s, clientData] = await Promise.all([
                getClientHistory(clientId),
                getOrderHistory(clientId),
                getBillingHistory(clientId),
                getClientSubmissions(clientId),
                getClient(clientId) // Reload client to get updated order_history
            ]);
            const fetchTime = Date.now() - startTime;
            console.log(`[ClientProfile] History data fetched in ${fetchTime}ms for ${clientId}:`, {
                historyCount: h?.length || 0,
                orderHistoryCount: oh?.length || 0,
                billingHistoryCount: bh?.length || 0,
                submissionsCount: s?.success ? (s.data?.length || 0) : 0,
                clientOrderHistoryCount: (clientData as any)?.order_history?.length || 0
            });
            setHistory(h || []);
            setOrderHistory(oh || []);
            setBillingHistory(bh || []);
            if (s.success && s.data) setSubmissions(s.data);

            // Load order_history from client data
            if (clientData) {
                try {
                    // Check both locations, prioritize camelCase from mapped object
                    const orderHistoryData = (clientData as any).orderHistory || (clientData as any).order_history;
                    if (orderHistoryData) {
                        const parsed = Array.isArray(orderHistoryData) ? orderHistoryData : JSON.parse(orderHistoryData);
                        console.log(`[ClientProfile] Parsed order_history for ${clientId}:`, {
                            count: parsed.length,
                            sample: parsed[0] ? Object.keys(parsed[0]) : []
                        });
                        // Newest first (backend may store either way; sort by timestamp for consistent UI)
                        const sorted = [...(parsed || [])].sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
                        setClientOrderHistory(sorted);
                    } else {
                        setClientOrderHistory([]);
                    }
                } catch (e) {
                    console.warn(`[ClientProfile] Error parsing order_history for ${clientId}:`, e);
                    setClientOrderHistory([]);
                }
            }

            setHistoryLoaded(true);
            console.log(`[ClientProfile] loadHistoryLazy() completed for ${clientId}`);
        } catch (e) {
            console.error(`[ClientProfile] Lazy load history failed for ${clientId}:`, e);
        } finally {
            setLoadingHistory(false);
        }
    }

    async function loadDataLegacy() {
        setLoadingOrderDetails(true);
        const [c, s, n, v, m, b, appSettings, catData, eData, allClientsData, regularClientsData, mealCatData, mealItemData, upcomingOrderData, activeOrderData, historyData, orderHistoryData, billingHistoryData] = await Promise.all([
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
            getMealCategories(),
            getMealItems(),
            getUpcomingOrderForClient(clientId),
            getRecentOrdersForClient(clientId),
            getClientHistory(clientId),
            getOrderHistory(clientId),
            getBillingHistory(clientId)
        ]);

        if (c) {
            setClient(c);
            // Load order_history from client data
            try {
                const orderHistoryData = (c as any).order_history;
                if (orderHistoryData) {
                    const parsed = Array.isArray(orderHistoryData) ? orderHistoryData : JSON.parse(orderHistoryData);
                    // Newest first (backend may store either way; sort by timestamp for consistent UI)
                    const sorted = [...(parsed || [])].sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
                    setClientOrderHistory(sorted);
                } else {
                    setClientOrderHistory([]);
                }
            } catch (e) {
                console.warn('Error parsing order_history:', e);
                setClientOrderHistory([]);
            }
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
        setMealCategories(mealCatData);
        setMealItems(mealItemData);
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

        // Set order config from clients.upcoming_order (single source)
        if (c) {
            let configToSet: any = null;
            let isUsingFallback = false;

            if (upcomingOrderData && typeof upcomingOrderData === 'object') {
                    const isMultiDayFormat = !upcomingOrderData.serviceType &&
                        !upcomingOrderData.deliveryDayOrders &&
                        Object.keys(upcomingOrderData).some(key => {
                            const val = (upcomingOrderData as any)[key];
                            return val && (val.serviceType || val.id);
                        });

                    if (isMultiDayFormat) {
                        const deliveryDayOrders: any = {};
                        const allMealSelections: any = {};
                        for (const day of Object.keys(upcomingOrderData)) {
                            const dayOrder = (upcomingOrderData as any)[day];
                            if (dayOrder && (dayOrder.serviceType || dayOrder.id)) {
                                deliveryDayOrders[day] = {
                                    vendorSelections: dayOrder.vendorSelections || [],
                                    mealSelections: dayOrder.mealSelections || {}
                                };
                                if (dayOrder.mealSelections) {
                                    Object.entries(dayOrder.mealSelections).forEach(([key, val]) => {
                                        if (!allMealSelections[key]) allMealSelections[key] = val;
                                    });
                                }
                            }
                        }
                        const firstDayKey = Object.keys(upcomingOrderData)[0];
                        const firstDayOrder = (upcomingOrderData as any)[firstDayKey];
                        if (firstDayOrder?.serviceType === 'Boxes' || c.serviceType === 'Boxes') {
                            configToSet = firstDayOrder;
                            if (!configToSet.serviceType) configToSet.serviceType = 'Boxes';
                        } else {
                            configToSet = {
                                serviceType: firstDayOrder?.serviceType || c.serviceType,
                                caseId: firstDayOrder?.caseId,
                                deliveryDayOrders,
                                mealSelections: allMealSelections
                            };
                        }
                    } else if (upcomingOrderData.serviceType === 'Food' && !upcomingOrderData.vendorSelections && !upcomingOrderData.deliveryDayOrders) {
                        if (upcomingOrderData.vendorId) {
                            upcomingOrderData.vendorSelections = [{ vendorId: upcomingOrderData.vendorId, items: upcomingOrderData.menuSelections || {} }];
                        } else {
                            upcomingOrderData.vendorSelections = [{ vendorId: '', items: {} }];
                        }
                        configToSet = upcomingOrderData;
                    } else {
                        configToSet = upcomingOrderData;
                    }
            }

            // Validate Config: If Boxes and missing critical fields, reject it
            if (configToSet && c.serviceType === 'Boxes' && !configToSet.vendorId && !configToSet.boxTypeId) {
                configToSet = null;
            }

            if (!configToSet) {
                const defaultOrder: any = { serviceType: c.serviceType };
                if (c.serviceType === 'Food') {
                    defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
                }
                configToSet = defaultOrder;
                isUsingFallback = false;
            }

            // Fix for Boxes: If vendorId is missing but boxTypeId exists, try to find vendor from boxType
            if (c.serviceType === 'Boxes' && !configToSet.vendorId && configToSet.boxTypeId) {
                // boxTypes (b) is available in scope from Promise.all
                const boxType = b.find((bt: any) => bt.id === configToSet.boxTypeId);
                if (boxType && boxType.vendorId) {

                    configToSet.vendorId = boxType.vendorId;
                }
            }

            // FINAL CONVERSION CHECK: Ensure any Food order with deliveryDayOrders has vendorSelections for UI
            if (configToSet && configToSet.serviceType === 'Food' && configToSet.deliveryDayOrders) {
                const vendorMap = new Map<string, any>();
                for (const [day, dayData] of Object.entries(configToSet.deliveryDayOrders)) {
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
                        if (!vendor.selectedDeliveryDays.includes(day)) {
                            vendor.selectedDeliveryDays.push(day);
                        }
                        vendor.itemsByDay[day] = selection.items || {};
                        // Ensure itemNotes are populated
                        if (!vendor.itemNotesByDay) vendor.itemNotesByDay = {};
                        vendor.itemNotesByDay[day] = selection.itemNotes || {};
                    }
                }
                // Only overwrite if we found valid selections, or if vendorSelections is missing
                if (vendorMap.size > 0 || !configToSet.vendorSelections) {
                    configToSet.vendorSelections = Array.from(vendorMap.values());
                }
                // We keep deliveryDayOrders on configToSet as the source of truth, but UI needs vendorSelections
                // Ideally we shouldn't delete deliveryDayOrders if we want to save it back, 
                // but ClientPortal logic deletes it. Let's delete it to match ClientPortal behavior and avoid confusion.
                delete configToSet.deliveryDayOrders;
            }

            setOrderConfig(configToSet);
            setOriginalOrderConfig(JSON.parse(JSON.stringify(configToSet))); // Deep copy for comparison

            // DEBUG LOG: Final decision for Sidebar
            console.log(`[SIDEBAR_DEBUG] Final Order Config for ${c.id}:`, {
                source: 'upcoming_order',
                serviceType: configToSet?.serviceType,
                vendorSelectionsLen: configToSet?.vendorSelections?.length,
                boxOrdersLen: configToSet?.boxOrders?.length,
                caseId: configToSet?.caseId
            });
        }
    }


    // -- Logic Helpers --

    function getVendorMenuItems(vendorId: string) {
        return menuItems
            .filter(i => i.vendorId === vendorId && i.isActive)
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
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
                        const itemPrice = item ? item.value : 0;
                        total += itemPrice * (qty as number);
                    }
                }
            } else if (selection.items) {
                // Normal items structure
                for (const [itemId, qty] of Object.entries(selection.items)) {
                    const item = menuItems.find(i => i.id === itemId);
                    const itemPrice = item ? item.value : 0;
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

        // REMOVED individual deliveryDayOrders loop as it causes double-counting (it's already in currentSelections)

        // Include meal selections (Breakfast, Lunch, etc.)
        if (orderConfig.mealSelections) {
            for (const config of Object.values(orderConfig.mealSelections)) {
                const typedConfig = config as { vendorId?: string | null; items: { [itemId: string]: number } };
                if (typedConfig.items) {
                    for (const qty of Object.values(typedConfig.items)) {
                        total += (Number(qty) || 0);
                    }
                }
            }
        }

        return total;
    }

    // Get total value across all delivery days (handles both formats)
    function getCurrentOrderTotalValueAllDays(): number {
        // Use getVendorSelectionsForDay(null) as the single source of truth.
        // It consolidates deliveryDayOrders if they exist, or returns vendorSelections.
        const currentSelections = getVendorSelectionsForDay(null);
        let total = 0;
        const countedItemIdsGlobally = new Set<string>(); // Tracker to prevent double counting across sections

        for (const selection of currentSelections || []) {
            if (!selection.vendorId) continue;

            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                // Multi-day / Per-vendor delivery days format
                const activeDays = selection.selectedDeliveryDays || [];


                for (const day of activeDays) {
                    const dayItems = selection.itemsByDay[day] || {};
                    for (const [itemId, qty] of Object.entries(dayItems)) {
                        const item = menuItems.find(i => i.id === itemId);
                        const itemPrice = item ? (item.value || 0) : 0;
                        const subtotal = itemPrice * (Number(qty) || 0);
                        total += subtotal;
                        countedItemIdsGlobally.add(itemId);

                    }
                }
            } else if (selection.items) {
                // Normal single-day / Flat format
                // Must multiply by number of days!
                const daysCount = (selection.selectedDeliveryDays)
                    ? selection.selectedDeliveryDays.length
                    : ((client as any).delivery_days?.length || 1);

                for (const [itemId, qty] of Object.entries(selection.items)) {
                    const item = menuItems.find(i => i.id === itemId);
                    const itemPrice = item ? (item.value || 0) : 0;
                    const subtotal = itemPrice * (Number(qty) || 0) * daysCount;
                    total += subtotal;
                    countedItemIdsGlobally.add(itemId);
                }
            }
        }

        // Note: We DO NOT iterate orderConfig.deliveryDayOrders separately here because 
        // getVendorSelectionsForDay(null) already includes them if they exist.
        // (Iterating them again would cause double counting).

        // Include meal selections (Breakfast, Lunch, etc.)
        if (orderConfig.mealSelections) {
            for (const [key, config] of Object.entries(orderConfig.mealSelections)) {
                const typedConfig = config as { vendorId?: string | null; items: { [itemId: string]: number } };
                if (typedConfig.items) {
                    for (const [itemId, qty] of Object.entries(typedConfig.items)) {
                        // CRITICAL: Prevent double counting across formats
                        if (countedItemIdsGlobally.has(itemId)) {
                            continue;
                        }

                        const item = mealItems.find(i => i.id === itemId);
                        if (item) {
                            const subtotal = (item.quotaValue || 1) * (Number(qty) || 0);
                            total += subtotal;
                        }
                    }
                }
            }
        }

        return total;
    }

    /**
     * Get the next delivery date for a vendor (wrapper for centralized function)
     */
    function getNextDeliveryDateObject(vendorId: string): Date | null {
        return getNextDeliveryDateUtil(vendorId, vendors);
    }

    /**
     * Get all delivery dates for the order (for weekly locking validation)
     * Uses centralized function from order-dates.ts
     */
    function getAllDeliveryDatesForOrderLocal(): Date[] {
        if (!orderConfig || !orderConfig.caseId || !formData.serviceType) return [];
        return getAllDeliveryDatesForOrder(orderConfig, vendors, formData.serviceType as "Food" | "Boxes");
    }

    /**
     * Get the earliest delivery date across all vendors in the order
     */
    function getEarliestDeliveryDateForOrder(): Date | null {
        const deliveryDates = getAllDeliveryDatesForOrderLocal();
        if (deliveryDates.length === 0) return null;
        return new Date(Math.min(...deliveryDates.map(d => d.getTime())));
    }

    /**
     * Get the earliest effective date for order changes.
     * Uses weekly locking logic - always returns a Sunday.
     */
    function getEarliestTakeEffectDateForOrder(): Date | null {
        if (!orderConfig || !orderConfig.caseId) return null;
        if (!settings) return null;

        // Use centralized function from order-dates.ts which uses weekly locking logic
        return getTakeEffectDate(settings);
    }

    /**
     * Check if any deliveries in the order are locked due to weekly cutoff.
     * Uses weekly locking logic: if any delivery in a week is locked, all deliveries in that week are locked.
     */
    function isCutoffPassed(): boolean {
        if (!settings) return false;
        if (!orderConfig || !orderConfig.caseId) return false;

        const deliveryDates = getAllDeliveryDatesForOrderLocal();
        if (deliveryDates.length === 0) return false;

        // Use weekly locking logic to check if any deliveries are locked
        return areAnyDeliveriesLocked(deliveryDates, settings);
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
        const conf = client.upcomingOrder;
        if (!conf || typeof conf !== 'object') return '-';
        const st = client.serviceType;

        let content = '';

        if (st === 'Food') {
            const limit = client.approvedMealsPerWeek || 0;
            const vendorsSummary = (conf.vendorSelections || [])
                .map((v: any) => {
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
    // Function that returns formatted delivery date (for display)
    function getNextDeliveryDate(vendorId: string): { dayOfWeek: string; date: string } | null {
        const deliveryDate = getNextDeliveryDateUtil(vendorId, vendors);
        if (!deliveryDate) return null;

        return {
            dayOfWeek: deliveryDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
            date: deliveryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
        };
    }

    function getNextDeliveryDateForVendor(vendorId: string): string | null {
        const deliveryDate = getNextDeliveryDateUtil(vendorId, vendors);
        if (!deliveryDate) return null;

        // Return formatted as full date string
        return formatDeliveryDate(deliveryDate);
    }

    // Box Logic Helpers
    function getBoxValidationSummary() {
        // No quota validation needed - removed box types
        // Users can select any items they want without quota requirements
        return { isValid: true, messages: [] };
    }

    async function validateOrder(): Promise<{ isValid: boolean, messages: string[] }> {
        if (formData.serviceType === 'Food') {
            const messages: string[] = [];

            // Check total meals (Value - aligned with UI) vs Approved Limit
            const totalValue = getCurrentOrderTotalValueAllDays();
            const approvedMeals = formData.approvedMealsPerWeek || 0;



            if (approvedMeals > 0 && isExceedingMaximum(totalValue, approvedMeals)) {

                setValidationError(`Total value selected (${totalValue.toFixed(2)}) exceeds approved value per week (${approvedMeals}).`);
                return { isValid: false, messages: [`Total value selected (${totalValue.toFixed(2)}) exceeds approved value per week (${approvedMeals}).`] };
            }

            // Check Vendor Minimums (Daily Logic)
            if (orderConfig.vendorSelections) {
                for (const selection of orderConfig.vendorSelections) {
                    if (!selection.vendorId) continue;
                    const vendor = vendors.find(v => v.id === selection.vendorId);
                    if (!vendor) continue;
                    const minMeals = vendor.minimumMeals || 0;
                    if (minMeals === 0) continue;

                    // Check each day independently
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
                                messages.push(`${vendor.name} requires a minimum value of ${minMeals} for ${day}. You have selected ${dayValue}.`);
                            }
                        }
                    } else if (selection.items) {
                        // Single/Flat Mode
                        let countValue = 0;
                        for (const [itemId, qty] of Object.entries(selection.items)) {
                            const item = menuItems.find(i => i.id === itemId);
                            countValue += (item?.value || 0) * (Number(qty) || 0);
                        }

                        if (!isMeetingMinimum(countValue, minMeals)) {
                            messages.push(`${vendor.name} requires a minimum value of ${minMeals} per delivery. You have selected ${countValue}.`);
                        }
                    }
                }
            }

            // Validate Meal Selections (Breakfast, Lunch, Dinner, etc.)
            if (orderConfig.mealSelections) {
                Object.entries(orderConfig.mealSelections).forEach(([key, config]: [string, any]) => {
                    const mealType = config.mealType || key.split('_')[0];
                    // Get all sub-categories for this meal type (e.g., Hot Breakfast, Cold Breakfast)
                    const subCategories = mealCategories.filter(c => c.mealType === mealType);

                    subCategories.forEach(subCat => {
                        if (subCat.setValue !== undefined && subCat.setValue !== null) {
                            // Calculate total value for this specific category
                            let catTotalValue = 0;
                            if (config.items) {
                                // Get items belonging to this category
                                const catItems = mealItems.filter(i => i.categoryId === subCat.id);

                                for (const [itemId, qty] of Object.entries(config.items)) {
                                    // Only count items in this category
                                    const item = catItems.find(i => i.id === itemId);
                                    if (item) {
                                        catTotalValue += ((item.value || 0) * (qty as number));
                                    }
                                }
                            }

                            if (!isMeetingExactTarget(catTotalValue, subCat.setValue)) {
                                messages.push(`${subCat.name}: Selected ${catTotalValue}, but required is ${subCat.setValue}.`);
                            }
                        }
                    });
                });
            }

            if (messages.length > 0) {
                return { isValid: false, messages };
            }
        }

        if (formData.serviceType === 'Boxes') {
            const messages: string[] = [];

            // Use the boxOrders array which supports multiple boxes
            const boxOrders = orderConfig.boxOrders || [];

            // Fallback for legacy single-box config if array is empty but legacy fields exist
            const effectiveBoxOrders = boxOrders.length > 0 ? boxOrders : (
                orderConfig.boxTypeId ? [{
                    boxTypeId: orderConfig.boxTypeId,
                    quantity: orderConfig.boxQuantity || 1,
                    items: orderConfig.items || {}
                }] : []
            );

            // Validate each box order
            for (let i = 0; i < effectiveBoxOrders.length; i++) {
                const box = effectiveBoxOrders[i];
                if (!box.boxTypeId) continue;

                try {
                    // Fetch quotas for this box type to ensure we have the latest rules
                    // We must fetch it because boxQuotas state only tracks the first box
                    let quotas: BoxQuota[] = [];
                    // Optimization: if it's the first box, we might have it in state, but clearer to just fetch or find in boxTypes

                    // Check if quotas are already attached to boxType in state
                    const boxTypeC = boxTypes.find(bt => bt.id === box.boxTypeId);
                    if (boxTypeC && boxTypeC.quotas && boxTypeC.quotas.length > 0) {
                        quotas = boxTypeC.quotas;
                    } else {
                        // Fetch if not available
                        quotas = await getBoxQuotas(box.boxTypeId);
                    }

                    if (quotas && quotas.length > 0) {
                        const boxQty = box.quantity || 1;
                        const selectedItems = box.items || {};

                        for (const quota of quotas) {
                            let categoryQuotaValue = 0;

                            // Calculate current value for this category in this box
                            for (const [itemId, qty] of Object.entries(selectedItems)) {
                                const item = menuItems.find(it => it.id === itemId);
                                // Ensure item belongs to the quota's category
                                if (item && item.categoryId === quota.categoryId) {
                                    const itemQuotaValue = item.quotaValue || 1;
                                    categoryQuotaValue += (qty as number) * itemQuotaValue;
                                }
                            }

                            const requiredQuotaValue = quota.targetValue * boxQty;

                            if (!isMeetingExactTarget(categoryQuotaValue, requiredQuotaValue)) {
                                const category = categories.find(c => c.id === quota.categoryId);
                                const categoryName = category?.name || 'Unknown Category';
                                const boxIndexLabel = effectiveBoxOrders.length > 1 ? ` (Box ${i + 1})` : '';

                                messages.push(
                                    `Category "${categoryName}"${boxIndexLabel} requires exactly ${requiredQuotaValue} quota value, but you have ${categoryQuotaValue}. ` +
                                    `Please adjust items in this category to match exactly.`
                                );
                            }
                        }
                    }
                } catch (err) {
                    console.error('Error validating box quotas:', err);
                }
            }

            if (messages.length > 0) {
                return { isValid: false, messages };
            }

            return { isValid: true, messages: [] };
        }

        if (formData.serviceType === 'Custom') {
            const messages: string[] = [];
            if (!orderConfig.custom_name || !orderConfig.custom_name.trim()) messages.push('Item Description is required.');
            if (!orderConfig.custom_price || Number(orderConfig.custom_price) <= 0) messages.push('Price must be greater than 0.');
            if (!orderConfig.vendorId) messages.push('Vendor is required.');
            if (!orderConfig.deliveryDay) messages.push('Delivery Day is required.');

            if (messages.length > 0) return { isValid: false, messages };
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

    async function handleConfirmDuplicateName() {
        if (!pendingClientData) {
            setShowDuplicateNameModal(false);
            return;
        }

        setSaving(true);
        try {
            const newClient = await addClient(pendingClientData);

            if (!newClient) {
                setSaving(false);
                setShowDuplicateNameModal(false);
                setPendingClientData(null);
                return;
            }

            // Now update the client with order details (same as editing an existing client)
            // Determine if orderConfig has meaningful data to save
            const hasCaseId = orderConfig?.caseId && orderConfig.caseId.trim() !== '';
            const hasVendorSelections = orderConfig?.vendorSelections &&
                Array.isArray(orderConfig.vendorSelections) &&
                orderConfig.vendorSelections.some((s: any) => s.vendorId && s.vendorId.trim() !== '');
            const hasDeliveryDayOrders = orderConfig?.deliveryDayOrders &&
                Object.keys(orderConfig.deliveryDayOrders).length > 0;
            const hasBoxConfig = (orderConfig?.vendorId && orderConfig.vendorId.trim() !== '') ||
                (orderConfig?.boxTypeId && orderConfig.boxTypeId.trim() !== '');

            if (hasCaseId && (hasVendorSelections || hasDeliveryDayOrders || hasBoxConfig)) {
                const cleanedOrderConfig = prepareNewColumnOrder();
                if (cleanedOrderConfig) {
                    await updateClientUpcomingOrder(newClient.id, cleanedOrderConfig);

                    if (newClient.serviceType === 'Custom' && cleanedOrderConfig.custom_name && cleanedOrderConfig.custom_price && cleanedOrderConfig.vendorId && cleanedOrderConfig.deliveryDay) {
                        await saveClientCustomOrder(
                            newClient.id,
                            cleanedOrderConfig.vendorId,
                            cleanedOrderConfig.custom_name,
                            Number(cleanedOrderConfig.custom_price),
                            cleanedOrderConfig.deliveryDay,
                            cleanedOrderConfig.caseId
                        );
                    }
                }
            }

            // Update the actual client ID so the component switches to edit mode
            setActualClientId(newClient.id);
            justCreatedClientRef.current = true;

            // Reload client data
            const fullDetails = await getClientFullDetails(newClient.id);
            if (fullDetails) {
                setClient(fullDetails.client);
                setFormData(fullDetails.client);
                if (fullDetails.upcomingOrder) {
                    setOrderConfig(fullDetails.upcomingOrder);
                    setOriginalOrderConfig(JSON.parse(JSON.stringify(fullDetails.upcomingOrder)));
                } else {
                    setOrderConfig({});
                    setOriginalOrderConfig({});
                }
            }

            invalidateClientData();
            setMessage('Client created successfully.');
            setShowDuplicateNameModal(false);
            setPendingClientData(null);
        } catch (error) {
            console.error('Error creating client:', error);
            setMessage(error instanceof Error ? error.message : 'Failed to create client');
        } finally {
            setSaving(false);
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
        setValidationError(null);
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

        const updatedFormData = { ...formData, serviceType: type };
        if (type === 'Boxes') {
            updatedFormData.approvedMealsPerWeek = 1;
        }
        setFormData(updatedFormData);
        // Reset order config for new type completely, ensuring caseId is reset too
        // The user must enter a NEW case ID for the new service type.
        if (type === 'Food') {
            setOrderConfig({ serviceType: type, vendorSelections: [{ vendorId: '', items: {} }] });
        } else if (type === 'Boxes') {
            const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
            setOrderConfig({
                serviceType: type,
                boxOrders: [{
                    boxTypeId: firstActiveBoxType?.id || '',
                    vendorId: firstActiveBoxType?.vendorId || '',
                    quantity: 1,
                    items: {}
                }]
            });
        } else {
            setOrderConfig({ serviceType: type, items: {} });
        }
    }

    // --- Box Order Helpers ---

    function handleAddBox() {
        const currentBoxes = orderConfig.boxOrders || [];
        const limit = formData.approvedMealsPerWeek;
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
            // If removing the last one, just reset it to empty/default instead of removing
            // Or allow removing to 0? The UI might look empty. Let's keep 1 blank one.
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
            // When vendor changes, try to find a box type for this vendor
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
                if (note) {
                    currentNotes[itemId] = note;
                } else {
                    delete currentNotes[itemId];
                }
            }
        } else {
            delete currentItems[itemId];
            delete currentNotes[itemId];
        }
        currentBoxes[boxIndex].items = currentItems;
        currentBoxes[boxIndex].itemNotes = currentNotes;
        setOrderConfig({ ...orderConfig, boxOrders: currentBoxes });
    }

    // --- New column (clients.upcoming_order) handlers — same UX, load/save only this column ---
    function handleNewColumnAddBox() {
        const currentBoxes = newColumnOrderConfig.boxOrders || [];
        const limit = formData.approvedMealsPerWeek;
        if (limit && currentBoxes.length >= limit) return;
        const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
        setNewColumnOrderConfig({
            ...newColumnOrderConfig,
            serviceType: newColumnOrderConfig.serviceType || formData.serviceType || 'Boxes',
            boxOrders: [
                ...currentBoxes,
                { boxTypeId: firstActiveBoxType?.id || '', vendorId: firstActiveBoxType?.vendorId || '', quantity: 1, items: {} }
            ]
        });
    }
    function getNewColumnBoxOrders(): any[] {
        return newColumnOrderConfig.boxOrders && newColumnOrderConfig.boxOrders.length > 0
            ? [...newColumnOrderConfig.boxOrders]
            : [{ boxTypeId: '', vendorId: '', quantity: 1, items: {} }];
    }
    function handleNewColumnRemoveBox(index: number) {
        const currentBoxes = getNewColumnBoxOrders();
        if (currentBoxes.length <= 1) {
            const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
            setNewColumnOrderConfig({
                ...newColumnOrderConfig,
                serviceType: 'Boxes',
                boxOrders: [{ boxTypeId: firstActiveBoxType?.id || '', vendorId: firstActiveBoxType?.vendorId || '', quantity: 1, items: {} }]
            });
            return;
        }
        currentBoxes.splice(index, 1);
        setNewColumnOrderConfig({ ...newColumnOrderConfig, boxOrders: currentBoxes });
    }
    function handleNewColumnBoxUpdate(index: number, field: string, value: any) {
        const currentBoxes = getNewColumnBoxOrders();
        if (!currentBoxes[index]) return;
        currentBoxes[index] = { ...currentBoxes[index], [field]: value };
        if (field === 'vendorId') {
            const validBoxType = boxTypes.find(bt => bt.isActive && bt.vendorId === value);
            if (validBoxType) currentBoxes[index].boxTypeId = validBoxType.id;
        }
        setNewColumnOrderConfig({ ...newColumnOrderConfig, serviceType: 'Boxes', boxOrders: currentBoxes });
    }
    function handleNewColumnBoxItemUpdate(boxIndex: number, itemId: string, quantity: number, note?: string) {
        const currentBoxes = getNewColumnBoxOrders();
        if (!currentBoxes[boxIndex]) return;
        const currentItems = { ...(currentBoxes[boxIndex].items || {}) };
        const currentNotes = { ...(currentBoxes[boxIndex].itemNotes || {}) };
        if (quantity > 0) {
            currentItems[itemId] = quantity;
            if (note !== undefined) currentNotes[itemId] = note || undefined;
        } else {
            delete currentItems[itemId];
            delete currentNotes[itemId];
        }
        currentBoxes[boxIndex] = { ...currentBoxes[boxIndex], items: currentItems, itemNotes: currentNotes };
        setNewColumnOrderConfig({ ...newColumnOrderConfig, serviceType: 'Boxes', boxOrders: currentBoxes });
    }
    /** Build payload for upcoming_order: only keep fields valid for current service type. Replaces entire column (no merge). */
    function prepareNewColumnOrder(): any {
        if (!newColumnOrderConfig || typeof newColumnOrderConfig !== 'object') return null;
        const raw = { ...newColumnOrderConfig };
        const serviceType = (raw.serviceType || formData.serviceType || client?.serviceType || 'Food') as ServiceType;

        if (serviceType === 'Boxes') {
            const boxOrders = Array.isArray(raw.boxOrders) ? raw.boxOrders : [];
            return {
                serviceType: 'Boxes',
                caseId: raw.caseId ?? undefined,
                boxOrders: boxOrders.map((box: any) => ({
                    boxTypeId: box.boxTypeId ?? box.box_type_id ?? undefined,
                    vendorId: box.vendorId ?? box.vendor_id ?? undefined,
                    quantity: typeof box.quantity === 'number' ? box.quantity : (parseInt(box.quantity, 10) || 1),
                    items: box.items && typeof box.items === 'object' ? box.items : {},
                    itemNotes: box.itemNotes && typeof box.itemNotes === 'object' ? box.itemNotes : {}
                })),
                notes: raw.notes ?? undefined
            };
        }
        if (serviceType === 'Custom') {
            return {
                serviceType: 'Custom',
                caseId: raw.caseId ?? undefined,
                custom_name: raw.custom_name ?? undefined,
                custom_price: raw.custom_price ?? undefined,
                vendorId: raw.vendorId ?? undefined,
                deliveryDay: raw.deliveryDay ?? undefined,
                notes: raw.notes ?? undefined
            };
        }
        // Food or Meal: allow Food + Meal together; strip Boxes and Custom.
        // Omit vendorSelections/mealSelections when they are empty or only placeholder rows (so caseId-only stays caseId-only).
        const hasRealVendor = Array.isArray(raw.vendorSelections) && raw.vendorSelections.some((s: any) => s?.vendorId || (s?.items && Object.keys(s.items).length > 0));
        const vendorSelections = hasRealVendor ? raw.vendorSelections : undefined;
        const deliveryDayOrders = raw.deliveryDayOrders && Object.keys(raw.deliveryDayOrders).length > 0 ? raw.deliveryDayOrders : undefined;
        const mealSelectionsFiltered = raw.mealSelections && typeof raw.mealSelections === 'object'
            ? Object.fromEntries(
                Object.entries(raw.mealSelections).filter(([, m]: [string, any]) => m && ((m.items && Object.keys(m.items || {}).length > 0) || !!m.vendorId))
            )
            : undefined;
        const mealSelections = mealSelectionsFiltered && Object.keys(mealSelectionsFiltered).length > 0 ? mealSelectionsFiltered : undefined;

        return {
            serviceType: raw.serviceType || 'Food',
            caseId: raw.caseId ?? undefined,
            vendorSelections,
            deliveryDayOrders,
            mealSelections,
            notes: raw.notes ?? undefined
        };
    }
    async function handleSaveNewColumnOrder() {
        if (!client?.id) return;
        setSavingNewColumn(true);
        try {
            const payload = prepareNewColumnOrder();
            await updateClientUpcomingOrder(client.id, payload ?? null);
            invalidateClientData(client.id);
            const fresh = await getClient(client.id);
            if (fresh) {
                lastUpcomingOrderClientIdRef.current = null; // Allow useEffect to re-sync with fresh DB state
                setClient(fresh);
                // Refresh Order History section so the new "Upcoming order saved" entry appears
                try {
                    const raw = (fresh as any).orderHistory ?? (fresh as any).order_history;
                    if (raw != null) {
                        const parsed = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []);
                        const sorted = [...parsed].sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
                        setClientOrderHistory(sorted);
                    }
                } catch (_) {
                    // ignore parse errors; section will refresh on next full load
                }
            }
            setMessage('Saved to new upcoming order column.');
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            console.error(e);
            setMessage('Failed to save new column.');
        } finally {
            setSavingNewColumn(false);
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

    // Helper: Get vendor selections for a specific delivery day (or consolidated if day is null)
    function getVendorSelectionsForDay(day: string | null): any[] {
        // Prioritize vendorSelections as the primary source of truth during an edit session
        // CRITICAL FIX: Array existence (even if empty) should stop the fallback to stale data.
        if (Array.isArray(orderConfig.vendorSelections)) {
            if (day) {
                // If a specific day is requested, we need to extract from itemsByDay or filter
                return orderConfig.vendorSelections.map((sel: any) => {
                    if (sel.itemsByDay && sel.selectedDeliveryDays?.includes(day)) {
                        return { ...sel, items: sel.itemsByDay[day] || {} };
                    }
                    if (sel.items && (!sel.selectedDeliveryDays || sel.selectedDeliveryDays.includes(day))) {
                        return sel;
                    }
                    return null;
                }).filter(Boolean);
            }
            return orderConfig.vendorSelections;
        }

        if (!orderConfig.deliveryDayOrders) {
            return [];
        }

        if (day) {
            return orderConfig.deliveryDayOrders[day]?.vendorSelections || [];
        }

        // Consolidated view (day is null) - reconstruct list from all days
        const deliveryDays = Object.keys(orderConfig.deliveryDayOrders).sort();
        const vendorMap = new Map<string, any>();

        for (const d of deliveryDays) {
            const daySelections = orderConfig.deliveryDayOrders[d].vendorSelections || [];
            for (const sel of daySelections) {
                // Use a temporary key for blank rows to group them, but only one per day
                const vId = sel.vendorId || "__blank__";

                if (!vendorMap.has(vId)) {
                    vendorMap.set(vId, {
                        vendorId: sel.vendorId,
                        selectedDeliveryDays: [],
                        itemsByDay: {},
                        itemNotesByDay: {}
                    });
                }

                const vendorSel = vendorMap.get(vId);
                if (!vendorSel.selectedDeliveryDays.includes(d)) {
                    vendorSel.selectedDeliveryDays.push(d);
                }
                vendorSel.itemsByDay[d] = sel.items || {};

                // Populate notes
                if (!vendorSel.itemNotesByDay) vendorSel.itemNotesByDay = {};
                vendorSel.itemNotesByDay[d] = sel.itemNotes || {};
            }
        }

        const consolidated = Array.from(vendorMap.values());
        // If consolidated list is empty, return one blank to start
        if (consolidated.length === 0) {
            return [];
        }
        return consolidated;
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
                // Updating consolidated view (null day)
                // Reconstruct deliveryDayOrders from the consolidated list
                const allDays = Object.keys(deliveryDayOrders);
                // Initialize empty to rebuild
                allDays.forEach(d => deliveryDayOrders[d] = { vendorSelections: [] });

                // Distribute consolidated selections back to days
                vendorSelections.forEach(vSel => {
                    const daysToPopulate = (vSel.selectedDeliveryDays && vSel.selectedDeliveryDays.length > 0)
                        ? vSel.selectedDeliveryDays
                        : (allDays.length > 0 ? [allDays[0]] : []);

                    daysToPopulate.forEach((d: string) => {
                        if (!deliveryDayOrders[d]) deliveryDayOrders[d] = { vendorSelections: [] };

                        const items = vSel.itemsByDay ? (vSel.itemsByDay[d] || {}) : (vSel.items || {});

                        deliveryDayOrders[d].vendorSelections.push({
                            vendorId: vSel.vendorId,
                            items: items
                        });
                    });
                });
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
        // Handling for multi-day format when adding to "consolidated" list (day is null)
        if (day === null && orderConfig.deliveryDayOrders) {
            const days = Object.keys(orderConfig.deliveryDayOrders).sort();
            if (days.length > 0) {
                // Add blank entry to the first available day so it gets picked up by the consolidated view
                const firstDay = days[0];
                const currentDaySelections = orderConfig.deliveryDayOrders[firstDay].vendorSelections || [];
                // Only add if there isn't already a blank one (to prevent duplicates in consolidated view)
                const hasBlank = currentDaySelections.some((s: any) => !s.vendorId);
                if (!hasBlank) {
                    const newDaySelections = [...currentDaySelections, { vendorId: '', items: {} }];
                    setVendorSelectionsForDay(firstDay, newDaySelections);
                }
                return;
            }
        }

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
        // Get current selections for the context (specific day or consolidated)
        const current = [...getVendorSelectionsForDay(day)];

        // Update the specific field
        current[index] = { ...current[index], [field]: value };

        // If changing vendor, we need to reset dependent fields
        if (field === 'vendorId') {
            current[index].items = {};
            current[index].itemsByDay = {}; // Reset multi-day mapping
            current[index].selectedDeliveryDays = [];

            // Auto-select delivery day if vendor has exactly one delivery day
            if (value) {
                const selectedVendor = vendors.find(v => v.id === value);
                if (selectedVendor && selectedVendor.deliveryDays && selectedVendor.deliveryDays.length === 1) {
                    const singleDay = selectedVendor.deliveryDays[0];
                    current[index].selectedDeliveryDays = [singleDay];
                    // Initialize items for that day
                    current[index].itemsByDay = { [singleDay]: {} };
                } else if (selectedVendor && selectedVendor.deliveryDays) {
                    // Pre-initialize empty structures for available days to avoid undefined errors later
                    const initialItemsByDay: any = {};
                    selectedVendor.deliveryDays.forEach(d => {
                        initialItemsByDay[d] = {};
                    });
                    // Do NOT auto-select days if there are multiple. User must choose.
                    // But we can prep the structure.
                }
            }
        }

        // Apply update
        setVendorSelectionsForDay(day, current);
    }

    function updateItemQuantity(blockIndex: number, itemId: string, qty: number, day: string | null = null) {
        const current = [...getVendorSelectionsForDay(day)];
        const selection = current[blockIndex];

        // Check if we're in multi-day format (has selectedDeliveryDays or orderConfig uses deliveryDayOrders)
        const isMultiDayFormat = (selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0) ||
            (orderConfig.deliveryDayOrders && day === null);

        if (isMultiDayFormat) {
            // Multi-day format - use itemsByDay
            const itemsByDay = { ...(selection.itemsByDay || {}) };
            const targetDay = day ? day : (selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0
                ? selection.selectedDeliveryDays[0]
                : (orderConfig.deliveryDayOrders ? Object.keys(orderConfig.deliveryDayOrders)[0] : null));

            if (targetDay) {
                if (!itemsByDay[targetDay]) itemsByDay[targetDay] = {};

                // In consolidated view (day === null), qty represents the desired total sum across all days
                // We need to adjust the target day's quantity to achieve this total while preserving other days
                if (day === null && selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 1) {
                    // Calculate sum of quantities on other days (excluding target day)
                    const otherDaysSum = selection.selectedDeliveryDays
                        .filter((sd: string) => sd !== targetDay)
                        .reduce((sum: number, sd: string) =>
                            sum + Number((itemsByDay[sd] || {})[itemId] || 0), 0);
                    // Set target day quantity to achieve desired total
                    const targetDayQty = qty - otherDaysSum;
                    if (targetDayQty > 0) {
                        itemsByDay[targetDay][itemId] = targetDayQty;
                    } else {
                        delete itemsByDay[targetDay][itemId];
                    }
                } else {
                    // Specific day update - set directly
                    if (qty > 0) {
                        itemsByDay[targetDay][itemId] = qty;
                    } else {
                        delete itemsByDay[targetDay][itemId];
                    }
                }
            }

            // Ensure selectedDeliveryDays is set if not already
            const selectedDays = selection.selectedDeliveryDays || (orderConfig.deliveryDayOrders ? Object.keys(orderConfig.deliveryDayOrders) : []);

            // Clear items to avoid confusion when using itemsByDay
            current[blockIndex] = {
                ...selection,
                itemsByDay,
                selectedDeliveryDays: selectedDays,
                items: {} // Clear items when using itemsByDay to prevent double counting
            };
        } else {
            // Single day format - update items directly
            const items = { ...(selection.items || {}) };
            if (qty > 0) {
                items[itemId] = qty;
            } else {
                delete items[itemId];
            }
            current[blockIndex] = {
                ...selection,
                items
            };
        }

        setVendorSelectionsForDay(day, current);
    }

    // --- MEAL SELECTION HANDLERS ---

    function handleAddMeal(mealType: string) {
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
    }

    function handleRemoveMeal(uniqueKey: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections) {
                const updatedSelections = { ...newConfig.mealSelections };
                delete updatedSelections[uniqueKey];
                newConfig.mealSelections = updatedSelections;
                if (Object.keys(newConfig.mealSelections).length === 0) {
                    delete newConfig.mealSelections;
                }
            }
            return newConfig;
        });
    }

    function handleMealVendorChange(uniqueKey: string, vendorId: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections && newConfig.mealSelections[uniqueKey]) {
                newConfig.mealSelections[uniqueKey] = {
                    ...newConfig.mealSelections[uniqueKey],
                    vendorId: vendorId
                };
            }
            return newConfig;
        });
    }

    function handleMealItemChange(uniqueKey: string, itemId: string, qty: number) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections && newConfig.mealSelections[uniqueKey]) {
                const updatedItems = { ...(newConfig.mealSelections[uniqueKey].items || {}) };
                if (qty > 0) {
                    updatedItems[itemId] = qty;
                } else {
                    delete updatedItems[itemId];
                }
                newConfig.mealSelections[uniqueKey] = {
                    ...newConfig.mealSelections[uniqueKey],
                    items: updatedItems
                };
            }
            return newConfig;
        });
    }

    const renderMealBlocks = () => {
        if (!orderConfig?.mealSelections) return null;
        return Object.entries(orderConfig.mealSelections).map(([uniqueKey, config]: [string, any]) => {
            const mealType = config.mealType || uniqueKey.split('_')[0];
            const category = mealCategories.find(c => c.mealType === mealType);
            let totalSelectedValue = 0;
            if (config.items) {
                for (const [itemId, qty] of Object.entries(config.items)) {
                    const item = mealItems.find(i => i.id === itemId);
                    if (item) {
                        totalSelectedValue += ((item.quotaValue || 1) * (qty as number));
                    }
                }
            }

            const requiredValue = category?.setValue;
            const isInvalid = requiredValue !== undefined && requiredValue !== null && totalSelectedValue !== requiredValue;

            return (
                <div key={uniqueKey} className={styles.vendorBlock} style={{
                    borderLeft: '4px solid var(--color-primary)',
                    border: isInvalid ? '2px solid #ef4444' : undefined,
                    backgroundColor: isInvalid ? '#fef2f2' : undefined
                }}>
                    {/* Header */}

                    <div className={styles.vendorHeader}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 600, color: isInvalid ? '#ef4444' : 'var(--color-primary)' }}>{mealType}</span>
                            {requiredValue !== undefined && requiredValue !== null && (
                                <span style={{ fontSize: '0.85em', color: isInvalid ? '#ef4444' : 'var(--text-secondary)' }}>
                                    Selected: {totalSelectedValue} / {requiredValue}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <select
                                className="input"
                                value={config.vendorId || ''}
                                onChange={(e) => handleMealVendorChange(uniqueKey, e.target.value)}
                                style={{ width: '200px' }}
                            >
                                <option value="">Select Vendor (Optional)...</option>
                                {vendors.filter(v => v.serviceTypes.includes('Food') && v.isActive).map(v => (
                                    <option key={v.id} value={v.id}>{v.name}</option>
                                ))}
                            </select>
                            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleRemoveMeal(uniqueKey)}>
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                    {/* Items */}
                    <div className={styles.menuItems}>
                        {mealItems.filter(i => {
                            const cat = mealCategories.find(c => c.id === i.categoryId);
                            return cat?.mealType === mealType;
                        })
                            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
                            .map(item => {
                                const qty = config.items?.[item.id] || 0;
                                return (
                                    <div key={item.id} className={styles.menuItem}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                            <span>
                                                {item.name}
                                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.9em', marginLeft: '4px' }}>
                                                    (Value: {item.quotaValue || 1})
                                                </span>
                                            </span>
                                            <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <button onClick={() => handleMealItemChange(uniqueKey, item.id, Math.max(0, qty - 1))} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                <button onClick={() => handleMealItemChange(uniqueKey, item.id, qty + 1)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                            </div>
                                        </label>
                                    </div>
                                );
                            })}
                        {mealItems.filter(i => mealCategories.find(c => c.id === i.categoryId)?.mealType === mealType).length === 0 && (
                            <span className={styles.hint}>No items found for {mealType}.</span>
                        )}
                    </div>
                </div>
            );
        });
    };

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

    async function handleSaveAndClose() {
        const saved = await handleSave();
        if (saved && onClose) {
            onClose();
        }
    }

    async function handleCreateDependent() {
        if (!dependentName.trim() || !client?.id) return;

        setCreatingDependent(true);
        try {
            const dobValue = dependentDob.trim() || null;
            const cinValue = dependentCin.trim() || null;
            const newDependent = await addDependent(dependentName.trim(), client.id, dobValue, cinValue);
            if (newDependent) {
                // Refresh dependents list
                const dependentsData = await getDependentsByParentId(client.id);
                setDependents(dependentsData);
                // Reset form
                setDependentName('');
                setDependentDob('');
                setDependentCin('');
                setShowAddDependentForm(false);
                // Invalidate cache to refresh list in parent component
                invalidateClientData();
            }
        } catch (error) {
            console.error('Error creating dependent:', error);
            alert(error instanceof Error ? error.message : 'Failed to create dependent');
        } finally {
            setCreatingDependent(false);
        }
    }

    const isDependent = !!client?.parentClientId;
    const filteredRegularClients = regularClients.filter(c =>
        c.fullName.toLowerCase().includes(parentClientSearch.toLowerCase()) && c.id !== clientId
    );
    const selectedParentClient = formData.parentClientId ? regularClients.find(c => c.id === formData.parentClientId) : null;

    // Handle form field changes
    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    // --- CLIENT INFO SECTION ---
    const renderClientInfoSection = () => (
        <section className={styles.card}>
            <h3 className={styles.sectionTitle}>Client Information</h3>
            <div className={styles.grid2}>
                <div className={styles.formGroup}>
                    <label className={styles.label}>Full Name <span className={styles.required}>*</span></label>
                    <input
                        type="text"
                        name="fullName"
                        className={styles.input}
                        value={formData.fullName || ''}
                        onChange={handleChange}
                        disabled={saving}
                        required
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.label}>Email <span className={styles.required}>*</span></label>
                    <input
                        type="email"
                        name="email"
                        className={styles.input}
                        value={formData.email || ''}
                        onChange={handleChange}
                        disabled={saving}
                        required
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.label}>Phone Number</label>
                    <input
                        type="tel"
                        name="phoneNumber"
                        className={styles.input}
                        value={formData.phoneNumber || ''}
                        onChange={handleChange}
                        disabled={saving}
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.label}>Secondary Phone</label>
                    <input
                        type="tel"
                        name="secondaryPhoneNumber"
                        className={styles.input}
                        value={formData.secondaryPhoneNumber || ''}
                        onChange={handleChange}
                        disabled={saving}
                    />
                </div>
                <div className={styles.formGroup} style={{ gridColumn: 'span 2' }}>
                    <label className={styles.label}>Address <span className={styles.required}>*</span></label>
                    <input
                        type="text"
                        name="address"
                        className={styles.input}
                        value={formData.address || ''}
                        onChange={handleChange}
                        disabled={saving}
                        required
                    />
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label}>Status</label>
                    <select
                        name="statusId"
                        className={styles.select}
                        value={formData.statusId || ''}
                        onChange={handleChange}
                        disabled={saving}
                    >
                        {statuses.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label}>Assigned Navigator</label>
                    <select
                        name="navigatorId"
                        className={styles.select}
                        value={formData.navigatorId || ''}
                        onChange={handleChange}
                        disabled={saving}
                    >
                        <option value="">Unassigned</option>
                        {navigators.filter(n => n.isActive || n.id === client?.navigatorId).map(n => (
                            <option key={n.id} value={n.id}>{n.name}</option>
                        ))}
                    </select>
                </div>

                {currentUser?.role !== 'navigator' && (
                    <div className={styles.formGroup}>
                        <label className={styles.label}>Parent Client (Optional)</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type="text"
                                className={styles.input}
                                placeholder="Search existing clients..."
                                value={parentClientSearch}
                                onChange={(e) => {
                                    setParentClientSearch(e.target.value);
                                    if (!e.target.value) {
                                        setFormData(prev => ({ ...prev, parentClientId: null }));
                                    }
                                    setShowParentSearch(true);
                                }}
                                onFocus={() => setShowParentSearch(true)}
                                onBlur={() => setTimeout(() => setShowParentSearch(false), 200)}
                            />
                            {formData.parentClientId && (
                                <button
                                    className={styles.clearBtn}
                                    onClick={() => {
                                        setFormData(prev => ({ ...prev, parentClientId: null }));
                                        setParentClientSearch('');
                                    }}
                                    style={{
                                        position: 'absolute',
                                        right: '10px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: 'var(--text-tertiary)'
                                    }}
                                >
                                    <X size={16} />
                                </button>
                            )}

                            {showParentSearch && parentClientSearch && !formData.parentClientId && (
                                <div className={styles.dropdown}>
                                    {regularClients
                                        .filter(c =>
                                            c.id !== clientId &&
                                            c.fullName.toLowerCase().includes(parentClientSearch.toLowerCase())
                                        )
                                        .slice(0, 5)
                                        .map(match => (
                                            <div
                                                key={match.id}
                                                className={styles.dropdownItem}
                                                onMouseDown={() => {
                                                    setFormData(prev => ({ ...prev, parentClientId: match.id }));
                                                    setParentClientSearch(match.fullName);
                                                    setShowParentSearch(false);
                                                }}
                                            >
                                                {match.fullName}
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className={styles.formGroup} style={{ gridColumn: 'span 2' }}>
                    <label className={styles.label}>Notes</label>
                    <textarea
                        name="notes"
                        className={styles.textarea}
                        value={formData.notes || ''}
                        onChange={handleChange}
                        disabled={saving}
                        rows={3}
                    />
                </div>
            </div>
        </section>
    );

    // --- SERVICE CONFIG SECTION ---
    const renderServiceConfigSection = () => (
        <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
            <h3 className={styles.sectionTitle}>Service Configuration</h3>
            <div className={styles.grid2}>
                <div className={styles.formGroup}>
                    <label className={styles.label}>Service Type</label>
                    <select
                        name="serviceType"
                        className={styles.select}
                        value={formData.serviceType}
                        onChange={handleChange}
                        disabled={saving}
                    >
                        <option value="Food">Food</option>
                        <option value="Meal">Meals</option>
                        <option value="Boxes">Boxes</option>
                        <option value="Equipment">Equipment</option>
                        <option value="Custom">Custom</option>
                    </select>
                </div>

                {formData.serviceType === 'Meal' && (
                    <div className={styles.formGroup}>
                        <label className={styles.label}>Approved Meals / Week</label>
                        <input
                            type="number"
                            name="approvedMealsPerWeek"
                            className={styles.input}
                            value={formData.approvedMealsPerWeek || 0}
                            onChange={handleChange}
                            disabled={saving}
                            min={0}
                        />
                    </div>
                )}

                <div className={styles.formGroup}>
                    <label className={styles.label}>Authorized Amount ($)</label>
                    <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                        <input
                            type="number"
                            name="authorizedAmount"
                            className={`${styles.input} pl-8`}
                            value={formData.authorizedAmount || ''}
                            onChange={handleChange}
                            disabled={saving}
                            placeholder="0.00"
                            step="0.01"
                        />
                    </div>
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label}>Expiration Date</label>
                    <input
                        type="date"
                        name="expirationDate"
                        className={styles.input}
                        value={formData.expirationDate ? formData.expirationDate.split('T')[0] : ''}
                        onChange={handleChange}
                        disabled={saving}
                    />
                </div>

                <div className={styles.checkboxGroup}>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            name="screeningTookPlace"
                            checked={formData.screeningTookPlace}
                            onChange={handleChange}
                            disabled={saving}
                        />
                        Screening Took Place
                    </label>
                </div>

                <div className={styles.checkboxGroup}>
                    <label className={styles.checkboxLabel}>
                        <input
                            type="checkbox"
                            name="screeningSigned"
                            checked={formData.screeningSigned}
                            onChange={handleChange}
                            disabled={saving}
                        />
                        Screening Signed
                    </label>
                </div>
            </div>
        </section>
    );

    // --- SHARED: same UI and logic for Current Order and Upcoming; only save target differs ---
    function renderOrderConfigUI(useNewColumn: boolean) {
        const config = useNewColumn ? newColumnOrderConfig : orderConfig;
        const setConfig = useNewColumn ? setNewColumnOrderConfig : setOrderConfig;
        const serviceType = useNewColumn ? (newColumnOrderConfig.serviceType || formData.serviceType || 'Food') : formData.serviceType;
        const removeBox = useNewColumn ? handleNewColumnRemoveBox : handleRemoveBox;
        const updateBox = useNewColumn ? handleNewColumnBoxUpdate : handleBoxUpdate;
        const addBox = useNewColumn ? handleNewColumnAddBox : handleAddBox;
        const updateBoxItem = useNewColumn ? handleNewColumnBoxItemUpdate : handleBoxItemUpdate;
        const isSaving = useNewColumn ? savingNewColumn : saving;
        const sectionTitle = useNewColumn ? 'Upcoming orders configuration' : 'Current Order Configuration';
        const badge = useNewColumn ? (<span className={styles.badge} style={{ backgroundColor: 'var(--bg-surface-active)', color: 'var(--text-secondary)' }}></span>) : (client && orderConfig.caseId ? <span className={styles.badge} style={{ backgroundColor: 'var(--bg-success)', color: 'var(--text-success)' }}>Active Order Configured</span> : null);
        const boxOrders = (config.boxOrders?.length ? config.boxOrders : [{ boxTypeId: '', vendorId: '', quantity: 1, items: {} }]);
        const boxCount = (config.boxOrders?.length ?? 0) || 1;
        return (
        <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 className={styles.sectionTitle}>{sectionTitle}</h3>
                {badge}
            </div>

            {useNewColumn && (
                <div className={styles.formGroup}>
                    <label className={styles.label}>Client type</label>
                    <div className={styles.serviceTypes} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                        {(['Food', 'Boxes', 'Custom'] as const).map(type => (
                            <button
                                key={type}
                                type="button"
                                className={`${styles.serviceBtn} ${serviceType === type ? styles.activeService : ''}`}
                                onClick={() => setConfig({ ...config, serviceType: type })}
                                disabled={isSaving}
                            >
                                {type}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className={styles.formGroup}>
                <label className={styles.label}>Case ID <span className={styles.required}>*</span></label>
                <input
                    type="text"
                    className={styles.input}
                    value={config.caseId || ''}
                    onChange={(e) => setConfig({ ...config, caseId: e.target.value })}
                    placeholder="Enter Case ID to enable configuration"
                    disabled={isSaving}
                />
            </div>

            {config.caseId ? (
                <>
                    {(serviceType === 'Food' || serviceType === 'Meal') && (
                        <div className="animate-fade-in" style={{ marginTop: '1rem' }}>
                            <FoodServiceWidget
                                orderConfig={config}
                                setOrderConfig={setConfig}
                                client={{ ...client, ...formData, serviceType: (serviceType === 'Food' || serviceType === 'Meal' ? serviceType : formData.serviceType) || 'Food' } as ClientProfile}
                                vendors={vendors}
                                menuItems={menuItems}
                                mealCategories={mealCategories}
                                mealItems={mealItems}
                                settings={settings}
                            />
                            <div style={{ marginTop: '1rem' }}>
                                <label className={styles.label}>Order Notes</label>
                                <textarea
                                    className={`${styles.input} ${styles.textarea}`}
                                    placeholder="Add general notes for this order..."
                                    value={config.notes || ''}
                                    onChange={(e) => setConfig({ ...config, notes: e.target.value })}
                                    rows={2}
                                    disabled={isSaving}
                                />
                            </div>
                        </div>
                    )}

                    {/* Custom Service Configuration */}
                    {serviceType === 'Custom' && (
                        <div className={styles.section} style={{ marginTop: '24px' }}>
                            <h3 className={styles.sectionTitle}>Custom Order Configuration</h3>
                            <div className={styles.card} style={{ backgroundColor: '#f9fafb' }}>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="col-span-2">
                                        <label className={styles.label}>Item Description <span className="text-red-500">*</span></label>
                                        <textarea
                                            className={styles.input}
                                            placeholder="e.g. Weekly Catering Platter"
                                            value={config.custom_name || ''}
                                            rows={1}
                                            style={{ resize: 'none', overflow: 'hidden', minHeight: '3rem' }}
                                            onInput={(e) => {
                                                const target = e.target as HTMLTextAreaElement;
                                                target.style.height = 'auto';
                                                target.style.height = target.scrollHeight + 'px';
                                            }}
                                            onChange={e => {
                                                setConfig({ ...config, custom_name: e.target.value });
                                                (e.target as HTMLTextAreaElement).style.height = 'auto';
                                                (e.target as HTMLTextAreaElement).style.height = (e.target as HTMLTextAreaElement).scrollHeight + 'px';
                                            }}
                                            disabled={isSaving}
                                        />
                                    </div>
                                    <div>
                                        <label className={styles.label}>Price per Order <span className="text-red-500">*</span></label>
                                        <div className="relative">
                                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                                            <input
                                                type="number"
                                                className={`${styles.input} pl-8`}
                                                placeholder="0.00"
                                                value={config.custom_price || ''}
                                                onChange={e => setConfig({ ...config, custom_price: e.target.value })}
                                                disabled={isSaving}
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className={styles.label}>Vendor <span className="text-red-500">*</span></label>
                                        <select
                                            className={styles.input}
                                            value={config.vendorId || ''}
                                            onChange={e => {
                                                const newVendorId = e.target.value;
                                                let newDeliveryDay = config.deliveryDay;
                                                if (newVendorId && newDeliveryDay) {
                                                    const selectedVendor = vendors.find(v => v.id === newVendorId);
                                                    if (selectedVendor && selectedVendor.deliveryDays && selectedVendor.deliveryDays.length > 0) {
                                                        if (!selectedVendor.deliveryDays.includes(newDeliveryDay)) {
                                                            newDeliveryDay = '';
                                                        }
                                                    }
                                                }
                                                setConfig({ ...config, vendorId: newVendorId, deliveryDay: newDeliveryDay });
                                            }}
                                            disabled={isSaving}
                                        >
                                            <option value="">Select Vendor</option>
                                            {vendors.filter(v => v.isActive).map(v => (
                                                <option key={v.id} value={v.id}>{v.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className={styles.label}>Delivery Day <span className="text-red-500">*</span></label>
                                        <select
                                            className={styles.input}
                                            value={config.deliveryDay || ''}
                                            onChange={e => setConfig({ ...config, deliveryDay: e.target.value })}
                                            disabled={isSaving}
                                        >
                                            <option value="">Select Day</option>
                                            {(() => {
                                                let availableDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                                                if (config.vendorId) {
                                                    const selectedVendor = vendors.find(v => v.id === config.vendorId);
                                                    if (selectedVendor && selectedVendor.deliveryDays && selectedVendor.deliveryDays.length > 0) {
                                                        availableDays = selectedVendor.deliveryDays;
                                                    }
                                                }
                                                return availableDays.map(day => (
                                                    <option key={day} value={day}>{day}</option>
                                                ));
                                            })()}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Boxes Configuration */}
                    {(serviceType === 'Boxes' || (!serviceType && config.serviceType === 'Boxes')) && (
                        <div className="animate-fade-in" style={{ marginTop: '1rem' }}>
                            {boxOrders.map((box: any, index: number) => (
                                <div key={index} className={styles.boxConfigCard} style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                        <h4 style={{ margin: 0 }}>Box #{index + 1}</h4>
                                        {boxCount > 1 && (
                                            <button type="button" className={styles.linkBtn} onClick={() => removeBox(index)} style={{ color: 'var(--color-danger)' }}>
                                                <Trash2 size={16} /> Remove
                                            </button>
                                        )}
                                    </div>

                                    <div className={styles.formGroup}>
                                        <label className={styles.label}>Box Type</label>
                                        <select
                                            className={styles.select}
                                            value={box.boxTypeId || ''}
                                            onChange={(e) => updateBox(index, 'boxTypeId', e.target.value)}
                                            disabled={isSaving}
                                        >
                                            <option value="">Select Box Type</option>
                                            {boxTypes.filter(b => b.isActive).map(b => (
                                                <option key={b.id} value={b.id}>{b.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className={styles.formGroup}>
                                        <label className={styles.label}>Quantity</label>
                                        <div className={styles.quantityControl}>
                                            <button type="button" onClick={() => updateBox(index, 'quantity', Math.max(1, (box.quantity || 1) - 1))} disabled={isSaving}>-</button>
                                            <span>{box.quantity || 1}</span>
                                            <button type="button" onClick={() => updateBox(index, 'quantity', (box.quantity || 1) + 1)} disabled={isSaving}>+</button>
                                        </div>
                                    </div>

                                    {/* Box Items Selection Logic */}
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
                                                    const searchTerm = '';
                                                    const availableItems = menuItems.filter(i =>
                                                        ((i.vendorId === null || i.vendorId === '') || i.vendorId === box.vendorId) &&
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

                                                    let requiredQuotaValue: number | null = null;
                                                    if (category.setValue !== undefined && category.setValue !== null) {
                                                        requiredQuotaValue = category.setValue;
                                                    } else if (box.boxTypeId) {
                                                        const quota = boxQuotas.find(q => q.boxTypeId === box.boxTypeId && q.categoryId === category.id);
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
                                                                        onQuantityChange={(qty) => updateBoxItem(index, item.id, qty)}
                                                                        onNoteChange={(note) => updateBoxItem(index, item.id, selectedItems[item.id] || 0, note)}
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
                            <button type="button" className={styles.btnSecondary} onClick={addBox} style={{ width: '100%' }} disabled={isSaving}>
                                <Plus size={16} /> Add Another Box
                            </button>
                        </div>
                    )}
                </>
            ) : (
                <div className={styles.alert}>
                    <AlertTriangle size={16} />
                    <span>Please enter a Case ID to configure the order.</span>
                </div>
            )}

            {/* Save to new column removed: main Save button at bottom now performs this action */}
        </section>
        );
    }
    const renderOrderConfigSection = () => renderOrderConfigUI(false);
    const renderNewColumnOrderSection = () => renderOrderConfigUI(true);

    // --- RECENT ORDERS SECTION ---
    const renderRecentOrdersSection = () => (
        <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
            <button
                type="button"
                onClick={() => setRecentOrdersExpanded(!recentOrdersExpanded)}
                className={styles.accordionHeader}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Calendar size={20} />
                    <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Recent Orders</h3>
                    <span className={styles.badge}>{activeOrder ? 1 : 0}</span>
                </div>
                {recentOrdersExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>

            {recentOrdersExpanded && (
                <div style={{ marginTop: '1rem' }}>
                    {loadingRecentOrders ? (
                        <div className={styles.loadingContainer}>
                            <div className={styles.spinner}></div>
                            <p>Loading orders...</p>
                        </div>
                    ) : activeOrder ? (
                        <div className={styles.orderCard}>
                            <div className={styles.orderHeader}>
                                <div>
                                    <span className={styles.orderNumber}>#{activeOrder.orderNumber || 'PENDING'}</span>
                                    <span className={styles.orderDate}>
                                        {activeOrder.scheduledDeliveryDate ? new Date(activeOrder.scheduledDeliveryDate).toLocaleDateString() : 'Date TBD'}
                                    </span>
                                </div>
                                <span className={styles.orderStatus}>{activeOrder.status || 'Active'}</span>
                            </div>
                            <div className={styles.orderDetails}>
                                <p><strong>Service:</strong> {activeOrder.serviceType}</p>
                                <p><strong>Case ID:</strong> {activeOrder.caseId || 'N/A'}</p>
                                {/* Detailed breakdown would go here */}
                            </div>
                        </div>
                    ) : (
                        <p className={styles.emptyText}>No recent orders found.</p>
                    )}
                </div>
            )}
        </section>
    );

    // --- BILLING HISTORY SECTION ---
    const renderBillingHistorySection = () => (
        <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
            <button
                type="button"
                onClick={() => setBillingHistoryExpanded(!billingHistoryExpanded)}
                className={styles.accordionHeader}
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <AlertTriangle size={20} /> {/* Placeholder icon */}
                    <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Billing History</h3>
                    <span className={styles.badge}>{billingHistory?.length || 0}</span>
                </div>
                {billingHistoryExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </button>

            {billingHistoryExpanded && (
                <div style={{ marginTop: '1rem' }}>
                    {billingHistory && billingHistory.length > 0 ? (
                        <div className={styles.tableContainer}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Amount</th>
                                        <th>Status</th>
                                        <th>Invoice #</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {billingHistory.map((bill: any, i: number) => (
                                        <tr key={i}>
                                            <td>{new Date(bill.date).toLocaleDateString()}</td>
                                            <td>${bill.amount?.toFixed(2)}</td>
                                            <td>{bill.status}</td>
                                            <td>{bill.invoiceNumber || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className={styles.emptyText}>No billing history available.</p>
                    )}
                </div>
            )}
        </section>
    );

    // --- ORDER HISTORY SECTION ---
    /** Build OrderConfiguration from a history entry so we can restore into clients.upcoming_order */
    function historyEntryToOrderConfiguration(entry: any): OrderConfiguration {
        const d = entry.orderDetails || entry.orderConfig || {};
        console.log('[Restore] Mapping entry to config. entry.orderDetails keys:', entry.orderDetails ? Object.keys(entry.orderDetails) : 'none', 'd keys:', Object.keys(d));
        const config: OrderConfiguration = {
            serviceType: entry.serviceType || d.serviceType || 'Food',
            caseId: entry.caseId ?? d.caseId ?? undefined,
            deliveryDay: entry.deliveryDay ?? d.deliveryDay ?? undefined
        };
        // Notes are often stored on the entry; pass through for display if the type is extended
        (config as any).notes = entry.notes ?? d.notes ?? undefined;
        (config as any).mealType = entry.mealType ?? d.mealType ?? undefined;

        // Food: vendorSelections or deliveryDayOrders
        if (d.vendorSelections && Array.isArray(d.vendorSelections)) {
            config.vendorSelections = d.vendorSelections.map((vs: any) => ({
                vendorId: vs.vendorId,
                items: vs.items && typeof vs.items === 'object' ? vs.items : (Array.isArray(vs.itemsDetails)
                    ? Object.fromEntries((vs.itemsDetails as any[]).map((i: any) => [i.itemId, i.quantity]))
                    : {}),
                itemNotes: vs.itemNotes && typeof vs.itemNotes === 'object' ? vs.itemNotes : (Array.isArray(vs.itemsDetails)
                    ? Object.fromEntries((vs.itemsDetails as any[]).filter((i: any) => i.note).map((i: any) => [i.itemId, i.note]))
                    : undefined)
            }));
        }
        if (d.deliveryDayOrders && typeof d.deliveryDayOrders === 'object') {
            config.deliveryDayOrders = {};
            for (const [day, dayData] of Object.entries(d.deliveryDayOrders as Record<string, any>)) {
                const vsList = dayData?.vendorSelections;
                if (Array.isArray(vsList)) {
                    config.deliveryDayOrders![day] = {
                        vendorSelections: vsList.map((vs: any) => ({
                            vendorId: vs.vendorId,
                            items: vs.items && typeof vs.items === 'object' ? vs.items : (Array.isArray(vs.itemsDetails)
                                ? Object.fromEntries((vs.itemsDetails as any[]).map((i: any) => [i.itemId, i.quantity]))
                                : {}),
                            itemNotes: vs.itemNotes && typeof vs.itemNotes === 'object' ? vs.itemNotes : (Array.isArray(vs.itemsDetails)
                                ? Object.fromEntries((vs.itemsDetails as any[]).filter((i: any) => i.note).map((i: any) => [i.itemId, i.note]))
                                : undefined)
                        }))
                    };
                }
            }
        }

        // Meal: mealSelections
        if (d.mealSelections && typeof d.mealSelections === 'object') {
            config.mealSelections = {};
            for (const [key, sel] of Object.entries(d.mealSelections as Record<string, any>)) {
                if (sel && typeof sel === 'object') {
                    config.mealSelections![key] = {
                        vendorId: sel.vendorId ?? undefined,
                        items: sel.items && typeof sel.items === 'object' ? sel.items : (Array.isArray(sel.itemsDetails)
                            ? Object.fromEntries((sel.itemsDetails as any[]).map((i: any) => [i.itemId, i.quantity]))
                            : {}),
                        itemNotes: sel.itemNotes && typeof sel.itemNotes === 'object' ? sel.itemNotes : (Array.isArray(sel.itemsDetails)
                            ? Object.fromEntries((sel.itemsDetails as any[]).filter((i: any) => i.note).map((i: any) => [i.itemId, i.note]))
                            : undefined)
                    };
                }
            }
        }

        // Boxes: boxOrders
        if (d.boxOrders && Array.isArray(d.boxOrders)) {
            config.boxOrders = d.boxOrders.map((box: any) => ({
                id: box.id || `restore-${Math.random().toString(36).slice(2)}`,
                clientId: clientId,
                boxTypeId: box.boxTypeId,
                vendorId: box.vendorId,
                quantity: box.quantity ?? 1,
                items: box.items && typeof box.items === 'object' ? box.items : (Array.isArray(box.itemsDetails)
                    ? Object.fromEntries((box.itemsDetails as any[]).map((i: any) => [i.itemId, i.quantity]))
                    : {}),
                itemPrices: box.itemPrices && typeof box.itemPrices === 'object' ? box.itemPrices : undefined,
                itemNotes: box.itemNotes && typeof box.itemNotes === 'object' ? box.itemNotes : undefined
            }));
        }

        // Custom
        if (d.customOrder && typeof d.customOrder === 'object') {
            const co = d.customOrder as any;
            config.vendorId = co.vendorId;
            config.custom_name = co.description ?? co.custom_name;
            config.custom_price = co.price ?? co.custom_price;
            config.deliveryDay = co.deliveryDay ?? config.deliveryDay;
        }

        return config;
    }

    async function handleRestoreFromHistory(entry: any, entryKey: string) {
        console.log('[Restore] Clicked – entryKey:', entryKey, 'entry keys:', entry ? Object.keys(entry) : []);
        setOrderHistoryRestoringId(entryKey);
        try {
            const restored = historyEntryToOrderConfiguration(entry);
            console.log('[Restore] Built config:', { serviceType: restored.serviceType, caseId: restored.caseId, vendorSelectionsCount: restored.vendorSelections?.length, boxOrdersCount: restored.boxOrders?.length, mealSelectionsKeys: restored.mealSelections ? Object.keys(restored.mealSelections) : [] });
            // Form is driven by orderConfig – must set this so the order form shows the restored data
            setOrderConfig(restored);
            // Switch service type tab to match restored order
            if (restored.serviceType && formData.serviceType !== restored.serviceType) {
                setFormData((prev: any) => ({ ...prev, serviceType: restored.serviceType }));
            }
            console.log('[Restore] Calling updateClientUpcomingOrder...');
            await updateClientUpcomingOrder(clientId, restored);
            invalidateClientData(clientId);
            const updated = await getClient(clientId);
            console.log('[Restore] Result:', updated ? 'ok' : 'null', updated?.upcomingOrder ? 'has upcomingOrder' : '');
            if (updated) {
                setClient(updated);
                setOrderConfig((updated as any).upcomingOrder ?? restored);
            }
            console.log('[Restore] Done – form should show restored order.');
            setOrderHistoryRestoreMessage({ type: 'success', text: 'Order restored. Form updated and saved to server.' });
            setTimeout(() => setOrderHistoryRestoreMessage(null), 5000);
        } catch (e: any) {
            const msg = e?.message || String(e);
            console.error('[Restore] Failed:', msg, e);
            setOrderHistoryRestoreMessage({ type: 'error', text: `Restore failed: ${msg}` });
            setTimeout(() => setOrderHistoryRestoreMessage(null), 8000);
        } finally {
            setOrderHistoryRestoringId(null);
        }
    }

    /** Canonicalize config for comparison: only include defined, non-empty content so history and live orderConfig produce same signature when order is the same. */
    function canonicalizeOrderForComparison(c: any): any {
        if (!c || typeof c !== 'object') return {};
        const out: any = {};
        if (c.serviceType != null && c.serviceType !== '') out.serviceType = c.serviceType;
        if (c.caseId != null && c.caseId !== '') out.caseId = c.caseId;
        if (c.deliveryDay != null && c.deliveryDay !== '') out.deliveryDay = c.deliveryDay;
        if (c.vendorId != null && c.vendorId !== '') out.vendorId = c.vendorId;
        if (c.custom_name != null && c.custom_name !== '') out.custom_name = c.custom_name;
        if (c.custom_price != null && c.custom_price !== '') out.custom_price = c.custom_price;
        if (c.vendorSelections != null && Array.isArray(c.vendorSelections) && c.vendorSelections.length > 0) {
            out.vendorSelections = c.vendorSelections;
        }
        if (c.deliveryDayOrders != null && typeof c.deliveryDayOrders === 'object' && Object.keys(c.deliveryDayOrders).length > 0) {
            out.deliveryDayOrders = c.deliveryDayOrders;
        }
        if (c.mealSelections != null && typeof c.mealSelections === 'object' && Object.keys(c.mealSelections).length > 0) {
            out.mealSelections = c.mealSelections;
        }
        if (c.customOrder != null && typeof c.customOrder === 'object') {
            out.customOrder = c.customOrder;
        }
        if (c.boxOrders != null && Array.isArray(c.boxOrders) && c.boxOrders.length > 0) {
            out.boxOrders = c.boxOrders.map((b: any) => {
                const box: any = {};
                if (b.boxTypeId != null) box.boxTypeId = b.boxTypeId;
                if (b.vendorId != null) box.vendorId = b.vendorId;
                if (b.quantity != null) box.quantity = b.quantity;
                if (b.items != null && typeof b.items === 'object' && Object.keys(b.items).length > 0) box.items = b.items;
                if (b.itemPrices != null && typeof b.itemPrices === 'object' && Object.keys(b.itemPrices).length > 0) box.itemPrices = b.itemPrices;
                if (b.itemNotes != null && typeof b.itemNotes === 'object' && Object.keys(b.itemNotes).length > 0) box.itemNotes = b.itemNotes;
                return box;
            });
        }
        return out;
    }

    /** Stable string for comparing two order configs (same content => same string). Uses canonical form so live orderConfig and history entry match when order is the same. */
    function orderConfigSignature(c: any): string {
        if (!c || typeof c !== 'object') return '';
        const stable = (obj: any): string => {
            if (obj == null) return 'null';
            if (Array.isArray(obj)) return '[' + obj.map(stable).join(',') + ']';
            if (typeof obj === 'object') {
                const keys = Object.keys(obj).sort();
                return '{' + keys.map(k => JSON.stringify(k) + ':' + stable(obj[k])).join(',') + '}';
            }
            return JSON.stringify(obj);
        };
        return stable(canonicalizeOrderForComparison(c));
    }

    const renderOrderHistorySection = () => (
        <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
            <div
                className={styles.sectionHeader}
                onClick={() => setOrderHistoryExpanded(!orderHistoryExpanded)}
                style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <History size={20} />

                    <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Order History</h3>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            console.log('[DEBUG BUTTON] Client:', client);
                            console.log('[DEBUG BUTTON] clientOrderHistory state:', clientOrderHistory);
                            console.log('[DEBUG BUTTON] Raw Order History (Camel):', (client as any)?.orderHistory);
                            console.log('[DEBUG BUTTON] Raw Order History (Snake):', (client as any)?.order_history);
                        }}
                        className="btn btn-sm btn-outline-secondary"
                        style={{ marginLeft: '1rem', fontSize: '0.7rem', padding: '2px 6px' }}
                    >
                        Log Data
                    </button>
                    <span className={styles.badge}>{clientOrderHistory.length}</span>
                </div>
                {orderHistoryExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
            </div>

            {orderHistoryRestoreMessage && (
                <div
                    role="alert"
                    style={{
                        marginTop: '0.75rem',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '6px',
                        backgroundColor: orderHistoryRestoreMessage.type === 'success' ? 'var(--color-success-bg, #d4edda)' : 'var(--color-error-bg, #f8d7da)',
                        color: orderHistoryRestoreMessage.type === 'success' ? 'var(--color-success, #155724)' : 'var(--color-error, #721c24)',
                        fontSize: '0.9rem'
                    }}
                >
                    {orderHistoryRestoreMessage.text}
                </div>
            )}

            {orderHistoryExpanded && (
                <div className={styles.historyList} style={{ marginTop: '1rem' }}>
                    {clientOrderHistory.length > 0 ? (
                        clientOrderHistory.map((entry, index) => {
                            const entryKey = entry.actionId || `history-${entry.timestamp}-${index}`;
                            const isRestoring = orderHistoryRestoringId === entryKey;
                            const od = entry.orderDetails || entry.orderConfig || {};
                            const hasRestorableDetails = !!(od && (od.vendorSelections || od.deliveryDayOrders || od.mealSelections || od.boxOrders || od.customOrder));
                            const entryConfig = historyEntryToOrderConfiguration(entry);
                            const entryCanon = canonicalizeOrderForComparison(entryConfig);
                            const currentCanon = orderConfig ? canonicalizeOrderForComparison(orderConfig) : {};
                            const entrySig = orderConfigSignature(entryConfig);
                            const currentSig = orderConfig ? orderConfigSignature(orderConfig) : '';
                            const isCurrentOrder = !!orderConfig && entrySig === currentSig;
                            // Find first character where signatures differ (for debugging)
                            let firstDiffAt = -1;
                            if (entrySig !== currentSig) {
                                for (let i = 0; i < Math.max(entrySig.length, currentSig.length); i++) {
                                    if (entrySig[i] !== currentSig[i]) { firstDiffAt = i; break; }
                                }
                            }
                            // Log comparison for each history entry
                            console.log('[History match]', {
                                index,
                                timestamp: entry.timestamp,
                                serviceType: entryConfig.serviceType,
                                entryCanonicalKeys: Object.keys(entryCanon),
                                currentCanonicalKeys: Object.keys(currentCanon),
                                hasOrderConfig: !!orderConfig,
                                orderConfigKeys: orderConfig ? Object.keys(orderConfig) : [],
                                entrySigLength: entrySig.length,
                                currentSigLength: currentSig.length,
                                match: isCurrentOrder,
                                firstDiffAt: firstDiffAt >= 0 ? firstDiffAt : null,
                                atFirstDiff: firstDiffAt >= 0 ? { entryChar: entrySig[firstDiffAt], currentChar: currentSig[firstDiffAt], entrySlice: entrySig.slice(Math.max(0, firstDiffAt - 20), firstDiffAt + 30), currentSlice: currentSig.slice(Math.max(0, firstDiffAt - 20), firstDiffAt + 30) } : null,
                                entrySigFull: entrySig,
                                currentSigFull: currentSig
                            });
                            if (index === 0 && (entry.orderDetails || entry.orderConfig) && !hasRestorableDetails) {
                                console.log('[Restore] First history entry has orderDetails/orderConfig but hasRestorableDetails=false. keys:', Object.keys(od));
                            }
                            return (
                                <div key={entryKey} className={styles.card} style={{ marginBottom: '1.5rem', borderLeft: isCurrentOrder ? '4px solid rgb(34, 197, 94)' : '4px solid var(--color-primary)', backgroundColor: 'var(--bg-surface)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                                            <strong>{entry.type === 'upcoming' ? 'Upcoming order saved' : entry.type === 'order_created' ? 'Order Created' : 'Order Updated'}</strong>
                                            <span className={styles.budget} style={{ fontSize: '0.8rem' }}>{entry.serviceType}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                            {hasRestorableDetails && (
                                                <button
                                                    type="button"
                                                    className="btn btn-sm btn-primary"
                                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); console.log('[Restore] Button clicked for entry:', entry?.timestamp); handleRestoreFromHistory(entry, entryKey); }}
                                                    disabled={isRestoring}
                                                    title={isRestoring ? 'Restoring…' : 'Restore this order as the current upcoming order and active order'}
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '0.35rem',
                                                        opacity: isRestoring ? 0.8 : 1,
                                                        cursor: isRestoring ? 'wait' : 'pointer',
                                                        pointerEvents: isRestoring ? 'none' : 'auto'
                                                    }}
                                                >
                                                    {isRestoring ? <Loader2 size={14} className="spin" style={{ flexShrink: 0 }} /> : <RotateCcw size={14} />}
                                                    {isRestoring ? 'Restoring…' : 'Restore'}
                                                </button>
                                            )}
                                            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                                {new Date(entry.timestamp).toLocaleString()}
                                            </span>
                                        </div>
                                    </div>

                                    <div style={{ fontSize: '0.95rem' }}>
                                        {entry.orderNumber && (
                                            <div style={{ marginBottom: '0.5rem' }}>
                                                <strong>Order #:</strong> {entry.orderNumber}
                                            </div>
                                        )}

                                        {/* Render Order Details depending on Service Type */}
                                        {entry.orderDetails && (
                                            <div style={{ marginTop: '0.5rem' }}>
                                                {/* Food / Meal / Custom - Vendor Selections */}
                                                {entry.orderDetails.vendorSelections && Array.isArray(entry.orderDetails.vendorSelections) && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                        {entry.orderDetails.vendorSelections.map((vs: any, vIdx: number) => {
                                                            const rawVs = entry.orderData?.vendorSelections?.[vIdx];
                                                            const hasItemsByDay = rawVs?.itemsByDay && typeof rawVs.itemsByDay === 'object' && Object.keys(rawVs.itemsByDay).length > 0;
                                                            const fallbackItems: { itemName: string; quantity: number }[] = [];
                                                            if (hasItemsByDay && (!vs.itemsDetails || vs.itemsDetails.length === 0)) {
                                                                const merged: Record<string, number> = {};
                                                                for (const day of Object.keys(rawVs.itemsByDay)) {
                                                                    const dayItems = rawVs.itemsByDay[day];
                                                                    if (dayItems && typeof dayItems === 'object') {
                                                                        for (const [itemId, qty] of Object.entries(dayItems)) {
                                                                            const n = typeof qty === 'number' ? qty : parseInt(String(qty), 10) || 0;
                                                                            if (n > 0) merged[itemId] = (merged[itemId] || 0) + n;
                                                                        }
                                                                    }
                                                                }
                                                                for (const [itemId, qty] of Object.entries(merged)) {
                                                                    const menuItem = menuItems.find((m: any) => m.id === itemId);
                                                                    fallbackItems.push({ itemName: menuItem?.name || 'Unknown Item', quantity: qty as number });
                                                                }
                                                            }
                                                            return (
                                                            <div key={vIdx} style={{ backgroundColor: 'var(--bg-surface-hover)', padding: '0.5rem', borderRadius: '4px' }}>
                                                                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{vs.vendorName || 'Unknown Vendor'}</div>
                                                                {/* Items List — use itemsDetails, or fallback from orderData.itemsByDay for older entries */}
                                                                {vs.itemsDetails && Array.isArray(vs.itemsDetails) && vs.itemsDetails.length > 0 ? (
                                                                    <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
                                                                        {vs.itemsDetails.map((item: any, iIdx: number) => (
                                                                            <li key={iIdx}>
                                                                                {item.itemName} x{item.quantity}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                ) : fallbackItems.length > 0 ? (
                                                                    <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
                                                                        {fallbackItems.map((item: any, iIdx: number) => (
                                                                            <li key={iIdx}>
                                                                                {item.itemName} x{item.quantity}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                ) : (
                                                                    <div style={{ fontSize: '0.9rem', fontStyle: 'italic' }}>Items: {Object.keys(vs.items || {}).length}</div>
                                                                )}
                                                            </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}

                                                {/* Custom Orders */}
                                                {entry.orderDetails.customOrder && (
                                                    <div style={{ backgroundColor: 'var(--bg-surface-hover)', padding: '0.8rem', borderRadius: '4px' }}>
                                                        <div style={{ fontWeight: 600, marginBottom: '0.4rem', color: 'var(--color-primary)' }}>Custom Order Details</div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '0.4rem', fontSize: '0.9rem' }}>
                                                            <span style={{ color: 'var(--text-tertiary)' }}>Vendor:</span>
                                                            <span style={{ fontWeight: 500 }}>{entry.orderDetails.customOrder.vendorName}</span>

                                                            <span style={{ color: 'var(--text-tertiary)' }}>Item:</span>
                                                            <span>{entry.orderDetails.customOrder.description}</span>

                                                            <span style={{ color: 'var(--text-tertiary)' }}>Price:</span>
                                                            <span style={{ fontWeight: 600 }}>${entry.orderDetails.customOrder.price?.toFixed(2)}</span>

                                                            <span style={{ color: 'var(--text-tertiary)' }}>Delivery:</span>
                                                            <span>{entry.orderDetails.customOrder.deliveryDay}</span>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Meal Selections */}
                                                {entry.orderDetails.mealSelections && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                                        {Object.entries(entry.orderDetails.mealSelections).map(([key, selection]: [string, any]) => (
                                                            <div key={key} style={{ backgroundColor: 'var(--bg-surface-hover)', padding: '0.8rem', borderRadius: '4px' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                                                                    <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{selection.mealType || key}</span>
                                                                    <span style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: '12px', backgroundColor: 'var(--bg-surface)', fontWeight: 500 }}>
                                                                        {selection.vendorName}
                                                                    </span>
                                                                </div>
                                                                {selection.itemsDetails && Array.isArray(selection.itemsDetails) ? (
                                                                    <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
                                                                        {selection.itemsDetails.map((item: any, iIdx: number) => (
                                                                            <li key={iIdx}>
                                                                                <strong>{item.itemName}</strong> x{item.quantity}
                                                                                {item.note && <span style={{ marginLeft: '0.5rem', fontStyle: 'italic', color: 'var(--text-tertiary)' }}>({item.note})</span>}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                ) : (
                                                                    <div style={{ fontSize: '0.85rem', fontStyle: 'italic', color: 'var(--text-tertiary)' }}>
                                                                        Items: {Object.keys(selection.items || {}).length}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Delivery Day Orders (Food by day — show whenever present, can appear with vendorSelections/mealSelections) */}
                                                {(() => {
                                                    const dayOrders = entry.orderDetails.deliveryDayOrders && Object.keys(entry.orderDetails.deliveryDayOrders).length > 0
                                                        ? entry.orderDetails.deliveryDayOrders
                                                        : null;
                                                    const fromOrderDataByDay: Record<string, { vendorSelections: { vendorName: string; itemsDetails: { itemName: string; quantity: number }[] }[] }> = {};
                                                    if (!dayOrders && entry.orderData?.vendorSelections) {
                                                        for (const vs of entry.orderData.vendorSelections) {
                                                            if (!vs?.itemsByDay || typeof vs.itemsByDay !== 'object') continue;
                                                            const vendorName = vendors.find((v: any) => v.id === vs.vendorId)?.name || 'Unknown Vendor';
                                                            for (const [day, dayItems] of Object.entries(vs.itemsByDay)) {
                                                                const items = (dayItems && typeof dayItems === 'object') ? dayItems : {};
                                                                if (Object.keys(items).length === 0) continue;
                                                                if (!fromOrderDataByDay[day]) fromOrderDataByDay[day] = { vendorSelections: [] };
                                                                const itemsDetails = Object.entries(items).map(([itemId, qty]) => {
                                                                    const menuItem = menuItems.find((m: any) => m.id === itemId);
                                                                    return { itemName: menuItem?.name || 'Unknown Item', quantity: typeof qty === 'number' ? qty : parseInt(String(qty), 10) || 0 };
                                                                });
                                                                fromOrderDataByDay[day].vendorSelections.push({ vendorName, itemsDetails });
                                                            }
                                                        }
                                                    }
                                                    const showByDay = dayOrders || (Object.keys(fromOrderDataByDay).length > 0 ? fromOrderDataByDay : null);
                                                    return showByDay ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: entry.orderDetails.vendorSelections || entry.orderDetails.mealSelections ? '0.75rem' : 0 }}>
                                                        {(entry.orderDetails.vendorSelections || entry.orderDetails.mealSelections) && (
                                                            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: '0.25rem' }}>Food (by delivery day)</div>
                                                        )}
                                                        {Object.entries(showByDay).map(([day, dayData]: [string, any]) => (
                                                            <div key={day}>
                                                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>{day}</div>
                                                                {(dayData.vendorSelections || []).map((vs: any, vIdx: number) => (
                                                                    <div key={vIdx} style={{ backgroundColor: 'var(--bg-surface-hover)', padding: '0.5rem', borderRadius: '4px', marginBottom: '0.5rem' }}>
                                                                        <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{vs.vendorName || 'Unknown Vendor'}</div>
                                                                        {vs.itemsDetails && Array.isArray(vs.itemsDetails) && vs.itemsDetails.length > 0 ? (
                                                                            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
                                                                                {vs.itemsDetails.map((item: any, iIdx: number) => (
                                                                                    <li key={iIdx}>
                                                                                        {item.itemName} x{item.quantity}
                                                                                    </li>
                                                                                ))}
                                                                            </ul>
                                                                        ) : (
                                                                            <div style={{ fontSize: '0.9rem', fontStyle: 'italic' }}>Items: {Object.keys(vs.items || {}).length}</div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        ))}
                                                    </div>
                                                    ) : null;
                                                })()}

                                                {/* Box Orders */}
                                                {entry.orderDetails.boxOrders && Array.isArray(entry.orderDetails.boxOrders) && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                        {entry.orderDetails.boxOrders.map((box: any, bIdx: number) => (
                                                            <div key={bIdx} style={{ backgroundColor: 'var(--bg-surface-hover)', padding: '0.5rem', borderRadius: '4px' }}>
                                                                <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                                                                    {box.boxTypeName || 'Unknown Box'} ({box.vendorName}) x{box.quantity}
                                                                </div>
                                                                {/* Box Contents */}
                                                                {box.itemsDetails && Array.isArray(box.itemsDetails) && (
                                                                    <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
                                                                        {box.itemsDetails.map((item: any, iIdx: number) => (
                                                                            <li key={iIdx}>
                                                                                {item.itemName} x{item.quantity}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* Render Snapshot for save_event or if orderDetails render was minimal */}
                                                {entry.type === 'save_event' && entry.snapshot && (
                                                    <div style={{
                                                        marginTop: '0.8rem',
                                                        padding: '0.8rem',
                                                        backgroundColor: 'var(--bg-surface)',
                                                        borderLeft: '2px solid var(--color-primary-light)',
                                                        fontSize: '0.85rem',
                                                        whiteSpace: 'pre-wrap',
                                                        fontFamily: 'monospace',
                                                        color: 'var(--text-secondary)',
                                                        borderRadius: '4px'
                                                    }}>
                                                        {entry.snapshot}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Fallback for entries with no orderDetails */}
                                        {!entry.orderDetails && (
                                            <div style={{ marginTop: '0.5rem', fontStyle: 'italic', color: 'var(--text-secondary)' }}>
                                                {entry.notes ? `Note: ${entry.notes}` : (entry.details || 'Order updated (No details captured)')}
                                            </div>
                                        )}

                                        {entry.updatedBy && (
                                            <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-tertiary)', textAlign: 'right' }}>
                                                Updated by: {entry.updatedBy}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className={styles.empty}>No order history available.</div>
                    )}
                </div>
            )}
        </section>
    );

    function getContent() {
        return (
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

                {validationError && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 9999,
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

                            <p style={{ color: '#4b5563', lineHeight: 1.5, marginBottom: '24px', fontSize: '1rem', whiteSpace: 'pre-line' }}>
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
                                        fontWeight: 600,
                                        width: '100%'
                                    }}
                                >
                                    I Understand
                                </button>
                            </div>
                        </div>
                    </div>
                )}

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
                                    <label className="label">Date of Birth</label>
                                    <input
                                        type="date"
                                        className="input"
                                        value={formData.dob || ''}
                                        onChange={e => setFormData({ ...formData, dob: e.target.value || null })}
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className="label">CIN#</label>
                                    <input
                                        type="text"
                                        className="input"
                                        placeholder="CIN Number"
                                        value={formData.cin || ''}
                                        onChange={e => setFormData({ ...formData, cin: e.target.value.trim() || null })}
                                    />
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
                        {isNewClient && (
                            <div className={styles.column}>
                                <section className={styles.card}>
                                    <h3 className={styles.sectionTitle}>Client Details</h3>

                                    <div className={styles.formGroup}>
                                        <label className="label">Full Name</label>
                                        <input className="input" value={formData.fullName || ''} onChange={e => setFormData({ ...formData, fullName: e.target.value })} />
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
                                        <input className="input" value={formData.address || ''} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                                    </div>

                                    <div className={styles.formGroup}>
                                        <label className="label">Phone</label>
                                        <input className="input" value={formData.phoneNumber || ''} onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })} />
                                        <div style={{ height: '1rem' }} /> {/* Spacer */}
                                        <label className="label">Secondary Phone</label>
                                        <input className="input" value={formData.secondaryPhoneNumber || ''} onChange={e => setFormData({ ...formData, secondaryPhoneNumber: e.target.value })} />
                                        <div style={{ height: '1rem' }} /> {/* Spacer */}
                                        <label className="label">Email</label>
                                        <input className="input" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                    </div>

                                    {/* Financial Controls for NEW CLIENTS - Moved here above notes */}
                                    {isNewClient && (currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                                        <div className={styles.formGroup} style={{ marginBottom: '1.5rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
                                            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '1rem', color: 'var(--text-secondary)' }}>
                                                Initial Authorization
                                            </h4>

                                            {formData.serviceType === 'Boxes' ? (
                                                <>
                                                    <label className="label">Max Boxes Authorized</label>
                                                    <input
                                                        type="number"
                                                        className="input"
                                                        value={formData.approvedMealsPerWeek ?? ''}
                                                        onChange={e => setFormData({ ...formData, approvedMealsPerWeek: e.target.value ? parseInt(e.target.value) : undefined })}
                                                        min={1}
                                                        placeholder="1"
                                                    />
                                                </>
                                            ) : (
                                                <>
                                                    {isNewClient && (
                                                        <>
                                                            <label className="label">Authorized Amount ($)</label>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                className="input"
                                                                value={formData.authorizedAmount ?? ''}
                                                                onChange={e => setFormData({ ...formData, authorizedAmount: e.target.value ? parseFloat(e.target.value) : null })}
                                                                placeholder="0.00"
                                                            />
                                                        </>
                                                    )}

                                                    {formData.serviceType === 'Food' && (
                                                        <>
                                                            <div style={{ height: '1rem' }} />
                                                            <label className="label">Approved Meals Per Week</label>
                                                            <input
                                                                type="number"
                                                                className="input"
                                                                value={formData.approvedMealsPerWeek ?? ''}
                                                                onChange={e => setFormData({ ...formData, approvedMealsPerWeek: e.target.value ? parseInt(e.target.value) : undefined })}
                                                                min={MIN_APPROVED_MEALS_PER_WEEK}
                                                                max={MAX_APPROVED_MEALS_PER_WEEK}
                                                                placeholder="21"
                                                            />
                                                        </>
                                                    )}
                                                </>
                                            )}

                                            <div style={{ height: '1rem' }} />
                                            <label className="label">Authorization Expiration Date</label>
                                            <input
                                                type="date"
                                                className="input"
                                                value={(() => { const ed = formData.expirationDate ?? ''; return ed ? (ed.includes('T') ? ed.split('T')[0] : ed) : ''; })()}
                                                onChange={e => setFormData({ ...formData, expirationDate: e.target.value || null })}
                                            />
                                        </div>
                                    )}

                                    <div className={styles.formGroup}>
                                        <label className="label">General Notes</label>
                                        <textarea className="input" style={{ height: '100px' }} value={formData.notes || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} />
                                    </div>

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

                                </section >

                                {!isDependent && (
                                    <section className={styles.card}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                            <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Dependents {dependents.length > 0 && `(${dependents.length})`}</h3>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => setShowAddDependentForm(!showAddDependentForm)}
                                                style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}
                                            >
                                                <Plus size={14} /> {showAddDependentForm ? 'Cancel' : 'Add Dependent'}
                                            </button>
                                        </div>

                                        {showAddDependentForm && (
                                            <div style={{
                                                padding: '1rem',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: 'var(--radius-md)',
                                                backgroundColor: 'var(--bg-surface-hover)',
                                                marginBottom: '0.75rem'
                                            }}>
                                                <label className="label" style={{ marginBottom: '0.5rem' }}>Dependent Name</label>
                                                <input
                                                    className="input"
                                                    placeholder="Enter dependent name"
                                                    value={dependentName}
                                                    onChange={e => setDependentName(e.target.value)}
                                                    onKeyDown={e => {
                                                        if (e.key === 'Enter' && dependentName.trim()) {
                                                            handleCreateDependent();
                                                        }
                                                    }}
                                                    style={{ marginBottom: '0.75rem' }}
                                                    autoFocus
                                                />
                                                <label className="label" style={{ marginBottom: '0.5rem' }}>Date of Birth</label>
                                                <input
                                                    type="date"
                                                    className="input"
                                                    value={dependentDob}
                                                    onChange={e => setDependentDob(e.target.value)}
                                                    style={{ marginBottom: '0.75rem' }}
                                                />
                                                <label className="label" style={{ marginBottom: '0.5rem' }}>CIN#</label>
                                                <input
                                                    type="text"
                                                    className="input"
                                                    placeholder="CIN Number"
                                                    value={dependentCin}
                                                    onChange={e => setDependentCin(e.target.value)}
                                                    style={{ marginBottom: '0.75rem' }}
                                                />
                                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                                    <button
                                                        className="btn btn-secondary"
                                                        onClick={() => {
                                                            setShowAddDependentForm(false);
                                                            setDependentName('');
                                                            setDependentDob('');
                                                            setDependentCin('');
                                                        }}
                                                        disabled={creatingDependent}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <button
                                                        className="btn btn-primary"
                                                        onClick={handleCreateDependent}
                                                        disabled={!dependentName.trim() || creatingDependent}
                                                    >
                                                        {creatingDependent ? <Loader2 className="spin" size={14} /> : <Plus size={14} />} Create Dependent
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {dependents.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {dependents.map(dependent => (
                                                    <div
                                                        key={dependent.id}
                                                        onClick={() => {
                                                            if (onClose) {
                                                                onClose();
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
                                                        {(dependent.dob || dependent.cin) && (
                                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                                                {dependent.dob && <span>DOB: {new Date(dependent.dob).toLocaleDateString()}</span>}
                                                                {dependent.dob && dependent.cin && <span> • </span>}
                                                                {dependent.cin && <span>CIN#: {dependent.cin}</span>}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', margin: 0 }}>
                                                No dependents yet. Click "Add Dependent" to create one.
                                            </p>
                                        )}
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
                            </div >
                        )}

                        <div className={styles.column}>
                            {/* HIDE: regular Service Configuration / Current Order — show only Upcoming orders configuration. Wrapped in false && to avoid nested comment issues. */}
                            {false && (
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

                                <div className={styles.formGroup}>
                                    {!isNewClient && (currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (
                                        <>
                                            {formData.serviceType === 'Boxes' ? (
                                                <>
                                                    <label className="label" style={{ marginTop: '1rem' }}>Max Boxes Authorized</label>
                                                    <input
                                                        type="number"
                                                        className="input"
                                                        value={formData.approvedMealsPerWeek ?? ''}
                                                        onChange={e => setFormData({ ...formData, approvedMealsPerWeek: e.target.value ? parseInt(e.target.value) : undefined })}
                                                        min={1}
                                                        placeholder="1"
                                                    />
                                                    {isNewClient && (
                                                        <>
                                                            <div style={{ height: '1rem' }} />
                                                            <label className="label">Authorization Expiration Date</label>
                                                            <input
                                                                type="date"
                                                                className="input"
                                                                value={(() => { const ed = formData.expirationDate ?? ''; return ed ? (ed.includes('T') ? ed.split('T')[0] : ed) : ''; })()}
                                                                onChange={e => setFormData({ ...formData, expirationDate: e.target.value || null })}
                                                            />
                                                        </>
                                                    )}
                                                </>
                                            ) : (
                                                <>
                                                    {/* Money-based Authorization for Food, Equipment, etc. */}
                                                    {isNewClient && (
                                                        <>
                                                            <label className="label" style={{ marginTop: '1rem' }}>Authorized Amount ($)</label>
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                className="input"
                                                                value={formData.authorizedAmount ?? ''}
                                                                onChange={e => setFormData({ ...formData, authorizedAmount: e.target.value ? parseFloat(e.target.value) : null })}
                                                                placeholder="0.00"
                                                            />
                                                        </>
                                                    )}
                                                    {isNewClient && (
                                                        <>
                                                            <div style={{ height: '1rem' }} />
                                                            <label className="label">Authorization Expiration Date</label>
                                                            <input
                                                                type="date"
                                                                className="input"
                                                                value={(() => { const ed = formData.expirationDate ?? ''; return ed ? (ed.includes('T') ? ed.split('T')[0] : ed) : ''; })()}
                                                                onChange={e => setFormData({ ...formData, expirationDate: e.target.value || null })}
                                                            />
                                                        </>
                                                    )}

                                                    {/* Meal-specific field */}
                                                    {formData.serviceType === 'Food' && (
                                                        <>
                                                            <div style={{ height: '1rem' }} />
                                                            <label className="label">Approved Meals Per Week</label>
                                                            <input
                                                                type="number"
                                                                className="input"
                                                                value={formData.approvedMealsPerWeek ?? ''}
                                                                onChange={e => setFormData({ ...formData, approvedMealsPerWeek: e.target.value ? parseInt(e.target.value) : undefined })}
                                                                min={MIN_APPROVED_MEALS_PER_WEEK}
                                                                max={MAX_APPROVED_MEALS_PER_WEEK}
                                                                placeholder="21"
                                                            />
                                                        </>
                                                    )}
                                                </>
                                            )}
                                        </>
                                    )}
                                </div>

                                {!orderConfig.caseId && (
                                    <div className={styles.alert} style={{ marginTop: '16px', backgroundColor: 'var(--bg-surface-hover)' }}>
                                        <AlertTriangle size={16} />
                                        Please enter a Case ID to configure the service.
                                    </div>
                                )}

                                {orderConfig.caseId && (
                                    <>
                                        {(formData.serviceType === 'Food' || formData.serviceType === 'Meal') && (
                                            <div className="animate-fade-in" style={{ marginTop: '1rem' }}>
                                                <FoodServiceWidget
                                                    orderConfig={orderConfig}
                                                    setOrderConfig={setOrderConfig}
                                                    client={{ ...client, ...formData } as ClientProfile}
                                                    vendors={vendors}
                                                    menuItems={menuItems}
                                                    mealCategories={mealCategories}
                                                    mealItems={mealItems}
                                                    settings={settings}
                                                />
                                                <div style={{ marginTop: '1rem' }}>
                                                    <label className={styles.label}>Order Notes</label>
                                                    <textarea
                                                        className="input"
                                                        placeholder="Add general notes for this order..."
                                                        value={orderConfig.notes || ''}
                                                        onChange={(e) => setOrderConfig({ ...orderConfig, notes: e.target.value })}
                                                        rows={2}
                                                        style={{ resize: 'vertical', minHeight: '3rem' }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {/* Custom Service Configuration */}
                                        {formData.serviceType === 'Custom' && (
                                            <div className={styles.section} style={{ marginTop: '24px' }}>
                                                <h3 className={styles.sectionTitle}>Custom Order Configuration</h3>
                                                <div className={styles.card} style={{ backgroundColor: '#f9fafb' }}>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <div className="col-span-2">
                                                            <label className={styles.label}>Item Description <span className="text-red-500">*</span></label>
                                                            <textarea
                                                                className="input"
                                                                placeholder="e.g. Weekly Catering Platter"
                                                                value={orderConfig.custom_name || ''}
                                                                rows={1}
                                                                style={{ resize: 'none', overflow: 'hidden', minHeight: '3rem' }}
                                                                onInput={(e) => {
                                                                    const target = e.target as HTMLTextAreaElement;
                                                                    target.style.height = 'auto';
                                                                    target.style.height = target.scrollHeight + 'px';
                                                                }}
                                                                onChange={e => {
                                                                    setOrderConfig({ ...orderConfig, custom_name: e.target.value });
                                                                    // Also trigger resize on change for safe measure
                                                                    e.target.style.height = 'auto';
                                                                    e.target.style.height = e.target.scrollHeight + 'px';
                                                                }}
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className={styles.label}>Price per Order <span className="text-red-500">*</span></label>
                                                            <div className="relative">
                                                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                                                                <input
                                                                    type="number"
                                                                    className="input pl-8"
                                                                    placeholder="0.00"
                                                                    value={orderConfig.custom_price || ''}
                                                                    onChange={e => setOrderConfig({ ...orderConfig, custom_price: e.target.value })}
                                                                />
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <label className={styles.label}>Vendor <span className="text-red-500">*</span></label>
                                                            <select
                                                                className="input"
                                                                value={orderConfig.vendorId || ''}
                                                                onChange={e => {
                                                                    const newVendorId = e.target.value;
                                                                    let newDeliveryDay = orderConfig.deliveryDay;

                                                                    // Check if current day is valid for new vendor
                                                                    if (newVendorId && newDeliveryDay) {
                                                                        const selectedVendor = vendors.find(v => v.id === newVendorId);
                                                                        if (selectedVendor && selectedVendor.deliveryDays && selectedVendor.deliveryDays.length > 0) {
                                                                            if (!selectedVendor.deliveryDays.includes(newDeliveryDay)) {
                                                                                newDeliveryDay = ''; // Reset if invalid
                                                                            }
                                                                        }
                                                                    }

                                                                    setOrderConfig({ ...orderConfig, vendorId: newVendorId, deliveryDay: newDeliveryDay });
                                                                }}
                                                            >
                                                                <option value="">Select Vendor</option>
                                                                {vendors.filter(v => v.isActive).map(v => (
                                                                    <option key={v.id} value={v.id}>{v.name}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div>
                                                            <label className={styles.label}>Delivery Day <span className="text-red-500">*</span></label>
                                                            <select
                                                                className="input"
                                                                value={orderConfig.deliveryDay || ''}
                                                                onChange={e => setOrderConfig({ ...orderConfig, deliveryDay: e.target.value })}
                                                            >
                                                                <option value="">Select Day</option>
                                                                {(() => {
                                                                    // Determine available days
                                                                    let availableDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

                                                                    if (orderConfig.vendorId) {
                                                                        const selectedVendor = vendors.find(v => v.id === orderConfig.vendorId);
                                                                        const sv = selectedVendor;
                                                                        if (sv?.deliveryDays?.length) {
                                                                            availableDays = sv!.deliveryDays;
                                                                        }
                                                                    }

                                                                    return availableDays.map(day => (
                                                                        <option key={day} value={day}>{day}</option>
                                                                    ));
                                                                })()}
                                                            </select>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}


                                        {
                                            formData.serviceType === 'Boxes' && (() => {
                                                const currentBoxes = orderConfig.boxOrders || [];

                                                return (
                                                    <div className="animate-fade-in">
                                                        {currentBoxes.map((box: any, index: number) => (
                                                            <div key={index} style={{
                                                                marginBottom: '2rem',
                                                                padding: '1.5rem',
                                                                backgroundColor: 'var(--bg-surface)',
                                                                border: '1px solid var(--border-color)',
                                                                borderRadius: 'var(--radius-md)',
                                                                position: 'relative'
                                                            }}>
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
                                                                {/* Box Type dropdown removed - defaulting to first active type in background */}

                                                                <div className={styles.formGroup}>
                                                                    <label className="label">Vendor</label>
                                                                    <select
                                                                        className="input"
                                                                        value={box.vendorId || ''}
                                                                        onChange={e => handleBoxUpdate(index, 'vendorId', e.target.value)}
                                                                    >
                                                                        <option value="">Select Vendor...</option>
                                                                        {vendors.filter(v => v.serviceTypes.includes('Boxes') && v.isActive).map(v => (
                                                                            <option key={v.id} value={v.id}>{v.name}</option>
                                                                        ))}
                                                                    </select>
                                                                </div>

                                                                {/* Take Effect Date for this vendor */}
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
                                                                                Changes may not take effect till next week
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

                                                                {/* Box Content Selection */}
                                                                <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>

                                                                    {/* Check if vendor has delivery days */}
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

                                                                                const selectedItems = box.items || {};

                                                                                // Calculate total quota value for this category based on THIS box's items
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

                                                                                // 1. Check if category has a fixed set value
                                                                                if (category.setValue !== undefined && category.setValue !== null) {
                                                                                    requiredQuotaValue = category.setValue;
                                                                                }
                                                                                // 2. Otherwise check box type specific quotas
                                                                                else if (box.boxTypeId) {
                                                                                    const quota = boxQuotas.find(q => q.boxTypeId === box.boxTypeId && q.categoryId === category.id);
                                                                                    if (quota) {
                                                                                        requiredQuotaValue = quota.targetValue;
                                                                                    }
                                                                                }

                                                                                const meetsQuota = requiredQuotaValue !== null ? isMeetingExactTarget(categoryQuotaValue, requiredQuotaValue) : true;

                                                                                // Get selected items for this category to show in summary
                                                                                const selectedItemsForCategory = availableItems.filter(item => {
                                                                                    const qty = Number(selectedItems[item.id] || 0);
                                                                                    return qty > 0;
                                                                                }).map(item => {
                                                                                    const qty = Number(selectedItems[item.id] || 0);
                                                                                    return { item, qty };
                                                                                });

                                                                                const shelfId = getCategoryShelfId(index, category.id);
                                                                                const isOpen = isCategoryShelfOpen(index, category.id);

                                                                                return (
                                                                                    <div key={category.id} style={{
                                                                                        marginBottom: '1rem',
                                                                                        background: 'var(--bg-surface)',
                                                                                        borderRadius: '8px',
                                                                                        border: requiredQuotaValue !== null && !meetsQuota ? '2px solid var(--color-danger)' : '1px solid var(--border-color)',
                                                                                        overflow: 'hidden',
                                                                                        transition: 'all 0.2s ease'
                                                                                    }}>
                                                                                        {/* Shelf Header - Always Visible */}
                                                                                        <div
                                                                                            onClick={() => toggleCategoryShelf(index, category.id)}
                                                                                            style={{
                                                                                                display: 'flex',
                                                                                                justifyContent: 'space-between',
                                                                                                alignItems: 'center',
                                                                                                padding: '12px 16px',
                                                                                                backgroundColor: isOpen ? 'var(--bg-surface-hover)' : 'var(--bg-surface)',
                                                                                                cursor: 'pointer',
                                                                                                borderBottom: isOpen ? '1px solid var(--border-color)' : 'none',
                                                                                                transition: 'background-color 0.2s ease'
                                                                                            }}
                                                                                        >
                                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, flexWrap: 'wrap' }}>
                                                                                                <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>
                                                                                                    {category.name}
                                                                                                </span>
                                                                                                {requiredQuotaValue !== null && (
                                                                                                    <span style={{
                                                                                                        color: meetsQuota ? 'var(--color-success)' : 'var(--color-danger)',
                                                                                                        fontSize: '0.85rem',
                                                                                                        padding: '2px 8px',
                                                                                                        backgroundColor: meetsQuota ? '#d1fae5' : '#fee2e2',
                                                                                                        borderRadius: '4px',
                                                                                                        fontWeight: 500
                                                                                                    }}>
                                                                                                        {categoryQuotaValue} / {requiredQuotaValue}
                                                                                                    </span>
                                                                                                )}
                                                                                                {categoryQuotaValue > 0 && requiredQuotaValue === null && (
                                                                                                    <span style={{
                                                                                                        color: 'var(--text-secondary)',
                                                                                                        fontSize: '0.85rem',
                                                                                                        padding: '2px 8px',
                                                                                                        backgroundColor: 'var(--bg-surface-hover)',
                                                                                                        borderRadius: '4px'
                                                                                                    }}>
                                                                                                        Total: {categoryQuotaValue}
                                                                                                    </span>
                                                                                                )}
                                                                                                {/* Show selected items in summary */}
                                                                                                {selectedItemsForCategory.length > 0 && (
                                                                                                    <div style={{
                                                                                                        display: 'flex',
                                                                                                        alignItems: 'center',
                                                                                                        gap: '4px',
                                                                                                        flexWrap: 'wrap',
                                                                                                        fontSize: '0.85rem',
                                                                                                        color: 'var(--text-secondary)'
                                                                                                    }}>
                                                                                                        {selectedItemsForCategory.map(({ item, qty }, idx) => (
                                                                                                            <span
                                                                                                                key={item.id}
                                                                                                                style={{
                                                                                                                    padding: '2px 8px',
                                                                                                                    backgroundColor: 'var(--bg-surface-hover)',
                                                                                                                    borderRadius: '4px',
                                                                                                                    fontSize: '0.8rem'
                                                                                                                }}
                                                                                                            >
                                                                                                                {item.name} {qty > 1 && `(${qty})`}
                                                                                                            </span>
                                                                                                        ))}
                                                                                                    </div>
                                                                                                )}
                                                                                                {selectedItemsForCategory.length === 0 && (
                                                                                                    <span style={{
                                                                                                        fontSize: '0.8rem',
                                                                                                        color: 'var(--text-tertiary)',
                                                                                                        fontStyle: 'italic'
                                                                                                    }}>
                                                                                                        No items selected
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                            <div style={{
                                                                                                transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)',
                                                                                                transition: 'transform 0.2s ease',
                                                                                                marginLeft: '8px'
                                                                                            }}>
                                                                                                <ChevronRight size={20} />
                                                                                            </div>
                                                                                        </div>

                                                                                        {/* Shelf Content - Only visible when open */}
                                                                                        {isOpen && (
                                                                                            <div style={{
                                                                                                padding: '16px',
                                                                                                backgroundColor: 'var(--bg-surface)',
                                                                                                animation: 'fadeIn 0.2s ease'
                                                                                            }}>
                                                                                                {requiredQuotaValue !== null && !meetsQuota && (
                                                                                                    <div style={{
                                                                                                        marginBottom: '1rem',
                                                                                                        padding: '0.75rem',
                                                                                                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                                                                        borderRadius: '6px',
                                                                                                        fontSize: '0.85rem',
                                                                                                        color: 'var(--color-danger)',
                                                                                                        display: 'flex',
                                                                                                        alignItems: 'center',
                                                                                                        gap: '0.5rem',
                                                                                                        border: '1px solid var(--color-danger)'
                                                                                                    }}>
                                                                                                        <AlertTriangle size={16} />
                                                                                                        <span>You must have a total of {requiredQuotaValue} {category.name} points</span>
                                                                                                    </div>
                                                                                                )}

                                                                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                                                                                                    {availableItems.map(item => {
                                                                                                        const qty = Number(selectedItems[item.id] || 0);
                                                                                                        const note = box.itemNotes?.[item.id] || '';
                                                                                                        const isSelected = qty > 0;

                                                                                                        return (
                                                                                                            <div key={item.id} style={{
                                                                                                                border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-color)',
                                                                                                                backgroundColor: isSelected ? 'rgba(var(--color-primary-rgb), 0.05)' : 'var(--bg-app)',
                                                                                                                borderRadius: '8px',
                                                                                                                padding: '12px',
                                                                                                                display: 'flex',
                                                                                                                flexDirection: 'column',
                                                                                                                gap: '10px',
                                                                                                                transition: 'all 0.2s ease',
                                                                                                                boxShadow: isSelected ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                                                                                                            }}>
                                                                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                                                                                                                    <div style={{ flex: 1 }}>
                                                                                                                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isSelected ? 'var(--color-primary)' : 'var(--text-primary)' }}>
                                                                                                                            {item.name}
                                                                                                                        </div>
                                                                                                                        {(item.quotaValue || 1) !== 1 && (
                                                                                                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                                                                                                Counts as {item.quotaValue} meals
                                                                                                                            </div>
                                                                                                                        )}
                                                                                                                    </div>
                                                                                                                    <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-surface)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                                                                                                        <button
                                                                                                                            onClick={() => handleBoxItemUpdate(index, item.id, Math.max(0, qty - 1), note)}
                                                                                                                            className="btn btn-ghost btn-sm"
                                                                                                                            style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                                                                            disabled={qty === 0}
                                                                                                                        >
                                                                                                                            -
                                                                                                                        </button>
                                                                                                                        <span style={{ width: '24px', textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>{qty}</span>
                                                                                                                        <button
                                                                                                                            onClick={() => handleBoxItemUpdate(index, item.id, qty + 1, note)}
                                                                                                                            className="btn btn-ghost btn-sm"
                                                                                                                            style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                                                                        >
                                                                                                                            +
                                                                                                                        </button>
                                                                                                                    </div>
                                                                                                                </div>

                                                                                                                {isSelected && (
                                                                                                                    <div style={{ marginTop: '0px' }}>
                                                                                                                        <TextareaAutosize
                                                                                                                            minRows={1}
                                                                                                                            placeholder="Add notes for this item..."
                                                                                                                            value={note}
                                                                                                                            onChange={(e) => handleBoxItemUpdate(index, item.id, qty, e.target.value)}
                                                                                                                            style={{
                                                                                                                                width: '100%',
                                                                                                                                fontSize: '0.85rem',
                                                                                                                                padding: '6px 8px',
                                                                                                                                borderRadius: '6px',
                                                                                                                                border: '1px solid rgba(0,0,0,0.1)',
                                                                                                                                backgroundColor: 'rgba(255,255,255,0.5)',
                                                                                                                                resize: 'none'
                                                                                                                            }}
                                                                                                                        />
                                                                                                                    </div>
                                                                                                                )}
                                                                                                            </div>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
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

                                                                                const selectedItems = box.items || {};

                                                                                return (
                                                                                    <div style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px' }}>
                                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                                                                            <span style={{ fontWeight: 600 }}>Uncategorized</span>
                                                                                        </div>

                                                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                                                                                            {uncategorizedItems.map(item => {
                                                                                                const qty = Number(selectedItems[item.id] || 0);
                                                                                                const note = box.itemNotes?.[item.id] || '';
                                                                                                const isSelected = qty > 0;

                                                                                                return (
                                                                                                    <div key={item.id} style={{
                                                                                                        border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-color)',
                                                                                                        backgroundColor: isSelected ? 'rgba(var(--color-primary-rgb), 0.05)' : 'var(--bg-app)',
                                                                                                        borderRadius: '8px',
                                                                                                        padding: '12px',
                                                                                                        display: 'flex',
                                                                                                        flexDirection: 'column',
                                                                                                        gap: '10px',
                                                                                                        transition: 'all 0.2s ease',
                                                                                                        boxShadow: isSelected ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                                                                                                    }}>
                                                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                                                                                                            <div style={{ flex: 1 }}>
                                                                                                                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isSelected ? 'var(--color-primary)' : 'var(--text-primary)' }}>
                                                                                                                    {item.name}
                                                                                                                </div>
                                                                                                                {(item.quotaValue || 1) !== 1 && (
                                                                                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                                                                                        Counts as {item.quotaValue} meals
                                                                                                                    </div>
                                                                                                                )}
                                                                                                            </div>
                                                                                                            <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-surface)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                                                                                                <button
                                                                                                                    onClick={() => handleBoxItemUpdate(index, item.id, Math.max(0, qty - 1), note)}
                                                                                                                    className="btn btn-ghost btn-sm"
                                                                                                                    style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                                                                    disabled={qty === 0}
                                                                                                                >
                                                                                                                    -
                                                                                                                </button>
                                                                                                                <span style={{ width: '24px', textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>{qty}</span>
                                                                                                                <button
                                                                                                                    onClick={() => handleBoxItemUpdate(index, item.id, qty + 1, note)}
                                                                                                                    className="btn btn-ghost btn-sm"
                                                                                                                    style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                                                                >
                                                                                                                    +
                                                                                                                </button>
                                                                                                            </div>
                                                                                                        </div>

                                                                                                        {isSelected && (
                                                                                                            <div style={{ marginTop: '0px' }}>
                                                                                                                <TextareaAutosize
                                                                                                                    minRows={1}
                                                                                                                    placeholder="Add notes for this item..."
                                                                                                                    value={note}
                                                                                                                    onChange={(e) => handleBoxItemUpdate(index, item.id, qty, e.target.value)}
                                                                                                                    style={{
                                                                                                                        width: '100%',
                                                                                                                        fontSize: '0.85rem',
                                                                                                                        padding: '6px 8px',
                                                                                                                        borderRadius: '6px',
                                                                                                                        border: '1px solid rgba(0,0,0,0.1)',
                                                                                                                        backgroundColor: 'rgba(255,255,255,0.5)',
                                                                                                                        resize: 'none'
                                                                                                                    }}
                                                                                                                />
                                                                                                            </div>
                                                                                                        )}
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
                                                        {(!(formData.approvedMealsPerWeek ?? 0) || currentBoxes.length < (formData.approvedMealsPerWeek ?? 0)) && (
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
                                            })()
                                        }

                                        {/* Equipment Order Section - Always visible */}
                                        <div className={styles.divider} style={{ marginTop: '2rem', marginBottom: '1rem' }} />
                                        <div style={{ marginTop: '1rem' }}>
                                            <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <Wrench size={14} /> Equipment Order
                                            </h4>
                                            {!showEquipmentOrder ? (
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={async () => {
                                                        setShowEquipmentOrder(true);
                                                        try {
                                                            // Bypass cache and fetch directly
                                                            const freshEquipment = await getEquipment();
                                                            if (freshEquipment && freshEquipment.length > 0) {
                                                                setEquipment(freshEquipment);
                                                            }
                                                        } catch (err) {
                                                            // Silent fail desirable here? or just standard error log? Keeping minimal as per 'remove debug' request
                                                            console.error('Error fetching equipment:', err);
                                                        }
                                                    }}
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
                                                                equipmentId: '', // Reset equipment selection when vendor changes
                                                                caseId: orderConfig.caseId || '' // Initialize with current caseId but allow override
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
                                                                    ...equipmentOrder!,
                                                                    equipmentId: e.target.value
                                                                })}
                                                            >
                                                                <option value="">Select Equipment Item...</option>
                                                                {equipment
                                                                    .map(eq => (
                                                                        <option key={eq.id} value={eq.id}>
                                                                            {eq.name} - ${eq.price.toFixed(2)}
                                                                        </option>
                                                                    ))}
                                                            </select>
                                                        </div>
                                                    )}

                                                    {equipmentOrder?.equipmentId && (
                                                        <div className={styles.formGroup}>
                                                            <label className="label">Case ID (Equipment Only)</label>
                                                            <input
                                                                type="text"
                                                                className="input"
                                                                value={equipmentOrder?.caseId ?? ''}
                                                                onChange={e => setEquipmentOrder(equipmentOrder ? {
                                                                    ...equipmentOrder,
                                                                    caseId: e.target.value
                                                                } : null)}
                                                                placeholder="Enter Case ID for this order"
                                                            />
                                                            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                                                                This Case ID will be used for this specific equipment order only.
                                                            </p>
                                                        </div>
                                                    )}

                                                    {equipmentOrder?.equipmentId && (
                                                        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                                                            <button
                                                                className="btn btn-primary"
                                                                onClick={async () => {
                                                                    if (!equipmentOrder?.vendorId || !equipmentOrder?.equipmentId) {
                                                                        alert('Please select both vendor and equipment item');
                                                                        return;
                                                                    }
                                                                    if (isNewClient) {
                                                                        alert('Please save the client first before creating an equipment order.');
                                                                        return;
                                                                    }
                                                                    try {
                                                                        setSubmittingEquipmentOrder(true);
                                                                        await saveEquipmentOrder(
                                                                            clientId,
                                                                            equipmentOrder!.vendorId,
                                                                            equipmentOrder!.equipmentId,
                                                                            equipmentOrder!.caseId ?? ''
                                                                        );
                                                                        setMessage('Equipment order submitted successfully!');
                                                                        setTimeout(() => setMessage(null), 3000);
                                                                        setShowEquipmentOrder(false);
                                                                        setEquipmentOrder(null);
                                                                        // Reload data to show the new order in Recent Orders section
                                                                        setLoadingRecentOrders(true);
                                                                        const [activeOrderData, orderHistoryData] = await Promise.all([
                                                                            getActiveOrderForClient(clientId),
                                                                            getOrderHistory(clientId)
                                                                        ]);
                                                                        setActiveOrder(activeOrderData);
                                                                        setOrderHistory(orderHistoryData || []);
                                                                        setLoadingRecentOrders(false);
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
                                )
                                }
                            </section>
                            )}

                            {/* Authorization & limits — follows Client type (Food/Boxes); saves to clients.approved_meals_per_week; same structure as Upcoming orders card */}
                            {(currentUser?.role === 'admin' || currentUser?.role === 'super_admin') && (() => {
                                const authType = newColumnOrderConfig?.serviceType ?? formData.serviceType ?? 'Food';
                                const isBoxes = authType === 'Boxes';
                                const isFoodOrMeal = authType === 'Food' || authType === 'Meal';
                                if (!isBoxes && !isFoodOrMeal) return null;
                                return (
                                    <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                                        <h3 className={styles.sectionTitle}>Authorization & limits</h3>
                                        <div className={styles.formGroup}>
                                            <label className="label">{isBoxes ? 'Max Boxes' : 'Max Meals'}</label>
                                            <input
                                                type="number"
                                                className="input"
                                                value={formData.approvedMealsPerWeek ?? ''}
                                                onChange={e => setFormData({ ...formData, approvedMealsPerWeek: e.target.value ? parseInt(e.target.value) : undefined })}
                                                min={isBoxes ? 1 : MIN_APPROVED_MEALS_PER_WEEK}
                                                max={isBoxes ? undefined : MAX_APPROVED_MEALS_PER_WEEK}
                                                placeholder={isBoxes ? '1' : '21'}
                                                disabled={saving}
                                            />
                                        </div>
                                    </section>
                                );
                            })()}

                            {/* Upcoming orders configuration — verbatim copy of Current Order UI; saves to clients.upcoming_order only */}
                            {(() => {
                                const nc = newColumnOrderConfig;
                                const setNc = setNewColumnOrderConfig;
                                const svcType = nc.serviceType ?? formData.serviceType ?? 'Food';
                                const currentBoxes = nc.boxOrders || [];
                                return (
                                    <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                            <h3 className={styles.sectionTitle}>Upcoming orders configuration</h3>
                                        </div>
                                        <div className={styles.formGroup}>
                                            <label className="label">Client type</label>
                                            <div className={styles.serviceTypes}>
                                                {(['Food', 'Boxes', 'Custom'] as const).map(type => (
                                                    <button
                                                        key={type}
                                                        type="button"
                                                        className={`${styles.serviceBtn} ${svcType === type ? styles.activeService : ''}`}
                                                        onClick={() => setNc({ ...nc, serviceType: type })}
                                                        disabled={savingNewColumn}
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
                                                value={nc.caseId || ''}
                                                placeholder="Enter Case ID to enable configuration..."
                                                onChange={e => setNc({ ...nc, caseId: e.target.value })}
                                                disabled={savingNewColumn}
                                            />
                                        </div>
                                        {!nc.caseId && (
                                            <div className={styles.alert} style={{ marginTop: '16px', backgroundColor: 'var(--bg-surface-hover)' }}>
                                                <AlertTriangle size={16} />
                                                Please enter a Case ID to configure the service.
                                            </div>
                                        )}
                                        {nc.caseId && (
                                            <>
                                                {(svcType === 'Food' || svcType === 'Meal') && (
                                                    <div className="animate-fade-in" style={{ marginTop: '1rem' }}>
                                                        <FoodServiceWidget
                                                            orderConfig={nc}
                                                            setOrderConfig={setNc}
                                                            client={{ ...client, ...formData, serviceType: svcType } as ClientProfile}
                                                            vendors={vendors}
                                                            menuItems={menuItems}
                                                            mealCategories={mealCategories}
                                                            mealItems={mealItems}
                                                            settings={settings}
                                                        />
                                                        <div style={{ marginTop: '1rem' }}>
                                                            <label className={styles.label}>Order Notes</label>
                                                            <textarea
                                                                className="input"
                                                                placeholder="Add general notes for this order..."
                                                                value={nc.notes || ''}
                                                                onChange={(e) => setNc({ ...nc, notes: e.target.value })}
                                                                rows={2}
                                                                style={{ resize: 'vertical', minHeight: '3rem' }}
                                                                disabled={savingNewColumn}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                                {svcType === 'Custom' && (
                                                    <div className={styles.section} style={{ marginTop: '24px' }}>
                                                        <h3 className={styles.sectionTitle}>Custom Order Configuration</h3>
                                                        <div className={styles.card} style={{ backgroundColor: '#f9fafb' }}>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                <div className="col-span-2">
                                                                    <label className={styles.label}>Item Description <span className="text-red-500">*</span></label>
                                                                    <textarea
                                                                        className="input"
                                                                        placeholder="e.g. Weekly Catering Platter"
                                                                        value={nc.custom_name || ''}
                                                                        rows={1}
                                                                        style={{ resize: 'none', overflow: 'hidden', minHeight: '3rem' }}
                                                                        onInput={(e) => {
                                                                            const target = e.target as HTMLTextAreaElement;
                                                                            target.style.height = 'auto';
                                                                            target.style.height = target.scrollHeight + 'px';
                                                                        }}
                                                                        onChange={e => { setNc({ ...nc, custom_name: e.target.value }); (e.target as HTMLTextAreaElement).style.height = 'auto'; (e.target as HTMLTextAreaElement).style.height = (e.target as HTMLTextAreaElement).scrollHeight + 'px'; }}
                                                                        disabled={savingNewColumn}
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <label className={styles.label}>Price per Order <span className="text-red-500">*</span></label>
                                                                    <div className="relative">
                                                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                                                                        <input
                                                                            type="number"
                                                                            className="input pl-8"
                                                                            placeholder="0.00"
                                                                            value={nc.custom_price || ''}
                                                                            onChange={e => setNc({ ...nc, custom_price: e.target.value })}
                                                                            disabled={savingNewColumn}
                                                                        />
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    <label className={styles.label}>Vendor <span className="text-red-500">*</span></label>
                                                                    <select
                                                                        className="input"
                                                                        value={nc.vendorId || ''}
                                                                        onChange={e => {
                                                                            const newVendorId = e.target.value;
                                                                            let newDeliveryDay = nc.deliveryDay;
                                                                            if (newVendorId && newDeliveryDay) {
                                                                                const selectedVendor = vendors.find(v => v.id === newVendorId);
                                                                                if (selectedVendor?.deliveryDays?.length && !selectedVendor.deliveryDays.includes(newDeliveryDay)) newDeliveryDay = '';
                                                                            }
                                                                            setNc({ ...nc, vendorId: newVendorId, deliveryDay: newDeliveryDay });
                                                                        }}
                                                                        disabled={savingNewColumn}
                                                                    >
                                                                        <option value="">Select Vendor</option>
                                                                        {vendors.filter(v => v.isActive).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                                                    </select>
                                                                </div>
                                                                <div>
                                                                    <label className={styles.label}>Delivery Day <span className="text-red-500">*</span></label>
                                                                    <select className="input" value={nc.deliveryDay || ''} onChange={e => setNc({ ...nc, deliveryDay: e.target.value })} disabled={savingNewColumn}>
                                                                        <option value="">Select Day</option>
                                                                        {((() => {
                                                                            let days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
                                                                            if (nc.vendorId) {
                                                                                const v = vendors.find(x => x.id === nc.vendorId);
                                                                                if (v?.deliveryDays?.length) days = v.deliveryDays;
                                                                            }
                                                                            return days;
                                                                        })()).map(day => <option key={day} value={day}>{day}</option>)}
                                                                    </select>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                {svcType === 'Boxes' && (
                                                    <div className="animate-fade-in">
                                                        {currentBoxes.map((box: any, index: number) => (
                                                            <div key={index} style={{ marginBottom: '2rem', padding: '1.5rem', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', position: 'relative' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                                                                    <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Package size={16} /> Box #{index + 1}</h4>
                                                                    {currentBoxes.length > 1 && (
                                                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleNewColumnRemoveBox(index)} style={{ color: 'var(--color-danger)', fontSize: '0.8rem', padding: '4px 8px' }}><Trash2 size={14} style={{ marginRight: '4px' }} /> Remove</button>
                                                                    )}
                                                                </div>
                                                                <div className={styles.formGroup}>
                                                                    <label className="label">Vendor</label>
                                                                    <select className="input" value={box.vendorId || ''} onChange={e => handleNewColumnBoxUpdate(index, 'vendorId', e.target.value)} disabled={savingNewColumn}>
                                                                        <option value="">Select Vendor...</option>
                                                                        {vendors.filter(v => v.serviceTypes.includes('Boxes') && v.isActive).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                                                    </select>
                                                                </div>
                                                                {box.vendorId && settings && (() => {
                                                                    const nextDate = getNextDeliveryDateForVendor(box.vendorId);
                                                                    if (nextDate) {
                                                                        return (
                                                                            <div style={{ marginTop: 'var(--spacing-md)', padding: '0.75rem', backgroundColor: 'var(--bg-surface-hover)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                                                                                Changes may not take effect till next week
                                                                            </div>
                                                                        );
                                                                    }
                                                                    return (
                                                                        <div style={{ marginTop: 'var(--spacing-md)', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-danger)', fontSize: '0.85rem', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'center', justifyContent: 'center' }}>
                                                                            <AlertTriangle size={16} /><span><strong>Warning:</strong> This vendor has no delivery days configured. Orders will NOT be created.</span>
                                                                        </div>
                                                                    );
                                                                })()}
                                                                <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                                                    {box.vendorId && !getNextDeliveryDateForVendor(box.vendorId) ? (
                                                                        <div style={{ padding: '1.5rem', backgroundColor: 'var(--bg-surface-active)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-danger)', color: 'var(--text-secondary)', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', opacity: 0.7 }}>
                                                                            <AlertTriangle size={24} color="var(--color-danger)" /><span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>Action Required</span>
                                                                            <span style={{ fontSize: '0.9rem' }}>Please configure <strong>Delivery Days</strong> for this vendor in Settings before adding items.</span>
                                                                        </div>
                                                                    ) : (
                                                                        <>
                                                                            {categories.map(category => {
                                                                                const availableItems = menuItems.filter(i => (i.vendorId === null || i.vendorId === '') && i.isActive && i.categoryId === category.id);
                                                                                if (availableItems.length === 0) return null;
                                                                                const selectedItems = box.items || {};
                                                                                let categoryQuotaValue = 0;
                                                                                Object.entries(selectedItems).forEach(([itemId, qty]) => {
                                                                                    const item = menuItems.find(i => i.id === itemId);
                                                                                    if (item && item.categoryId === category.id) categoryQuotaValue += (qty as number) * (item.quotaValue || 1);
                                                                                });
                                                                                let requiredQuotaValue: number | null = null;
                                                                                if (category.setValue !== undefined && category.setValue !== null) requiredQuotaValue = category.setValue;
                                                                                else if (box.boxTypeId) {
                                                                                    const quota = boxQuotas.find(q => q.boxTypeId === box.boxTypeId && q.categoryId === category.id);
                                                                                    if (quota) requiredQuotaValue = quota.targetValue;
                                                                                }
                                                                                const meetsQuota = requiredQuotaValue !== null ? isMeetingExactTarget(categoryQuotaValue, requiredQuotaValue) : true;
                                                                                const selectedItemsForCategory = availableItems.filter(item => Number(selectedItems[item.id] || 0) > 0).map(item => ({ item, qty: Number(selectedItems[item.id] || 0) }));
                                                                                const shelfId = getNewColumnCategoryShelfId(index, category.id);
                                                                                const isOpen = isNewColumnCategoryShelfOpen(index, category.id);
                                                                                return (
                                                                                    <div key={category.id} style={{ marginBottom: '1rem', background: 'var(--bg-surface)', borderRadius: '8px', border: requiredQuotaValue !== null && !meetsQuota ? '2px solid var(--color-danger)' : '1px solid var(--border-color)', overflow: 'hidden', transition: 'all 0.2s ease' }}>
                                                                                        <div onClick={() => toggleNewColumnCategoryShelf(index, category.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: isOpen ? 'var(--bg-surface-hover)' : 'var(--bg-surface)', cursor: 'pointer', borderBottom: isOpen ? '1px solid var(--border-color)' : 'none', transition: 'background-color 0.2s ease' }}>
                                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, flexWrap: 'wrap' }}>
                                                                                                <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>{category.name}</span>
                                                                                                {requiredQuotaValue !== null && <span style={{ color: meetsQuota ? 'var(--color-success)' : 'var(--color-danger)', fontSize: '0.85rem', padding: '2px 8px', backgroundColor: meetsQuota ? '#d1fae5' : '#fee2e2', borderRadius: '4px', fontWeight: 500 }}>{categoryQuotaValue} / {requiredQuotaValue}</span>}
                                                                                                {categoryQuotaValue > 0 && requiredQuotaValue === null && <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '2px 8px', backgroundColor: 'var(--bg-surface-hover)', borderRadius: '4px' }}>Total: {categoryQuotaValue}</span>}
                                                                                                {selectedItemsForCategory.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{selectedItemsForCategory.map(({ item, qty }) => <span key={item.id} style={{ padding: '2px 8px', backgroundColor: 'var(--bg-surface-hover)', borderRadius: '4px', fontSize: '0.8rem' }}>{item.name} {qty > 1 && `(${qty})`}</span>)}</div>}
                                                                                                {selectedItemsForCategory.length === 0 && <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No items selected</span>}
                                                                                            </div>
                                                                                            <div style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease', marginLeft: '8px' }}><ChevronRight size={20} /></div>
                                                                                        </div>
                                                                                        {isOpen && (
                                                                                            <div style={{ padding: '16px', backgroundColor: 'var(--bg-surface)', animation: 'fadeIn 0.2s ease' }}>
                                                                                                {requiredQuotaValue !== null && !meetsQuota && (
                                                                                                    <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', fontSize: '0.85rem', color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '0.5rem', border: '1px solid var(--color-danger)' }}>
                                                                                                        <AlertTriangle size={16} /><span>You must have a total of {requiredQuotaValue} {category.name} points</span>
                                                                                                    </div>
                                                                                                )}
                                                                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                                                                                                    {availableItems.map(item => {
                                                                                                        const qty = Number(selectedItems[item.id] || 0);
                                                                                                        const note = box.itemNotes?.[item.id] || '';
                                                                                                        const isSelected = qty > 0;
                                                                                                        return (
                                                                                                            <div key={item.id} style={{ border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-color)', backgroundColor: isSelected ? 'rgba(var(--color-primary-rgb), 0.05)' : 'var(--bg-app)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', transition: 'all 0.2s ease', boxShadow: isSelected ? '0 2px 4px rgba(0,0,0,0.05)' : 'none' }}>
                                                                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                                                                                                                    <div style={{ flex: 1 }}>
                                                                                                                        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isSelected ? 'var(--color-primary)' : 'var(--text-primary)' }}>{item.name}</div>
                                                                                                                        {(item.quotaValue || 1) !== 1 && <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>Counts as {item.quotaValue} meals</div>}
                                                                                                                    </div>
                                                                                                                    <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-surface)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                                                                                                        <button onClick={() => handleNewColumnBoxItemUpdate(index, item.id, Math.max(0, qty - 1), note)} className="btn btn-ghost btn-sm" style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} disabled={qty === 0}>-</button>
                                                                                                                        <span style={{ width: '24px', textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>{qty}</span>
                                                                                                                        <button onClick={() => handleNewColumnBoxItemUpdate(index, item.id, qty + 1, note)} className="btn btn-ghost btn-sm" style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                                {isSelected && (
                                                                                                                    <div style={{ marginTop: '0px' }}>
                                                                                                                        <TextareaAutosize minRows={1} placeholder="Add notes for this item..." value={note} onChange={(e) => handleNewColumnBoxItemUpdate(index, item.id, qty, e.target.value)} style={{ width: '100%', fontSize: '0.85rem', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.1)', backgroundColor: 'rgba(255,255,255,0.5)', resize: 'none' }} />
                                                                                                                    </div>
                                                                                                                )}
                                                                                                            </div>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                            {(() => {
                                                                                const uncategorizedItems = menuItems.filter(i => (i.vendorId === null || i.vendorId === '') && i.isActive && (!i.categoryId || i.categoryId === ''));
                                                                                if (uncategorizedItems.length === 0) return null;
                                                                                const selectedItems = box.items || {};
                                                                                return (
                                                                                    <div style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px' }}>
                                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}><span style={{ fontWeight: 600 }}>Uncategorized</span></div>
                                                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                                                                                            {uncategorizedItems.map(item => {
                                                                                                const qty = Number(selectedItems[item.id] || 0);
                                                                                                const note = box.itemNotes?.[item.id] || '';
                                                                                                const isSelected = qty > 0;
                                                                                                return (
                                                                                                    <div key={item.id} style={{ border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-color)', backgroundColor: isSelected ? 'rgba(var(--color-primary-rgb), 0.05)' : 'var(--bg-app)', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', transition: 'all 0.2s ease', boxShadow: isSelected ? '0 2px 4px rgba(0,0,0,0.05)' : 'none' }}>
                                                                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                                                                                                            <div style={{ flex: 1 }}><div style={{ fontWeight: 600, fontSize: '0.9rem', color: isSelected ? 'var(--color-primary)' : 'var(--text-primary)' }}>{item.name}</div>{(item.quotaValue || 1) !== 1 && <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>Counts as {item.quotaValue} meals</div>}</div>
                                                                                                            <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-surface)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                                                                                                <button onClick={() => handleNewColumnBoxItemUpdate(index, item.id, Math.max(0, qty - 1), note)} className="btn btn-ghost btn-sm" style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }} disabled={qty === 0}>-</button>
                                                                                                                <span style={{ width: '24px', textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>{qty}</span>
                                                                                                                <button onClick={() => handleNewColumnBoxItemUpdate(index, item.id, qty + 1, note)} className="btn btn-ghost btn-sm" style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                                                                                                            </div>
                                                                                                        </div>
                                                                                                        {isSelected && <div style={{ marginTop: '0px' }}><TextareaAutosize minRows={1} placeholder="Add notes for this item..." value={note} onChange={(e) => handleNewColumnBoxItemUpdate(index, item.id, qty, e.target.value)} style={{ width: '100%', fontSize: '0.85rem', padding: '6px 8px', borderRadius: '6px', border: '1px solid rgba(0,0,0,0.1)', backgroundColor: 'rgba(255,255,255,0.5)', resize: 'none' }} /></div>}
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
                                                        {(!(formData.approvedMealsPerWeek ?? 0) || currentBoxes.length < (formData.approvedMealsPerWeek ?? 0)) && (
                                                            <button type="button" className="btn btn-outline" style={{ width: '100%', borderStyle: 'dashed', padding: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }} onClick={handleNewColumnAddBox} disabled={savingNewColumn}>
                                                                <Plus size={16} /> Add Another Box
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                                <div className={styles.divider} style={{ marginTop: '2rem', marginBottom: '1rem' }} />
                                                <div style={{ marginTop: '1rem' }}>
                                                    <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Wrench size={14} /> Equipment Order</h4>
                                                    {!showEquipmentOrder ? (
                                                        <button className="btn btn-secondary" onClick={async () => { setShowEquipmentOrder(true); try { const freshEquipment = await getEquipment(); if (freshEquipment?.length) setEquipment(freshEquipment); } catch (err) { console.error('Error fetching equipment:', err); } }} style={{ width: '100%' }}>Equipment Order</button>
                                                    ) : (
                                                        <div style={{ padding: '1rem', backgroundColor: 'var(--bg-surface-hover)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                                                            <div className={styles.formGroup}>
                                                                <label className="label">Vendor</label>
                                                                <select className="input" value={equipmentOrder?.vendorId || ''} onChange={e => setEquipmentOrder({ ...equipmentOrder, vendorId: e.target.value, equipmentId: '', caseId: orderConfig.caseId || '' })}>
                                                                    <option value="">Select Vendor...</option>
                                                                    {vendors.filter(v => v.serviceTypes?.includes('Equipment') && v.isActive).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                                                                </select>
                                                            </div>
                                                            {equipmentOrder?.vendorId && (
                                                                <div className={styles.formGroup}>
                                                                    <label className="label">Equipment Item</label>
                                                                    <select className="input" value={equipmentOrder?.equipmentId || ''} onChange={e => setEquipmentOrder({ ...equipmentOrder!, equipmentId: e.target.value })}>
                                                                        <option value="">Select Equipment Item...</option>
                                                                        {equipment.map(eq => <option key={eq.id} value={eq.id}>{eq.name} - ${eq.price.toFixed(2)}</option>)}
                                                                    </select>
                                                                </div>
                                                            )}
                                                            {equipmentOrder?.equipmentId && (
                                                                <>
                                                                    <div className={styles.formGroup}>
                                                                        <label className="label">Case ID (Equipment Only)</label>
                                                                        <input type="text" className="input" value={equipmentOrder.caseId} onChange={e => setEquipmentOrder({ ...equipmentOrder, caseId: e.target.value })} placeholder="Enter Case ID for this order" />
                                                                    </div>
                                                                    <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                                                                        <button className="btn btn-primary" onClick={async () => {
                                                                            if (!equipmentOrder.vendorId || !equipmentOrder.equipmentId) { alert('Please select both vendor and equipment item'); return; }
                                                                            if (isNewClient) { alert('Please save the client first before creating an equipment order.'); return; }
                                                                            try {
                                                                                setSubmittingEquipmentOrder(true);
                                                                                await saveEquipmentOrder(clientId, equipmentOrder.vendorId, equipmentOrder.equipmentId, equipmentOrder.caseId);
                                                                                setMessage('Equipment order submitted successfully!');
                                                                                setTimeout(() => setMessage(null), 3000);
                                                                                setShowEquipmentOrder(false);
                                                                                setEquipmentOrder(null);
                                                                                setLoadingRecentOrders(true);
                                                                                const [activeOrderData, orderHistoryData] = await Promise.all([getActiveOrderForClient(clientId), getOrderHistory(clientId)]);
                                                                                setActiveOrder(activeOrderData);
                                                                                setOrderHistory(orderHistoryData || []);
                                                                                setLoadingRecentOrders(false);
                                                                            } catch (error: any) { alert(`Error submitting equipment order: ${error.message || 'Unknown error'}`); }
                                                                            finally { setSubmittingEquipmentOrder(false); }
                                                                        }} disabled={submittingEquipmentOrder}>{submittingEquipmentOrder ? 'Submitting...' : 'Submit Equipment Order'}</button>
                                                                        <button className="btn btn-secondary" onClick={() => { setShowEquipmentOrder(false); setEquipmentOrder(null); }}>Cancel</button>
                                                                    </div>
                                                                </>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                {/* Save to new column removed: main Save button performs this action */}
                                            </>
                                        )}
                                    </section>
                                );
                            })()}

                            {/* Recent Orders Panel - Collapsible Shelf */}
                            <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                                <button
                                    type="button"
                                    onClick={() => setRecentOrdersExpanded(!recentOrdersExpanded)}
                                    style={{
                                        width: '100%',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '0.75rem 1rem',
                                        backgroundColor: 'var(--bg-surface-hover)',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem',
                                        fontWeight: 600,
                                        marginBottom: recentOrdersExpanded ? 'var(--spacing-md)' : 0,
                                        transition: 'all 0.2s ease'
                                    }}
                                    onMouseOver={(e) => {
                                        e.currentTarget.style.backgroundColor = 'var(--bg-surface-active)';
                                    }}
                                    onMouseOut={(e) => {
                                        e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                    }}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Calendar size={18} />
                                        Recent Orders ({activeOrder ? (activeOrder.multiple === true && Array.isArray(activeOrder.orders) ? activeOrder.orders.length : 1) : 0})
                                    </span>
                                    {recentOrdersExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>
                                {recentOrdersExpanded && (
                                    <div>
                                        {loadingRecentOrders ? (
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
                                                                                {order.id ? (
                                                                                    <Link href={`/orders/${order.id}`} style={{ color: 'var(--color-primary)', textDecoration: 'none', cursor: 'pointer' }}>
                                                                                        {order.orderNumber ? `Order #${order.orderNumber}` : `Order ${orderIdx + 1}`}
                                                                                    </Link>
                                                                                ) : (
                                                                                    <span>{order.orderNumber ? `Order #${order.orderNumber}` : `Order ${orderIdx + 1}`}</span>
                                                                                )}
                                                                                {isMultiple && !order.orderNumber && ` of ${ordersToDisplay.length}`}
                                                                                {order.scheduledDeliveryDate && (
                                                                                    <span style={{ marginLeft: 'var(--spacing-sm)', fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                                                                                        • Scheduled: {new Date(order.scheduledDeliveryDate).toLocaleDateString('en-US', { timeZone: 'UTC' })}
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
                                                                            {isBoxes && (order.boxTypeId || (order.boxOrders && order.boxOrders.length > 0)) && (
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                                                    {(() => {
                                                                                        const boxesToDisplay = (order.boxOrders && order.boxOrders.length > 0)
                                                                                            ? order.boxOrders
                                                                                            : [{
                                                                                                boxTypeId: order.boxTypeId,
                                                                                                vendorId: order.vendorId,
                                                                                                quantity: order.boxQuantity,
                                                                                                items: order.items
                                                                                            }];

                                                                                        return boxesToDisplay.map((boxData: any, bIdx: number) => {
                                                                                            const box = boxTypes.find(b => b.id === boxData.boxTypeId);
                                                                                            const boxVendorId = boxData.vendorId || box?.vendorId || null;
                                                                                            const vendor = boxVendorId ? vendors.find(v => v.id === boxVendorId) : null;
                                                                                            const vendorName = vendor?.name || 'Unassigned';
                                                                                            const boxName = box?.name || 'Unknown Box';
                                                                                            const items = boxData.items || {};

                                                                                            return (
                                                                                                <div key={bIdx} style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                                                    {/* Vendor */}
                                                                                                    <div style={{ marginBottom: 'var(--spacing-xs)', fontSize: '0.8rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.025em', fontWeight: 600 }}>
                                                                                                        {vendorName}
                                                                                                    </div>
                                                                                                    {/* Box Type and Quantity */}
                                                                                                    <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                                                                                                        {boxName} × {boxData.quantity || 1}
                                                                                                    </div>
                                                                                                    {/* Items List */}
                                                                                                    {Object.keys(items).length > 0 ? (
                                                                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                                                                            {Object.entries(items).map(([itemId, qty]: [string, any]) => {
                                                                                                                const item = menuItems.find(i => i.id === itemId);
                                                                                                                return item ? (
                                                                                                                    <div key={itemId} style={{ marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                                                                                                        <span>{item.name}</span>
                                                                                                                        <span style={{ color: 'var(--text-secondary)' }}>× {qty}</span>
                                                                                                                    </div>
                                                                                                                ) : null;
                                                                                                            })}
                                                                                                        </div>
                                                                                                    ) : (
                                                                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                                                                                            No items selected
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>
                                                                                            );
                                                                                        });
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
                                    </div>
                                )}
                            </section>

                            {/* Order History Section - Using the new renderOrderHistorySection */}
                            {renderOrderHistorySection()}
                        </div>
                    </div >
                )
                }
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
            </div >
        )
    }

    const content = getContent();

    return (
        <>
            {onClose ? (
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
            ) : (
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
            <DuplicateNameConfirmationModal
                isOpen={showDuplicateNameModal}
                onClose={() => {
                    setShowDuplicateNameModal(false);
                    setPendingClientData(null);
                }}
                onConfirm={handleConfirmDuplicateName}
                clientName={pendingClientData?.fullName || formData.fullName || ''}
                creating={saving}
            />
            <EmptyOrderConfirmModal
                isOpen={showEmptyOrderConfirmModal}
                onClose={() => {
                    setShowEmptyOrderConfirmModal(false);
                    pendingEmptyOrderSaveRef.current = null;
                }}
                onConfirm={handleConfirmEmptyOrderSave}
                saving={saving}
            />
        </>
    );

    /** Check if both current order config and upcoming order config are empty. If upcoming has content, we consider order not empty (main save now saves upcoming order). */
    function isOrderCompletelyEmpty(): boolean {
        const nc = newColumnOrderConfig;
        const st = (nc?.serviceType || formData.serviceType) as string;
        const config = nc ?? orderConfig;
        if (st === 'Food') {
            const hasDeliveryDays = config?.deliveryDayOrders && Object.keys(config.deliveryDayOrders).length > 0;
            const hasItemsInDeliveryDays = hasDeliveryDays && Object.values(config.deliveryDayOrders).some((dayData: any) => {
                const selections = dayData?.vendorSelections || [];
                return selections.some((s: any) => s.vendorId && ((s.items && Object.keys(s.items).length > 0) || (s.itemsByDay && Object.keys(s.itemsByDay).length > 0)));
            });
            const hasVendorItems = config?.vendorSelections?.some((s: any) => s.vendorId && ((s.items && Object.keys(s.items).length > 0) || (s.itemsByDay && Object.keys(s.itemsByDay).length > 0)));
            return !hasItemsInDeliveryDays && !hasVendorItems;
        }
        if (st === 'Meal') {
            const hasMeals = config?.mealSelections && Object.keys(config.mealSelections).length > 0;
            return !hasMeals;
        }
        if (st === 'Boxes') {
            const boxes = config?.boxOrders || [];
            let hasItemsInBoxes = false;
            if (boxes.length > 0) {
                hasItemsInBoxes = boxes.some((b: any) => {
                    const items = b.items;
                    return items && typeof items === 'object' && Object.values(items).some((qty: any) => Number(qty) > 0);
                });
            }
            if (hasItemsInBoxes) return false;
            const rootItems = config?.items;
            const hasRootItems = rootItems && typeof rootItems === 'object' && Object.values(rootItems).some((qty: any) => Number(qty) > 0);
            return !hasRootItems;
        }
        if (st === 'Custom') {
            return !config?.custom_name?.trim() || (config.custom_price !== 0 && (config.custom_price == null || config.custom_price === '')) || !config.vendorId || !config.deliveryDay;
        }
        return false;
    }

    async function handleConfirmEmptyOrderSave() {
        const fn = pendingEmptyOrderSaveRef.current;
        if (fn) {
            pendingEmptyOrderSaveRef.current = null;
            setShowEmptyOrderConfirmModal(false);
            await fn();
        }
    }

    async function handleSave(): Promise<boolean> {
        if (!client && !isNewClient) {
            return false;
        }

        // Validate approvedMealsPerWeek min/max bounds
        // Allow 0/undefined (can be under min), but if > 0, must be within min/max bounds
        const approvedMeals = formData.approvedMealsPerWeek ?? 0;

        // If value is > 0, validate it's within bounds (0 is always allowed)
        if (approvedMeals > 0) {
            if (approvedMeals < MIN_APPROVED_MEALS_PER_WEEK) {
                setValidationError(`Approved meals per week (${approvedMeals}) must be at least ${MIN_APPROVED_MEALS_PER_WEEK}.`);

                return false;
            }
            if (approvedMeals > MAX_APPROVED_MEALS_PER_WEEK) {
                setValidationError(`Approved meals per week (${approvedMeals}) must be at most ${MAX_APPROVED_MEALS_PER_WEEK}.`);

                return false;
            }
        }

        // Validate order config before saving (validateOrder uses orderConfig; we save newColumnOrderConfig)
        if (orderConfig?.caseId) {
            const validation = await validateOrder();
            if (!validation.isValid) {
                setValidationError(validation.messages.join('\n'));
                return false;
            }
        }

        // Check for Status Change by Navigator
        // Only show units modal if the new status requires units on change
        // Skip this check for new clients
        if (!isNewClient && client) {


            if (currentUser?.role === 'navigator' && formData.statusId !== client.statusId) {
                const newStatus = statuses.find(s => s.id === formData.statusId);


                // Only show modal if the new status has requiresUnitsOnChange enabled
                if (newStatus?.requiresUnitsOnChange) {

                    try {
                        const oldStatusName = getStatusName(client.statusId);
                        const newStatusName = getStatusName(formData.statusId!);
                        setPendingStatusChange({ oldStatus: oldStatusName, newStatus: newStatusName });
                        setShowUnitsModal(true);
                        return false; // Intercepted
                    } catch (e) {
                        console.error('[handleSave] Error in status change logic:', e);
                    }
                } else {

                }
            }
        }

        // If order is completely empty, show confirmation modal before saving
        if (isOrderCompletelyEmpty()) {
            const performSave = async () => {
                const success = await executeSave(0);
                if (!success) {
                    throw new Error("Failed to save client data");
                }
            };
            pendingEmptyOrderSaveRef.current = async () => {
                if (onBackgroundSave && !isNewClient && client) {
                    onBackgroundSave(client.id, client.fullName, performSave);
                    if (onClose) onClose();
                } else {
                    await executeSave(0);
                }
            };
            setShowEmptyOrderConfirmModal(true);
            return false;
        }

        // Perform the save operation (encapsulated for background use)
        const performSave = async () => {
            const success = await executeSave(0);
            if (!success) {
                // If the background save fails, throw an error so the background handler knows
                throw new Error("Failed to save client data");
            }
        };

        if (onBackgroundSave && !isNewClient && client) {
            // Background Save Mode: Close immediately and run in background
            onBackgroundSave(client.id, client.fullName, performSave);
            if (onClose) onClose();
            return true; // Indicate effective "success" to caller
        } else {
            // Foreground / Blocking Mode (e.g. New Client, or no handler)
            return await executeSave(0);
        }
    }

    // Helper to prepare cleaned active order (extracted to be reusable)

    // Helper to prepare cleaned active order (extracted to be reusable)
    function prepareActiveOrder() {
        if (!orderConfig) return undefined;

        const cleanedOrderConfig = { ...orderConfig };

        // CRITICAL: Always preserve caseId at the top level for both Food and Boxes
        cleanedOrderConfig.caseId = orderConfig.caseId;

        // NEW: Convert mealSelections and generic vendorSelections to unified vendorSelections
        const vendorMap = new Map<string, any>();

        // 1. First, ingest explicit Generic/Lunch vendor selections
        if (orderConfig.vendorSelections && Array.isArray(orderConfig.vendorSelections)) {
            orderConfig.vendorSelections.forEach((vs: any) => {
                if (vs.vendorId) {
                    if (!vendorMap.has(vs.vendorId)) {
                        vendorMap.set(vs.vendorId, {
                            vendorId: vs.vendorId,
                            items: {},
                            selectedDeliveryDays: vs.selectedDeliveryDays || []
                        });
                    }
                    const vendorEntry = vendorMap.get(vs.vendorId);
                    // Merge items
                    if (vs.items) {
                        Object.entries(vs.items).forEach(([itemId, qty]) => {
                            const numericQty = Number(qty);
                            if (numericQty > 0) {
                                vendorEntry.items[itemId] = (vendorEntry.items[itemId] || 0) + numericQty;
                            }
                        });
                    }
                }
            });
        }

        // 2. Meal Selections are now handled separately by the backend sync logic.
        // We DO NOT merge them into vendorMap anymore to avoid duplicate orders.
        // We just ensure they are cleaned and preserved in step 3 below.

        // DISABLED: This old processing logic conflicts with the new itemsByDay format
        // The new logic starting at line ~3397 handles vendor selections properly
        /*
        if (vendorMap.size > 0) {
            // CRITICAL FIX: Redistribute the fresh unified vendorSelections into deliveryDayOrders.
            // This ensures day-specific logic (Regular Orders) is respected, and universal items (Meals) are applied to all days.
     
            const newDeliveryDayOrders: any = { };
                    const clientDeliveryDays = (formData as any).delivery_days || client?.delivery_days || [];
     
            vendorMap.forEach((selection: any) => {
                const daysToApply = (selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0)
                    ? selection.selectedDeliveryDays // Use specific days if set (Regular Vendor)
                    : clientDeliveryDays; // Use all client days if empty (Meals/Breakfast)
     
                daysToApply.forEach((day: string) => {
                    if (!newDeliveryDayOrders[day]) {
                        newDeliveryDayOrders[day] = { vendorSelections: [] };
                    }
                    // Check if this vendor is already added to this day (merge if needed, though vendorMap is unique by vendorId)
                    newDeliveryDayOrders[day].vendorSelections.push({
                        vendorId: selection.vendorId,
                    items: selection.items
                    });
                });
            });
     
            if (Object.keys(newDeliveryDayOrders).length > 0) {
                        cleanedOrderConfig.deliveryDayOrders = newDeliveryDayOrders;
                    // We don't send flat vendorSelections since we are sending day-specific orders
                    delete cleanedOrderConfig.vendorSelections;
            } else {
                        // Fallback if no days found (unlikely), send flat selections
                        cleanedOrderConfig.vendorSelections = Array.from(vendorMap.values());
            }
        }
                    */

        if (formData.serviceType === 'Food') {
            // PRIORITY 1: Check if we have per-vendor delivery days (itemsByDay format) - this is the new format


            // NEW LOGIC: If we have ANY vendorSelections array (even empty), we assume it's the source of truth
            // and we should regenerate deliveryDayOrders from it. This handles the case where all vendors are deleted.
            const hasVendorSelectionsArray = Array.isArray(cleanedOrderConfig.vendorSelections);

            const hasPerVendorDeliveryDays = hasVendorSelectionsArray && (
                cleanedOrderConfig.vendorSelections.length === 0 ||
                cleanedOrderConfig.vendorSelections.some((s: any) =>
                    s.selectedDeliveryDays && s.selectedDeliveryDays.length > 0 && s.itemsByDay
                )
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
                            const vendorSelection = {
                                vendorId: selection.vendorId,
                                items: dayItems,
                                itemNotes: selection.itemNotesByDay?.[day] || {}
                            };

                            deliveryDayOrders[day].vendorSelections.push(vendorSelection);
                        } else {

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
                } else {
                    // CRITICAL FIX: If no days having vendors, we must explicitly set deliveryDayOrders to empty object
                    // to overwrite any stale data from database.
                    cleanedOrderConfig.deliveryDayOrders = {};
                }

                // Remove the transient vendorSelections used for UI state
                cleanedOrderConfig.vendorSelections = undefined;
            } else if (cleanedOrderConfig.deliveryDayOrders) {
                // PRIORITY 2: Existing multi-day format (deliveryDayOrders) - clean and preserve

                for (const day of Object.keys(cleanedOrderConfig.deliveryDayOrders)) {
                    cleanedOrderConfig.deliveryDayOrders[day].vendorSelections = (cleanedOrderConfig.deliveryDayOrders[day].vendorSelections || [])
                        .filter((s: any) => s.vendorId)
                        .map((s: any) => ({
                            vendorId: s.vendorId,
                            items: s.items || {}
                        }));
                }
            } else if (cleanedOrderConfig.vendorSelections) {
                // PRIORITY 3: Single-day format - clean and preserve vendor selections

                cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                    .filter((s: any) => s.vendorId)
                    .map((s: any) => ({
                        vendorId: s.vendorId,
                        items: s.items || {},
                        itemNotes: s.itemNotes || {}
                    }));
            }

            // CRITICAL: Preserve mealSelections (Breakfast, Lunch, Dinner, etc.)
            if (orderConfig.mealSelections) {
                const cleanedMealSelections: any = {};
                for (const [mealType, selection] of Object.entries(orderConfig.mealSelections)) {
                    const items = (selection as any).items || {};
                    const hasItems = Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
                    if (hasItems) {
                        cleanedMealSelections[mealType] = {
                            vendorId: (selection as any).vendorId || null,
                            items: items,
                            itemNotes: (selection as any).itemNotes || {}
                        };
                    }
                }
                if (Object.keys(cleanedMealSelections).length > 0) {
                    cleanedOrderConfig.mealSelections = cleanedMealSelections;
                } else {
                    delete cleanedOrderConfig.mealSelections;
                }
            }
        } else if (formData.serviceType === 'Boxes') {
            console.log('[ClientProfile] prepareActiveOrder: Processing Boxes service');
            console.log('[ClientProfile] prepareActiveOrder: orderConfig.boxOrders:', orderConfig.boxOrders?.length || 0, 'boxes');

            if (orderConfig.vendorId !== undefined) {
                cleanedOrderConfig.vendorId = orderConfig.vendorId;
            }
            cleanedOrderConfig.caseId = orderConfig.caseId;
            if (orderConfig.boxTypeId !== undefined) {
                cleanedOrderConfig.boxTypeId = orderConfig.boxTypeId;
            }
            cleanedOrderConfig.boxQuantity = orderConfig.boxQuantity || 1;
            cleanedOrderConfig.items = orderConfig.items || {};
            cleanedOrderConfig.itemPrices = orderConfig.itemPrices || {};

            // Helper to clean box items and notes
            if (orderConfig.boxOrders && Array.isArray(orderConfig.boxOrders) && orderConfig.boxOrders.length > 0) {
                console.log('[ClientProfile] prepareActiveOrder: Processing', orderConfig.boxOrders.length, 'box orders');
                cleanedOrderConfig.boxOrders = orderConfig.boxOrders.map((box: any) => {
                    const cleanedItems: any = {};
                    const cleanedNotes: any = {};

                    if (box.items) {
                        Object.entries(box.items).forEach(([itemId, qty]) => {
                            if (Number(qty) > 0) {
                                cleanedItems[itemId] = Number(qty);
                                if (box.itemNotes && box.itemNotes[itemId]) {
                                    cleanedNotes[itemId] = box.itemNotes[itemId];
                                }
                            }
                        });
                    }

                    return {
                        ...box,
                        items: cleanedItems,
                        itemNotes: cleanedNotes
                    };
                });
                // CRITICAL: Ensure boxOrders is always set if it existed in orderConfig, even if empty after cleaning
                // This prevents the save from being skipped when boxOrders exists but gets filtered
                console.log('[ClientProfile] prepareActiveOrder: Processed boxOrders:', cleanedOrderConfig.boxOrders.length, 'boxes');
                console.log('[ClientProfile] prepareActiveOrder: Final boxOrders:', JSON.stringify(cleanedOrderConfig.boxOrders, null, 2));
            } else if (orderConfig.items && Object.keys(orderConfig.items).length > 0) {
                // Fallback: Convert root items to boxOrders array for legacy/single-box mode
                const cleanedItems: any = {};
                const cleanedNotes: any = {}; // Notes might be missing on root in this case, or logic is needed if stored elsewhere

                Object.entries(orderConfig.items).forEach(([itemId, qty]) => {
                    if (Number(qty) > 0) {
                        cleanedItems[itemId] = Number(qty);
                        // Accessing global itemNotes if they exist on orderConfig, or skip
                        // Assuming itemNotes are not on root for now, or would be orderConfig.itemNotes
                    }
                });

                if (Object.keys(cleanedItems).length > 0) {
                    cleanedOrderConfig.boxOrders = [{
                        vendorId: orderConfig.vendorId,
                        boxTypeId: orderConfig.boxTypeId,
                        quantity: orderConfig.boxQuantity || 1,
                        items: cleanedItems,
                        itemNotes: cleanedNotes // Empty for now unless we find where notes are stored in legacy
                    }];
                }
            }

        }

        return {
            ...cleanedOrderConfig,
            serviceType: formData.serviceType,
            lastUpdated: new Date().toISOString(),
            updatedBy: 'Admin'
        };

    }

    function generateOrderSnapshot(config: OrderConfiguration | undefined): string {
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
            // Check both consolidated (vendorSelections) and multi-day (deliveryDayOrders) formats
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
            primarySection = `Custom Order: ${(config as any).custom_name || 'Unnamed'}\n`;
            primarySection += `Price: $${(config as any).custom_price || 0}\n`;
            primarySection += `Vendor: ${getVendorName((config as any).vendorId)}`;
        }

        if (primarySection) {
            snapshot += primarySection + '\n';
        }

        // 2. MEAL SELECTIONS SECTION (CUMULATIVE)
        const meals = (config as any).mealSelections || {};
        const mealTypes = Object.keys(meals).sort();
        if (mealTypes.length > 0) {
            if (primarySection) snapshot += '--- Meals ---\n';
            snapshot += mealTypes.map(mType => {
                const m = meals[mType];
                const items = m?.items || {};
                const itemDetails = Object.keys(items)
                    .map(itemId => `  - ${items[itemId]}x ${getItemName(itemId, true)}`)
                    .join('\n');
                const vName = m?.vendorId ? getVendorName(m.vendorId) : 'No vendor';
                return `${mType} [${vName}]:\n${itemDetails || '  - No items'}`;
            }).join('\n');
        } else if (config.serviceType === 'Meal' && !primarySection) {
            snapshot += 'No meal selections configured';
        }

        return snapshot.trim();
    }


    async function executeSave(unitsAdded: number = 0): Promise<boolean> {
        if (!client && !isNewClient) return false;

        // Invalidate client-side caches for this specific client to ensure we fetch fresh data after save
        if (clientId) {
            invalidateClientData(clientId);
            invalidateOrderData(clientId);
        }

        setSaving(true);
        setMessage(null);

        try {
            if (isNewClient) {
                // STRATEGY: Create client first WITHOUT order details, then update it with order details
                // This avoids issues with saving order data during creation and uses the proven edit path
                const initialStatusId = (initialStatuses || statuses)[0]?.id || '';
                const defaultNavigatorId = (initialNavigators || navigators).find(n => n.isActive)?.id || '';

                // Create client without upcoming order first
                const clientDataWithoutOrder: Omit<ClientProfile, 'id' | 'createdAt' | 'updatedAt'> = {
                    fullName: formData.fullName ?? '',
                    email: formData.email ?? '',
                    address: formData.address ?? '',
                    phoneNumber: formData.phoneNumber ?? '',
                    secondaryPhoneNumber: formData.secondaryPhoneNumber ?? null,
                    navigatorId: formData.navigatorId ?? defaultNavigatorId,
                    endDate: formData.endDate ?? '',
                    screeningTookPlace: formData.screeningTookPlace ?? false,
                    screeningSigned: formData.screeningSigned ?? false,
                    notes: formData.notes ?? '',
                    statusId: formData.statusId ?? initialStatusId,
                    serviceType: formData.serviceType ?? 'Food',
                    approvedMealsPerWeek: formData.approvedMealsPerWeek ?? 21,
                    authorizedAmount: formData.authorizedAmount ?? null,
                    expirationDate: formData.expirationDate ?? null,
                    upcomingOrder: undefined
                };

                // Check if a client with this name already exists
                const clientName = clientDataWithoutOrder.fullName?.trim();
                if (clientName) {
                    const nameExists = await checkClientNameExists(clientName);
                    if (nameExists) {
                        // Store the client data and show confirmation modal
                        setPendingClientData(clientDataWithoutOrder);
                        setShowDuplicateNameModal(true);
                        setSaving(false);
                        return false;
                    }
                }

                const newClient = await addClient(clientDataWithoutOrder);

                if (!newClient) {
                    setSaving(false);
                    return false;
                }




                // Now update the client with order details (same as editing an existing client)
                // Determine if orderConfig has meaningful data to save
                const hasCaseId = orderConfig?.caseId && orderConfig.caseId.trim() !== '';
                const hasVendorSelections = orderConfig?.vendorSelections &&
                    Array.isArray(orderConfig.vendorSelections) &&
                    orderConfig.vendorSelections.some((s: any) => s.vendorId && s.vendorId.trim() !== '');
                const hasDeliveryDayOrders = orderConfig?.deliveryDayOrders &&
                    Object.keys(orderConfig.deliveryDayOrders).length > 0;
                const hasBoxConfig = (orderConfig?.vendorId && orderConfig.vendorId.trim() !== '') ||
                    (orderConfig?.boxTypeId && orderConfig.boxTypeId.trim() !== '');
                const hasOrderData = hasCaseId || hasVendorSelections || hasDeliveryDayOrders || hasBoxConfig;

                // Prepare update data with order details
                const updateData: Partial<ClientProfile> = {
                    fullName: formData.fullName ?? '',
                    email: formData.email ?? '',
                    address: formData.address ?? '',
                    phoneNumber: formData.phoneNumber ?? '',
                    secondaryPhoneNumber: formData.secondaryPhoneNumber ?? null,
                    navigatorId: formData.navigatorId ?? defaultNavigatorId,
                    endDate: formData.endDate ?? '',
                    screeningTookPlace: formData.screeningTookPlace ?? false,
                    screeningSigned: formData.screeningSigned ?? false,
                    notes: formData.notes ?? '',
                    statusId: formData.statusId ?? initialStatusId,
                    serviceType: formData.serviceType ?? 'Food',
                    approvedMealsPerWeek: formData.approvedMealsPerWeek ?? 21,
                    authorizedAmount: formData.authorizedAmount ?? null,
                    expirationDate: formData.expirationDate ?? null,
                    upcomingOrder: hasOrderData ? prepareActiveOrder() : undefined
                };


                try {
                    // updateClient doesn't return a value, so we call it and then fetch the updated client
                    await updateClient(newClient.id, updateData);
                } catch (error) {
                    console.error('[ClientProfile] Error updating client with order details:', error);
                    setSaving(false);
                    setMessage('Error updating client with order details.');
                    return false;
                }

                // Fetch the updated client after update

                const updatedClient = await getClient(newClient.id);

                if (!updatedClient) {
                    console.error('[ClientProfile] Failed to fetch updated client after update');
                    setSaving(false);
                    setMessage('Error: Failed to fetch updated client.');
                    return false;
                }




                // IMPORTANT: Set flag BEFORE changing clientId to prevent useEffect from overwriting orderConfig
                justCreatedClientRef.current = true;

                // Update state with the updated client
                setActualClientId(updatedClient.id);
                setClient(updatedClient);
                setFormData(updatedClient);

                // Set orderConfig from upcomingOrder
                const upcoming = updatedClient.upcomingOrder;
                if (upcoming && typeof upcoming === 'object' && Object.keys(upcoming).length > 0) {
                    setOrderConfig(upcoming);
                    setOriginalOrderConfig(JSON.parse(JSON.stringify(upcoming)));
                }

                invalidateClientData();
                setMessage('Client created successfully.');

                // Save order to clients.upcoming_order
                const newOrderPayload = prepareNewColumnOrder();
                if (newOrderPayload && newOrderPayload.caseId) {
                    await updateClientUpcomingOrder(updatedClient.id, newOrderPayload);
                    if (updatedClient.serviceType === 'Custom' && newOrderPayload.custom_name && newOrderPayload.custom_price !== undefined && newOrderPayload.vendorId && newOrderPayload.deliveryDay) {
                        await saveClientCustomOrder(
                            updatedClient.id,
                            newOrderPayload.vendorId,
                            newOrderPayload.custom_name,
                            Number(newOrderPayload.custom_price),
                            newOrderPayload.deliveryDay,
                            newOrderPayload.caseId,
                            { skipHistory: true }
                        );
                    }
                }

                // IMPORTANT: Set saving to false and return true BEFORE any state updates that might trigger re-renders
                setSaving(false);

                return true;
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
            if ((client.authorizedAmount ?? null) !== (formData.authorizedAmount ?? null)) {
                changes.push(`Authorized Amount: ${client.authorizedAmount ?? 'null'} -> ${formData.authorizedAmount ?? 'null'}`);
            }
            if ((client.expirationDate || null) !== (formData.expirationDate || null)) {
                changes.push(`Expiration Date: ${client.expirationDate || 'null'} -> ${formData.expirationDate || 'null'}`);
            }

            // Check if any functional change occurred (main save now persists upcoming order only)
            const prevUpcoming = (client as any)?.upcoming_order ?? client?.upcomingOrder ?? {};
            const hasOrderConfigChanges = JSON.stringify(newColumnOrderConfig) !== JSON.stringify(prevUpcoming);
            const hasOrderChanges = !!(newColumnOrderConfig && newColumnOrderConfig.caseId);

            // Generate the full snapshot from upcoming order config (what we save)
            const orderSnapshot = generateOrderSnapshot(newColumnOrderConfig);

            let summary = '';
            if (changes.length > 0 || hasOrderConfigChanges) {
                summary = (changes.length > 0 ? changes.join(', ') + ' | ' : '') + orderSnapshot;
            } else {
                // For "re-saves", still capture the current state for reference
                summary = `Profile re-saved (no changes) | ${orderSnapshot}`;
            }

            console.log(`[ClientProfile] [history] executeSave summary:`, summary);
            console.log(`[ClientProfile] [history] executeSave changes array:`, JSON.stringify(changes));

            // Update client profile
            // 1. Calculate changes
            // 2. Prepare updateData
            // 3. IF order changes, add upcomingOrder to updateData (handled in updateClientUpcomingOrder below)
            // 4. Call updateClient once

            // Checking order changes again...
            // The original code called updateClient BEFORE calculating cleanedOrderConfig.
            // This means we need to restructure a bit.

            let updateData: Partial<ClientProfile> = { ...formData };

            // Prepare the updated JSONB history for the clients table
            // This is the "One Thing" that gets saved to persist history

            // Prepare the updated JSONB history for the clients table (reflects upcoming order we save)
            const newHistoryEntry = {
                type: 'save_event',
                orderDetails: newColumnOrderConfig,
                snapshot: orderSnapshot,
                timestamp: new Date().toISOString(),
                updatedBy: currentUser?.role || currentUser?.id || 'Admin'
            };

            // Add to updateData so updateClient saves it in one call
            updateData.orderHistory = [...(client?.orderHistory || []), newHistoryEntry];


            // Log Navigator Action if applicable
            if (currentUser?.role === 'navigator' && client.statusId !== formData.statusId) {
                const oldStatusName = (initialStatuses || statuses).find(s => s.id === client.statusId)?.name || 'Unknown';
                const newStatusName = (initialStatuses || statuses).find(s => s.id === formData.statusId)?.name || 'Unknown';

                await logNavigatorAction({
                    navigatorId: currentUser.id,
                    clientId: clientId,
                    oldStatus: oldStatusName,
                    newStatus: newStatusName,
                    unitsAdded: unitsAdded
                });
            }

            // Main save now only persists upcoming order (no activeOrder sync to food/meal/box tables)

            await updateClient(clientId, updateData, { skipHistory: true });

            // Save upcoming order (same as former "Save to new column" button)
            await updateClientUpcomingOrder(clientId, prepareNewColumnOrder());
            invalidateClientData(clientId);
            lastUpcomingOrderClientIdRef.current = null;
            const fresh = await getClient(clientId);
            if (fresh) {
                setClient(fresh);
                try {
                    const raw = (fresh as any).orderHistory ?? (fresh as any).order_history;
                    if (raw != null) {
                        const parsed = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []);
                        const sorted = [...parsed].sort((a: any, b: any) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
                        setClientOrderHistory(sorted);
                    }
                } catch (_) {
                    // ignore parse errors
                }
            }

            // Order saved via updateClientUpcomingOrder above

            // Reload upcoming order if we had order changes
            // Reload from fresh client; upcoming order is in clients.upcoming_order.
            /*
            if (hasOrderConfigChanges || hasOrderChanges) {
                const updatedUpcomingOrder = await getUpcomingOrderForClient(clientId);
                                    if (updatedUpcomingOrder) {
                                        setOrderConfig(updatedUpcomingOrder);
                                    setOriginalOrderConfig(JSON.parse(JSON.stringify(updatedUpcomingOrder)));
                }
            }
                                    */

            // Show confirmation message (main save now persists upcoming order)
            let confirmationMessage = hasOrderChanges && newColumnOrderConfig?.caseId
                ? 'Saved to upcoming order.'
                : 'Changes saved successfully.';

            // Always close modal and client portal after saving (especially for navigators adding units)
            const wasNavigatorAddingUnits = currentUser?.role === 'navigator' && pendingStatusChange !== null;
            setShowUnitsModal(false);
            setPendingStatusChange(null);

            // If navigator added units, always close the portal
            if (wasNavigatorAddingUnits && onClose) {
                onClose();
                return true;
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
            // Even on error, close modal and portal if navigator was adding units
            const wasNavigatorAddingUnits = currentUser?.role === 'navigator' && pendingStatusChange !== null;
            setShowUnitsModal(false);
            setPendingStatusChange(null);

            // Only close if it was a navigator unit flow, otherwise keep modal open to show error
            if (wasNavigatorAddingUnits && onClose) {
                // For now, let's keep it open even for navigators if there's an error so they can see it
                // onClose(); 
            }

            setSaving(false);
            return false;
        } finally {
            setSaving(false);
            // Ensure modal is closed
            setShowUnitsModal(false);
            setPendingStatusChange(null);
        }
    }

    return (
        <section className={styles.card}>
            <h3 className={styles.sectionTitle}>Client Information</h3>
            <div className={styles.grid2}>
                <div className={styles.formGroup}>
                    <label className={styles.label}>Full Name <span className={styles.required}>*</span></label>
                    <input
                        type="text"
                        name="fullName"
                        className={styles.input}
                        value={formData.fullName || ''}
                        onChange={handleChange}
                        disabled={saving}
                        required
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.label}>Email <span className={styles.required}>*</span></label>
                    <input
                        type="email"
                        name="email"
                        className={styles.input}
                        value={formData.email || ''}
                        onChange={handleChange}
                        disabled={saving}
                        required
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.label}>Phone Number</label>
                    <input
                        type="tel"
                        name="phoneNumber"
                        className={styles.input}
                        value={formData.phoneNumber || ''}
                        onChange={handleChange}
                        disabled={saving}
                    />
                </div>
                <div className={styles.formGroup}>
                    <label className={styles.label}>Secondary Phone</label>
                    <input
                        type="tel"
                        name="secondaryPhoneNumber"
                        className={styles.input}
                        value={formData.secondaryPhoneNumber || ''}
                        onChange={handleChange}
                        disabled={saving}
                    />
                </div>
                <div className={styles.formGroup} style={{ gridColumn: 'span 2' }}>
                    <label className={styles.label}>Address <span className={styles.required}>*</span></label>
                    <input
                        type="text"
                        name="address"
                        className={styles.input}
                        value={formData.address || ''}
                        onChange={handleChange}
                        disabled={saving}
                        required
                    />
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label}>Status</label>
                    <select
                        name="statusId"
                        className={styles.select}
                        value={formData.statusId || ''}
                        onChange={handleChange}
                        disabled={saving}
                    >
                        {statuses.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                    </select>
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label}>Assigned Navigator</label>
                    <select
                        name="navigatorId"
                        className={styles.select}
                        value={formData.navigatorId || ''}
                        onChange={handleChange}
                        disabled={saving}
                    >
                        <option value="">Unassigned</option>
                        {navigators.filter(n => n.isActive || n.id === client?.navigatorId).map(n => (
                            <option key={n.id} value={n.id}>{n.name}</option>
                        ))}
                    </select>
                </div>

                {currentUser?.role !== 'navigator' && (
                    <div className={styles.formGroup}>
                        <label className={styles.label}>Parent Client (Optional)</label>
                        <div style={{ position: 'relative' }}>
                            <input
                                type="text"
                                className={styles.input}
                                placeholder="Search existing clients..."
                                value={parentClientSearch}
                                onChange={(e) => {
                                    setParentClientSearch(e.target.value);
                                    if (!e.target.value) {
                                        setFormData(prev => ({ ...prev, parentClientId: null }));
                                    }
                                    setShowParentSearch(true);
                                }}
                                onFocus={() => setShowParentSearch(true)}
                                onBlur={() => setTimeout(() => setShowParentSearch(false), 200)}
                            />
                            {formData.parentClientId && (
                                <button
                                    className={styles.clearBtn}
                                    onClick={() => {
                                        setFormData(prev => ({ ...prev, parentClientId: null }));
                                        setParentClientSearch('');
                                    }}
                                    style={{
                                        position: 'absolute',
                                        right: '10px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        color: 'var(--text-tertiary)'
                                    }}
                                >
                                    <X size={16} />
                                </button>
                            )}

                            {showParentSearch && parentClientSearch && !formData.parentClientId && (
                                <div className={styles.dropdown}>
                                    {regularClients
                                        .filter(c =>
                                            c.id !== clientId &&
                                            c.fullName.toLowerCase().includes(parentClientSearch.toLowerCase())
                                        )
                                        .slice(0, 5)
                                        .map(match => (
                                            <div
                                                key={match.id}
                                                className={styles.dropdownItem}
                                                onMouseDown={() => {
                                                    setFormData(prev => ({ ...prev, parentClientId: match.id }));
                                                    setParentClientSearch(match.fullName);
                                                    setShowParentSearch(false);
                                                }}
                                            >
                                                {match.fullName}
                                            </div>
                                        ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className={styles.formGroup} style={{ gridColumn: 'span 2' }}>
                    <label className={styles.label}>Notes</label>
                    <textarea
                        name="notes"
                        className={styles.textarea}
                        value={formData.notes || ''}
                        onChange={handleChange}
                        disabled={saving}
                        rows={3}
                    />
                </div>
            </div>
        </section>
    );

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button className={styles.backBtn} onClick={handleBack} disabled={saving}>
                        <ArrowLeft size={18} />
                        Back
                    </button>
                    <h1 className={styles.title}>{isNewClient ? 'Add New Client' : (client?.fullName || 'Client Profile')}</h1>
                </div>
                <div className={styles.actions}>
                    {message && <span className={styles.successMessage}>{message}</span>}
                    {validationError && (
                        <span className={styles.successMessage} style={{ color: 'var(--color-danger)' }}>
                            {validationError}
                        </span>
                    )}

                    {!isNewClient && (
                        <button
                            className={`${styles.iconBtn} ${styles.danger}`}
                            onClick={() => setShowDeleteModal(true)}
                            title="Delete Client"
                            disabled={saving}
                        >
                            <Trash2 size={20} />
                        </button>
                    )}

                    <button className={styles.btn} onClick={handleDiscardChanges} disabled={saving}>
                        Discard
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={() => handleSave()}
                        disabled={saving}
                    >
                        {saving ? <Loader2 className="spin" size={16} /> : (isNewClient ? 'Create Client' : 'Save Changes')}
                    </button>
                </div>
            </div >

            {/* Validation Message Box (if needed) */}
            {
                validationError && (
                    <div style={{
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        color: 'var(--color-danger)',
                        padding: '1rem',
                        borderRadius: 'var(--radius-md)',
                        marginBottom: '1rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                    }}>
                        <AlertTriangle size={20} />
                        <span>{validationError}</span>
                    </div>
                )
            }

            <div className={styles.grid}>
                {/* Form Sections */}
                <div className={styles.column}>
                    {renderClientInfoSection()}
                    {renderServiceConfigSection()}
                    {renderOrderConfigSection()}
                    {renderNewColumnOrderSection()}
                    {renderRecentOrdersSection()}
                    {renderOrderHistorySection()}
                    {renderBillingHistorySection()}
                </div>
            </div >
        </div >
    );
}