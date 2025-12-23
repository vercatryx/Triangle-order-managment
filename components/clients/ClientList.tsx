'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ClientProfile, ClientStatus, Navigator } from '@/lib/types';
import { getClients, getStatuses, getNavigators, addClient } from '@/lib/actions';
import { Plus, Search, ChevronRight } from 'lucide-react';
import styles from './ClientList.module.css';

export function ClientList() {
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    // Views
    const [currentView, setCurrentView] = useState<'all' | 'ineligible' | 'history' | 'billing'>('all');

    // New Client Modal state
    const [isCreating, setIsCreating] = useState(false);
    const [newClientName, setNewClientName] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setIsLoading(true);
        const [cData, sData, nData] = await Promise.all([getClients(), getStatuses(), getNavigators()]);
        setClients(cData);
        setStatuses(sData);
        setNavigators(nData);
        setIsLoading(false);
    }

    const filteredClients = clients.filter(c => {
        const matchesSearch = c.fullName.toLowerCase().includes(search.toLowerCase());

        // Filter by View
        let matchesView = true;
        if (currentView === 'ineligible') {
            const status = statuses.find(s => s.id === c.statusId);
            // Show clients whose status does NOT allow deliveries
            matchesView = status ? !status.deliveriesAllowed : false;
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
            window.location.href = `/clients/${newClient.id}`; // Redirect to edit
        }
    }

    function getStatusName(id: string) {
        return statuses.find(s => s.id === id)?.name || 'Unknown';
    }

    function getNavigatorName(id: string) {
        return navigators.find(n => n.id === id)?.name || 'Unassigned';
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
                            className={`${styles.viewBtn} ${currentView === 'billing' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('billing')}
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
                    <span style={{ flex: 2 }}>Name</span>
                    <span style={{ flex: 2 }}>Status</span>
                    <span style={{ flex: 1.5 }}>Navigator</span>
                    <span style={{ flex: 1 }}>Service</span>
                    <span style={{ flex: 1.5 }}>Phone</span>
                    <span style={{ flex: 1.5 }}>Address</span>
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredClients.map(client => (
                    <Link key={client.id} href={`/clients/${client.id}`} className={styles.clientRow}>
                        <span style={{ flex: 2, fontWeight: 600 }}>{client.fullName}</span>
                        <span style={{ flex: 2 }}>
                            <span className={`badge ${getStatusName(client.statusId) === 'Active' ? 'badge-success' : ''}`}>
                                {getStatusName(client.statusId)}
                            </span>
                        </span>
                        <span style={{ flex: 1.5 }}>{getNavigatorName(client.navigatorId)}</span>
                        <span style={{ flex: 1 }}>{client.serviceType}</span>
                        <span style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {client.phoneNumber || '-'}
                        </span>
                        <span style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {client.address || '-'}
                        </span>
                        <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                    </Link>
                ))}
                {filteredClients.length === 0 && !isLoading && (
                    <div className={styles.empty}>
                        {currentView === 'ineligible' ? 'No ineligible clients found.' : 'No clients found.'}
                    </div>
                )}
            </div>

            {/* Disclaimer for unimplemented views */}
            {(currentView === 'history' || currentView === 'billing') && (
                <div style={{ marginTop: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                    <p>Detailed {currentView} view implementation pending backend support.</p>
                </div>
            )}
        </div>
    );
}
