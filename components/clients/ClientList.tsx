'use client';

import { ClientProfileDetail } from './ClientProfile';

import { useState, useEffect, useRef } from 'react';
import { ClientProfile, ClientStatus, Navigator, Vendor, BoxType, ClientFullDetails, MenuItem } from '@/lib/types';
import { getClientsPaginated, getClientFullDetails, getStatuses, getNavigators, addClient, getVendors, getBoxTypes, getMenuItems } from '@/lib/actions';
import { invalidateClientData } from '@/lib/cached-data';
import { Plus, Search, ChevronRight, CheckSquare, Square, StickyNote, Package, ArrowUpDown, ArrowUp, ArrowDown, Filter, Eye, EyeOff } from 'lucide-react';
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
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);

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
    const [serviceTypeFilter, setServiceTypeFilter] = useState<string | null>(null);
    const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);

    // New Client Modal state
    const [isCreating, setIsCreating] = useState(false);
    const [newClientName, setNewClientName] = useState('');

    // Selected Client for Modal
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    // Order Details Visibility Toggle
    const [showOrderDetails, setShowOrderDetails] = useState(true);

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
        // 'billing' might just show all clients but with different columns?

        // Filter by Status
        const matchesStatusFilter = !statusFilter || c.statusId === statusFilter;

        // Filter by Navigator
        const matchesNavigatorFilter = !navigatorFilter || c.navigatorId === navigatorFilter;

        // Filter by Screening Status
        const matchesScreeningFilter = !screeningFilter || (c.screeningStatus || 'not_started') === screeningFilter;

        // Filter by Service Type (Active Order)
        const matchesServiceTypeFilter = !serviceTypeFilter || c.serviceType === serviceTypeFilter;

        return matchesSearch && matchesView && matchesStatusFilter && matchesNavigatorFilter && matchesScreeningFilter && matchesServiceTypeFilter;
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

        if (!showOrderDetails) {
            let vendorSummary = 'Not Set';

            if (st === 'Food') {
                const uniqueVendors = new Set<string>();

                // Check if it's multi-day format
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
                    vendorSummary = Array.from(uniqueVendors).join(', ');
                }
            } else if (st === 'Boxes') {
                const box = boxTypes.find(b => b.id === conf.boxTypeId);
                const vendorName = vendors.find(v => v.id === box?.vendorId)?.name;
                if (vendorName) vendorSummary = vendorName;
            }

            return (
                <div>
                    <strong style={{ fontWeight: 600, color: '#2563eb' }}>{st}</strong>
                    <span style={{ color: 'var(--text-primary)', marginLeft: '4px' }}>
                        - {vendorSummary}
                    </span>
                </div>
            );
        }

        if (st === 'Food') {
            // Check if it's multi-day format
            const isMultiDay = conf.deliveryDayOrders && typeof conf.deliveryDayOrders === 'object';

            if (isMultiDay) {
                // Multi-day format: deliveryDayOrders[day].vendorSelections
                const days = Object.keys(conf.deliveryDayOrders || {}).sort();

                if (days.length === 0) {
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div><strong style={{ fontWeight: 600 }}>Food</strong> - Vendor: Not Set</div>
                        </div>
                    );
                }

                const dayLines = days.map(day => {
                    const dayOrder = conf.deliveryDayOrders?.[day];
                    const vendorSelections = dayOrder?.vendorSelections || [];

                    if (vendorSelections.length === 0) {
                        return { day, vendors: [] };
                    }

                    const vendorLines = vendorSelections.map((v: any) => {
                        const vendorName = vendors.find(ven => ven.id === v.vendorId)?.name || 'Not Set';
                        const items = v.items || {};
                        const itemEntries = Object.entries(items);

                        const hasItems = itemEntries.some(([_, qty]) => Number(qty) > 0);
                        if (!hasItems) return null;

                        const itemDetails = itemEntries
                            .filter(([_, qty]) => Number(qty) > 0)
                            .map(([id, qty]) => {
                                const item = menuItems.find(i => i.id === id);
                                return item ? `${item.name} x${qty}` : null;
                            })
                            .filter((item): item is string => item !== null)
                            .join(', ');

                        return { vendorName, itemDetails };
                    }).filter((line): line is { vendorName: string; itemDetails: string } => line !== null);

                    return { day, vendors: vendorLines };
                }).filter((dayLine): dayLine is { day: string; vendors: { vendorName: string; itemDetails: string }[] } => dayLine.vendors.length > 0);

                if (dayLines.length === 0) {
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div><strong style={{ fontWeight: 600 }}>Food</strong> - Vendor: Not Set</div>
                        </div>
                    );
                }

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {dayLines.map((dayLine, dayIdx) => (
                            <div key={dayIdx} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <div>
                                    {dayIdx === 0 && <strong style={{ fontWeight: 600 }}>Food</strong>}
                                    {dayIdx === 0 && ' - '}
                                    <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{dayLine.day}:</span>
                                </div>
                                {dayLine.vendors.map((vendor: { vendorName: string; itemDetails: string }, vIdx: number) => (
                                    <div key={vIdx} style={{ marginLeft: '0' }}>
                                        <span style={{ fontWeight: 500 }}>Vendor: {vendor.vendorName}</span>
                                        {vendor.itemDetails && (
                                            <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginLeft: '0' }}>
                                                {vendor.itemDetails}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                );
            } else {
                // Single-day format: vendorSelections array
                const vendorSelections = conf.vendorSelections || [];

                if (vendorSelections.length === 0) {
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div><strong style={{ fontWeight: 600 }}>Food</strong> - Vendor: Not Set</div>
                        </div>
                    );
                }

                const vendorLines = vendorSelections.map(v => {
                    const vendorName = vendors.find(ven => ven.id === v.vendorId)?.name || 'Not Set';
                    const items = v.items || {};
                    const itemEntries = Object.entries(items);

                    const hasItems = itemEntries.some(([_, qty]) => Number(qty) > 0);
                    if (!hasItems) return null;

                    const itemDetails = itemEntries
                        .filter(([_, qty]) => Number(qty) > 0)
                        .map(([id, qty]) => {
                            const item = menuItems.find(i => i.id === id);
                            return item ? `${item.name} x${qty}` : null;
                        })
                        .filter((item): item is string => item !== null)
                        .join(', ');

                    return { vendorName, itemDetails };
                }).filter((line): line is { vendorName: string; itemDetails: string } => line !== null);

                if (vendorLines.length === 0) {
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div><strong style={{ fontWeight: 600 }}>Food</strong> - Vendor: Not Set</div>
                        </div>
                    );
                }

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {vendorLines.map((line, idx) => (
                            <div key={idx}>
                                {idx === 0 && <strong style={{ fontWeight: 600 }}>Food</strong>}
                                {idx === 0 ? ' - ' : ''}
                                <span style={{ fontWeight: 500 }}>Vendor: {line.vendorName}</span>
                                {line.itemDetails && (
                                    <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)', marginLeft: '0' }}>
                                        {line.itemDetails}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                );
            }
        } else if (st === 'Boxes') {
            const box = boxTypes.find(b => b.id === conf.boxTypeId);
            const vendorName = vendors.find(v => v.id === box?.vendorId)?.name || 'Not Set';

            const items = conf.items || {};
            const itemDetails = Object.entries(items)
                .filter(([_, qty]) => Number(qty) > 0)
                .map(([id, qty]) => {
                    const item = menuItems.find(i => i.id === id);
                    return item ? `${item.name} x${qty}` : null;
                })
                .filter(Boolean)
                .join(', ');

            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div>
                        <strong style={{ fontWeight: 600 }}>Boxes</strong> - Vendor: {vendorName}
                    </div>
                    {itemDetails && (
                        <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)' }}>
                            {itemDetails}
                        </div>
                    )}
                    {!itemDetails && (
                        <div style={{ fontSize: '0.85em', color: 'var(--text-secondary)' }}>
                            Items: Not Set
                        </div>
                    )}
                </div>
            );
        }

        return '-';
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



                {/* Clear All Filters Button */}
                {(statusFilter || navigatorFilter || screeningFilter || serviceTypeFilter) && (
                    <button
                        className="btn btn-secondary"
                        onClick={() => {
                            setStatusFilter(null);
                            setNavigatorFilter(null);
                            setScreeningFilter(null);
                            setServiceTypeFilter(null);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem' }}
                    >
                        Clear All Filters
                    </button>
                )}
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
                            style={{ cursor: 'pointer', opacity: statusFilter ? 1 : 0.5, color: statusFilter ? '#3b82f6' : 'inherit', filter: statusFilter ? 'drop-shadow(0 0 3px #3b82f6)' : 'none' }}
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

                    {/* Navigator column with filter */}
                    <span style={{ minWidth: '160px', flex: 1, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }} data-filter-dropdown>
                        <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('navigator')}>
                            Navigator {getSortIcon('navigator')}
                        </span>
                        <Filter
                            size={14}
                            style={{ cursor: 'pointer', opacity: navigatorFilter ? 1 : 0.5, color: navigatorFilter ? '#3b82f6' : 'inherit', filter: navigatorFilter ? 'drop-shadow(0 0 3px #3b82f6)' : 'none' }}
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
                            style={{ cursor: 'pointer', opacity: screeningFilter ? 1 : 0.5, color: screeningFilter ? '#3b82f6' : 'inherit', filter: screeningFilter ? 'drop-shadow(0 0 3px #3b82f6)' : 'none' }}
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
                            style={{ cursor: 'pointer', opacity: serviceTypeFilter ? 1 : 0.5, color: serviceTypeFilter ? '#3b82f6' : 'inherit', filter: serviceTypeFilter ? 'drop-shadow(0 0 3px #3b82f6)' : 'none' }}
                            onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'serviceType' ? null : 'serviceType'); }}
                        />
                        {openFilterMenu === 'serviceType' && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                zIndex: 1000, minWidth: '200px'
                            }}>
                                <div onClick={() => { setServiceTypeFilter(null); setOpenFilterMenu(null); }}
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
                            </div>
                        )}
                    </span>

                    <span style={{ minWidth: '180px', flex: 1.2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleSort('email')}>
                        Email {getSortIcon('email')}
                    </span>
                    <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleSort('phone')}>
                        Phone {getSortIcon('phone')}
                    </span>
                    <span style={{ minWidth: '250px', flex: 2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleSort('address')}>
                        Address {getSortIcon('address')}
                    </span>
                    <span style={{ minWidth: '200px', flex: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleSort('notes')}>
                        Notes {getSortIcon('notes')}
                    </span>
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredClients.map(client => {
                    const status = statuses.find(s => s.id === client.statusId);
                    const isNotAllowed = status ? status.deliveriesAllowed === false : false;

                    return (
                        <div
                            key={client.id}
                            onClick={() => setSelectedClientId(client.id)}
                            className={styles.clientRow}
                            style={{ cursor: 'pointer' }}
                        >
                            <span title={client.fullName} style={{ minWidth: '200px', flex: 2, fontWeight: 600, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {isNotAllowed && <span className={styles.redTab}></span>}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{client.fullName}</span>
                            </span>
                            <span title={getStatusName(client.statusId)} style={{ minWidth: '140px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                <span className={`badge ${getStatusName(client.statusId) === 'Active' ? 'badge-success' : ''}`}>
                                    {getStatusName(client.statusId)}
                                </span>
                            </span>
                            <span title={getNavigatorName(client.navigatorId)} style={{ minWidth: '160px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{getNavigatorName(client.navigatorId)}</span>
                            <span style={{ minWidth: '140px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{getScreeningStatus(client)}</span>
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
                                // We might want to refresh only this client in the list?
                                // For now, let's just let it be. If they edit, cache might be stale, 
                                // but we re-fetch effectively on mount of ClientProfile anyway if initialData is stale?
                                // Actually, I passed initialData only. If they edit and close, 
                                // valid logic dictates we should maybe invalidate the cache for this ID.
                                setDetailsCache(prev => {
                                    const next = { ...prev };
                                    delete next[selectedClientId];
                                    return next;
                                });
                                // We also should probably update the list row if things changed (like name).
                                // Implementing full re-fetch of list or just this item is tricky without prop drilling.
                                // For MVP, we can re-fetch page 1 or just leave it.
                                // Let's just invalidate cache so next open is fresh.
                            }}
                        />
                    </div>
                    <div className={styles.overlay} onClick={() => setSelectedClientId(null)}></div>
                </div>
            )}
        </div>
    );
}
