'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, Download, ExternalLink } from 'lucide-react';
import { getBillingHistory, getClient } from '@/lib/actions';
import { ClientProfile } from '@/lib/types';
import styles from './BillingDetail.module.css';

interface Props {
    clientId: string;
}

export function BillingDetail({ clientId }: Props) {
    const router = useRouter();
    const [client, setClient] = useState<ClientProfile | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadData() {
            const [c, h] = await Promise.all([
                getClient(clientId),
                getBillingHistory(clientId)
            ]);
            if (c) setClient(c);
            setHistory(h);
            setLoading(false);
        }
        loadData();
    }, [clientId]);

    if (loading) return <div className={styles.container}>Loading billing data...</div>;
    if (!client) return <div className={styles.container}>Client not found.</div>;

    const totalOutstanding = history
        .filter(i => i.status === 'Unpaid')
        .reduce((sum, i) => sum + i.amount, 0);

    return (
        <div className={styles.container}>
            <button className={styles.backBtn} onClick={() => router.push(`/clients/${clientId}`)}>
                <ArrowLeft size={20} /> Back to Profile
            </button>

            <header className={styles.header}>
                <h1 className={styles.title}>Billing: {client.fullName}</h1>
                <button className="btn btn-primary">
                    <Download size={16} /> Export Statement
                </button>
            </header>

            <div className={styles.summary}>
                <div className={styles.summaryCard}>
                    <div className={styles.label}>Outstanding Balance</div>
                    <div className={styles.value}>${totalOutstanding.toFixed(2)}</div>
                </div>
                <div className={styles.summaryCard}>
                    <div className={styles.label}>Last Payment</div>
                    <div className={styles.value}>$150.00</div>
                </div>
                <div className={styles.summaryCard}>
                    <div className={styles.label}>Billing Cycle</div>
                    <div className={styles.value}>Monthly</div>
                </div>
            </div>

            <div className={styles.tableContainer}>
                <div className={styles.tableTitle}>Billing History</div>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th className={styles.th}>Date</th>
                            <th className={styles.th}>Amount</th>
                            <th className={styles.th}>Method</th>
                            <th className={styles.th}>Status</th>
                            <th className={styles.th}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.map(item => (
                            <tr key={item.id}>
                                <td className={styles.td}>{item.date}</td>
                                <td className={styles.td}>${item.amount.toFixed(2)}</td>
                                <td className={styles.td}>{item.method}</td>
                                <td className={styles.td}>
                                    <span className={
                                        item.status === 'Paid' ? styles.statusPaid :
                                            item.status === 'Unpaid' ? styles.statusUnpaid :
                                                styles.statusPending
                                    }>
                                        {item.status}
                                    </span>
                                </td>
                                <td className={styles.td}>
                                    <button className={styles.iconBtn}>
                                        <ExternalLink size={14} /> View
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {history.length === 0 && <div className={styles.empty}>No billing records found.</div>}
            </div>
        </div>
    );
}
