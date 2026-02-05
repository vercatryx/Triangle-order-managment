'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, ChevronRight, Loader2, ArrowUpDown, Trash2, ChevronLeft } from 'lucide-react';
import { deleteOrder } from '@/lib/actions';
import styles from './OrdersList.module.css';

const PAGE_SIZE_OPTIONS = [50, 100, 500, 1000] as const;

export function OrdersList() {
    const router = useRouter();
    const [orders, setOrders] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [creationIdFilter, setCreationIdFilter] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'created_at', direction: 'desc' });
    const [isLoading, setIsLoading] = useState(true);
    const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);

    const loadData = useCallback(async (pageNum: number) => {
        setIsLoading(true);
        try {
            const params = new URLSearchParams();
            params.set('page', String(pageNum));
            params.set('pageSize', String(pageSize));
            if (searchQuery) params.set('search', searchQuery);
            if (statusFilter !== 'all') params.set('status', statusFilter);
            if (creationIdFilter.trim()) params.set('creationId', creationIdFilter.trim());
            params.set('sortBy', sortConfig.key);
            params.set('sortDirection', sortConfig.direction);
            const res = await fetch(`/api/orders?${params.toString()}`);
            if (!res.ok) throw new Error(await res.text());
            const { orders: data, total: totalCount } = await res.json();
            setOrders(data);
            setTotal(totalCount ?? 0);
        } catch (error) {
            console.error('Failed to load orders:', error);
            setOrders([]);
            setTotal(0);
        } finally {
            setIsLoading(false);
        }
    }, [searchQuery, statusFilter, creationIdFilter, sortConfig.key, sortConfig.direction, pageSize]);

    // Fetch when page or any server-side param changes
    useEffect(() => {
        loadData(page);
    }, [page, loadData]);

    const runSearch = () => {
        setSearchQuery(searchInput.trim());
        setPage(1);
    };

    // When filters, sort, or page size change, go to page 1
    useEffect(() => {
        setPage(1);
    }, [statusFilter, creationIdFilter, sortConfig.key, sortConfig.direction, pageSize]);

    const handleSort = (key: string) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
        setPage(1);
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const filteredOrders = orders;

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'pending': return styles.statusPending;
            case 'confirmed': return styles.statusConfirmed;
            case 'completed': return styles.statusCompleted;
            case 'waiting_for_proof': return styles.statusWaitProof;
            case 'billing_pending': return styles.statusBilling;
            case 'cancelled': return styles.statusCancelled;
            default: return '';
        }
    };

    const formatStatus = (status: string) => {
        if (!status) return 'UNKNOWN';
        return status.replace(/_/g, ' ').toUpperCase();
    };

    const handleSelectOrder = (orderId: string) => {
        const newSelected = new Set(selectedOrders);
        if (newSelected.has(orderId)) {
            newSelected.delete(orderId);
        } else {
            newSelected.add(orderId);
        }
        setSelectedOrders(newSelected);
    };

    const handleSelectAll = () => {
        if (selectedOrders.size === filteredOrders.length) {
            setSelectedOrders(new Set());
        } else {
            setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
        }
    };
    const rowStartIndex = (page - 1) * pageSize;

    const handleDeleteSelected = async () => {
        if (selectedOrders.size === 0) return;

        const count = selectedOrders.size;
        if (!window.confirm(`Are you sure you want to delete ${count} order(s)? This action cannot be undone.`)) {
            return;
        }

        setIsDeleting(true);
        try {
            const orderIds = Array.from(selectedOrders);
            let successCount = 0;
            let failCount = 0;

            for (const orderId of orderIds) {
                const result = await deleteOrder(orderId);
                if (result.success) {
                    successCount++;
                } else {
                    failCount++;
                    console.error(`Failed to delete order ${orderId}:`, result.message);
                }
            }

            setSelectedOrders(new Set());
            await loadData(page);

            if (failCount === 0) {
                alert(`Successfully deleted ${successCount} order(s).`);
            } else {
                alert(`Deleted ${successCount} order(s). Failed to delete ${failCount} order(s).`);
            }
        } catch (error) {
            console.error('Bulk delete error:', error);
            alert('An error occurred while deleting orders.');
        } finally {
            setIsDeleting(false);
        }
    };

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>All Orders</h1>
                </div>
                <div className={styles.loadingContainer}>
                    <Loader2 className="animate-spin" size={32} />
                    <p>Loading orders...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>All Orders</h1>
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
                            onClick={() => router.push('/billing')}
                        >
                            Billing
                        </button>
                        <button
                            className={`${styles.viewBtn} ${styles.viewBtnActive}`}
                            onClick={() => router.push('/orders')}
                        >
                            Orders
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.filters}>
                <form
                    className={styles.searchForm}
                    onSubmit={(e) => { e.preventDefault(); runSearch(); }}
                >
                    <div className={styles.searchBox}>
                        <Search size={18} className={styles.searchIcon} />
                        <input
                            className={`input ${styles.searchInput}`}
                            placeholder="Client name or order #..."
                            value={searchInput}
                            onChange={e => setSearchInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
                        />
                    </div>
                    <button type="submit" className={styles.searchBtn} aria-label="Search">
                        <Search size={18} />
                        <span>Search</span>
                    </button>
                </form>

                <div className={`${styles.filterGroup} ${styles.filterGroupStatus}`}>
                    <label className="label">Status</label>
                    <select
                        className="input"
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                    >
                        <option value="all">All Statuses</option>
                        <option value="pending">Pending</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>

                <div className={`${styles.filterGroup} ${styles.filterGroupCreationId}`}>
                    <label className="label">Creation ID</label>
                    <input
                        className="input"
                        type="number"
                        placeholder="e.g. 1"
                        value={creationIdFilter}
                        onChange={e => setCreationIdFilter(e.target.value)}
                        min="1"
                    />
                </div>

                <button
                    className="button"
                    onClick={handleSelectAll}
                    style={{ marginLeft: 'auto' }}
                >
                    {selectedOrders.size === filteredOrders.length && filteredOrders.length > 0
                        ? 'Deselect All'
                        : 'Select All (page)'}
                </button>

                {selectedOrders.size > 0 && (
                    <button
                        className="button"
                        onClick={handleDeleteSelected}
                        disabled={isDeleting}
                        style={{
                            backgroundColor: 'var(--color-danger)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}
                    >
                        <Trash2 size={16} />
                        {isDeleting ? 'Deleting...' : `Delete Selected (${selectedOrders.size})`}
                    </button>
                )}
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ width: '50px' }}></span>
                    <span
                        style={{ width: '40px', fontWeight: 'bold' }}
                    >#</span>
                    <span
                        style={{ width: '100px', cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }}
                        onClick={() => handleSort('order_number')}
                    >
                        Order # <ArrowUpDown size={14} style={{ marginLeft: '4px', flexShrink: 0 }} />
                    </span>
                    <span
                        style={{ flex: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }}
                        onClick={() => handleSort('clientName')}
                    >
                        Client <ArrowUpDown size={14} style={{ marginLeft: '4px', flexShrink: 0 }} />
                    </span>
                    <span
                        style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }}
                        onClick={() => handleSort('service_type')}
                    >
                        Service <ArrowUpDown size={14} style={{ marginLeft: '4px', flexShrink: 0 }} />
                    </span>
                    <span
                        style={{ flex: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }}
                        onClick={() => handleSort('vendors')}
                    >
                        Vendors <ArrowUpDown size={14} style={{ marginLeft: '4px', flexShrink: 0 }} />
                    </span>
                    <span
                        style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }}
                        onClick={() => handleSort('items')}
                    >
                        Items <ArrowUpDown size={14} style={{ marginLeft: '4px', flexShrink: 0 }} />
                    </span>
                    <span
                        style={{ flex: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }}
                        onClick={() => handleSort('status')}
                    >
                        Status <ArrowUpDown size={14} style={{ marginLeft: '4px', flexShrink: 0 }} />
                    </span>
                    <span
                        style={{ flex: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }}
                        onClick={() => handleSort('deliveryDate')}
                    >
                        Delivery Date <ArrowUpDown size={14} style={{ marginLeft: '4px', flexShrink: 0 }} />
                    </span>
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredOrders.map((order, index) => (
                    <div 
                        key={order.id} 
                        className={styles.row} 
                        onClick={() => router.push(`/orders/${order.id}`)}
                        style={{ cursor: 'pointer' }}
                    >
                        <span 
                            style={{ width: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleSelectOrder(order.id);
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={selectedOrders.has(order.id)}
                                onChange={(e) => {
                                    e.stopPropagation();
                                    handleSelectOrder(order.id);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                style={{ cursor: 'pointer', width: '18px', height: '18px' }}
                            />
                        </span>
                        <span style={{ width: '40px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{rowStartIndex + index + 1}</span>
                        <span style={{ width: '100px', fontWeight: 600 }}>{order.order_number || 'N/A'}</span>
                        <span style={{ flex: 2 }}>{order.clientName}</span>
                        <span style={{ flex: 1 }}>{order.service_type}</span>
                        <span style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {((order.vendorNames as string[]) || ['Unknown']).join(', ')}
                        </span>
                        <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            {order.total_items !== null && order.total_items !== undefined ? `${order.total_items} item${order.total_items !== 1 ? 's' : ''}` : '-'}
                        </span>
                        <span style={{ flex: 1.5 }}>
                            <span className={getStatusStyle(order.status)}>
                                {formatStatus(order.status)}
                            </span>
                        </span>
                        <span style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {order.scheduled_delivery_date ? new Date(order.scheduled_delivery_date).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '-'}
                        </span>
                        <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                    </div>
                ))}
                {filteredOrders.length === 0 && !isLoading && (
                    <div className={styles.empty}>No orders found.</div>
                )}
            </div>

            {total > 0 && (
                <div className={styles.pagination}>
                    <span className={styles.paginationSummary}>
                        {totalPages > 1
                            ? `Showing ${rowStartIndex + 1}–${Math.min(rowStartIndex + filteredOrders.length, total)} of ${total.toLocaleString()} orders`
                            : `${total.toLocaleString()} order${total !== 1 ? 's' : ''}`}
                    </span>
                    <div className={styles.paginationControls}>
                        <label className={styles.perPageLabel}>
                            Per page
                            <select
                                className="input"
                                value={pageSize}
                                onChange={(e) => setPageSize(Number(e.target.value))}
                            >
                                {PAGE_SIZE_OPTIONS.map((n) => (
                                    <option key={n} value={n}>{n}</option>
                                ))}
                            </select>
                        </label>
                        {totalPages > 1 && (
                            <>
                                <button
                                    className={`button ${styles.pageBtn}`}
                                    disabled={page <= 1 || isLoading}
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                >
                                    <ChevronLeft size={18} /> Prev
                                </button>
                                <span className={styles.pageInfo}>
                                    Page {page} of {totalPages}
                                </span>
                                <button
                                    className={`button ${styles.pageBtn}`}
                                    disabled={page >= totalPages || isLoading}
                                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                                >
                                    Next <ChevronRight size={18} />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
