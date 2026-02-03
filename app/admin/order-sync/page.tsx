'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import styles from './OrderSync.module.css';

interface ItemDetail {
    name: string;
    quantity: number;
    note?: string;
}

interface VendorSelection {
    vendorName: string;
    items: ItemDetail[];
}

interface BoxOrderDetail {
    boxTypeName: string;
    vendorName?: string;
    quantity: number;
    items: ItemDetail[];
}

interface DiscrepancyClient {
    clientId: string;
    clientName: string;
    serviceType: string;
    discrepancyType: 'active_order_only' | 'upcoming_orders_only' | 'both_exist_mismatch';
    activeOrderDetails: {
        exists: boolean;
        serviceType?: string;
        caseId?: string;
        notes?: string;
        vendorSelections?: VendorSelection[];
        boxOrders?: BoxOrderDetail[];
        mealSelections?: { [mealType: string]: VendorSelection };
        deliveryDays?: string[];
    };
    upcomingOrderDetails: {
        exists: boolean;
        orders?: {
            id: string;
            deliveryDay?: string;
            serviceType?: string;
            caseId?: string;
            vendorSelections?: VendorSelection[];
            boxOrder?: BoxOrderDetail;
            itemCount: number;
        }[];
    };
}

type Resolution = 'use_active_order' | 'use_upcoming_orders' | 'clear_both';

interface Message {
    type: 'success' | 'error';
    text: string;
}

interface ClientStatus {
    status: 'pending' | 'syncing' | 'success' | 'error';
    error?: string;
}

