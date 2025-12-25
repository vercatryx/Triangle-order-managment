'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, ChevronRight, FileText, Download } from 'lucide-react';
import { getAllBillingRecords } from '@/lib/actions';
import { BillingRecord } from '@/lib/types';
import styles from './BillingList.module.css';

export function BillingList() {
    const router = useRouter();
    const [records, setRecords] = useState<BillingRecord[]>([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'pending' | 'request sent'>('all');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setIsLoading(true);
        const data = await getAllBillingRecords();
        setRecords(data);
        setIsLoading(false);
    }

    const filteredRecords = records.filter(r => {
        const matchesSearch = (r.clientName || '').toLowerCase().includes(search.toLowerCase()) ||
            (r.remarks || '').toLowerCase().includes(search.toLowerCase()) ||
            (r.navigator || '').toLowerCase().includes(search.toLowerCase());

        const matchesStatus = statusFilter === 'all' || r.status === statusFilter;

        return matchesSearch && matchesStatus;
    });

    if (isLoading) {
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
                            onClick={() => router.push('/clients?view=ineligible')}
                        >
                            Ineligible
                        </button>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/clients?view=history')}
                        >
                            History
                        </button>
                        <button
                            className={`${styles.viewBtn} ${styles.viewBtnActive}`}
                            onClick={() => router.push('/billing')}
                        >
                            Billing
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
                        placeholder="Search by client, remarks, or navigator..."
                        style={{ paddingLeft: '2.5rem', width: '400px' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label className="label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Filter Status:</label>
                    <select
                        className="input"
                        style={{ width: '150px' }}
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                    >
                        <option value="all">All Statuses</option>
                        <option value="success">Success</option>
                        <option value="failed">Failed</option>
                        <option value="pending">Pending</option>
                        <option value="request sent">Request Sent</option>
                    </select>
                </div>
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ flex: 2 }}>Client Name</span>
                    <span style={{ flex: 1 }}>Amount</span>
                    <span style={{ flex: 1.5 }}>Navigator</span>
                    <span style={{ flex: 1.5 }}>Status</span>
                    <span style={{ flex: 2 }}>Remarks</span>
                    <span style={{ flex: 1.5 }}>Date</span>
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredRecords.map(record => (
                    <Link key={record.id} href={`/clients/${record.clientId}/billing`} className={styles.row}>
                        <span style={{ flex: 2, fontWeight: 600 }}>{record.clientName || 'Unknown'}</span>
                        <span style={{ flex: 1 }}>${record.amount.toFixed(2)}</span>
                        <span style={{ flex: 1.5 }}>{record.navigator}</span>
                        <span style={{ flex: 1.5 }}>
                            <span className={
                                record.status === 'success' ? styles.statusSuccess :
                                    record.status === 'failed' ? styles.statusFailed :
                                    record.status === 'request sent' ? styles.statusPending :
                                        styles.statusPending
                            }>
                                {record.status === 'request sent' ? 'REQUEST SENT' : record.status.toUpperCase()}
                            </span>
                        </span>
                        <span style={{ flex: 2, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {record.remarks || '-'}
                        </span>
                        <span style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {new Date(record.createdAt).toLocaleDateString()}
                        </span>
                        <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                    </Link>
                ))}
                {filteredRecords.length === 0 && (
                    <div className={styles.empty}>No billing records found.</div>
                )}
            </div>
        </div>
    );
}
