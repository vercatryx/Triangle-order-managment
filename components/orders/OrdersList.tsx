'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, ChevronRight, Package, ArrowLeft, Loader2, ArrowUpDown } from 'lucide-react';
import { getAllOrders } from '@/lib/actions';
import styles from './OrdersList.module.css';

export function OrdersList() {
    const router = useRouter();
    const [orders, setOrders] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setIsLoading(true);
        try {
            const data = await getAllOrders();
            setOrders(data);
        } catch (error) {
            console.error('Failed to load orders:', error);
        } finally {
            setIsLoading(false);
        }
    }

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const sortedOrders = [...orders].sort((a, b) => {
        if (!sortConfig) return 0;

        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        // Handle nested or special properties
        if (sortConfig.key === 'items') {
            aValue = a.total_items || 0;
            bValue = b.total_items || 0;
        } else if (sortConfig.key === 'deliveryDate') {
            aValue = new Date(a.scheduled_delivery_date || 0).getTime();
            bValue = new Date(b.scheduled_delivery_date || 0).getTime();
        } else if (sortConfig.key === 'order_number') {
            aValue = Number(a.order_number || 0);
            bValue = Number(b.order_number || 0);
        }

        if (aValue < bValue) {
            return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
            return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
    });

    const filteredOrders = sortedOrders.filter(o => {
        const matchesSearch =
            (o.clientName || '').toLowerCase().includes(search.toLowerCase()) ||
            (o.order_number || '').toString().includes(search);

        const matchesStatus = statusFilter === 'all' || o.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

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
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className="input"
                        placeholder="Search by client or order #..."
                        style={{ paddingLeft: '2.5rem', width: '300px' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>

                <select
                    className="input"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{ width: '200px' }}
                >
                    <option value="all">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                </select>
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span
                        style={{ width: '40px', fontWeight: 'bold' }}
                    >#</span>
                    <span
                        style={{ width: '100px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={() => handleSort('order_number')}
                    >
                        Order # <ArrowUpDown size={14} style={{ marginLeft: '4px' }} />
                    </span>
                    <span
                        style={{ flex: 2, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={() => handleSort('clientName')}
                    >
                        Client <ArrowUpDown size={14} style={{ marginLeft: '4px' }} />
                    </span>
                    <span
                        style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={() => handleSort('service_type')}
                    >
                        Service <ArrowUpDown size={14} style={{ marginLeft: '4px' }} />
                    </span>
                    <span
                        style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={() => handleSort('items')}
                    >
                        Items <ArrowUpDown size={14} style={{ marginLeft: '4px' }} />
                    </span>
                    <span
                        style={{ flex: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={() => handleSort('status')}
                    >
                        Status <ArrowUpDown size={14} style={{ marginLeft: '4px' }} />
                    </span>
                    <span
                        style={{ flex: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        onClick={() => handleSort('deliveryDate')}
                    >
                        Delivery Date <ArrowUpDown size={14} style={{ marginLeft: '4px' }} />
                    </span>
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredOrders.map((order, index) => (
                    <Link key={order.id} href={`/orders/${order.id}`} className={styles.row}>
                        <span style={{ width: '40px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{index + 1}</span>
                        <span style={{ width: '100px', fontWeight: 600 }}>{order.order_number || 'N/A'}</span>
                        <span style={{ flex: 2 }}>{order.clientName}</span>
                        <span style={{ flex: 1 }}>{order.service_type}</span>
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
                    </Link>
                ))}
                {filteredOrders.length === 0 && (
                    <div className={styles.empty}>No orders found.</div>
                )}
            </div>


        </div>
    );
}
