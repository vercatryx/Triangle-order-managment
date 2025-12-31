'use client';

import { ClientProfileDetail } from './ClientProfile';

import { useState, useEffect, useRef } from 'react';
import { ClientProfile, ClientStatus, Navigator, Vendor, BoxType, ClientFullDetails, MenuItem } from '@/lib/types';
import { getClientsPaginated, getClientFullDetails, getStatuses, getNavigators, addClient, getVendors, getBoxTypes, getMenuItems } from '@/lib/actions';
import { Plus, Search, ChevronRight, CheckSquare, Square, StickyNote, Package, Calendar } from 'lucide-react';
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
    const [currentView, setCurrentView] = useState<'all' | 'eligible' | 'ineligible' | 'history' | 'billing' | 'orders'>('all');

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
        } else if (currentView === 'orders') {
            // Show only clients with orders updated this week
            if (!c.activeOrder || !c.activeOrder.lastUpdated) return false;
            matchesView = isInCurrentWeek(c.activeOrder.lastUpdated);
        }
        // 'history' and 'billing' might just show all clients but with different columns? 
        // Or maybe just a placeholder for now as requested.

        return matchesSearch && matchesView;
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

        // Use shared text logic for consistency and validity check
        const fullText = getOrderSummaryText(client);
        if (!fullText || fullText === '') return null;

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

            if (!vendorsSummary) return null;
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

        return (
            <span title={fullText}>
                <strong style={{ fontWeight: 600 }}>{st}</strong>{content}
            </span>
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
                            className={`${styles.viewBtn} ${currentView === 'history' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('history')}
                        >
                            History
                        </button>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'orders' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('orders')}
                        >
                            <Calendar size={14} style={{ marginRight: '4px' }} />
                            This Week's Orders
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
                    {currentView === 'orders' ? (
                        <>
                            <span style={{ minWidth: '200px', flex: 2, paddingRight: '16px' }}>Client Name</span>
                            <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px' }}>Status</span>
                            <span style={{ minWidth: '160px', flex: 1, paddingRight: '16px' }}>Navigator</span>
                            <span style={{ minWidth: '350px', flex: 3, paddingRight: '16px' }}>Order Details</span>
                            <span style={{ minWidth: '180px', flex: 1.2, paddingRight: '16px' }}>Last Updated</span>
                            <span style={{ width: '40px' }}></span>
                        </>
                    ) : (
                        <>
                            <span style={{ minWidth: '200px', flex: 2, paddingRight: '16px' }}>Name</span>
                            <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px' }}>Status</span>
                            <span style={{ minWidth: '160px', flex: 1, paddingRight: '16px' }}>Navigator</span>
                            <span style={{ minWidth: '100px', flex: 0.8, paddingRight: '16px' }}>Screening</span>
                            <span style={{ minWidth: '350px', flex: 3, paddingRight: '16px' }}>Active Order</span>
                            <span style={{ minWidth: '180px', flex: 1.2, paddingRight: '16px' }}>Email</span>
                            <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px' }}>Phone</span>
                            <span style={{ minWidth: '250px', flex: 2, paddingRight: '16px' }}>Address</span>
                            <span style={{ minWidth: '200px', flex: 2 }}>Notes</span>
                            <span style={{ width: '40px' }}></span>
                        </>
                    )}
                </div>
                {filteredClients.map(client => {
                    const status = statuses.find(s => s.id === client.statusId);
                    const isNotAllowed = status ? status.deliveriesAllowed === false : false;
                    const lastUpdated = currentView === 'orders' && client.activeOrder?.lastUpdated
                        ? new Date(client.activeOrder.lastUpdated).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })
                        : null;

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
                            {currentView === 'orders' ? (
                                <>
                                    <span style={{ minWidth: '350px', flex: 3, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {getOrderSummary(client)}
                                    </span>
                                    <span title={lastUpdated || '-'} style={{ minWidth: '180px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {lastUpdated || '-'}
                                    </span>
                                </>
                            ) : (
                                <>
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
                                </>
                            )}
                            <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                        </div>
                    );
                })}
                {filteredClients.length === 0 && !isLoading && (
                    <div className={styles.empty}>
                        {currentView === 'ineligible' ? 'No ineligible clients found.' :
                            currentView === 'eligible' ? 'No eligible clients found.' :
                                currentView === 'orders' ? 'No orders found for this week.' :
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

            {/* Disclaimer for unimplemented views */}
            {(currentView === 'history' || currentView === 'billing') && (
                <div style={{ marginTop: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    <p>Detailed {currentView} view implementation pending backend support.</p>
                </div>
            )}
        </div>
    );
}