export default function OrderSyncPage() {
    const [discrepancies, setDiscrepancies] = useState<DiscrepancyClient[]>([]);
    const [loading, setLoading] = useState(true);
    const [resolvingClient, setResolvingClient] = useState<string | null>(null);
    const [syncingAll, setSyncingAll] = useState(false);
    const [message, setMessage] = useState<Message | null>(null);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [clientStatuses, setClientStatuses] = useState<Record<string, ClientStatus>>({});
    const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);

    const fetchDiscrepancies = useCallback(async () => {
        setLoading(true);
        setClientStatuses({});
        try {
            const response = await fetch('/api/order-sync-discrepancies');
            const data = await response.json();

            if (data.success) {
                setDiscrepancies(data.discrepancies);
            } else {
                setMessage({ type: 'error', text: data.error || 'Failed to fetch discrepancies' });
            }
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || 'Network error' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchDiscrepancies();
    }, [fetchDiscrepancies]);

    // Auto-dismiss messages after 10 seconds
    useEffect(() => {
        if (message) {
            const timer = setTimeout(() => setMessage(null), 10000);
            return () => clearTimeout(timer);
        }
    }, [message]);

    const handleResolve = async (clientId: string, resolution: Resolution) => {
        setResolvingClient(clientId);
        setMessage(null);

        try {
            const response = await fetch('/api/order-sync-discrepancies/resolve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId, resolution })
            });

            const data = await response.json();

            if (data.success) {
                setMessage({ type: 'success', text: data.message });
                setDiscrepancies(prev => prev.filter(d => d.clientId !== clientId));
            } else {
                setMessage({ type: 'error', text: data.error || 'Resolution failed' });
            }
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || 'Network error' });
        } finally {
            setResolvingClient(null);
        }
    };

    const handleSyncAll = async (resolution: Resolution) => {
        if (discrepancies.length === 0) return;

        // Filter based on resolution type
        const eligibleClients = discrepancies.filter(d => {
            if (resolution === 'use_active_order') return d.activeOrderDetails.exists;
            if (resolution === 'use_upcoming_orders') return d.upcomingOrderDetails.exists;
            return true; // clear_both applies to all
        });

        if (eligibleClients.length === 0) return;

        const confirmMsg = resolution === 'clear_both'
            ? `Are you sure you want to CLEAR BOTH sources for all ${eligibleClients.length} clients? This cannot be undone.`
            : `Sync ${eligibleClients.length} clients using "${resolution === 'use_active_order' ? 'Active Order' : 'Upcoming Orders'}" as the source of truth?`;

        if (!confirm(confirmMsg)) return;

        setSyncingAll(true);
        setMessage(null);
        setSyncProgress({ current: 0, total: eligibleClients.length });

        // Initialize all client statuses to pending
        const initialStatuses: Record<string, ClientStatus> = {};
        eligibleClients.forEach(d => {
            initialStatuses[d.clientId] = { status: 'pending' };
        });
        setClientStatuses(initialStatuses);

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < eligibleClients.length; i++) {
            const discrepancy = eligibleClients[i];

            // Update to syncing
            setClientStatuses(prev => ({
                ...prev,
                [discrepancy.clientId]: { status: 'syncing' }
            }));

            setSyncProgress({ current: i + 1, total: eligibleClients.length });

            try {
                const response = await fetch('/api/order-sync-discrepancies/resolve', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId: discrepancy.clientId, resolution })
                });

                const data = await response.json();

                if (data.success) {
                    successCount++;
                    // Mark as success and remove from list after a brief delay
                    setClientStatuses(prev => ({
                        ...prev,
                        [discrepancy.clientId]: { status: 'success' }
                    }));

                    // Remove from list after showing success briefly
                    setTimeout(() => {
                        setDiscrepancies(prev => prev.filter(d => d.clientId !== discrepancy.clientId));
                    }, 500);
                } else {
                    failCount++;
                    setClientStatuses(prev => ({
                        ...prev,
                        [discrepancy.clientId]: { status: 'error', error: data.error || 'Sync failed' }
                    }));
                }
            } catch (error: any) {
                failCount++;
                setClientStatuses(prev => ({
                    ...prev,
                    [discrepancy.clientId]: { status: 'error', error: error.message || 'Network error' }
                }));
            }

            // Small delay between requests to allow UI to update
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        setSyncingAll(false);
        setSyncProgress(null);

        if (failCount === 0) {
            setMessage({ type: 'success', text: `Successfully synced all ${successCount} clients!` });
        } else {
            setMessage({
                type: 'error',
                text: `Synced ${successCount} clients. ${failCount} failed - see errors below.`
            });
        }
    };

    const toggleExpand = (clientId: string) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(clientId)) {
                next.delete(clientId);
            } else {
                next.add(clientId);
            }
            return next;
        });
    };

    const renderItems = (items: ItemDetail[]) => {
        if (!items || items.length === 0) return <span className={styles.noData}>No items</span>;
        return (
            <ul className={styles.itemList}>
                {items.map((item, i) => (
                    <li key={i} className={styles.itemRow}>
                        <span className={styles.itemName}>{item.name}</span>
                        <span className={styles.itemQty}>×{item.quantity}</span>
                        {item.note && <span className={styles.itemNote}>({item.note})</span>}
                    </li>
                ))}
            </ul>
        );
    };

    const renderVendorSelections = (selections?: VendorSelection[]) => {
        if (!selections || selections.length === 0) return null;
        return (
            <div className={styles.vendorSelections}>
                {selections.map((vs, i) => (
                    <div key={i} className={styles.vendorBlock}>
                        <div className={styles.vendorName}>{vs.vendorName}</div>
                        {renderItems(vs.items)}
                    </div>
                ))}
            </div>
        );
    };

    const renderBoxOrders = (boxOrders?: BoxOrderDetail[]) => {
        if (!boxOrders || boxOrders.length === 0) return null;
        return (
            <div className={styles.boxOrders}>
                {boxOrders.map((box, i) => (
                    <div key={i} className={styles.boxBlock}>
                        <div className={styles.boxHeader}>
                            <span className={styles.boxTypeName}>{box.boxTypeName}</span>
                            <span className={styles.boxQty}>×{box.quantity}</span>
                            {box.vendorName && <span className={styles.boxVendor}>from {box.vendorName}</span>}
                        </div>
                        {renderItems(box.items)}
                    </div>
                ))}
            </div>
        );
    };

    const renderMealSelections = (mealSelections?: { [mealType: string]: VendorSelection }) => {
        if (!mealSelections) return null;
        return (
            <div className={styles.mealSelections}>
                {Object.entries(mealSelections).map(([mealType, selection]) => (
                    <div key={mealType} className={styles.mealBlock}>
                        <div className={styles.mealType}>{mealType}</div>
                        <div className={styles.vendorName}>{selection.vendorName}</div>
                        {renderItems(selection.items)}
                    </div>
                ))}
            </div>
        );
    };

    const renderActiveOrderDetails = (details: DiscrepancyClient['activeOrderDetails']) => {
        if (!details.exists) {
            return <div className={styles.noData}>No data in active_order</div>;
        }
        return (
            <div className={styles.orderDetails}>
                <div className={styles.detailRow}>
                    <strong>Type:</strong> {details.serviceType || 'N/A'}
                </div>
                {details.caseId && (
                    <div className={styles.detailRow}>
                        <strong>Case ID:</strong> {details.caseId}
                    </div>
                )}
                {details.deliveryDays && details.deliveryDays.length > 0 && (
                    <div className={styles.detailRow}>
                        <strong>Days:</strong> {details.deliveryDays.join(', ')}
                    </div>
                )}
                {details.notes && (
                    <div className={styles.detailRow}>
                        <strong>Notes:</strong> {details.notes}
                    </div>
                )}
                {renderVendorSelections(details.vendorSelections)}
                {renderBoxOrders(details.boxOrders)}
                {renderMealSelections(details.mealSelections)}
            </div>
        );
    };

    const renderUpcomingOrderDetails = (details: DiscrepancyClient['upcomingOrderDetails']) => {
        if (!details.exists || !details.orders || details.orders.length === 0) {
            return <div className={styles.noData}>No scheduled upcoming_orders</div>;
        }
        return (
            <div className={styles.orderDetails}>
                {details.orders.map((order, i) => (
                    <div key={order.id} className={styles.upcomingOrder}>
                        <div className={styles.upcomingOrderHeader}>
                            <span className={styles.orderIndex}>Order {i + 1}</span>
                            {order.deliveryDay && <span className={styles.deliveryDay}>{order.deliveryDay}</span>}
                            <span className={styles.orderType}>{order.serviceType}</span>
                        </div>
                        {order.caseId && (
                            <div className={styles.detailRow}>
                                <strong>Case:</strong> {order.caseId}
                            </div>
                        )}
                        {renderVendorSelections(order.vendorSelections)}
                        {order.boxOrder && renderBoxOrders([order.boxOrder])}
                    </div>
                ))}
            </div>
        );
    };

    const getDiscrepancyBadge = (type: DiscrepancyClient['discrepancyType']) => {
        switch (type) {
            case 'active_order_only':
                return <span className={`${styles.badge} ${styles.badgeWarning}`}>Active Order Only</span>;
            case 'upcoming_orders_only':
                return <span className={`${styles.badge} ${styles.badgeInfo}`}>Upcoming Orders Only</span>;
            default:
                return <span className={styles.badge}>Unknown</span>;
        }
    };

    const getRowStatusClass = (clientId: string) => {
        const status = clientStatuses[clientId];
        if (!status) return '';
        switch (status.status) {
            case 'syncing': return styles.rowSyncing;
            case 'success': return styles.rowSuccess;
            case 'error': return styles.rowError;
            default: return '';
        }
    };

    const activeOrderOnlyCount = discrepancies.filter(d => d.discrepancyType === 'active_order_only').length;
    const upcomingOnlyCount = discrepancies.filter(d => d.discrepancyType === 'upcoming_orders_only').length;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.title}>Order Sync Discrepancies</h1>
                <p className={styles.subtitle}>
                    Clients where <code>active_order</code> and <code>upcoming_orders</code> are out of sync
                </p>
            </header>

            {message && (
                <div className={message.type === 'success' ? styles.successMessage : styles.errorMessage}>
                    <span className={styles.messageIcon}>
                        {message.type === 'success' ? '✓' : '✕'}
                    </span>
                    {message.text}
                </div>
            )}

            <div className={styles.statsBar}>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Total Discrepancies</span>
                    <span className={`${styles.statValue} ${discrepancies.length > 0 ? styles.statValueWarning : ''}`}>
                        {discrepancies.length}
                    </span>
                </div>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Active Order Only</span>
                    <span className={styles.statValue}>{activeOrderOnlyCount}</span>
                </div>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Upcoming Orders Only</span>
                    <span className={styles.statValue}>{upcomingOnlyCount}</span>
                </div>
                <button
                    className={styles.refreshButton}
                    onClick={fetchDiscrepancies}
                    disabled={loading || syncingAll}
                >
                    {loading ? <span className={styles.spinner} /> : '↻'}
                    Refresh
                </button>
            </div>

            {syncProgress && (
                <div className={styles.progressBar}>
                    <div className={styles.progressText}>
                        Syncing {syncProgress.current} of {syncProgress.total}...
                    </div>
                    <div className={styles.progressTrack}>
                        <div
                            className={styles.progressFill}
                            style={{ width: `${(syncProgress.current / syncProgress.total) * 100}%` }}
                        />
                    </div>
                </div>
            )}

            {discrepancies.length > 0 && (
                <div className={styles.syncAllBar}>
                    <span className={styles.syncAllLabel}>Sync All:</span>
                    {activeOrderOnlyCount > 0 && (
                        <button
                            className={`${styles.actionButton} ${styles.btnPrimary}`}
                            onClick={() => handleSyncAll('use_active_order')}
                            disabled={syncingAll}
                        >
                            {syncingAll ? 'Syncing...' : `Use Active Order (${activeOrderOnlyCount})`}
                        </button>
                    )}
                    {upcomingOnlyCount > 0 && (
                        <button
                            className={`${styles.actionButton} ${styles.btnSecondary}`}
                            onClick={() => handleSyncAll('use_upcoming_orders')}
                            disabled={syncingAll}
                        >
                            {syncingAll ? 'Syncing...' : `Use Upcoming Orders (${upcomingOnlyCount})`}
                        </button>
                    )}
                    <button
                        className={`${styles.actionButton} ${styles.btnDanger}`}
                        onClick={() => handleSyncAll('clear_both')}
                        disabled={syncingAll}
                    >
                        {syncingAll ? 'Clearing...' : 'Clear All'}
                    </button>
                </div>
            )}

            {loading ? (
                <div className={styles.loading}>
                    <span className={styles.spinner} />
                    Loading discrepancies...
                </div>
            ) : discrepancies.length === 0 ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>✓</div>
                    <h3>All Synced!</h3>
                    <p>No discrepancies found between active_order and upcoming_orders.</p>
                </div>
            ) : (
                <div className={styles.table}>
                    <div className={`${styles.tableRow} ${styles.tableHeader}`}>
                        <div className={styles.tableHeaderCell}>Client</div>
                        <div className={styles.tableHeaderCell}>Issue</div>
                        <div className={styles.tableHeaderCell}>Active Order</div>
                        <div className={styles.tableHeaderCell}>Upcoming Orders</div>
                        <div className={styles.tableHeaderCell}>Actions</div>
                    </div>
                    {discrepancies.map((discrepancy) => {
                        const isExpanded = expandedRows.has(discrepancy.clientId);
                        const clientStatus = clientStatuses[discrepancy.clientId];
                        return (
                            <div
                                key={discrepancy.clientId}
                                className={`${styles.tableRowWrapper} ${isExpanded ? styles.expanded : ''} ${getRowStatusClass(discrepancy.clientId)}`}
                            >
                                <div className={styles.tableRow}>
                                    <div className={styles.tableCell}>
                                        <button
                                            className={styles.expandBtn}
                                            onClick={() => toggleExpand(discrepancy.clientId)}
                                        >
                                            {isExpanded ? '▼' : '▶'}
                                        </button>
                                        <Link
                                            href={`/clients?id=${discrepancy.clientId}`}
                                            className={styles.clientLink}
                                        >
                                            {discrepancy.clientName}
                                        </Link>
                                        {clientStatus?.status === 'syncing' && (
                                            <span className={styles.syncingIndicator}>
                                                <span className={styles.spinnerSmall} /> Syncing...
                                            </span>
                                        )}
                                        {clientStatus?.status === 'success' && (
                                            <span className={styles.successIndicator}>✓ Done</span>
                                        )}
                                        <div className={styles.clientServiceType}>
                                            {discrepancy.serviceType}
                                        </div>
                                    </div>
                                    <div className={styles.tableCell}>
                                        {getDiscrepancyBadge(discrepancy.discrepancyType)}
                                    </div>
                                    <div className={styles.tableCell}>
                                        {discrepancy.activeOrderDetails.exists ? (
                                            <span className={styles.quickSummary}>
                                                {discrepancy.activeOrderDetails.serviceType || 'Data exists'}
                                                {discrepancy.activeOrderDetails.caseId && ` • ${discrepancy.activeOrderDetails.caseId}`}
                                            </span>
                                        ) : (
                                            <span className={styles.noData}>No data</span>
                                        )}
                                    </div>
                                    <div className={styles.tableCell}>
                                        {discrepancy.upcomingOrderDetails.exists ? (
                                            <span className={styles.quickSummary}>
                                                {discrepancy.upcomingOrderDetails.orders?.length} order(s)
                                            </span>
                                        ) : (
                                            <span className={styles.noData}>No data</span>
                                        )}
                                    </div>
                                    <div className={styles.tableCell}>
                                        <div className={styles.actionButtons}>
                                            {discrepancy.activeOrderDetails.exists && (
                                                <button
                                                    className={`${styles.actionButton} ${styles.btnPrimary}`}
                                                    onClick={() => handleResolve(discrepancy.clientId, 'use_active_order')}
                                                    disabled={resolvingClient === discrepancy.clientId || syncingAll}
                                                >
                                                    {resolvingClient === discrepancy.clientId ? '...' : 'Use Active'}
                                                </button>
                                            )}
                                            {discrepancy.upcomingOrderDetails.exists && (
                                                <button
                                                    className={`${styles.actionButton} ${styles.btnSecondary}`}
                                                    onClick={() => handleResolve(discrepancy.clientId, 'use_upcoming_orders')}
                                                    disabled={resolvingClient === discrepancy.clientId || syncingAll}
                                                >
                                                    {resolvingClient === discrepancy.clientId ? '...' : 'Use Upcoming'}
                                                </button>
                                            )}
                                            <button
                                                className={`${styles.actionButton} ${styles.btnDanger}`}
                                                onClick={() => handleResolve(discrepancy.clientId, 'clear_both')}
                                                disabled={resolvingClient === discrepancy.clientId || syncingAll}
                                            >
                                                {resolvingClient === discrepancy.clientId ? '...' : 'Clear'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                                {/* Inline error message for failed syncs */}
                                {clientStatus?.status === 'error' && (
                                    <div className={styles.inlineError}>
                                        <span className={styles.errorIcon}>✕</span>
                                        <span className={styles.errorText}>{clientStatus.error}</span>
                                    </div>
                                )}
                                {isExpanded && (
                                    <div className={styles.expandedContent}>
                                        <div className={styles.expandedCol}>
                                            <h4>Active Order Details</h4>
                                            {renderActiveOrderDetails(discrepancy.activeOrderDetails)}
                                        </div>
                                        <div className={styles.expandedCol}>
                                            <h4>Upcoming Orders Details</h4>
                                            {renderUpcomingOrderDetails(discrepancy.upcomingOrderDetails)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
