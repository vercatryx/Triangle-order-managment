'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, ChevronRight, Download, ChevronDown, ChevronUp, ExternalLink, Image } from 'lucide-react';
import { getBillingRequestsByWeek, type BillingRequest } from '@/lib/actions';
import { getWeekStart, getWeekOptions, getWeekRangeString } from '@/lib/utils';
import styles from './BillingList.module.css';

export function BillingList() {
    const router = useRouter();
    const [billingRequests, setBillingRequests] = useState<BillingRequest[]>([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'completed' | 'success' | 'failed'>('all');
    const [selectedWeek, setSelectedWeek] = useState<Date | null>(null);
    const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [weekOptions, setWeekOptions] = useState<Date[]>([]);
    const [statusDropdownOpen, setStatusDropdownOpen] = useState<string | null>(null);

    useEffect(() => {
        // Initialize week options
        const options = getWeekOptions(8, 2);
        setWeekOptions(options);
        // Set default to current week
        setSelectedWeek(getWeekStart(new Date()));
    }, []);

    useEffect(() => {
        if (selectedWeek) {
            loadData();
        }
    }, [selectedWeek]);

    async function loadData() {
        if (!selectedWeek) return;
        setIsLoading(true);
        try {
            const data = await getBillingRequestsByWeek(selectedWeek);
            setBillingRequests(data);
        } catch (error) {
            console.error('Error loading billing requests:', error);
        } finally {
            setIsLoading(false);
        }
    }

    const filteredRequests = billingRequests.filter(req => {
        const matchesSearch = (req.clientName || '').toLowerCase().includes(search.toLowerCase());
        let matchesStatus = true;
        if (statusFilter === 'ready') {
            matchesStatus = req.readyForBilling && !req.billingCompleted;
        } else if (statusFilter === 'completed') {
            matchesStatus = req.billingCompleted;
        } else if (statusFilter === 'success') {
            matchesStatus = req.billingStatus === 'success';
        } else if (statusFilter === 'failed') {
            matchesStatus = req.billingStatus === 'failed';
        }
        return matchesSearch && matchesStatus;
    });

    const toggleRequest = (requestKey: string) => {
        setExpandedRequest(expandedRequest === requestKey ? null : requestKey);
    };

    const getRequestKey = (req: BillingRequest) => `${req.clientId}-${req.weekStart}`;

    if (isLoading && !selectedWeek) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Billing Records</h1>
                </div>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading billing records...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Billing Records</h1>
                <div className={styles.headerActions}>
                    <div className={styles.viewToggle}>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/clients')}
                        >
                            All Clients
                        </button>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/clients?view=eligible')}
                        >
                            Eligible
                        </button>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/clients?view=ineligible')}
                        >
                            Ineligible
                        </button>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/clients?view=needs-attention')}
                        >
                            Needs Attention
                        </button>
                        <button
                            className={`${styles.viewBtn} ${styles.viewBtnActive}`}
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
                    <button className="btn btn-secondary">
                        <Download size={16} /> Export CSV
                    </button>
                </div>
            </div>

            <div className={styles.filters}>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className="input"
                        placeholder="Search by client name..."
                        style={{ paddingLeft: '2.5rem', width: '400px' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <label className="label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Week:</label>
                    <select
                        className="input"
                        style={{ width: '250px' }}
                        value={selectedWeek ? selectedWeek.toISOString() : ''}
                        onChange={(e) => {
                            if (e.target.value) {
                                setSelectedWeek(new Date(e.target.value));
                            }
                        }}
                    >
                        {weekOptions.map((week, idx) => {
                            const weekStr = getWeekRangeString(week);
                            const isCurrentWeek = getWeekStart(new Date()).getTime() === week.getTime();
                            return (
                                <option key={idx} value={week.toISOString()}>
                                    {weekStr} {isCurrentWeek ? '(Current)' : ''}
                                </option>
                            );
                        })}
                    </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label className="label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Filter Status:</label>
                    <select
                        className="input"
                        style={{ width: '180px' }}
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                    >
                        <option value="all">All</option>
                        <option value="ready">Ready for Billing</option>
                        <option value="completed">Billing Completed</option>
                        <option value="success">Billing Success</option>
                        <option value="failed">Billing Failed</option>
                    </select>
                </div>
            </div>

            <div className={styles.list}>
                {(() => {
                    const grandTotal = filteredRequests.reduce((sum, req) => sum + req.totalAmount, 0);
                    return (
                        <>
                            <div className={styles.listHeader}>
                                <span style={{ flex: 2 }}>Client Name</span>
                                <span style={{ flex: 1.5 }}>Week Range</span>
                                <span style={{ flex: 1 }}>Orders</span>
                                <span style={{ flex: 1 }}>
                                    Total Amount <span style={{ color: 'var(--text-tertiary)', fontWeight: 400, fontSize: '0.875rem' }}>(${grandTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span>
                                </span>
                                <span style={{ flex: 1.5 }}>Status</span>
                                <span style={{ width: '40px' }}></span>
                            </div>
                            {filteredRequests.map(request => {
                        const requestKey = getRequestKey(request);
                        const isExpanded = expandedRequest === requestKey;
                        
                        // Determine status label and class
                        let statusLabel: string;
                        let statusClass: string;
                        
                        // Check billing status first (based on all orders)
                        if (request.billingStatus === 'success') {
                            statusLabel = 'Billing Success';
                            statusClass = styles.statusSuccess;
                        } else if (request.billingStatus === 'failed') {
                            statusLabel = 'Billing Failed';
                            statusClass = styles.statusFailed;
                        } else if (request.billingCompleted) {
                            statusLabel = 'Billing Completed';
                            statusClass = styles.statusSuccess;
                        } else if (request.readyForBilling) {
                            statusLabel = 'Ready for Billing';
                            statusClass = styles.statusReady;
                        } else {
                            statusLabel = 'Waiting for Proof';
                            statusClass = styles.statusPending;
                        }

                        return (
                            <div key={requestKey}>
                                <div
                                    className={styles.requestRow}
                                    onClick={() => toggleRequest(requestKey)}
                                >
                                    <span style={{ flex: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem', fontWeight: 500 }}>
                                            {filteredRequests.indexOf(request) + 1}.
                                        </span>
                                        {request.clientName || 'Unknown'}
                                    </span>
                                    <span style={{ flex: 1.5, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                        {request.weekRange}
                                    </span>
                                    <span style={{ flex: 1 }}>{request.orderCount}</span>
                                    <span style={{ flex: 1, fontWeight: 600 }}>${request.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                <span style={{ flex: 1.5, position: 'relative' }}>
                                    <span 
                                        className={statusClass}
                                        style={{ cursor: 'pointer', display: 'inline-block' }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setStatusDropdownOpen(statusDropdownOpen === requestKey ? null : requestKey);
                                        }}
                                    >
                                        {statusLabel.toUpperCase()}
                                    </span>
                                    {/* Show billing notes if available */}
                                    {request.orders.some(o => o.billing_notes) && (
                                        <div style={{ 
                                            fontSize: '0.75rem', 
                                            color: 'var(--text-tertiary)', 
                                            marginTop: '2px',
                                            fontStyle: 'italic'
                                        }}>
                                            {Array.from(new Set(
                                                request.orders
                                                    .filter(o => o.billing_notes)
                                                    .map(o => o.billing_notes)
                                                    .filter(Boolean)
                                            )).join(' | ')}
                                        </div>
                                    )}
                                    {/* Status dropdown */}
                                    {statusDropdownOpen === requestKey && (
                                        <div 
                                            className={styles.statusDropdown}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <select
                                                className="input"
                                                style={{ width: '100%', marginBottom: '0.5rem' }}
                                                value={(() => {
                                                    // Determine current status from orders
                                                    const allSuccessful = request.orders.every(o => o.status === 'billing_successful');
                                                    const hasFailed = request.orders.some(o => o.status === 'billing_failed');
                                                    if (allSuccessful) return 'billing_successful';
                                                    if (hasFailed) return 'billing_failed';
                                                    return 'billing_pending';
                                                })()}
                                                onChange={async (e) => {
                                                    const newStatus = e.target.value;
                                                    try {
                                                        const orderIds = request.orders.map(o => o.id);
                                                        
                                                        const response = await fetch('/api/update-order-billing-status', {
                                                            method: 'POST',
                                                            headers: { 'Content-Type': 'application/json' },
                                                            body: JSON.stringify({
                                                                orderIds,
                                                                status: newStatus
                                                            })
                                                        });
                                                        
                                                        const result = await response.json();
                                                        
                                                        if (result.success) {
                                                            setStatusDropdownOpen(null);
                                                            // Reload data
                                                            if (selectedWeek) {
                                                                loadData();
                                                            }
                                                        } else {
                                                            alert(`Failed to update status: ${result.error || 'Unknown error'}`);
                                                        }
                                                    } catch (error: any) {
                                                        console.error('Error updating status:', error);
                                                        alert(`Error: ${error.message || 'Failed to update status'}`);
                                                    }
                                                }}
                                            >
                                                <option value="billing_pending">Billing Pending</option>
                                                <option value="billing_successful">Billing Successful</option>
                                                <option value="billing_failed">Billing Failed</option>
                                            </select>
                                            <button
                                                className="btn btn-secondary"
                                                style={{ width: '100%', fontSize: '0.875rem' }}
                                                onClick={() => setStatusDropdownOpen(null)}
                                            >
                                                Close
                                            </button>
                                        </div>
                                    )}
                                </span>
                                <span style={{ width: '40px', display: 'flex', justifyContent: 'center' }}>
                                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </span>
                            </div>
                            {isExpanded && (
                                <div className={styles.ordersDetail}>
                                    <div className={styles.ordersDetailHeader}>
                                        <h3>Orders in this billing request</h3>
                                        <span className={styles.ordersCount}>{request.orders.length} order{request.orders.length !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div className={styles.ordersList}>
                                        <div className={styles.ordersListHeader}>
                                            <span style={{ width: '100px' }}>Order #</span>
                                            <span style={{ flex: 1 }}>Service</span>
                                            <span style={{ flex: 1 }}>Amount</span>
                                            <span style={{ flex: 1.5 }}>Delivery Date</span>
                                            <span style={{ flex: 1 }}>Status</span>
                                            <span style={{ flex: 1 }}>Proof of Delivery</span>
                                            <span style={{ width: '40px' }}></span>
                                        </div>
                                        {/* Show ALL orders for this client/week - both with and without proof */}
                                        {request.orders.map(order => {
                                            const deliveryDate = order.actual_delivery_date
                                                ? new Date(order.actual_delivery_date).toLocaleDateString('en-US', { timeZone: 'UTC' })
                                                : order.scheduled_delivery_date
                                                    ? new Date(order.scheduled_delivery_date).toLocaleDateString('en-US', { timeZone: 'UTC' })
                                                    : '-';

                                            const proofUrl = order.proof_of_delivery_image || order.delivery_proof_url || null;
                                            
                                            // Format order status
                                            const formatOrderStatus = (status: string) => {
                                                const statusMap: { [key: string]: string } = {
                                                    'pending': 'Pending',
                                                    'confirmed': 'Confirmed',
                                                    'completed': 'Completed',
                                                    'waiting_for_proof': 'Waiting for Proof',
                                                    'billing_pending': 'Billing Pending',
                                                    'cancelled': 'Cancelled'
                                                };
                                                return statusMap[status] || status;
                                            };
                                            
                                            const orderStatus = formatOrderStatus(order.status || 'pending');
                                            const orderStatusClass = order.status === 'billing_pending' || order.status === 'completed' 
                                                ? styles.statusSuccess 
                                                : order.status === 'waiting_for_proof' 
                                                    ? styles.statusPending 
                                                    : styles.statusNeutral;

                                            return (
                                                <div key={order.id} className={styles.orderRow}>
                                                    <Link
                                                        href={`/orders/${order.id}`}
                                                        style={{ width: '100px', fontWeight: 600, textDecoration: 'none', color: 'inherit' }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {order.order_number || 'N/A'}
                                                    </Link>
                                                    <Link
                                                        href={`/orders/${order.id}`}
                                                        style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {order.service_type}
                                                    </Link>
                                                    <Link
                                                        href={`/orders/${order.id}`}
                                                        style={{ flex: 1, textDecoration: 'none', color: 'inherit' }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        ${(order.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </Link>
                                                    <Link
                                                        href={`/orders/${order.id}`}
                                                        style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)', textDecoration: 'none' }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {deliveryDate}
                                                    </Link>
                                                    <span style={{ flex: 1 }}>
                                                        <span className={orderStatusClass} style={{ fontSize: '0.85rem' }}>
                                                            {orderStatus.toUpperCase()}
                                                        </span>
                                                    </span>
                                                    <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        {proofUrl ? (
                                                            <a
                                                                href={proofUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className={styles.proofLink}
                                                                onClick={(e) => e.stopPropagation()}
                                                                title="View proof of delivery"
                                                            >
                                                                <Image size={14} />
                                                                <span>View Proof</span>
                                                            </a>
                                                        ) : (
                                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
                                                                No proof
                                                            </span>
                                                        )}
                                                    </span>
                                                    <Link
                                                        href={`/orders/${order.id}`}
                                                        style={{ width: '40px', display: 'flex', justifyContent: 'center', textDecoration: 'none', color: 'inherit' }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <ChevronRight size={14} />
                                                    </Link>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                    })}
                        </>
                    );
                })()}
                {filteredRequests.length === 0 && !isLoading && (
                    <div className={styles.empty}>
                        {selectedWeek
                            ? `No billing requests found for ${getWeekRangeString(selectedWeek)}.`
                            : 'No billing requests found.'}
                    </div>
                )}
                {isLoading && selectedWeek && (
                    <div className={styles.loadingContainer}>
                        <div className="spinner"></div>
                        <p>Loading billing requests...</p>
                    </div>
                )}
            </div>
            
        </div>
    );
}
