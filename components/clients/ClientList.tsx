'use client';

import { ClientProfileDetail } from './ClientProfile';

import { useState, useEffect, useRef } from 'react';
import { ClientProfile, ClientStatus, Navigator, Vendor, BoxType, ClientFullDetails, MenuItem } from '@/lib/types';
import { getClientsPaginated, getClientFullDetails, getStatuses, getNavigators, addClient, getVendors, getBoxTypes, getMenuItems } from '@/lib/actions';
import { invalidateClientData } from '@/lib/cached-data';
import { getClientSubmissions } from '@/lib/form-actions';
import { Plus, Search, ChevronRight, CheckSquare, Square, StickyNote, Package, ArrowUpDown, ArrowUp, ArrowDown, Filter } from 'lucide-react';
import styles from './ClientList.module.css';
import { useRouter } from 'next/navigation';

interface ClientListProps {
    currentUser?: { role: string; id: string } | null;
}

export function ClientList({ currentUser }: ClientListProps) {
    const router = useRouter();
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [clientSubmissions, setClientSubmissions] = useState<Record<string, any>>({});

    // Pagination State
    const [page, setPage] = useState(1);
    const [totalClients, setTotalClients] = useState(0);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const PAGE_SIZE = 20;

    // Prefetching State
    const [detailsCache, setDetailsCache] = useState<Record<string, ClientFullDetails>>({});
    const pendingPrefetches = useRef<Set<string>>(new Set());

    // Views
    const [currentView, setCurrentView] = useState<'all' | 'eligible' | 'ineligible' | 'billing'>('all');

    // Sorting State
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    // Filtering State
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [navigatorFilter, setNavigatorFilter] = useState<string | null>(null);
    const [screeningFilter, setScreeningFilter] = useState<string | null>(null);
    const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);

    // New Client Modal state
    const [isCreating, setIsCreating] = useState(false);
    const [newClientName, setNewClientName] = useState('');

    // Selected Client for Modal
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    useEffect(() => {
        loadInitialData();
    }, []);

    // Progressive Loading Effect
    useEffect(() => {
        if (!isLoading && clients.length < totalClients && !isFetchingMore) {
            // Fetch next page
            const nextPage = page + 1;
            fetchMoreClients(nextPage);
        }
    }, [clients.length, totalClients, isLoading, isFetchingMore, page]);

    // Background Prefetching Effect
    useEffect(() => {
        if (isLoading) return;

        // Find clients that need prefetching (not in cache, not currently pending)
        // Prioritize visible clients? For now, just top to bottom of current list.
        const candidates = clients.filter(c => !detailsCache[c.id] && !pendingPrefetches.current.has(c.id));

        if (candidates.length > 0) {
            // Take the first few
            const batch = candidates.slice(0, 3);
            batch.forEach(c => prefetchClient(c.id));
        }
    }, [clients, detailsCache, isLoading]);

    // Load submissions when clients are loaded
    useEffect(() => {
        if (!isLoading && clients.length > 0) {
            loadClientSubmissions();
        }
    }, [clients.length, isLoading]);

    // Close filter menus when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as HTMLElement;
            // Check if click is inside any filter dropdown or menu
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
            const [sData, nData, vData, bData, mData, cRes] = await Promise.all([
                getStatuses(),
                getNavigators(),
                getVendors(),
                getBoxTypes(),
                getMenuItems(),
                getClientsPaginated(1, PAGE_SIZE)
            ]);

            setStatuses(sData);
            setNavigators(nData);
            setVendors(vData);
            setBoxTypes(bData);
            setMenuItems(mData);
            setClients(cRes.clients);
            setTotalClients(cRes.total);
            setPage(1);
        } catch (error) {
            console.error("Error loading initial data:", error);
        } finally {
            setIsLoading(false);
        }
    }

    async function loadClientSubmissions() {
        // Load submissions for all clients
        const submissionsMap: Record<string, any> = {};

        for (const client of clients) {
            try {
                const result = await getClientSubmissions(client.id);
                if (result.success && result.data && result.data.length > 0) {
                    // Get the most recent submission
                    submissionsMap[client.id] = result.data[0];
                }
            } catch (error) {
                console.error(`Error loading submissions for client ${client.id}:`, error);
            }
        }

        setClientSubmissions(submissionsMap);
    }


    async function fetchMoreClients(nextPage: number) {
        setIsFetchingMore(true);
        try {
            const res = await getClientsPaginated(nextPage, PAGE_SIZE);
            setClients(prev => {
                // Deduplicate just in case
                const existingIds = new Set(prev.map(c => c.id));
                const newClients = res.clients.filter(c => !existingIds.has(c.id));
                return [...prev, ...newClients];
            });
            setPage(nextPage);
            // Update total just in case it changed
            setTotalClients(res.total);
        } catch (error) {
            console.error(`Error fetching page ${nextPage}:`, error);
        } finally {
            setIsFetchingMore(false);
        }
    }

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

    const filteredClients = clients.filter(c => {
        const matchesSearch = c.fullName.toLowerCase().includes(search.toLowerCase());

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
        }

        // Filter by Status
        const matchesStatusFilter = !statusFilter || c.statusId === statusFilter;

        // Filter by Navigator
        const matchesNavigatorFilter = !navigatorFilter || c.navigatorId === navigatorFilter;

        // Filter by Screening Status
        const matchesScreeningFilter = !screeningFilter || (c.screeningStatus || 'not_started') === screeningFilter;

        return matchesSearch && matchesView && matchesStatusFilter && matchesNavigatorFilter && matchesScreeningFilter;
    }).sort((a, b) => {
        if (!sortColumn) return 0;

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
            default:
                return 0;
        }

        return sortDirection === 'asc' ? comparison : -comparison;
    });

    async function handleCreate() {
        if (!newClientName.trim()) return;

        // Default initial status (first one or specific ID if known)
        const initialStatusId = statuses[0]?.id || '';

        const newClient = await addClient({
            fullName: newClientName,
            email: '',
            address: '',
            phoneNumber: '',
            navigatorId: navigators.find(n => n.isActive)?.id || '',
            endDate: '',
            screeningTookPlace: false,
            screeningSigned: false,
            notes: '',
            statusId: initialStatusId,
            serviceType: 'Food', // Default
            approvedMealsPerWeek: 21 // Default per user request
        });

        if (newClient) {
            invalidateClientData(); // Invalidate cache
            setIsCreating(false);
            setNewClientName(''); // Reset
            // Refresh logic: for simplicity, confirm and maybe add to top? 
            // Or just reload all. Reloading all is safest.
            window.location.reload(); // Simplest way to reset pagination state correctly
        }
    }

    function getStatusName(id: string) {
        return statuses.find(s => s.id === id)?.name || 'Unknown';
    }

    function getNavigatorName(id: string) {
        return navigators.find(n => n.id === id)?.name || 'Unassigned';
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

    function getOrderSummary(client: ClientProfile) {
        if (!client.activeOrder) return '-';
        const st = client.serviceType;
        const conf = client.activeOrder;

        if (st === 'Food') {
            const limit = client.approvedMealsPerWeek || 0;
            const vendorSelections = (conf.vendorSelections || []).filter((v: any) => {
                const itemCount = Object.values(v.items || {}).reduce((a: number, b: any) => a + Number(b), 0);
                return itemCount > 0;
            });

            if (vendorSelections.length === 0) return null;

            // Build detailed summary showing vendors and their items
            const vendorDetails = vendorSelections.map((v: any) => {
                const vendorName = vendors.find(ven => ven.id === v.vendorId)?.name || 'Unknown';
                const items = Object.entries(v.items || {})
                    .filter(([_, qty]) => Number(qty) > 0)
                    .map(([itemId, qty]) => {
                        const item = menuItems.find(i => i.id === itemId);
                        return item ? `${item.name} x${qty}` : null;
                    })
                    .filter(Boolean)
                    .join(', ');

                return { vendorName, items };
            });

            // Create tooltip with full details
            const tooltipText = vendorDetails.map(v =>
                `${v.vendorName}: ${v.items || 'No items'}`
            ).join('\n') + `\n[Max ${limit}]`;

            // Display: Show vendors first, then items in a compact format
            const displayText = vendorDetails.map(v =>
                `${v.vendorName}: ${v.items || 'No items'}`
            ).join(' | ');

            return (
                <span title={tooltipText} style={{ display: 'block', lineHeight: '1.4' }}>
                    <strong style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{st}</strong>
                    <span style={{ fontSize: '0.85rem', marginLeft: '4px' }}>
                        {displayText}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                        [Max {limit}]
                    </span>
                </span>
            );
        } else if (st === 'Boxes') {
            const box = boxTypes.find(b => b.id === conf.boxTypeId);
            const vendorName = vendors.find(v => v.id === box?.vendorId)?.name || 'Unknown Vendor';
            const boxName = box?.name || 'Unknown Box';
            const items = Object.entries(conf.items || {})
                .filter(([_, qty]) => Number(qty) > 0)
                .map(([itemId, qty]) => {
                    const item = menuItems.find(i => i.id === itemId);
                    return item ? `${item.name} x${qty}` : null;
                })
                .filter(Boolean);

            if (items.length === 0) {
                return (
                    <span>
                        <strong style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{st}</strong>
                        <span style={{ fontSize: '0.85rem', marginLeft: '4px' }}>
                            : {vendorName} - {boxName} × {conf.boxQuantity || 1}
                        </span>
                    </span>
                );
            }

            const itemsText = items.join(', ');
            const tooltipText = `${vendorName} - ${boxName} × ${conf.boxQuantity || 1}\nItems: ${itemsText}`;

            return (
                <span title={tooltipText} style={{ display: 'block', lineHeight: '1.4' }}>
                    <strong style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{st}</strong>
                    <span style={{ fontSize: '0.85rem', marginLeft: '4px' }}>
                        : {vendorName} - {boxName} × {conf.boxQuantity || 1}
                    </span>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px', marginLeft: '0' }}>
                        {itemsText}
                    </div>
                </span>
            );
        }

        return null;
    }

    function getScreeningStatus(client: ClientProfile) {
        // Use screening_status field
        const screeningStatus = client.screeningStatus || 'not_started';

        // Determine display based on screening_status
        let firstCheckboxColor = 'var(--text-tertiary)';
        let firstCheckboxChecked = false;
        let secondCheckboxColor = 'var(--text-tertiary)';
        let secondCheckboxChecked = false;
        let statusText = 'Not Started';

        switch (screeningStatus) {
            case 'waiting_approval':
                firstCheckboxChecked = true;
                firstCheckboxColor = 'var(--color-success)';
                secondCheckboxColor = '#f59e0b'; // Yellow
                secondCheckboxChecked = false;
                statusText = 'Waiting for Approval';
                break;
            case 'approved':
                firstCheckboxChecked = true;
                firstCheckboxColor = 'var(--color-success)';
                secondCheckboxColor = '#10b981'; // Green
                secondCheckboxChecked = true;
                statusText = 'Approved';
                break;
            case 'rejected':
                firstCheckboxChecked = true;
                firstCheckboxColor = 'var(--color-success)';
                secondCheckboxColor = '#ef4444'; // Red
                secondCheckboxChecked = false;
                statusText = 'Rejected';
                break;
            case 'not_started':
            default:
                firstCheckboxChecked = false;
                secondCheckboxChecked = false;
                statusText = 'Not Started';
                break;
        }

        return (
            <div style={{ display: 'flex', gap: '8px' }} title={statusText}>
                <span style={{ color: firstCheckboxColor }}>
                    {firstCheckboxChecked ? <CheckSquare size={16} /> : <Square size={16} />}
                </span>
                <span style={{ color: secondCheckboxColor }}>
                    {secondCheckboxChecked ? <StickyNote size={16} /> : <Square size={16} />}
                </span>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Clients</h1>
                </div>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading clients...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                    <h1 className={styles.title}>Clients</h1>
                    {!isLoading && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            {clients.length} / {totalClients} loaded
                        </span>
                    )}
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
                            className={`${styles.viewBtn} ${currentView === 'billing' ? styles.viewBtnActive : ''}`}
                            onClick={() => router.push('/billing')}
                        >
                            Billing
                        </button>
                    </div>

                    <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                        <Plus size={16} /> New Client
                    </button>
                </div>
            </div>

            <div className={styles.filters}>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className="input"
                        placeholder="Search clients..."
                        style={{ paddingLeft: '2.5rem', width: '300px' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {isCreating && (
                <div className={styles.createModal}>
                    <div className={styles.createCard}>
                        <h3>Create New Client</h3>
                        <div className={styles.formGroup}>
                            <label className="label">Client Name</label>
                            <input
                                className="input"
                                placeholder="Full Name"
                                value={newClientName}
                                onChange={e => setNewClientName(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className={styles.modalActions}>
                            <button className="btn btn-primary" onClick={handleCreate}>Create & Edit</button>
                            <button className="btn btn-secondary" onClick={() => setIsCreating(false)}>Cancel</button>
                        </div>
                    </div>
                    <div className={styles.overlay} onClick={() => setIsCreating(false)}></div>
                </div>
            )}

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    {/* Name - Sort only */}
                    <div className={styles.columnHeader} style={{ minWidth: '200px', flex: 2, paddingRight: '16px' }}>
                        <span>Name</span>
                        <button
                            className={`${styles.sortButton} ${sortColumn === 'name' ? styles.sortButtonActive : ''}`}
                            onClick={() => handleSort('name')}
                            title="Sort by Name"
                        >
                            {getSortIcon('name')}
                        </button>
                    </div>

                    {/* Status - Sort + Filter */}
                    <div className={styles.columnHeader} style={{ minWidth: '140px', flex: 1, paddingRight: '16px' }}>
                        <span>Status</span>
                        <div className={styles.headerButtons}>
                            <button
                                className={`${styles.sortButton} ${sortColumn === 'status' ? styles.sortButtonActive : ''}`}
                                onClick={() => handleSort('status')}
                                title="Sort by Status"
                            >
                                {getSortIcon('status')}
                            </button>
                            <div className={styles.filterDropdown} data-filter-dropdown>
                                <button
                                    className={`${styles.filterButton} ${statusFilter ? styles.filterButtonActive : ''}`}
                                    title="Filter by Status"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenFilterMenu(openFilterMenu === 'status' ? null : 'status');
                                    }}
                                >
                                    <Filter size={14} />
                                </button>
                                {openFilterMenu === 'status' && (
                                    <div className={styles.filterMenu} onClick={(e) => e.stopPropagation()}>
                                        <button
                                            className={!statusFilter ? styles.filterOptionActive : styles.filterOption}
                                            onClick={() => {
                                                setStatusFilter(null);
                                                setOpenFilterMenu(null);
                                            }}
                                        >
                                            All
                                        </button>
                                        {statuses.map(status => (
                                            <button
                                                key={status.id}
                                                className={statusFilter === status.id ? styles.filterOptionActive : styles.filterOption}
                                                onClick={() => {
                                                    setStatusFilter(status.id);
                                                    setOpenFilterMenu(null);
                                                }}
                                            >
                                                {status.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Navigator - Sort + Filter */}
                    <div className={styles.columnHeader} style={{ minWidth: '160px', flex: 1, paddingRight: '16px' }}>
                        <span>Navigator</span>
                        <div className={styles.headerButtons}>
                            <button
                                className={`${styles.sortButton} ${sortColumn === 'navigator' ? styles.sortButtonActive : ''}`}
                                onClick={() => handleSort('navigator')}
                                title="Sort by Navigator"
                            >
                                {getSortIcon('navigator')}
                            </button>
                            <div className={styles.filterDropdown} data-filter-dropdown>
                                <button
                                    className={`${styles.filterButton} ${navigatorFilter ? styles.filterButtonActive : ''}`}
                                    title="Filter by Navigator"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenFilterMenu(openFilterMenu === 'navigator' ? null : 'navigator');
                                    }}
                                >
                                    <Filter size={14} />
                                </button>
                                {openFilterMenu === 'navigator' && (
                                    <div className={styles.filterMenu} onClick={(e) => e.stopPropagation()}>
                                        <button
                                            className={!navigatorFilter ? styles.filterOptionActive : styles.filterOption}
                                            onClick={() => {
                                                setNavigatorFilter(null);
                                                setOpenFilterMenu(null);
                                            }}
                                        >
                                            All
                                        </button>
                                        {navigators.map(navigator => (
                                            <button
                                                key={navigator.id}
                                                className={navigatorFilter === navigator.id ? styles.filterOptionActive : styles.filterOption}
                                                onClick={() => {
                                                    setNavigatorFilter(navigator.id);
                                                    setOpenFilterMenu(null);
                                                }}
                                            >
                                                {navigator.name}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Screening - Sort + Filter */}
                    <div className={styles.columnHeader} style={{ minWidth: '100px', flex: 0.8, paddingRight: '16px' }}>
                        <span>Screening</span>
                        <div className={styles.headerButtons}>
                            <button
                                className={`${styles.sortButton} ${sortColumn === 'screening' ? styles.sortButtonActive : ''}`}
                                onClick={() => handleSort('screening')}
                                title="Sort by Screening Status"
                            >
                                {getSortIcon('screening')}
                            </button>
                            <div className={styles.filterDropdown} data-filter-dropdown>
                                <button
                                    className={`${styles.filterButton} ${screeningFilter ? styles.filterButtonActive : ''}`}
                                    title="Filter by Screening Status"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenFilterMenu(openFilterMenu === 'screening' ? null : 'screening');
                                    }}
                                >
                                    <Filter size={14} />
                                </button>
                                {openFilterMenu === 'screening' && (
                                    <div className={styles.filterMenu} onClick={(e) => e.stopPropagation()}>
                                        <button
                                            className={!screeningFilter ? styles.filterOptionActive : styles.filterOption}
                                            onClick={() => {
                                                setScreeningFilter(null);
                                                setOpenFilterMenu(null);
                                            }}
                                        >
                                            All
                                        </button>
                                        {['not_started', 'waiting_approval', 'approved', 'rejected'].map(status => (
                                            <button
                                                key={status}
                                                className={screeningFilter === status ? styles.filterOptionActive : styles.filterOption}
                                                onClick={() => {
                                                    setScreeningFilter(status);
                                                    setOpenFilterMenu(null);
                                                }}
                                            >
                                                {getScreeningStatusLabel(status)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Active Order - Nothing */}
                    <div className={styles.columnHeader} style={{ minWidth: '350px', flex: 3, paddingRight: '16px' }}>
                        <span>Active Order</span>
                    </div>

                    {/* Email - Sort only */}
                    <div className={styles.columnHeader} style={{ minWidth: '180px', flex: 1.2, paddingRight: '16px' }}>
                        <span>Email</span>
                        <button
                            className={`${styles.sortButton} ${sortColumn === 'email' ? styles.sortButtonActive : ''}`}
                            onClick={() => handleSort('email')}
                            title="Sort by Email"
                        >
                            {getSortIcon('email')}
                        </button>
                    </div>

                    {/* Phone - Sort only */}
                    <div className={styles.columnHeader} style={{ minWidth: '140px', flex: 1, paddingRight: '16px' }}>
                        <span>Phone</span>
                        <button
                            className={`${styles.sortButton} ${sortColumn === 'phone' ? styles.sortButtonActive : ''}`}
                            onClick={() => handleSort('phone')}
                            title="Sort by Phone"
                        >
                            {getSortIcon('phone')}
                        </button>
                    </div>

                    {/* Address - Sort only */}
                    <div className={styles.columnHeader} style={{ minWidth: '250px', flex: 2, paddingRight: '16px' }}>
                        <span>Address</span>
                        <button
                            className={`${styles.sortButton} ${sortColumn === 'address' ? styles.sortButtonActive : ''}`}
                            onClick={() => handleSort('address')}
                            title="Sort by Address"
                        >
                            {getSortIcon('address')}
                        </button>
                    </div>

                    {/* Notes - Sort only */}
                    <div className={styles.columnHeader} style={{ minWidth: '200px', flex: 2 }}>
                        <span>Notes</span>
                        <button
                            className={`${styles.sortButton} ${sortColumn === 'notes' ? styles.sortButtonActive : ''}`}
                            onClick={() => handleSort('notes')}
                            title="Sort by Notes"
                        >
                            {getSortIcon('notes')}
                        </button>
                    </div>

                    <div style={{ width: '40px' }}></div>
                </div>
                {filteredClients.map(client => {
                    const status = statuses.find(s => s.id === client.statusId);
                    const isNotAllowed = status ? status.deliveriesAllowed === false : false;

                    return (
                        <div
                            key={client.id}
                            onClick={() => setSelectedClientId(client.id)}
                            className={`${styles.clientRow} ${isNotAllowed ? styles.clientRowNotAllowed : ''}`}
                            style={{ cursor: 'pointer' }}
                        >
                            <span title={client.fullName} style={{ minWidth: '200px', flex: 2, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{client.fullName}</span>
                            <span title={getStatusName(client.statusId)} style={{ minWidth: '140px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                <span className={`badge ${getStatusName(client.statusId) === 'Active' ? 'badge-success' : ''}`}>
                                    {getStatusName(client.statusId)}
                                </span>
                            </span>
                            <span title={getNavigatorName(client.navigatorId)} style={{ minWidth: '160px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{getNavigatorName(client.navigatorId)}</span>
                            <span style={{ minWidth: '100px', flex: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{getScreeningStatus(client)}</span>
                            <span style={{ minWidth: '350px', flex: 3, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {getOrderSummary(client)}
                            </span>
                            <span title={client.email || undefined} style={{ minWidth: '180px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {client.email || '-'}
                            </span>
                            <span title={client.phoneNumber} style={{ minWidth: '140px', flex: 1, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {client.phoneNumber || '-'}
                            </span>
                            <span title={client.address} style={{ minWidth: '250px', flex: 2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {client.address || '-'}
                            </span>
                            <span title={client.notes} style={{ minWidth: '200px', flex: 2, fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {client.notes || '-'}
                            </span>
                            <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                        </div>
                    );
                })}
                {filteredClients.length === 0 && !isLoading && (
                    <div className={styles.empty}>
                        {currentView === 'ineligible' ? 'No ineligible clients found.' :
                            currentView === 'eligible' ? 'No eligible clients found.' :
                                'No clients found.'}
                    </div>
                )}
            </div>

            {selectedClientId && (
                <div className={styles.profileModal}>
                    <div className={styles.profileCard}>
                        <ClientProfileDetail
                            clientId={selectedClientId}
                            initialData={detailsCache[selectedClientId]}
                            onClose={() => {
                                setSelectedClientId(null);
                                // Clear the cached details for this client
                                setDetailsCache(prev => {
                                    const next = { ...prev };
                                    delete next[selectedClientId];
                                    return next;
                                });
                                // Invalidate cache and refresh data on close in case of changes
                                invalidateClientData();
                                loadInitialData();
                            }}
                            currentUser={currentUser}
                        />
                    </div>
                    <div className={styles.overlay} onClick={() => setSelectedClientId(null)}></div>
                </div>
            )}
        </div>
    );
}
