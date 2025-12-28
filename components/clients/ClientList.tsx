'use client';

import { ClientProfileDetail } from './ClientProfile';

import { useState, useEffect } from 'react';
import { ClientProfile, ClientStatus, Navigator, Vendor, BoxType } from '@/lib/types';
import { addClient } from '@/lib/actions';
import { getClients, getStatuses, getNavigators, getVendors, getBoxTypes, invalidateClientData } from '@/lib/cached-data';
import { Plus, Search, ChevronRight, CheckSquare, Square, StickyNote, Package, Calendar } from 'lucide-react';
import styles from './ClientList.module.css';
import { useRouter } from 'next/navigation';

export function ClientList() {
    const router = useRouter();
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    // Views
    const [currentView, setCurrentView] = useState<'all' | 'eligible' | 'ineligible' | 'history' | 'billing' | 'orders'>('all');

    // New Client Modal state
    const [isCreating, setIsCreating] = useState(false);
    const [newClientName, setNewClientName] = useState('');

    // Selected Client for Modal
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setIsLoading(true);
        const [cData, sData, nData, vData, bData] = await Promise.all([
            getClients(),
            getStatuses(),
            getNavigators(),
            getVendors(),
            getBoxTypes()
        ]);
        setClients(cData);
        setStatuses(sData);
        setNavigators(nData);
        setVendors(vData);
        setBoxTypes(bData);
        setIsLoading(false);
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
            invalidateClientData(); // Invalidate cache
            setIsCreating(false);
            setNewClientName(''); // Reset
            await loadData(); // Refresh list
            setSelectedClientId(newClient.id); // Open modal
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

    function getOrderSummary(client: ClientProfile) {
        if (!client.activeOrder) return '-';
        const st = client.serviceType;
        // Re-use logic or just extract the content part if needed, but for now duplicate logic is safer to avoid breaking JSX structure if not careful.
        // Actually, to ensure consistency, let's just grab the content suffix.
        const fullText = getOrderSummaryText(client);
        // st is the first word usually, but we want to bold it.
        // Let's stick to the existing JSX structure for now and just use the new function for the tooltip.

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

        return (
            <span title={fullText}>
                <strong style={{ fontWeight: 600 }}>{st}</strong>{content}
            </span>
        );
    }

    function getScreeningStatus(client: ClientProfile) {
        return (
            <div style={{ display: 'flex', gap: '8px' }}>
                <span title="Took Place" style={{ color: client.screeningTookPlace ? 'var(--color-success)' : 'var(--text-tertiary)' }}>
                    {client.screeningTookPlace ? <CheckSquare size={16} /> : <Square size={16} />}
                </span>
                <span title="Signed" style={{ color: client.screeningSigned ? 'var(--color-success)' : 'var(--text-tertiary)' }}>
                    {client.screeningSigned ? <StickyNote size={16} /> : <Square size={16} />}
                </span>
            </div>
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

    // Get clients with orders updated this week
    const thisWeekOrders = clients.filter(client => {
        if (!client.activeOrder || !client.activeOrder.lastUpdated) return false;
        return isInCurrentWeek(client.activeOrder.lastUpdated);
    });



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
                <h1 className={styles.title}>Clients</h1>
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
                            onClose={() => {
                                setSelectedClientId(null);
                                invalidateClientData(); // Invalidate cache on close
                                loadData(); // Refresh data on close in case of changes
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
