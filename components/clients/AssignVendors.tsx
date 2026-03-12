'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { ClientProfile, ClientStatus, Vendor, BoxType, ClientFullDetails, ClientBoxOrder, Navigator, GlobalLocation, MenuItem } from '@/lib/types';
import {
    getStatuses,
    getVendors,
    getBoxTypes,
    getClients,
    getNavigators,
    getGlobalLocations,
    getMenuItems,
    getMealItems,
    getClient,
    getClientFullDetails,
    massAssignVendorToBoxOrders
} from '@/lib/actions';
import { getClient as getClientCached } from '@/lib/cached-data';
import { ClientInfoShelf } from './ClientInfoShelf';
import { ClientProfileDetail } from './ClientProfile';
import { ArrowLeft, Search, X, Loader2, AlertCircle, ChevronDown, RefreshCcw, ChevronRight } from 'lucide-react';
import styles from './ClientList.module.css';
import { useRouter } from 'next/navigation';

interface AssignVendorsProps {
    currentUser?: { role: string; id: string } | null;
}

export function AssignVendors({ currentUser }: AssignVendorsProps = {}) {
    const router = useRouter();
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [globalLocations, setGlobalLocations] = useState<GlobalLocation[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [mealItems, setMealItems] = useState<MenuItem[]>([]);
    const [detailsCache, setDetailsCache] = useState<Record<string, ClientFullDetails>>({});
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set());
    const [selectedVendorId, setSelectedVendorId] = useState<string>('');
    const [isAssigning, setIsAssigning] = useState(false);
    const [assignResult, setAssignResult] = useState<{ success: number; failed: number } | null>(null);
    const lastCheckedIndex = useRef<number | null>(null);

    const [infoShelfClientId, setInfoShelfClientId] = useState<string | null>(null);
    const [shelfClient, setShelfClient] = useState<ClientProfile | null>(null);
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    useEffect(() => {
        if (!infoShelfClientId) {
            setShelfClient(null);
            return;
        }
        let cancelled = false;
        getClientCached(infoShelfClientId).then((c) => {
            if (!cancelled && c) setShelfClient(c);
        });
        return () => { cancelled = true; };
    }, [infoShelfClientId]);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setIsLoading(true);
        try {
            const [sData, vData, bData, nData, gLocs, mData, mealData, allClients] = await Promise.all([
                getStatuses(),
                getVendors(),
                getBoxTypes(),
                getNavigators(),
                getGlobalLocations(),
                getMenuItems(),
                getMealItems(),
                getClients()
            ]);
            setStatuses(sData);
            setVendors(vData);
            setBoxTypes(bData);
            setNavigators(nData);
            setGlobalLocations(Array.isArray(gLocs) ? gLocs : (gLocs as any).success ? (gLocs as any).data : []);
            setMenuItems(mData);
            setMealItems(mealData as any);
            setClients(allClients);
        } catch (error) {
            console.error("Error loading data:", error);
        } finally {
            setIsLoading(false);
        }
    }

    async function refreshSingleClient(clientId: string) {
        if (!clientId) return;
        try {
            const updatedClient = await getClient(clientId);
            if (updatedClient) {
                setClients(prev => {
                    const exists = prev.find(c => c.id === clientId);
                    if (exists) return prev.map(c => c.id === clientId ? updatedClient : c);
                    return prev;
                });
            }
        } catch (err) {
            console.error("Failed to refresh single client:", err);
        }
    }

    function getStatusName(id: string) {
        return statuses.find(s => s.id === id)?.name || 'Unknown';
    }

    const needsVendor = useCallback((client: ClientProfile): { needs: boolean; reasons: string[] } => {
        const reasons: string[] = [];
        const status = statuses.find(s => s.id === client.statusId);
        if (!status?.deliveriesAllowed) return { needs: false, reasons };
        if (client.parentClientId) return { needs: false, reasons };

        // #5 — Meal orders with no vendor assigned (same as needs-attention)
        const mealSelections = client.mealOrder?.mealSelections || client.upcomingOrder?.mealSelections;
        if (mealSelections) {
            const mealTypes = Object.keys(mealSelections);
            if (mealTypes.length > 0) {
                const missingMeals = mealTypes.filter(type => !mealSelections[type].vendorId);
                if (missingMeals.length > 0) {
                    reasons.push(`Meal: No vendor (${missingMeals.join(', ')})`);
                }
            }
        }

        // #6 — Any box order with no vendor attached (same as needs-attention)
        const allBoxOrders = client.upcomingOrder?.boxOrders || [];
        if (allBoxOrders.length > 0) {
            const hasMissing = allBoxOrders.some((boxOrder: any) => {
                if (boxOrder.vendorId) return false;
                const bt = boxTypes.find(b => b.id === boxOrder.boxTypeId);
                return !bt?.vendorId;
            });
            if (hasMissing) reasons.push('Box order: No vendor attached');
        }

        // #7 — Box clients with items selected but no vendor (same as needs-attention)
        if (client.serviceType === 'Boxes' && allBoxOrders.length > 0) {
            const hasItemsNoVendor = allBoxOrders.some((boxOrder: any) => {
                const hasItems = Object.keys(boxOrder.items || {}).length > 0;
                if (!hasItems) return false;
                if (boxOrder.vendorId) return false;
                const bt = boxTypes.find(b => b.id === boxOrder.boxTypeId);
                return !bt?.vendorId;
            });
            if (hasItemsNoVendor && !reasons.some(r => r.includes('No vendor'))) {
                reasons.push('Boxes: Items selected but no vendor');
            }
        }

        return { needs: reasons.length > 0, reasons };
    }, [statuses, boxTypes]);

    const filteredClients = clients.filter(c => {
        const { needs } = needsVendor(c);
        if (!needs) return false;

        if (search) {
            const s = search.toLowerCase();
            return c.fullName.toLowerCase().includes(s) ||
                (c.phoneNumber && c.phoneNumber.includes(s)) ||
                (c.address && c.address.toLowerCase().includes(s));
        }
        return true;
    }).sort((a, b) => a.fullName.localeCompare(b.fullName));

    function handleCheckboxClick(clientId: string, index: number, event: React.MouseEvent) {
        if (event.shiftKey && lastCheckedIndex.current !== null) {
            const start = Math.min(lastCheckedIndex.current, index);
            const end = Math.max(lastCheckedIndex.current, index);
            setSelectedClients(prev => {
                const next = new Set(prev);
                for (let i = start; i <= end; i++) {
                    next.add(filteredClients[i].id);
                }
                return next;
            });
        } else {
            setSelectedClients(prev => {
                const next = new Set(prev);
                if (next.has(clientId)) {
                    next.delete(clientId);
                } else {
                    next.add(clientId);
                }
                return next;
            });
        }
        lastCheckedIndex.current = index;
    }

    function handleSelectAll() {
        if (selectedClients.size === filteredClients.length) {
            setSelectedClients(new Set());
        } else {
            setSelectedClients(new Set(filteredClients.map(c => c.id)));
        }
    }

    async function handleAssign() {
        if (selectedClients.size === 0 || !selectedVendorId) return;
        setIsAssigning(true);
        setAssignResult(null);
        try {
            const result = await massAssignVendorToBoxOrders(Array.from(selectedClients), selectedVendorId);
            if (result.success && result.results) {
                const successCount = result.results.filter((r: any) => r.success).length;
                const failedCount = result.results.filter((r: any) => !r.success).length;
                setAssignResult({ success: successCount, failed: failedCount });
                setSelectedClients(new Set());
                setSelectedVendorId('');
                await loadData();
            }
        } catch (error) {
            console.error('Error assigning vendors:', error);
            alert('Failed to assign vendors. Check console for details.');
        } finally {
            setIsAssigning(false);
        }
    }

    function openShelf(clientId: string, e: React.MouseEvent) {
        e.stopPropagation();
        setInfoShelfClientId(clientId);
        if (!detailsCache[clientId]) {
            getClientFullDetails(clientId).then(details => {
                if (details) {
                    setDetailsCache(prev => ({ ...prev, [clientId]: details }));
                }
            });
        }
    }

    function getOrderSummaryForShelf(client: ClientProfile): React.ReactNode {
        if (!client.upcomingOrder) return <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No active order</span>;
        const conf = client.upcomingOrder;
        const st = conf.serviceType || client.serviceType;
        const displayLabel = (st === 'Food' || st === 'Meal') ? 'Food' : st;

        const vendorNames = new Set<string>();
        const itemsList: { name: string; quantity: number }[] = [];

        if (st === 'Boxes') {
            const boxOrders = conf.boxOrders || [];
            if (boxOrders.length > 0) {
                boxOrders.forEach((box: any) => {
                    const boxDef = boxTypes.find(b => b.id === box.boxTypeId);
                    const vId = box.vendorId || boxDef?.vendorId;
                    if (vId) {
                        const vName = vendors.find(v => v.id === vId)?.name;
                        if (vName) vendorNames.add(vName);
                    }
                    if (box.items) {
                        Object.entries(box.items).forEach(([itemId, qty]) => {
                            const q = Number(qty);
                            if (q > 0) {
                                const item = menuItems.find(i => i.id === itemId);
                                if (item) itemsList.push({ name: item.name, quantity: q });
                            }
                        });
                    }
                });
            } else {
                const box = boxTypes.find(b => b.id === conf.boxTypeId);
                const vendorId = conf.vendorId || box?.vendorId;
                const vName = vendors.find(v => v.id === vendorId)?.name;
                if (vName) vendorNames.add(vName);
            }
        } else if (st === 'Food' || st === 'Meal') {
            const isMultiDay = conf.deliveryDayOrders && typeof conf.deliveryDayOrders === 'object';
            const processSelections = (selections: any[]) => {
                selections.forEach((sel: any) => {
                    const vName = vendors.find(v => v.id === sel.vendorId)?.name;
                    if (vName) vendorNames.add(vName);
                });
            };
            if (isMultiDay) {
                Object.values(conf.deliveryDayOrders || {}).forEach((dayOrder: any) => {
                    if (dayOrder?.vendorSelections) processSelections(dayOrder.vendorSelections);
                });
            } else if (conf.vendorSelections) {
                processSelections(conf.vendorSelections);
            }
            const mealSelections = client.mealOrder?.mealSelections || conf.mealSelections;
            if (mealSelections) {
                Object.values(mealSelections).forEach((sel: any) => {
                    if (sel?.vendorId) {
                        const vName = vendors.find(v => v.id === sel.vendorId)?.name;
                        if (vName) vendorNames.add(vName);
                    }
                });
            }
        }

        const vendorStr = Array.from(vendorNames).join(', ') || 'Vendor Not Set';

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {displayLabel} - <span style={{ fontWeight: 500 }}>{vendorStr}</span>
                </div>
                {itemsList.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {itemsList.map((item, idx) => (
                            <div key={idx} style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
                                <span style={{ fontWeight: 600 }}>{item.quantity}</span> * {item.name}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    const activeVendors = vendors.filter(v => v.isActive);

    function getCurrentVendorName(client: ClientProfile): string {
        const vendorNameSet = new Set<string>();
        const boxOrders = client.upcomingOrder?.boxOrders || detailsCache[client.id]?.boxOrders || [];
        for (const bo of boxOrders) {
            const vId = (bo as any).vendorId || boxTypes.find(b => b.id === (bo as any).boxTypeId)?.vendorId;
            if (vId) {
                const name = vendors.find(v => v.id === vId)?.name;
                if (name) vendorNameSet.add(name);
            }
        }
        const mealSelections = client.mealOrder?.mealSelections || client.upcomingOrder?.mealSelections;
        if (mealSelections) {
            for (const type of Object.keys(mealSelections)) {
                const vId = mealSelections[type]?.vendorId;
                if (vId) {
                    const name = vendors.find(v => v.id === vId)?.name;
                    if (name) vendorNameSet.add(name);
                }
            }
        }
        return Array.from(vendorNameSet).join(', ');
    }

    return (
        <div className={styles.container} style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div className={styles.header}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h1 className="title">Clients</h1>
                    </div>
                    <p className="text-secondary" style={{ marginTop: '4px' }}>
                        {filteredClients.length} clients missing vendor assignment
                        {selectedClients.size > 0 && ` · ${selectedClients.size} selected`}
                    </p>
                </div>

                <div className={styles.headerActions}>
                    <div className={styles.viewToggle}>
                        <button className={styles.viewBtn} onClick={() => router.push('/clients')}>
                            All Clients
                        </button>
                        <button className={styles.viewBtn} onClick={() => router.push('/clients')}>
                            Eligible
                        </button>
                        <button className={styles.viewBtn} onClick={() => router.push('/clients')}>
                            Ineligible
                        </button>
                        <button className={styles.viewBtn} onClick={() => router.push('/clients')}>
                            Needs Attention
                        </button>
                        <button className={`${styles.viewBtn} ${styles.viewBtnActive}`}>
                            Assign Vendors
                        </button>
                        <button className={styles.viewBtn} onClick={() => router.push('/billing')}>
                            Billing
                        </button>
                        <button className={styles.viewBtn} onClick={() => router.push('/orders')}>
                            Orders
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.filters} style={{ marginTop: '12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ position: 'relative' }}>
                        <select
                            className="input"
                            value={selectedVendorId}
                            onChange={e => setSelectedVendorId(e.target.value)}
                            style={{ minWidth: '220px', paddingRight: '2rem', appearance: 'none' }}
                        >
                            <option value="">Select vendor...</option>
                            {activeVendors.map(v => (
                                <option key={v.id} value={v.id}>{v.name}</option>
                            ))}
                        </select>
                        <ChevronDown size={16} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
                    </div>
                    <button
                        className="btn btn-primary"
                        onClick={handleAssign}
                        disabled={selectedClients.size === 0 || !selectedVendorId || isAssigning}
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        {isAssigning ? (
                            <><Loader2 size={16} className="animate-spin" /> Assigning...</>
                        ) : (
                            <>Assign to {selectedClients.size} client{selectedClients.size !== 1 ? 's' : ''}</>
                        )}
                    </button>
                </div>
            </div>

            {assignResult && (
                <div style={{
                    padding: '10px 16px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: assignResult.failed === 0 ? 'rgba(34, 197, 94, 0.1)' : 'rgba(234, 179, 8, 0.1)',
                    border: `1px solid ${assignResult.failed === 0 ? 'var(--color-success)' : '#eab308'}`,
                    color: assignResult.failed === 0 ? 'var(--color-success)' : '#eab308',
                    marginBottom: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                }}>
                    <span>
                        {assignResult.success} client{assignResult.success !== 1 ? 's' : ''} updated successfully
                        {assignResult.failed > 0 && `, ${assignResult.failed} failed`}
                    </span>
                    <button onClick={() => setAssignResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}>
                        <X size={16} />
                    </button>
                </div>
            )}

            <div className={styles.filters} style={{ marginTop: '12px' }}>
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
                        <button className={styles.clearButton} onClick={() => setSearch('')} aria-label="Clear search">
                            <X size={16} />
                        </button>
                    )}
                </div>
                <div style={{ marginLeft: 'auto' }}>
                    <button
                        className="btn btn-secondary"
                        onClick={() => loadData()}
                        disabled={isLoading}
                        title="Refresh List"
                    >
                        <RefreshCcw size={16} className={isLoading ? "animate-spin" : ""} />
                    </button>
                </div>
            </div>

            <div className={styles.list} style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <div className={styles.listHeader}>
                    <span style={{ width: '44px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <input
                            type="checkbox"
                            checked={filteredClients.length > 0 && selectedClients.size === filteredClients.length}
                            onChange={handleSelectAll}
                            style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                        />
                    </span>
                    <span style={{ minWidth: '50px', flex: 0.3, paddingRight: '8px' }}>#</span>
                    <span style={{ minWidth: '200px', flex: 2, paddingRight: '16px' }}>Name</span>
                    <span style={{ minWidth: '180px', flex: 1.5, paddingRight: '16px' }}>Address</span>
                    <span style={{ minWidth: '120px', flex: 1, paddingRight: '16px' }}>Status</span>
                    <span style={{ minWidth: '120px', flex: 1, paddingRight: '16px' }}>Service Type</span>
                    <span style={{ minWidth: '180px', flex: 1.5, paddingRight: '16px' }}>Current Vendor</span>
                    <span style={{ minWidth: '280px', flex: 2.5, paddingRight: '16px' }}>Reason</span>
                    <span style={{ width: '40px' }}></span>
                </div>
                {isLoading ? (
                    <div className={styles.loadingContainer} style={{ padding: '2rem' }}>
                        <div className="spinner"></div>
                        <p>Loading clients...</p>
                    </div>
                ) : filteredClients.length === 0 ? (
                    <div className={styles.empty}>
                        No clients need vendor assignment.
                    </div>
                ) : (
                    filteredClients.map((client, index) => {
                        const { reasons } = needsVendor(client);
                        const isSelected = selectedClients.has(client.id);
                        const currentVendor = getCurrentVendorName(client);
                        const statusName = getStatusName(client.statusId);

                        return (
                            <div
                                key={client.id}
                                className={styles.clientRow}
                                style={{
                                    cursor: 'pointer',
                                    backgroundColor: isSelected ? 'rgba(253, 235, 35, 0.08)' : undefined
                                }}
                                onClick={(e) => {
                                    if ((e.target as HTMLElement).tagName !== 'INPUT' && !(e.target as HTMLElement).closest('[data-open-shelf]')) {
                                        handleCheckboxClick(client.id, index, e);
                                    }
                                }}
                            >
                                <span style={{ width: '44px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => {}}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleCheckboxClick(client.id, index, e as unknown as React.MouseEvent);
                                        }}
                                        style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--color-primary)' }}
                                    />
                                </span>
                                <span style={{ minWidth: '50px', flex: 0.3, paddingRight: '8px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    {index + 1}
                                </span>
                                <span title={client.fullName} style={{ minWidth: '200px', flex: 2, fontWeight: 600, paddingRight: '16px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {client.fullName}
                                </span>
                                <span title={client.address || ''} style={{ minWidth: '180px', flex: 1.5, paddingRight: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {client.address || '-'}
                                </span>
                                <span style={{ minWidth: '120px', flex: 1, paddingRight: '16px' }}>
                                    <span className={`badge ${statusName === 'Active' ? 'badge-success' : ''}`}>
                                        {statusName}
                                    </span>
                                </span>
                                <span style={{ minWidth: '120px', flex: 1, paddingRight: '16px' }}>
                                    <span className={`badge ${client.serviceType === 'Boxes' ? 'badge-blue' : client.serviceType === 'Food' ? 'badge-green' : 'badge-purple'}`}>
                                        {client.serviceType || '-'}
                                    </span>
                                </span>
                                <span style={{ minWidth: '180px', flex: 1.5, paddingRight: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {currentVendor || <span style={{ color: 'var(--color-danger)', fontWeight: 500 }}>No vendor</span>}
                                </span>
                                <span title={reasons.join(', ')} style={{ minWidth: '280px', flex: 2.5, paddingRight: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#eab308' }}>
                                        <AlertCircle size={14} />
                                        {reasons.join(', ')}
                                    </span>
                                </span>
                                <span
                                    data-open-shelf
                                    style={{ width: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)' }}
                                    onClick={(e) => openShelf(client.id, e)}
                                    title="Open client details"
                                >
                                    <ChevronRight size={16} />
                                </span>
                            </div>
                        );
                    })
                )}
            </div>

            {selectedClientId && (
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
                            currentUser={currentUser}
                            onClose={() => {
                                const closedClientId = selectedClientId;
                                setSelectedClientId(null);
                                setDetailsCache(prev => {
                                    const next = { ...prev };
                                    delete next[closedClientId];
                                    return next;
                                });
                                refreshSingleClient(closedClientId);
                            }}
                        />
                    </div>
                    <div className={styles.overlay} onClick={() => {
                        const closedClientId = selectedClientId;
                        setSelectedClientId(null);
                        setDetailsCache(prev => {
                            const next = { ...prev };
                            delete next[closedClientId];
                            return next;
                        });
                        refreshSingleClient(closedClientId);
                    }}></div>
                </div>
            )}

            {infoShelfClientId && (shelfClient || clients.find(c => c.id === infoShelfClientId)) && (
                <ClientInfoShelf
                    client={shelfClient || clients.find(c => c.id === infoShelfClientId)!}
                    statuses={statuses}
                    navigators={navigators}
                    globalLocations={globalLocations}
                    orderSummary={getOrderSummaryForShelf(shelfClient || clients.find(c => c.id === infoShelfClientId)!)}
                    submissions={detailsCache[infoShelfClientId]?.submissions || []}
                    allClients={clients}
                    onClose={() => setInfoShelfClientId(null)}
                    onOpenProfile={(clientId) => {
                        setInfoShelfClientId(null);
                        setSelectedClientId(clientId);
                    }}
                    onClientUpdated={() => {
                        const updatedClientId = infoShelfClientId;
                        if (updatedClientId) {
                            setDetailsCache(prev => {
                                const newCache = { ...prev };
                                delete newCache[updatedClientId];
                                return newCache;
                            });
                            refreshSingleClient(updatedClientId);
                        }
                    }}
                    onClientDeleted={() => {
                        setInfoShelfClientId(null);
                        loadData();
                    }}
                    currentUser={currentUser}
                />
            )}
        </div>
    );
}
