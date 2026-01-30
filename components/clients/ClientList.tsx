'use client';

import { ClientProfileDetail } from './ClientProfile';
import { ClientInfoShelf } from './ClientInfoShelf';

import { useState, useEffect, useRef } from 'react';
import { ClientProfile, ClientStatus, Navigator, Vendor, BoxType, ClientFullDetails, MenuItem, GlobalLocation } from '@/lib/types';
import {
    getClientsPaginated,
    getClientFullDetails,
    getStatuses,
    getNavigators,
    addClient,
    addDependent,
    getRegularClients,
    getVendors,
    getBoxTypes,
    getMenuItems,
    getMealItems,
    getClients,
    updateClient,
    getUpcomingOrderForClient as serverGetUpcomingOrderForClient,
    getCompletedOrdersWithDeliveryProof as serverGetCompletedOrdersWithDeliveryProof,
    getBatchClientDetails,
    getClient,
    getGlobalLocations,
    getSettings,
    getCategories,
    getEquipment,
    getMealCategories
} from '@/lib/actions';
import { invalidateClientData } from '@/lib/cached-data';
import { Plus, Search, ChevronRight, CheckSquare, Square, StickyNote, Package, ArrowUpDown, ArrowUp, ArrowDown, Filter, Eye, EyeOff, Loader2, AlertCircle, X, RefreshCcw } from 'lucide-react';
import styles from './ClientList.module.css';
import { useRouter } from 'next/navigation';

interface ClientListProps {
    currentUser?: { role: string; id: string } | null;
}

