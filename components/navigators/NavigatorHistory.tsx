'use client';

import { useState, useEffect } from 'react';
import { getNavigatorLogs } from '@/lib/actions';
import { History } from 'lucide-react';
import styles from './NavigatorHistory.module.css';

interface NavigatorLog {
    id: string;
    clientId: string;
    clientName: string;
    oldStatus: string;
    newStatus: string;
    unitsAdded: number;
    createdAt: string;
}

interface NavigatorHistoryProps {
    navigatorId: string;
}

export function NavigatorHistory({ navigatorId }: NavigatorHistoryProps) {
    const [logs, setLogs] = useState<NavigatorLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadHistory();
    }, [navigatorId]);

    async function loadHistory() {
        setIsLoading(true);
        try {
            const history = await getNavigatorLogs(navigatorId);
            setLogs(history);
        } catch (error) {
            console.error('Error loading navigator history:', error);
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>My History</h2>
                    <p className={styles.subtitle}>View your unit history sorted by date</p>
                </div>
            </div>

            {isLoading ? (
                <div className={styles.loading}>Loading history...</div>
            ) : logs.length === 0 ? (
                <div className={styles.emptyState}>
                    <History size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                    <p>No history found.</p>
                    <p className={styles.emptySubtext}>Your unit history will appear here once you start adding units to clients.</p>
                </div>
            ) : (
                <div className={styles.tableContainer}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Client Name</th>
                                <th>Old Status</th>
                                <th>New Status</th>
                                <th style={{ textAlign: 'right' }}>Units Added</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map((log) => (
                                <tr key={log.id}>
                                    <td>
                                        {new Date(log.createdAt).toLocaleString('en-US', {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit'
                                        })}
                                    </td>
                                    <td style={{ fontWeight: 500 }}>{log.clientName}</td>
                                    <td>
                                        <span className={styles.statusBadge}>{log.oldStatus || 'N/A'}</span>
                                    </td>
                                    <td>
                                        <span className={`${styles.statusBadge} ${styles.statusNew}`}>
                                            {log.newStatus || 'N/A'}
                                        </span>
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--color-success)' }}>
                                        +{log.unitsAdded}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

