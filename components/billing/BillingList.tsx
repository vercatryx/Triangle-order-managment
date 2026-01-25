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
    const [statusFilter, setStatusFilter] = useState<'all' | 'billing_pending' | 'billing_successful'>('all');
    const [selectedWeek, setSelectedWeek] = useState<Date | null>(null);
    const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [weekOptions, setWeekOptions] = useState<Date[]>([]);

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
        const matchesStatus = statusFilter === 'all' || req.billingStatus === statusFilter;
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
                        <option value="all">All Statuses</option>
                        <option value="billing_pending">Billing Pending</option>
                        <option value="billing_successful">Billing Successful</option>
                    </select>
                </div>
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ flex: 2 }}>Client Name</span>
                    <span style={{ flex: 1.5 }}>Week Range</span>
                    <span style={{ flex: 1 }}>Orders</span>
                    <span style={{ flex: 1 }}>Total Amount</span>
                    <span style={{ flex: 1.5 }}>Status</span>
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredRequests.map(request => {
                    const requestKey = getRequestKey(request);
                    const isExpanded = expandedRequest === requestKey;
                    const statusLabel = request.billingStatus === 'billing_successful' ? 'Billing Successful' : 'Billing Pending';
                    const statusClass = request.billingStatus === 'billing_successful' ? styles.statusSuccess : styles.statusPending;

                    return (
                        <div key={requestKey}>
                            <div
                                className={styles.requestRow}
                                onClick={() => toggleRequest(requestKey)}
                            >
                                <span style={{ flex: 2, fontWeight: 600 }}>{request.clientName || 'Unknown'}</span>
                                <span style={{ flex: 1.5, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    {request.weekRange}
                                </span>
                                <span style={{ flex: 1 }}>{request.orderCount}</span>
                                <span style={{ flex: 1, fontWeight: 600 }}>${request.totalAmount.toFixed(2)}</span>
                                <span style={{ flex: 1.5 }}>
                                    <span className={statusClass}>
                                        {statusLabel.toUpperCase()}
                                    </span>
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
                                            <span style={{ flex: 1 }}>Proof of Delivery</span>
                                            <span style={{ width: '40px' }}></span>
                                        </div>
                                        {request.orders.map(order => {
                                            const deliveryDate = order.actual_delivery_date
                                                ? new Date(order.actual_delivery_date).toLocaleDateString('en-US', { timeZone: 'UTC' })
                                                : order.scheduled_delivery_date
                                                    ? new Date(order.scheduled_delivery_date).toLocaleDateString('en-US', { timeZone: 'UTC' })
                                                    : '-';

                                            const proofUrl = order.proof_of_delivery_image || order.delivery_proof_url || null;

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
                                                        ${(order.amount || 0).toFixed(2)}
                                                    </Link>
                                                    <Link
                                                        href={`/orders/${order.id}`}
                                                        style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)', textDecoration: 'none' }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        {deliveryDate}
                                                    </Link>
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