export function ClientList({ currentUser }: ClientListProps = {}) {
    const router = useRouter();
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [allClientsForLookup, setAllClientsForLookup] = useState<ClientProfile[]>([]);
    const [globalLocations, setGlobalLocations] = useState<GlobalLocation[]>([]);
    const [mealItems, setMealItems] = useState<MenuItem[]>([]);
    const [settings, setSettings] = useState<any>(null);
    const [categories, setCategories] = useState<any[]>([]);
    const [equipment, setEquipment] = useState<any[]>([]);
    const [mealCategories, setMealCategories] = useState<any[]>([]);
    const [regularClients, setRegularClients] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [backgroundTasks, setBackgroundTasks] = useState<Map<string, string>>(new Map());
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [includeOrderDetails, setIncludeOrderDetails] = useState(false);

    // Single Batch Loading State - No Pagination
    // All clients are loaded at once.
    const [detailsCache, setDetailsCache] = useState<Record<string, ClientFullDetails>>({});
    const pendingPrefetches = useRef<Set<string>>(new Set());

    // Track which clients have already logged missing vendor ID warnings (to avoid spam)


    // Views
    const [currentView, setCurrentView] = useState<'all' | 'eligible' | 'ineligible' | 'billing' | 'needs-attention'>('all');

    // Sorting State
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    // Filtering State
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [navigatorFilter, setNavigatorFilter] = useState<string | null>(null);
    const [screeningFilter, setScreeningFilter] = useState<string | null>(null);
    const [serviceTypeFilter, setServiceTypeFilter] = useState<string | null>(null);
    const [needsVendorFilter, setNeedsVendorFilter] = useState<boolean>(false);
    const [reasonFilter, setReasonFilter] = useState<string | null>(null);
    const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);

    // Add Dependent Modal state
    const [isAddingDependent, setIsAddingDependent] = useState(false);
    const [dependentName, setDependentName] = useState('');
    const [dependentDob, setDependentDob] = useState('');
    const [dependentCin, setDependentCin] = useState('');
    const [selectedParentClientId, setSelectedParentClientId] = useState<string>('');
    const [parentClientSearch, setParentClientSearch] = useState('');
    const [editingDependentId, setEditingDependentId] = useState<string | null>(null);

    // Show/Hide Dependents Toggle
    const [showDependents, setShowDependents] = useState(false);

    // Selected Client for Modal
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    // Order Details Visibility Toggle
    const [showOrderDetails, setShowOrderDetails] = useState(false);

    // Info Shelf State
    const [infoShelfClientId, setInfoShelfClientId] = useState<string | null>(null);

    useEffect(() => {
        loadInitialData();
    }, []);

    // Reload data when view changes
    useEffect(() => {
        if (!isLoading) {
            loadInitialData();
        }
    }, [currentView]);

    // PREVIOUS: Progressive Loading Effect (Removed)
    // We now load all clients in one go, so no need for fetchMoreClients logic.

    // DISABLED: Background Prefetching - Using bulk loading instead
    // Prefetching is disabled to avoid unnecessary API calls
    // useEffect(() => {
    //     if (isLoading || clients.length === 0) return;
    //     // ... prefetching code removed
    // }, [clients, detailsCache, isLoading]);

    // Click-outside-to-close filter menus
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as HTMLElement;
            const filterDropdown = target.closest('[data-filter-dropdown]');
            if (!filterDropdown) {
                setOpenFilterMenu(null);
            }
        }

        if (openFilterMenu) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [openFilterMenu]);

    async function loadInitialData() {
        setIsLoading(true);
        try {
            // Fetch ALL data in parallel. 
            // Note: getClients now returns ALL clients, not paginated.
            const [sData, nData, vData, bData, mData, mealData, allClients, gLocs, appSettings, catData, eData, mealCatData, regClients] = await Promise.all([
                getStatuses(),
                getNavigators(),
                getVendors(),
                getBoxTypes(),
                getMenuItems(),
                getMealItems(),
                getClients(),
                getGlobalLocations(),
                getSettings(),
                getCategories(),
                getEquipment(),
                getMealCategories(),
                getRegularClients()
            ]);

            setStatuses(sData);
            setNavigators(nData);
            setVendors(vData);
            setBoxTypes(bData);
            setMenuItems(mData);
            setMealItems(mealData as any);
            setClients(allClients); // Set ALL clients at once
            setAllClientsForLookup(allClients);
            setGlobalLocations(Array.isArray(gLocs) ? gLocs : (gLocs as any).success ? (gLocs as any).data : []);
            setSettings(appSettings);
            setCategories(catData);
            setEquipment(eData);
            setMealCategories(mealCatData);
            setRegularClients(regClients);
        } catch (error) {
            console.error("Error loading initial data:", error);
        } finally {
            setIsLoading(false);
        }
    }

    async function refreshDataInBackground() {
        setIsRefreshing(true);
        try {
            invalidateClientData();

            const [sData, nData, vData, bData, mData, mealData, allClients, gLocs, appSettings, catData, eData, mealCatData, regClients] = await Promise.all([
                getStatuses(),
                getNavigators(),
                getVendors(),
                getBoxTypes(),
                getMenuItems(),
                getMealItems(),
                getClients(),
                getGlobalLocations(),
                getSettings(),
                getCategories(),
                getEquipment(),
                getMealCategories(),
                getRegularClients()
            ]);

            setStatuses(sData);
            setNavigators(nData);
            setVendors(vData);
            setBoxTypes(bData);
            setMenuItems(mData);
            setMealItems(mealData as any);
            setClients(allClients);
            setAllClientsForLookup(allClients);
            setGlobalLocations(Array.isArray(gLocs) ? gLocs : (gLocs as any).success ? (gLocs as any).data : []);
            setSettings(appSettings);
            setCategories(catData);
            setEquipment(eData);
            setMealCategories(mealCatData);
            setRegularClients(regClients);
        } catch (error) {
            console.error("Error refreshing data:", error);
        } finally {
            setIsRefreshing(false);
        }
    }

    const handleBackgroundSave = async (clientId: string, clientName: string, saveAction: () => Promise<void>) => {
        // Add to background tasks
        setBackgroundTasks(prev => new Map(prev).set(clientId, clientName));

        try {
            // Execute the save action
            await saveAction();

            // Refresh this client's data in the list
            await refreshSingleClient(clientId);
        } catch (error) {
            console.error(`Error saving client ${clientName}:`, error);
            // Ideally assume we'd show a toast here, but for now console error is consistent with app
            alert(`Failed to save ${clientName} in background. Please try again.`);
        } finally {
            // Remove from tasks
            setBackgroundTasks(prev => {
                const next = new Map(prev);
                next.delete(clientId);
                return next;
            });

            // Show success message if no error occurred
            if (!backgroundTasks.has(clientId)) { // Check simplistic error handling, ideally based on try/catch flow
                setSuccessMessage(`Successfully saved ${clientName}`);
                setTimeout(() => setSuccessMessage(null), 3000);
            }
        }
    };

    async function refreshSingleClient(clientId: string) {
        if (!clientId) return;
        try {
            // Fetch just this client
            const updatedClient = await getClient(clientId);
            if (updatedClient) {
                setClients(prev => {
                    // Check if client exists in list
                    const exists = prev.find(c => c.id === clientId);
                    if (exists) {
                        // Update existing
                        return prev.map(c => c.id === clientId ? updatedClient : c);
                    } else {
                        // Safest is to only update existing
                        return prev;
                    }
                });
            }
        } catch (err) {
            console.error("Failed to refresh single client:", err);
        }
    }

    // Removed fetchMoreClients as it's no longer needed for single-batch loading

    async function prefetchClient(clientId: string) {
        if (detailsCache[clientId] || pendingPrefetches.current.has(clientId)) return;

        pendingPrefetches.current.add(clientId);
        try {
            const details = await getClientFullDetails(clientId);
            if (details) {
                setDetailsCache(prev => ({ ...prev, [clientId]: details }));
            }
        } catch (error) {
            console.error(`Error prefetching client ${clientId}:`, error);
        } finally {
            pendingPrefetches.current.delete(clientId);
        }
    }

    const baseFilteredClients = clients.filter(c => {
        const searchLower = search.toLowerCase();
        // NEW: Extended Search (Vendor Names & Item Names)
        const getExtendedSearchTerms = (c: ClientProfile): string => {
            // Simplified: Search exactly what is displayed in the summary columns
            const orderSummary = getOrderSummaryText(c);
            const mealSummary = getMealOrderSummaryText(c);
            return `${orderSummary} ${mealSummary}`.toLowerCase();
        };


        const extendedSearchLine = getExtendedSearchTerms(c);

        const matchesSearch =
            c.fullName.toLowerCase().includes(searchLower) ||
            (c.phoneNumber && c.phoneNumber.includes(searchLower)) ||
            (c.secondaryPhoneNumber && c.secondaryPhoneNumber.includes(searchLower)) ||
            (c.address && c.address.toLowerCase().includes(searchLower)) ||
            (c.email && c.email.toLowerCase().includes(searchLower)) ||
            (c.notes && c.notes.toLowerCase().includes(searchLower)) ||
            extendedSearchLine.includes(searchLower);

        // Filter by View
        let matchesView = true;
        if (currentView === 'eligible') {
            const status = statuses.find(s => s.id === c.statusId);
            // Show clients whose status allows deliveries
            matchesView = status ? status.deliveriesAllowed : false;
        } else if (currentView === 'ineligible') {
            const status = statuses.find(s => s.id === c.statusId);
            // Show clients whose status does NOT allow deliveries
            matchesView = status ? !status.deliveriesAllowed : false;
        } else if (currentView === 'needs-attention') {
            // First, check if client is eligible (status allows deliveries)
            const status = statuses.find(s => s.id === c.statusId);
            const isEligible = status ? status.deliveriesAllowed : false;

            // Only show eligible clients that need attention
            if (!isEligible) {
                matchesView = false;
            } else {
                // Show clients that need attention based on specific criteria:
                // 1. Clients with boxes that do not have a vendor assigned
                // 2. Clients whose expiration date is within the current month
                // 3. Clients with boxes whose authorized amount is less than 584
                // 4. Clients with food whose authorized amount is less than 1344

                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

                // 1. Check if client with boxes doesn't have vendor assigned
                let boxesNeedsVendor = false;
                if (c.serviceType === 'Boxes') {
                    // Check actual box orders from client_box_orders table
                    const clientDetails = detailsCache[c.id];

                    // Only check if we have cached details (to avoid false positives)
                    if (clientDetails) {
                        const boxOrders = clientDetails.boxOrders || [];

                        if (boxOrders.length === 0) {
                            boxesNeedsVendor = true; // No box orders means needs vendor
                        } else {
                            // Check if any box order is missing a vendor
                            boxesNeedsVendor = boxOrders.some(boxOrder => {
                                // Check vendorId on the box order itself, or fall back to box type's vendor
                                if (boxOrder.vendorId) {
                                    return false; // Has vendor
                                }
                                // Fall back to box type's vendor if box order doesn't have one
                                const box = boxTypes.find(b => b.id === boxOrder.boxTypeId);
                                return !box?.vendorId; // Missing vendor if box type also doesn't have one
                            });
                        }
                    }
                    // If cache entry doesn't exist, we can't determine vendor status, so skip this check
                }

                // 2. Check if expiration date is within current month
                let expirationInCurrentMonth = false;
                if (c.expirationDate) {
                    const expDate = new Date(c.expirationDate);
                    expirationInCurrentMonth = expDate >= firstDayOfMonth && expDate <= lastDayOfMonth;
                }

                // 3. Check if boxes client has authorized amount < 584 or is null/undefined
                const boxesLowOrNoAmount = c.serviceType === 'Boxes' && (c.authorizedAmount === null || c.authorizedAmount === undefined || c.authorizedAmount < 584);

                // 4. Check if food client has authorized amount < 1344 or is null/undefined
                const foodLowOrNoAmount = c.serviceType === 'Food' && (c.authorizedAmount === null || c.authorizedAmount === undefined || c.authorizedAmount < 1344);

                // 5. Check if meal orders exist but no vendor is assigned
                let mealNeedsVendor = false;
                const mealSelections = c.mealOrder?.mealSelections || c.activeOrder?.mealSelections;
                if (mealSelections) {
                    const mealTypes = Object.keys(mealSelections);
                    if (mealTypes.length > 0) {
                        mealNeedsVendor = mealTypes.some(type => !mealSelections[type].vendorId);
                    }
                }

                // 6. Check if any box order (regardless of service type) has no vendor attached
                let boxOrderNeedsVendor = false;
                // Check both activeOrder and detailsCache for box orders
                const activeBoxOrders = c.activeOrder?.boxOrders || [];
                const clientDetails = detailsCache[c.id];
                const cachedBoxOrders = clientDetails?.boxOrders || [];
                // Combine both sources, prioritizing activeOrder
                const allBoxOrders = activeBoxOrders.length > 0 ? activeBoxOrders : cachedBoxOrders;

                if (allBoxOrders.length > 0) {
                    boxOrderNeedsVendor = allBoxOrders.some(boxOrder => {
                        // Check vendorId on the box order itself, or fall back to box type's vendor
                        if (boxOrder.vendorId) {
                            return false; // Has vendor
                        }
                        // Fall back to box type's vendor if box order doesn't have one
                        const box = boxTypes.find(b => b.id === boxOrder.boxTypeId);
                        return !box?.vendorId; // Missing vendor if box type also doesn't have one
                    });
                }

                matchesView = boxesNeedsVendor || expirationInCurrentMonth || boxesLowOrNoAmount || foodLowOrNoAmount || mealNeedsVendor || boxOrderNeedsVendor;
            }
        }
        // 'billing' might just show all clients but with different columns?

        // Filter by Status
        const matchesStatusFilter = !statusFilter || c.statusId === statusFilter;

        // Filter by Navigator
        const matchesNavigatorFilter = !navigatorFilter || c.navigatorId === navigatorFilter;

        // Filter by Screening Status
        const matchesScreeningFilter = !screeningFilter || (c.screeningStatus || 'not_started') === screeningFilter;

        // Filter by Service Type (Active Order)
        const matchesServiceTypeFilter = !serviceTypeFilter || c.serviceType === serviceTypeFilter;

        // Filter by Needs Vendor (for Boxes clients without vendor OR Meal orders without vendor)
        let matchesNeedsVendorFilter = true;
        if (needsVendorFilter) {
            let needsBoxVendor = false;
            let needsMealVendor = false;

            // Check Boxes
            if (c.serviceType === 'Boxes') {
                // Check actual box orders from client_box_orders table
                const clientDetails = detailsCache[c.id];

                // Only check if we have cached details (to avoid false positives)
                if (clientDetails) {
                    const boxOrders = clientDetails.boxOrders || [];

                    if (boxOrders.length === 0) {
                        needsBoxVendor = true; // No box orders means needs vendor
                    } else {
                        // Check if any box order is missing a vendor
                        needsBoxVendor = boxOrders.some(boxOrder => {
                            // Check vendorId on the box order itself, or fall back to box type's vendor
                            if (boxOrder.vendorId) {
                                return false; // Has vendor
                            }
                            // Fall back to box type's vendor if box order doesn't have one
                            const box = boxTypes.find(b => b.id === boxOrder.boxTypeId);
                            return !box?.vendorId; // Missing vendor if box type also doesn't have one
                        });
                    }
                }
                // If cache entry doesn't exist, we can't determine vendor status, so skip this check
            }

            // Check Meals
            const mealSelections = c.mealOrder?.mealSelections || c.activeOrder?.mealSelections;
            if (mealSelections) {
                const mealTypes = Object.keys(mealSelections);
                if (mealTypes.length > 0) {
                    needsMealVendor = mealTypes.some(type => !mealSelections[type].vendorId);
                }
            }
            matchesNeedsVendorFilter = needsBoxVendor || needsMealVendor;
        }

        // Filter by Needs Attention Reason
        let matchesReasonFilter = true;
        if (reasonFilter && currentView === 'needs-attention') {
            const reasons = getNeedsAttentionReason(c).split(', ');
            matchesReasonFilter = reasons.includes(reasonFilter);
        }

        // Filter by Dependents visibility
        const matchesDependentsFilter = showDependents || !c.parentClientId;

        return matchesSearch && matchesView && matchesStatusFilter && matchesNavigatorFilter && matchesScreeningFilter && matchesServiceTypeFilter && matchesNeedsVendorFilter && matchesReasonFilter && matchesDependentsFilter;
    });

    // Group dependents under their parent clients
    // First, separate parent clients and dependents
    const parentClients = baseFilteredClients.filter(c => !c.parentClientId);
    const dependents = baseFilteredClients.filter(c => c.parentClientId);

    // Helper function to compare clients based on sort column
    function compareClients(a: ClientProfile, b: ClientProfile): number {
        // Always sort clients needing vendor assignment to the top
        const aNeedsVendor = a.serviceType === 'Boxes' && (!a.activeOrder || (a.activeOrder.serviceType === 'Boxes' && !a.activeOrder.vendorId && !boxTypes.find(bt => bt.id === a.activeOrder?.boxTypeId)?.vendorId));
        const bNeedsVendor = b.serviceType === 'Boxes' && (!b.activeOrder || (b.activeOrder.serviceType === 'Boxes' && !b.activeOrder.vendorId && !boxTypes.find(bt => bt.id === b.activeOrder?.boxTypeId)?.vendorId));

        if (aNeedsVendor !== bNeedsVendor) {
            return aNeedsVendor ? -1 : 1; // Clients needing vendor come first
        }

        if (!sortColumn) {
            // Default to alphabetical by name
            return a.fullName.localeCompare(b.fullName);
        }

        let comparison = 0;

        switch (sortColumn) {
            case 'name':
                comparison = a.fullName.localeCompare(b.fullName);
                break;
            case 'status':
                const statusA = getStatusName(a.statusId);
                const statusB = getStatusName(b.statusId);
                comparison = statusA.localeCompare(statusB);
                break;
            case 'navigator':
                const navA = getNavigatorName(a.navigatorId);
                const navB = getNavigatorName(b.navigatorId);
                comparison = navA.localeCompare(navB);
                break;
            case 'screening':
                const screeningA = a.screeningStatus || 'not_started';
                const screeningB = b.screeningStatus || 'not_started';
                comparison = screeningA.localeCompare(screeningB);
                break;
            case 'email':
                const emailA = a.email || '';
                const emailB = b.email || '';
                comparison = emailA.localeCompare(emailB);
                break;
            case 'phone':
                const phoneA = a.phoneNumber || '';
                const phoneB = b.phoneNumber || '';
                comparison = phoneA.localeCompare(phoneB);
                break;
            case 'secondaryPhone':
                const secondaryPhoneA = a.secondaryPhoneNumber || '';
                const secondaryPhoneB = b.secondaryPhoneNumber || '';
                comparison = secondaryPhoneA.localeCompare(secondaryPhoneB);
                break;
            case 'address':
                const addressA = a.address || '';
                const addressB = b.address || '';
                comparison = addressA.localeCompare(addressB);
                break;
            case 'notes':
                const notesA = a.notes || '';
                const notesB = b.notes || '';
                comparison = notesA.localeCompare(notesB);
                break;
            case 'authorizedAmount':
                const amountA = a.authorizedAmount ?? 0;
                const amountB = b.authorizedAmount ?? 0;
                comparison = amountA - amountB;
                break;
            case 'expirationDate':
                const dateA = a.expirationDate ? new Date(a.expirationDate).getTime() : 0;
                const dateB = b.expirationDate ? new Date(b.expirationDate).getTime() : 0;
                comparison = dateA - dateB;
                break;
            default:
                comparison = a.fullName.localeCompare(b.fullName);
        }

        return sortDirection === 'asc' ? comparison : -comparison;
    }

    // Sort parent clients (default to alphabetical by name)
    const sortedParentClients = [...parentClients].sort(compareClients);

    // Group dependents by parent ID and sort them alphabetically within each group
    const dependentsByParent = new Map<string, ClientProfile[]>();
    dependents.forEach(dep => {
        const parentId = dep.parentClientId!;
        if (!dependentsByParent.has(parentId)) {
            dependentsByParent.set(parentId, []);
        }
        dependentsByParent.get(parentId)!.push(dep);
    });

    // Sort dependents within each parent group (always alphabetically by name, ignoring other sort columns)
    dependentsByParent.forEach((deps, parentId) => {
        deps.sort((a, b) => a.fullName.localeCompare(b.fullName));
    });

    // Build final list: each parent followed by its dependents
    const groupedClients: ClientProfile[] = [];
    sortedParentClients.forEach(parent => {
        groupedClients.push(parent);
        // Add dependents for this parent (they're already filtered by showDependents in the base filter)
        const parentDependents = dependentsByParent.get(parent.id) || [];
        groupedClients.push(...parentDependents);
    });

    // Also include dependents whose parents are not in the filtered list (orphaned dependents)
    const orphanedDependents = dependents.filter(dep => {
        const parentId = dep.parentClientId!;
        return !sortedParentClients.some(p => p.id === parentId);
    });
    if (orphanedDependents.length > 0) {
        orphanedDependents.sort((a, b) => a.fullName.localeCompare(b.fullName));
        groupedClients.push(...orphanedDependents);
    }

    // Use the grouped clients as the final filtered list
    const filteredClients = groupedClients;

    function handleCreate() {
        // Open the modal immediately with "new" as a special clientId
        // The modal will handle creating the client when the user clicks save
        setSelectedClientId('new');
    }

    async function handleAddDependent() {
        if (!dependentName.trim() || !selectedParentClientId) return;

        try {
            const dobValue = dependentDob.trim() || null;
            const cinValue = dependentCin.trim() || null;

            if (editingDependentId) {
                // Update existing dependent
                const updated = await updateClient(editingDependentId, {
                    fullName: dependentName.trim(),
                    parentClientId: selectedParentClientId,
                    dob: dobValue,
                    cin: cinValue
                });

                // Optimistic update
                if (updated) {
                    setClients(prev => prev.map(c => c.id === editingDependentId ? { ...c, ...updated } : c));
                }
            } else {
                // Create new dependent
                const newDependent = await addDependent(dependentName.trim(), selectedParentClientId, dobValue, cinValue);
                if (!newDependent) return;

                // Optimistic update: Add to list immediately
                setClients(prev => [...prev, newDependent]);
            }

            // invalidateClientData(); // Avoid full cache invalidation to prevent refetch loops
            setIsAddingDependent(false);
            setDependentName('');
            setDependentDob('');
            setDependentCin('');
            setSelectedParentClientId('');
            setParentClientSearch('');
            setEditingDependentId(null);
            // window.location.reload(); // Removed full reload

            // Optionally refresh background data silently if needed, but local update is better
        } catch (error) {
            console.error('Error saving dependent:', error);
            alert(error instanceof Error ? error.message : 'Failed to save dependent');
        }
    }

    // Load regular clients when dependent modal opens
    useEffect(() => {
        if (isAddingDependent) {
            getRegularClients().then(setRegularClients).catch(console.error);
        }
    }, [isAddingDependent]);

    const filteredRegularClients = regularClients.filter(c =>
        c.fullName.toLowerCase().includes(parentClientSearch.toLowerCase())
    );

    // Calculate total clients (excluding dependents)
    const totalRegularClients = clients.filter(c => !c.parentClientId).length;

    function getStatusName(id: string) {
        return statuses.find(s => s.id === id)?.name || 'Unknown';
    }

    function getNavigatorName(id: string) {
        return navigators.find(n => n.id === id)?.name || 'Unassigned';
    }

    function getParentClientName(client: ClientProfile) {
        if (!client.parentClientId) return null;
        const parentClient = allClientsForLookup.find(c => c.id === client.parentClientId);
        return parentClient?.fullName || 'Unknown Parent';
    }

    function handleSort(column: string) {
        if (sortColumn === column) {
            // Toggle direction
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // New column, default to ascending
            setSortColumn(column);
            setSortDirection('asc');
        }
    }

    function getSortIcon(column: string) {
        if (sortColumn !== column) {
            return <ArrowUpDown size={14} />;
        }
        return sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    }

    function getScreeningStatusLabel(status: string) {
        switch (status) {
            case 'not_started':
                return 'Not Started';
            case 'waiting_approval':
                return 'Waiting for Approval';
            case 'approved':
                return 'Approved';
            case 'rejected':
                return 'Rejected';
            default:
                return status;
        }
    }

    function getOrderSummaryText(client: ClientProfile) {
        if (!client.activeOrder) return '-';
        const st = client.serviceType;
        const conf = client.activeOrder;

        let content = '';

        if (st === 'Food') {
            const limit = client.approvedMealsPerWeek || 0;
            const uniqueVendors = new Set<string>();
            const isMultiDay = conf.deliveryDayOrders && typeof conf.deliveryDayOrders === 'object';

            // Helper to process selections
            const processSelections = (selections: any[]) => {
                selections.forEach(v => {
                    const vendorName = vendors.find(ven => ven.id === v.vendorId)?.name;
                    if (vendorName) {
                        const itemCount = Object.values(v.items || {}).reduce((a: number, b: any) => a + Number(b), 0);
                        if (itemCount > 0) uniqueVendors.add(`${vendorName} (${itemCount})`);
                    }
                });
            };

            if (isMultiDay) {
                Object.values(conf.deliveryDayOrders || {}).forEach((dayOrder: any) => {
                    if (dayOrder?.vendorSelections) processSelections(dayOrder.vendorSelections);
                });
            } else if (conf.vendorSelections) {
                processSelections(conf.vendorSelections);
            }

            const vendorsSummary = Array.from(uniqueVendors).join(', ');

            if (!vendorsSummary) return '';
            content = `: ${vendorsSummary} [Max ${limit}]`;
        } else if (st === 'Boxes') {
            const boxOrders = conf.boxOrders || [];
            const uniqueVendors = new Set<string>();
            const allItems: string[] = [];

            if (boxOrders.length > 0) {
                boxOrders.forEach((box: any) => {
                    // Vendor
                    const boxDef = boxTypes.find(b => b.id === box.boxTypeId);
                    const vId = box.vendorId || boxDef?.vendorId;
                    if (vId) {
                        const vName = vendors.find(v => v.id === vId)?.name;
                        if (vName) uniqueVendors.add(vName);
                    }

                    // Items
                    if (box.items) {
                        Object.entries(box.items).forEach(([itemId, qty]) => {
                            if (Number(qty) > 0) {
                                const item = menuItems.find(i => i.id === itemId);
                                if (item) allItems.push(`${item.name} x${qty}`);
                            }
                        });
                    }
                });
            }

            // Legacy Fallback
            if (boxOrders.length === 0) {
                // Check vendorId from order config first, then fall back to boxType
                const box = boxTypes.find(b => b.id === conf.boxTypeId);
                const vendorId = conf.vendorId || box?.vendorId;
                const vendorName = vendors.find(v => v.id === vendorId)?.name;
                if (vendorName) uniqueVendors.add(vendorName);

                const itemDetails = Object.entries(conf.items || {}).map(([id, qty]) => {
                    const item = menuItems.find(i => i.id === id);
                    return item ? `${item.name} x${qty}` : null;
                }).filter(Boolean);
                allItems.push(...(itemDetails as string[]));
            }

            const vendorsStr = Array.from(uniqueVendors).join(', ');
            const itemsStr = allItems.join(', ');

            content = `: ${vendorsStr} ${itemsStr ? `(${itemsStr})` : ''}`;
        }

        return `${st}${content}`;
    }

    function getMealOrderSummaryText(client: ClientProfile): string {
        const selections = client.mealOrder?.mealSelections || client.activeOrder?.mealSelections;
        if (!selections) return '';

        const mealTypes = Object.keys(selections);
        const hasItems = mealTypes.some(type => {
            const items = selections[type]?.items || {};
            return Object.values(items).some((qty: any) => Number(qty) > 0);
        });

        if (mealTypes.length === 0 || !hasItems) return '';

        const parts: string[] = [];
        mealTypes.forEach(type => {
            const data = selections[type];
            const items = data?.items || {};
            const itemEntries = Object.entries(items).filter(([_, qty]) => Number(qty) > 0);

            if (itemEntries.length === 0) return;

            const vendorName = data.vendorId ? vendors.find(v => v.id === data.vendorId)?.name : 'Not Set';

            const itemDetails = itemEntries.map(([id, qty]) => {
                const item = menuItems.find(i => i.id === id) || (mealItems as any[]).find((i: any) => i.id === id);
                return item ? `${item.name} (${qty})` : null;
            }).filter(Boolean).join(', ');

            if (itemDetails) {
                parts.push(`${type}: ${vendorName} - ${itemDetails}`);
            }
        });

        return parts.join('; ');
    }

    function getMealOrderSummaryJSX(client: ClientProfile) {
        // Fallback to activeOrder if mealOrder not present (legacy support / hybrid state)
        const selections = client.mealOrder?.mealSelections || client.activeOrder?.mealSelections;

        if (!selections) {
            return (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border-color)' }}>
                    <strong style={{ fontWeight: 600 }}>Meal</strong> - <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No meals selected</span>
                </div>
            );
        }

        const mealTypes = Object.keys(selections).sort();

        // Check if there are any actual items selected
        const hasItems = mealTypes.some(type => {
            const items = selections[type]?.items || {};
            return Object.values(items).some((qty: any) => Number(qty) > 0);
        });

        if (mealTypes.length === 0 || !hasItems) {
            return (
                <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border-color)' }}>
                    <strong style={{ fontWeight: 600 }}>Meal</strong> - <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No meals selected</span>
                </div>
            );
        }

        return (
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--border-color)' }}>
                {mealTypes.map(type => {
                    const data = selections[type];
                    const items = data?.items || {};
                    const itemEntries = Object.entries(items).filter(([_, qty]) => Number(qty) > 0);

                    if (itemEntries.length === 0) return null;

                    const vendorName = data.vendorId ? vendors.find(v => v.id === data.vendorId)?.name : 'Not Set';

                    const itemDetails = itemEntries.map(([id, qty]) => {
                        const item = menuItems.find(i => i.id === id) || mealItems.find(i => i.id === id);
                        return item ? `${item.name} x${qty}` : `Item #${id.slice(0, 8)} x${qty}`;
                    }).join(', ');

                    return (
                        <div key={type} style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '8px' }}>
                            <div>
                                <strong style={{ fontWeight: 600 }}>Meal</strong> - <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{type}:</span>
                            </div>
                            <div style={{ marginLeft: '0' }}>
                                <span style={{ fontWeight: 500 }}>Vendor: {vendorName}</span>
                                <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginLeft: '0' }}>
                                    {itemDetails}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    }

    function getOrderSummary(client: ClientProfile, forceDetails: boolean = false) {
        if (!client.activeOrder) return <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No active order</span>;

        const conf = client.activeOrder;
        const st = conf.serviceType || client.serviceType;

        // If we are just showing the simple list table cell (forceDetails=false)
        if (!showOrderDetails && !forceDetails) {
            // ... existing logic for table cell summary ...
            // For now, let's just keep the string logic for the table cell if needed, 
            // BUT forceDetails=true is passed for the ClientInfoShelf.
            // The table usually uses this function too? 
            // Let's check usage. The table usage likely doesn't pass true.
            // If !forceDetails, return the string summary we had before or a simple ReactNode.

            let label: string = st;
            const vendorSummaries: React.ReactNode[] = [];

            if (st === 'Food') {
                const uniqueVendors = new Set<string>();
                const isMultiDay = conf.deliveryDayOrders && typeof conf.deliveryDayOrders === 'object';
                if (isMultiDay) {
                    Object.values(conf.deliveryDayOrders || {}).forEach((dayOrder: any) => {
                        if (dayOrder?.vendorSelections) {
                            dayOrder.vendorSelections.forEach((v: any) => {
                                const vName = vendors.find(ven => ven.id === v.vendorId)?.name;
                                if (vName) uniqueVendors.add(vName);
                            });
                        }
                    });
                } else if (conf.vendorSelections) {
                    conf.vendorSelections.forEach(v => {
                        const vName = vendors.find(ven => ven.id === v.vendorId)?.name;
                        if (vName) uniqueVendors.add(vName);
                    });
                }
                if (uniqueVendors.size > 0) {
                    uniqueVendors.forEach(v => vendorSummaries.push(v));
                }
            } else if (st === 'Boxes') {
                const uniqueVendors = new Set<string>();
                const boxOrders = conf.boxOrders || [];

                if (boxOrders.length > 0) {
                    boxOrders.forEach((box: any) => {
                        const boxDef = boxTypes.find(b => b.id === box.boxTypeId);
                        const vId = box.vendorId || boxDef?.vendorId;
                        if (vId) {
                            const vName = vendors.find(v => v.id === vId)?.name;
                            if (vName) uniqueVendors.add(vName);
                        }
                    });
                } else {
                    // Fallback for legacy format
                    let computedVendorId = conf.vendorId;
                    if (!computedVendorId && !conf.boxTypeId && typeof conf === 'object') {
                        const possibleDayKeys = Object.keys(conf).filter(k => k !== 'id' && k !== 'serviceType' && k !== 'caseId' && typeof (conf as any)[k] === 'object' && (conf as any)[k]?.vendorId);
                        if (possibleDayKeys.length > 0) computedVendorId = (conf as any)[possibleDayKeys[0]].vendorId;
                    }
                    const box = boxTypes.find(b => b.id === conf.boxTypeId);
                    const vendorId = computedVendorId || box?.vendorId;
                    if (vendorId) {
                        const vName = vendors.find(v => v.id === vendorId)?.name;
                        if (vName) uniqueVendors.add(vName);
                    }
                }

                if (uniqueVendors.size > 0) {
                    uniqueVendors.forEach(v => vendorSummaries.push(v));
                }
            } else if (st === 'Custom') {
                const vId = conf.vendorId;
                const vName = vendors.find(v => v.id === vId)?.name;
                if (vName) vendorSummaries.push(vName);
            }
            return (
                <div style={{ fontSize: '0.85rem' }}>
                    <span className={`badge ${st === 'Boxes' ? 'badge-blue' : st === 'Custom' ? 'badge-purple' : 'badge-green'}`} style={{ marginRight: '6px' }}>{st}</span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                        {vendorSummaries.length > 0 ? vendorSummaries.join(', ') : 'No Vendor'}
                    </span>
                </div>
            );
        }

        // Full Details for ClientInfoShelf (forceDetails=true)
        const itemsList: { name: string; quantity: number }[] = [];
        let vendorName = '';

        if (st === 'Food') {
            // Collect all items from all vendors/days
            const isMultiDay = conf.deliveryDayOrders && typeof conf.deliveryDayOrders === 'object';

            // Helper to process selections
            const processSelections = (selections: any[]) => {
                selections.forEach(sel => {
                    const vName = vendors.find(v => v.id === sel.vendorId)?.name;
                    if (vName && !vendorName.includes(vName)) {
                        vendorName = vendorName ? `${vendorName}, ${vName}` : vName;
                    }
                    if (sel.items) {
                        Object.entries(sel.items).forEach(([itemId, qty]) => {
                            const q = Number(qty);
                            if (q > 0) {
                                const item = menuItems.find(i => i.id === itemId);
                                if (item) {
                                    // Check if already in list (aggregate?) - Usually we want row per item per vendor, but here simple list
                                    const existing = itemsList.find(i => i.name === item.name);
                                    if (existing) existing.quantity += q;
                                    else itemsList.push({ name: item.name, quantity: q });
                                }
                            }
                        });
                    }
                });
            };

            if (isMultiDay) {
                Object.values(conf.deliveryDayOrders || {}).forEach((dayOrder: any) => {
                    if (dayOrder?.vendorSelections) processSelections(dayOrder.vendorSelections);
                });
            } else if (conf.vendorSelections) {
                processSelections(conf.vendorSelections);
            }

            // Add Meal Items
            const mealSelections = client.mealOrder?.mealSelections || client.activeOrder?.mealSelections;
            if (mealSelections) {
                Object.keys(mealSelections).forEach(type => {
                    const sel = mealSelections[type];
                    if (sel.items) {
                        Object.entries(sel.items).forEach(([itemId, qty]) => {
                            const q = Number(qty);
                            if (q > 0) {
                                // Try to find in menu items or meal items (though meal items usually separate)
                                const item = menuItems.find(i => i.id === itemId) || mealItems.find(i => i.id === itemId);
                                if (item) {
                                    const existing = itemsList.find(i => i.name === item.name);
                                    if (existing) existing.quantity += q;
                                    else itemsList.push({ name: item.name, quantity: q });
                                } else {
                                    // Fallback for ID if not found
                                    itemsList.push({ name: `Item #${itemId.slice(0, 5)}`, quantity: q });
                                }
                            }
                        });
                    }
                });
            }

        } else if (st === 'Boxes') {
            // Boxes Logic
            const boxOrders = conf.boxOrders || [];
            const uniqueVendors = new Set<string>();

            if (boxOrders.length > 0) {
                boxOrders.forEach((box: any) => {
                    const boxDef = boxTypes.find(b => b.id === box.boxTypeId);
                    const vId = box.vendorId || boxDef?.vendorId;
                    if (vId) {
                        const vName = vendors.find(v => v.id === vId)?.name;
                        if (vName) uniqueVendors.add(vName);
                    }

                    if (box.items) {
                        Object.entries(box.items).forEach(([itemId, qty]) => {
                            const q = Number(qty);
                            if (q > 0) {
                                const item = menuItems.find(i => i.id === itemId);
                                if (item) {
                                    const existing = itemsList.find(i => i.name === item.name);
                                    if (existing) existing.quantity += q;
                                    else itemsList.push({ name: item.name, quantity: q });
                                }
                            }
                        });
                    }
                });
                vendorName = Array.from(uniqueVendors).join(', ') || 'No Vendor';
            } else {
                // Legacy Fallback
                let computedVendorId = conf.vendorId;
                if (!computedVendorId && !conf.boxTypeId && typeof conf === 'object') {
                    const possibleDayKeys = Object.keys(conf).filter(k => k !== 'id' && k !== 'serviceType' && k !== 'caseId' && typeof (conf as any)[k] === 'object' && (conf as any)[k]?.vendorId);
                    if (possibleDayKeys.length > 0) computedVendorId = (conf as any)[possibleDayKeys[0]].vendorId;
                }
                const box = boxTypes.find(b => b.id === conf.boxTypeId);
                const vId = computedVendorId || box?.vendorId;
                vendorName = vendors.find(v => v.id === vId)?.name || 'No Vendor';

                if (conf.items) {
                    Object.entries(conf.items).forEach(([itemId, qty]) => {
                        const q = Number(qty);
                        if (q > 0) {
                            const item = menuItems.find(i => i.id === itemId);
                            if (item) itemsList.push({ name: item.name, quantity: q });
                        }
                    });
                }
            }
        } else if (st === 'Custom') {
            // Custom Order Logic
            const vId = conf.vendorId;
            vendorName = vendors.find(v => v.id === vId)?.name || 'No Vendor';

            const desc = conf.custom_name || 'Custom Item';
            const price = conf.custom_price || 0;

            itemsList.push({
                name: `${desc} ($${Number(price).toFixed(2)})`,
                quantity: 1
            });
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {st} - <span style={{ fontWeight: 500 }}>{vendorName || 'Vendor Not Set'}</span>
                </div>
                {itemsList.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {itemsList.map((item, idx) => (
                            <div key={idx} style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
                                <span style={{ fontWeight: 600 }}>{item.quantity}</span> * {item.name}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>No items selected</div>
                )}

                {/* 
                   For Meal specific detailed display, we could reuse getMealOrderSummaryJSX logic 
                   but we just aggregated everything above for a cleaner list as requested.
                   "2 * Challah"
                  */}
            </div>
        );
    }


    function getScreeningStatus(client: ClientProfile) {
        const status = client.screeningStatus || 'not_started';

        const statusConfig = {
            not_started: {
                label: 'Not Started',
                color: 'var(--text-tertiary)',
                bgColor: 'var(--bg-surface-hover)',
                icon: <Square size={14} />
            },
            waiting_approval: {
                label: 'Pending',
                color: '#eab308',
                bgColor: 'rgba(234, 179, 8, 0.1)',
                icon: <CheckSquare size={14} />
            },
            approved: {
                label: 'Approved',
                color: 'var(--color-success)',
                bgColor: 'rgba(34, 197, 94, 0.1)',
                icon: <CheckSquare size={14} />
            },
            rejected: {
                label: 'Rejected',
                color: 'var(--color-danger)',
                bgColor: 'rgba(239, 68, 68, 0.1)',
                icon: <Square size={14} />
            }
        };

        const config = statusConfig[status];

        return (
            <span
                title={`Screening Status: ${config.label}`}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    color: config.color,
                    backgroundColor: config.bgColor,
                    whiteSpace: 'nowrap'
                }}
            >
                {config.icon}
                {config.label}
            </span>
        );
    }

    function getNeedsAttentionReason(client: ClientProfile): string {
        const reasons: string[] = [];
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        // 1. Check if client with boxes doesn't have vendor assigned
        if (client.serviceType === 'Boxes') {
            // Check actual box orders from client_box_orders table
            const clientDetails = detailsCache[client.id];

            // Only check if we have cached details (to avoid false positives)
            if (clientDetails) {
                const boxOrders = clientDetails.boxOrders || [];

                if (boxOrders.length === 0) {
                    // No box orders means needs vendor
                    reasons.push('Boxes: No vendor assigned');
                } else {
                    // Check if any box order is missing a vendor
                    const hasMissingVendor = boxOrders.some(boxOrder => {
                        // Check vendorId on the box order itself, or fall back to box type's vendor
                        if (boxOrder.vendorId) {
                            return false; // Has vendor
                        }
                        // Fall back to box type's vendor if box order doesn't have one
                        const box = boxTypes.find(b => b.id === boxOrder.boxTypeId);
                        return !box?.vendorId; // Missing vendor if box type also doesn't have one
                    });

                    if (hasMissingVendor) {
                        reasons.push('Boxes: No vendor assigned');
                    }
                }
            }
            // If cache entry doesn't exist, we can't determine vendor status, so skip this check
        }

        // 2. Check if expiration date is within current month
        if (client.expirationDate) {
            const expDate = new Date(client.expirationDate);
            if (expDate >= firstDayOfMonth && expDate <= lastDayOfMonth) {
                reasons.push('Expiration date this month');
            }
        }

        // 3. Check if boxes client has authorized amount < 584 or is null/undefined
        if (client.serviceType === 'Boxes') {
            if (client.authorizedAmount === null || client.authorizedAmount === undefined) {
                reasons.push('Boxes: No authorized amount');
            } else if (client.authorizedAmount < 584) {
                reasons.push(`Boxes: Auth amount $${client.authorizedAmount} < $584`);
            }
        }

        // 4. Check if food client has authorized amount < 1344 or is null/undefined
        if (client.serviceType === 'Food') {
            if (client.authorizedAmount === null || client.authorizedAmount === undefined) {
                reasons.push('Food: No authorized amount');
            } else if (client.authorizedAmount < 1344) {
                reasons.push(`Food: Auth amount $${client.authorizedAmount} < $1344`);
            }
        }

        // 5. Check if meal orders exist but no vendor is assigned
        const mealSelections = client.mealOrder?.mealSelections || client.activeOrder?.mealSelections;
        if (mealSelections) {
            const mealTypes = Object.keys(mealSelections);
            if (mealTypes.length > 0) {
                const missingVendorMeals = mealTypes.filter(type => !mealSelections[type].vendorId);
                if (missingVendorMeals.length > 0) {
                    reasons.push(`Meal: No vendor assigned (${missingVendorMeals.join(', ')})`);
                }
            }
        }

        // 6. Check if any box order (regardless of service type) has no vendor attached
        // Check both activeOrder and detailsCache for box orders
        const activeBoxOrders = client.activeOrder?.boxOrders || [];
        const clientDetails = detailsCache[client.id];
        const cachedBoxOrders = clientDetails?.boxOrders || [];
        // Combine both sources, prioritizing activeOrder
        const allBoxOrders = activeBoxOrders.length > 0 ? activeBoxOrders : cachedBoxOrders;

        if (allBoxOrders.length > 0) {
            const boxOrdersWithoutVendor = allBoxOrders.filter(boxOrder => {
                // Check vendorId on the box order itself, or fall back to box type's vendor
                if (boxOrder.vendorId) {
                    return false; // Has vendor
                }
                // Fall back to box type's vendor if box order doesn't have one
                const box = boxTypes.find(b => b.id === boxOrder.boxTypeId);
                return !box?.vendorId; // Missing vendor if box type also doesn't have one
            });

            if (boxOrdersWithoutVendor.length > 0) {
                reasons.push('Box order: No vendor attached');
            }
        }

        return reasons.length > 0 ? reasons.join(', ') : 'No reason specified';
    }

    // Get available reasons for filter
    const availableReasons = Array.from(new Set(
        clients
            .filter(c => {
                // Re-apply specific needs-attention logic to get the base set of clients
                // This is a bit duplicative but ensures we get all reasons even when other filters are active
                // However, usually filters should narrow down options. 
                // Let's stick to showing ALL reasons present in the "needs-attention" view (ignoring other filters for the list generation if possible, 
                // but for simplicity and standard UI patterns, usually facets update based on current view.
                // The user request said: "generate it from all of the reasons that are currently available"
                // which implies looking at the *current data*.
                // To be safe and helpful, we'll calculate it from the clients that MATCH the 'needs-attention' view criteria
                // regardless of the search/status filters, so users can see what's possible.

                // Matches View Logic (Needs Attention)
                let matchesView = false;
                const status = statuses.find(s => s.id === c.statusId);
                const isEligible = status ? status.deliveriesAllowed : false;

                if (isEligible) {
                    const boxNeedsVendor = c.serviceType === 'Boxes' && (!c.activeOrder || (c.activeOrder.serviceType === 'Boxes' && !c.activeOrder.vendorId && !boxTypes.find(bt => bt.id === c.activeOrder?.boxTypeId)?.vendorId));
                    // ... (rest of logic) ...
                    // To avoid duplicating ALL the complex logic above, let's assume if it produces a reason string != "No reason specified"
                    // AND it is eligible, it's in the list.
                    // Actually, 'getNeedsAttentionReason' handles the reason generation.
                    // The view logic also checks eligibility.

                    // Basic eligibility check reused
                    // We can just rely on 'getNeedsAttentionReason' returning something meaningful?
                    // No, because getNeedsAttentionReason calculates reasons for ANY client.
                    // The view only shows ELIGIBLE clients.
                    return isEligible;
                }
                return false;
            })
            .flatMap(c => {
                const r = getNeedsAttentionReason(c);
                if (r === 'No reason specified') return [];
                return r.split(', ');
            })
    )).sort();

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

    return (
        <div className={styles.container} style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            <div className={styles.header}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h1 className="title">Clients</h1>
                        {(isRefreshing || backgroundTasks.size > 0) && (
                            <div className={styles.refreshIndicator} style={{ color: 'var(--primary)', backgroundColor: 'var(--primary-light)' }}>
                                <Loader2 size={14} className="animate-spin" />
                                <span>Saving {Array.from(backgroundTasks.values())[0]}{backgroundTasks.size > 1 ? ` (+${backgroundTasks.size - 1} others)` : ''}...</span>
                            </div>
                        )}
                        {!isRefreshing && backgroundTasks.size === 0 && successMessage && (
                            <div className={styles.refreshIndicator} style={{ color: 'var(--success)', backgroundColor: 'var(--success-light)', border: '1px solid var(--success)' }}>
                                <CheckSquare size={14} />
                                <span>{successMessage}</span>
                            </div>
                        )}
                    </div>
                    <p className="text-secondary">Showing {filteredClients.length} of {clients.length} clients{!showDependents ? ' (Dependents Hidden)' : ''}</p>
                </div>

                <div className={styles.headerActions}>
                    <div className={styles.viewToggle}>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'all' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('all')}
                        >
                            All Clients
                        </button>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'eligible' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('eligible')}
                        >
                            Eligible
                        </button>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'ineligible' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('ineligible')}
                        >
                            Ineligible
                        </button>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'needs-attention' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('needs-attention')}
                        >
                            Needs Attention
                        </button>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'billing' ? styles.viewBtnActive : ''}`}
                            onClick={() => router.push('/billing')}
                        >
                            Billing
                        </button>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/orders')}
                        >
                            Orders
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.filters} style={{ marginTop: '12px' }}>
                <button
                    className={`btn ${showDependents ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setShowDependents(!showDependents)}
                    style={{ fontSize: '0.9rem' }}
                >
                    {showDependents ? <Eye size={16} /> : <EyeOff size={16} />} {showDependents ? 'Hide' : 'Show'} Dependents
                </button>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className="input"
                        placeholder="Search clients..."
                        style={{ paddingLeft: '2.5rem', paddingRight: search ? '2rem' : '0.75rem', width: '300px' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    {search && (
                        <button
                            className={styles.clearButton}
                            onClick={() => setSearch('')}
                            aria-label="Clear search"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>

                <div style={{ marginLeft: '8px' }}>
                    <button
                        className={`btn ${includeOrderDetails ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => setIncludeOrderDetails(!includeOrderDetails)}
                        style={{ fontSize: '0.9rem', height: '38px', display: 'flex', alignItems: 'center', gap: '6px' }}
                        title="Search within order summaries (items and vendors)"
                    >
                        {includeOrderDetails ? <CheckSquare size={16} /> : <Square size={16} />}
                        Include Order Details
                    </button>
                </div>



                {/* Clear All Filters Button */}
                <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
                    <button
                        className="btn btn-secondary"
                        onClick={refreshDataInBackground}
                        disabled={isRefreshing || isLoading}
                        title="Refresh List"
                    >
                        <RefreshCcw size={16} className={isRefreshing || isLoading ? "animate-spin" : ""} />
                    </button>
                    <button className="btn btn-primary" onClick={handleCreate}>
                        <Plus size={16} /> New Client
                    </button>
                    <button className="btn btn-secondary" onClick={() => setIsAddingDependent(true)}>
                        <Plus size={16} /> Add Dependent
                    </button>
                </div>
                {(statusFilter || navigatorFilter || screeningFilter || serviceTypeFilter || needsVendorFilter) && (
                    <button
                        className="btn btn-secondary"
                        onClick={() => {
                            setStatusFilter(null);
                            setNavigatorFilter(null);
                            setScreeningFilter(null);
                            setServiceTypeFilter(null);
                            setNeedsVendorFilter(false);
                            setReasonFilter(null);
                        }}
                    >
                        <X size={16} /> Clear Filters
                    </button>
                )}

                {/* Filter Buttons ... can stay or be part of this sticky block? user said "header". Filters are usually part of header controls. */}
                {/* The user said "the whole top of the page will still remain". This implies filters too. */}

            </div>




            {
                isAddingDependent && (
                    <div className={styles.createModal}>
                        <div className={styles.createCard} style={{ width: '500px' }}>
                            <h3>{editingDependentId ? 'Edit Dependent' : 'Add Dependent'}</h3>
                            <div className={styles.formGroup}>
                                <label className="label">Dependent Name</label>
                                <input
                                    className="input"
                                    placeholder="Full Name"
                                    value={dependentName}
                                    onChange={e => setDependentName(e.target.value)}
                                    autoFocus
                                />
                            </div>
                            <div className={styles.formGroup}>
                                <label className="label">Date of Birth</label>
                                <input
                                    type="date"
                                    className="input"
                                    value={dependentDob}
                                    onChange={e => setDependentDob(e.target.value)}
                                />
                            </div>
                            <div className={styles.formGroup}>
                                <label className="label">CIN#</label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="CIN Number"
                                    value={dependentCin}
                                    onChange={e => setDependentCin(e.target.value)}
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
                                            filteredRegularClients.map(client => (
                                                <div
                                                    key={client.id}
                                                    onClick={() => {
                                                        setSelectedParentClientId(client.id);
                                                        setParentClientSearch(client.fullName);
                                                    }}
                                                    style={{
                                                        padding: '0.75rem',
                                                        cursor: 'pointer',
                                                        backgroundColor: selectedParentClientId === client.id ? 'var(--bg-surface-hover)' : 'transparent',
                                                        borderBottom: '1px solid var(--border-color)',
                                                        transition: 'background-color 0.2s'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        if (selectedParentClientId !== client.id) {
                                                            e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                                        }
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        if (selectedParentClientId !== client.id) {
                                                            e.currentTarget.style.backgroundColor = 'transparent';
                                                        }
                                                    }}
                                                >
                                                    {client.fullName}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className={styles.modalActions}>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleAddDependent}
                                    disabled={!dependentName.trim() || !selectedParentClientId}
                                >
                                    {editingDependentId ? 'Save Changes' : 'Create Dependent'}
                                </button>
                                <button className="btn btn-secondary" onClick={() => {
                                    setIsAddingDependent(false);
                                    setDependentName('');
                                    setDependentDob('');
                                    setDependentCin('');
                                    setSelectedParentClientId('');
                                    setParentClientSearch('');
                                    setEditingDependentId(null);
                                }}>Cancel</button>
                            </div>
                        </div>
                        <div className={styles.overlay} onClick={() => {
                            setIsAddingDependent(false);
                            setDependentName('');
                            setDependentDob('');
                            setDependentCin('');
                            setSelectedParentClientId('');
                            setParentClientSearch('');
                            setEditingDependentId(null);
                        }}></div>
                    </div>
                )
            }

            <div className={styles.list} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <div className={styles.listHeader}>
                    <span style={{ minWidth: '60px', flex: 0.3, paddingRight: '16px', display: 'flex', alignItems: 'center' }}>
                        #
                    </span>
                    <span style={{ minWidth: '200px', flex: 2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleSort('name')}>
                        Name {getSortIcon('name')}
                    </span>

                    {/* Status column with filter */}
                    <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }} data-filter-dropdown>
                        <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('status')}>
                            Status {getSortIcon('status')}
                        </span>
                        <Filter
                            size={14}
                            style={{ cursor: 'pointer', opacity: statusFilter ? 1 : 0.5, color: statusFilter ? 'var(--color-primary)' : 'inherit', filter: statusFilter ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                            onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'status' ? null : 'status'); }}
                        />
                        {openFilterMenu === 'status' && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                zIndex: 1000, minWidth: '200px', maxHeight: '300px', overflowY: 'auto'
                            }}>
                                <div onClick={() => { setStatusFilter(null); setOpenFilterMenu(null); }}
                                    style={{
                                        padding: '8px 12px', cursor: 'pointer',
                                        backgroundColor: !statusFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                        fontWeight: !statusFilter ? 600 : 400
                                    }}>
                                    All Statuses
                                </div>
                                {statuses.map(status => (
                                    <div key={status.id}
                                        onClick={() => { setStatusFilter(status.id); setOpenFilterMenu(null); }}
                                        style={{
                                            padding: '8px 12px', cursor: 'pointer',
                                            backgroundColor: statusFilter === status.id ? 'var(--bg-surface-hover)' : 'transparent',
                                            fontWeight: statusFilter === status.id ? 600 : 400
                                        }}>
                                        {status.name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </span>

                    {currentView !== 'needs-attention' && (
                        <>
                            {/* Navigator column with filter */}
                            <span style={{ minWidth: '160px', flex: 1, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }} data-filter-dropdown>
                                <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('navigator')}>
                                    Navigator {getSortIcon('navigator')}
                                </span>
                                <Filter
                                    size={14}
                                    style={{ cursor: 'pointer', opacity: navigatorFilter ? 1 : 0.5, color: navigatorFilter ? 'var(--color-primary)' : 'inherit', filter: navigatorFilter ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                                    onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'navigator' ? null : 'navigator'); }}
                                />
                                {openFilterMenu === 'navigator' && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                        zIndex: 1000, minWidth: '200px', maxHeight: '300px', overflowY: 'auto'
                                    }}>
                                        <div onClick={() => { setNavigatorFilter(null); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: !navigatorFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: !navigatorFilter ? 600 : 400
                                            }}>
                                            All Navigators
                                        </div>
                                        {navigators.map(navigator => (
                                            <div key={navigator.id}
                                                onClick={() => { setNavigatorFilter(navigator.id); setOpenFilterMenu(null); }}
                                                style={{
                                                    padding: '8px 12px', cursor: 'pointer',
                                                    backgroundColor: navigatorFilter === navigator.id ? 'var(--bg-surface-hover)' : 'transparent',
                                                    fontWeight: navigatorFilter === navigator.id ? 600 : 400
                                                }}>
                                                {navigator.name}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </span>

                            {/* Screening column with filter */}
                            <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }} data-filter-dropdown>
                                <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('screening')}>
                                    Screening {getSortIcon('screening')}
                                </span>
                                <Filter
                                    size={14}
                                    style={{ cursor: 'pointer', opacity: screeningFilter ? 1 : 0.5, color: screeningFilter ? 'var(--color-primary)' : 'inherit', filter: screeningFilter ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                                    onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'screening' ? null : 'screening'); }}
                                />
                                {openFilterMenu === 'screening' && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                        zIndex: 1000, minWidth: '200px'
                                    }}>
                                        <div onClick={() => { setScreeningFilter(null); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: !screeningFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: !screeningFilter ? 600 : 400
                                            }}>
                                            All Statuses
                                        </div>
                                        {['not_started', 'waiting_approval', 'approved', 'rejected'].map(status => (
                                            <div key={status}
                                                onClick={() => { setScreeningFilter(status); setOpenFilterMenu(null); }}
                                                style={{
                                                    padding: '8px 12px', cursor: 'pointer',
                                                    backgroundColor: screeningFilter === status ? 'var(--bg-surface-hover)' : 'transparent',
                                                    fontWeight: screeningFilter === status ? 600 : 400
                                                }}>
                                                {getScreeningStatusLabel(status)}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </span>

                            {/* Active Order column with filter */}
                            <span style={{ minWidth: '350px', flex: 3, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }} data-filter-dropdown>
                                Active Order
                                <span
                                    onClick={(e) => { e.stopPropagation(); setShowOrderDetails(!showOrderDetails); }}
                                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}
                                    title={showOrderDetails ? "Hide Details" : "Show Details"}
                                >
                                    {showOrderDetails ? <EyeOff size={14} /> : <Eye size={14} />}
                                </span>
                                <Filter
                                    size={14}
                                    style={{ cursor: 'pointer', opacity: (serviceTypeFilter || needsVendorFilter) ? 1 : 0.5, color: (serviceTypeFilter || needsVendorFilter) ? 'var(--color-primary)' : 'inherit', filter: (serviceTypeFilter || needsVendorFilter) ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                                    onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'serviceType' ? null : 'serviceType'); }}
                                />
                                {openFilterMenu === 'serviceType' && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                        zIndex: 1000, minWidth: '200px'
                                    }}>
                                        <div onClick={() => { setServiceTypeFilter(null); setNeedsVendorFilter(false); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: !serviceTypeFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: !serviceTypeFilter ? 600 : 400
                                            }}>
                                            All Types
                                        </div>
                                        <div onClick={() => { setServiceTypeFilter('Food'); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: serviceTypeFilter === 'Food' ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: serviceTypeFilter === 'Food' ? 600 : 400
                                            }}>
                                            Food
                                        </div>
                                        <div onClick={() => { setServiceTypeFilter('Boxes'); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: serviceTypeFilter === 'Boxes' ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: serviceTypeFilter === 'Boxes' ? 600 : 400
                                            }}>
                                            Boxes
                                        </div>
                                        <div onClick={() => { setServiceTypeFilter('Custom'); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: serviceTypeFilter === 'Custom' ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: serviceTypeFilter === 'Custom' ? 600 : 400
                                            }}>
                                            Custom
                                        </div>
                                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }}></div>
                                        <div onClick={() => { setNeedsVendorFilter(!needsVendorFilter); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: needsVendorFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: needsVendorFilter ? 600 : 400,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                            <AlertCircle size={14} />
                                            Needs Vendor Assignment
                                        </div>
                                    </div>
                                )}
                            </span>
                        </>
                    )}

                    {currentView === 'needs-attention' ? (
                        <>
                            <span style={{ minWidth: '400px', flex: 4, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                Reason
                            </span>
                            <span style={{ minWidth: '400px', flex: 4, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }} data-filter-dropdown>
                                Reason
                                <Filter
                                    size={14}
                                    style={{ cursor: 'pointer', opacity: reasonFilter ? 1 : 0.5, color: reasonFilter ? 'var(--color-primary)' : 'inherit', filter: reasonFilter ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                                    onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'reason' ? null : 'reason'); }}
                                />
                                {openFilterMenu === 'reason' && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                        zIndex: 1000, minWidth: '250px', maxHeight: '300px', overflowY: 'auto'
                                    }}>
                                        <div onClick={() => { setReasonFilter(null); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: !reasonFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: !reasonFilter ? 600 : 400
                                            }}>
                                            All Reasons
                                        </div>
                                        {availableReasons.map(reason => (
                                            <div key={reason}
                                                onClick={() => { setReasonFilter(reason); setOpenFilterMenu(null); }}
                                                style={{
                                                    padding: '8px 12px', cursor: 'pointer',
                                                    backgroundColor: reasonFilter === reason ? 'var(--bg-surface-hover)' : 'transparent',
                                                    fontWeight: reasonFilter === reason ? 600 : 400,
                                                    whiteSpace: 'normal',
                                                    lineHeight: '1.4'
                                                }}>
                                                {reason}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </span>
                            <span style={{ minWidth: '150px', flex: 1.2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('authorizedAmount')}>
                                Authorized Amount {getSortIcon('authorizedAmount')}
                            </span>
                            <span style={{ minWidth: '150px', flex: 1.2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('expirationDate')}>
                                Expiration Date {getSortIcon('expirationDate')}
                            </span>
                        </>
                    ) : (
                        <>
                            <span style={{ minWidth: '180px', flex: 1.2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('email')}>
                                Email {getSortIcon('email')}
                            </span>
                            <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('phone')}>
                                Phone {getSortIcon('phone')}
                            </span>
                            <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('secondaryPhone')}>
                                Secondary Phone {getSortIcon('secondaryPhone')}
                            </span>
                            <span style={{ minWidth: '250px', flex: 2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('address')}>
                                Address {getSortIcon('address')}
                            </span>
                            <span style={{ minWidth: '200px', flex: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('notes')}>
                                Notes {getSortIcon('notes')}
                            </span>
                        </>
                    )}
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredClients.map((client, index) => {
                    const status = statuses.find(s => s.id === client.statusId);
                    const isNotAllowed = status ? status.deliveriesAllowed === false : false;
                    const isDependent = !!client.parentClientId;

                    return (
                        <div
                            key={client.id}
                            onClick={() => {
                                if (isDependent) {
                                    setEditingDependentId(client.id);
                                    setDependentName(client.fullName);
                                    setDependentDob(client.dob || '');
                                    setDependentCin(client.cin?.toString() || '');
                                    setSelectedParentClientId(client.parentClientId || '');
                                    const parentClient = allClientsForLookup.find(c => c.id === client.parentClientId);
                                    if (parentClient) {
                                        setParentClientSearch(parentClient.fullName);
                                    }
                                    setIsAddingDependent(true);
                                } else {
                                    // Open the info shelf instead of the full profile directly
                                    setInfoShelfClientId(client.id);
                                    prefetchClient(client.id);
                                }
                            }}
                            className={`${styles.clientRow} ${isDependent ? styles.clientRowDependent : ''}`}
                            style={{ cursor: 'pointer' }}
                        >
                            <span style={{ minWidth: '60px', flex: 0.3, paddingRight: '16px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                {index + 1}
                            </span>
                            <span title={client.fullName} style={{ minWidth: '200px', flex: 2, fontWeight: 600, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {isNotAllowed && <span className={styles.redTab}></span>}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{client.fullName}</span>
                            </span>
                            <span title={client.parentClientId ? `Parent: ${getParentClientName(client)}` : getStatusName(client.statusId)} style={{ minWidth: '140px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {client.parentClientId ? (
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                        Parent: {getParentClientName(client)}
                                    </span>
                                ) : (
                                    <span className={`badge ${getStatusName(client.statusId) === 'Active' ? 'badge-success' : ''}`}>
                                        {getStatusName(client.statusId)}
                                    </span>
                                )}
                            </span>
                            {currentView !== 'needs-attention' && (
                                <>
                                    <span title={isDependent ? '' : getNavigatorName(client.navigatorId)} style={{ minWidth: '160px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{isDependent ? '-' : getNavigatorName(client.navigatorId)}</span>
                                    <span style={{ minWidth: '140px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{isDependent ? '-' : getScreeningStatus(client)}</span>
                                    <span style={{ minWidth: '350px', flex: 3, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : getOrderSummary(client)}
                                    </span>
                                </>
                            )}
                            {currentView === 'needs-attention' ? (
                                <>
                                    <span title={getNeedsAttentionReason(client)} style={{ minWidth: '400px', flex: 4, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {getNeedsAttentionReason(client)}
                                    </span>
                                    <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {client.authorizedAmount !== null && client.authorizedAmount !== undefined
                                            ? `$${client.authorizedAmount.toFixed(2)}`
                                            : '-'}
                                    </span>
                                    <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {client.expirationDate
                                            ? new Date(client.expirationDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
                                            : '-'}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span title={isDependent ? undefined : (client.email || undefined)} style={{ minWidth: '180px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : (client.email || '-')}
                                    </span>
                                    <span title={isDependent ? undefined : client.phoneNumber} style={{ minWidth: '140px', flex: 1, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : (client.phoneNumber || '-')}
                                    </span>
                                    <span title={isDependent ? undefined : (client.secondaryPhoneNumber || undefined)} style={{ minWidth: '140px', flex: 1, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : (client.secondaryPhoneNumber || '-')}
                                    </span>
                                    <span title={isDependent ? undefined : client.address} style={{ minWidth: '250px', flex: 2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : (client.address || '-')}
                                    </span>
                                    <span title={isDependent ? undefined : client.notes} style={{ minWidth: '200px', flex: 2, fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : (client.notes || '-')}
                                    </span>
                                </>
                            )}
                            <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                        </div>
                    );
                })}
                {/* Loading State in List Area */}
                {isLoading && clients.length === 0 && (
                    <div className={styles.loadingContainer} style={{ padding: '2rem' }}>
                        <div className="spinner"></div>
                        <p>Loading clients...</p>
                    </div>
                )}

                {filteredClients.length === 0 && !isLoading && (
                    <div className={styles.empty}>
                        {needsVendorFilter ? 'No clients with box orders needing vendor assignment.' :
                            currentView === 'ineligible' ? 'No ineligible clients found.' :
                                currentView === 'eligible' ? 'No eligible clients found.' :
                                    currentView === 'needs-attention' ? 'No clients need attention.' :
                                        'No clients found.'}
                    </div>
                )}
            </div>

            {
                selectedClientId && (
                    <div className={styles.profileModal}>
                        <div className={styles.profileCard}>
                            <ClientProfileDetail
                                clientId={selectedClientId}
                                initialData={detailsCache[selectedClientId]}
                                statuses={statuses}
                                navigators={navigators}
                                vendors={vendors}
                                menuItems={menuItems}
                                boxTypes={boxTypes}
                                settings={settings}
                                categories={categories}
                                mealCategories={mealCategories}
                                mealItems={mealItems as any}
                                equipment={equipment}
                                allClients={allClientsForLookup}
                                regularClients={regularClients}
                                currentUser={currentUser}
                                onClose={() => {
                                    const closedClientId = selectedClientId;
                                    setSelectedClientId(null);
                                    // Clear the cache for this client
                                    setDetailsCache(prev => {
                                        const next = { ...prev };
                                        delete next[closedClientId];
                                        return next;
                                    });
                                    // Refresh ONLY this client in background
                                    refreshSingleClient(closedClientId);
                                }}
                                onBackgroundSave={handleBackgroundSave}
                            />
                        </div>
                        <div className={styles.overlay} onClick={() => {
                            const closedClientId = selectedClientId;
                            setSelectedClientId(null);
                            // Clear the cache for this client
                            setDetailsCache(prev => {
                                const next = { ...prev };
                                delete next[closedClientId];
                                return next;
                            });
                            // Refresh ONLY this client in background
                            refreshSingleClient(closedClientId);
                        }}></div>
                    </div>
                )
            }

            {
                infoShelfClientId && clients.find(c => c.id === infoShelfClientId) && (
                    <ClientInfoShelf
                        client={detailsCache[infoShelfClientId]?.client || clients.find(c => c.id === infoShelfClientId)!}
                        statuses={statuses}
                        navigators={navigators}
                        globalLocations={globalLocations}
                        orderSummary={getOrderSummary(detailsCache[infoShelfClientId]?.client || clients.find(c => c.id === infoShelfClientId)!, true)}
                        submissions={detailsCache[infoShelfClientId]?.submissions || []}
                        allClients={allClientsForLookup}
                        onClose={() => setInfoShelfClientId(null)}
                        onOpenProfile={(clientId) => {
                            setInfoShelfClientId(null);
                            setSelectedClientId(clientId);
                        }}
                        onClientUpdated={() => {
                            // Clear cache for this client to force re-fetch
                            const updatedClientId = infoShelfClientId;
                            if (updatedClientId) {
                                setDetailsCache(prev => {
                                    const newCache = { ...prev };
                                    delete newCache[updatedClientId];
                                    return newCache;
                                });
                                // Optimized: Just refresh this single client instead of everything
                                refreshSingleClient(updatedClientId);
                            }
                        }}
                        onClientDeleted={() => {
                            setInfoShelfClientId(null);
                            refreshDataInBackground();
                        }}
                        currentUser={currentUser}
                        onBackgroundSave={handleBackgroundSave}
                    />
                )
            }
        </div >
    );
}



