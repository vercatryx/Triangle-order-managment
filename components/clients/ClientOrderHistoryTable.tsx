'use client';

import { Calendar, User, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import styles from './ClientOrderHistoryTable.module.css';
import { useState } from 'react';

interface HistoryEntry {
    type?: string;
    timestamp?: string;
    updatedBy?: string;
    snapshot?: string;
    orderDetails?: any;
    // Legacy fields fallback
    who?: string;
    summary?: string;
    actionId?: string;
}

interface Props {
    history: HistoryEntry[];
}

export default function ClientOrderHistoryTable({ history = [] }: Props) {
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

    const toggleRow = (id: string) => {
        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedRows(newExpanded);
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleDateString('en-US', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (!history || history.length === 0) {
        return (
            <div className={styles.emptyState}>
                <FileText size={48} className={styles.emptyIcon} />
                <p>No order history found for this client.</p>
            </div>
        );
    }

    // Sort by timestamp descending
    const sortedHistory = [...history].sort((a, b) => {
        const tA = new Date(a.timestamp || 0).getTime();
        const tB = new Date(b.timestamp || 0).getTime();
        return tB - tA;
    });

    return (
        <div className={styles.container}>
            <div className={styles.tableWrapper}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th style={{ width: '40px' }}></th>
                            <th>Date</th>
                            <th>User</th>
                            <th>Snapshot Summary</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedHistory.map((record, index) => {
                            // Generate a stable key for the row
                            const recordId = record.actionId || `${index}-${record.timestamp}`;
                            const isExpanded = expandedRows.has(recordId);
                            const user = record.updatedBy || record.who || 'System';
                            const summary = record.snapshot || record.summary || 'No summary available';
                            const hasDetails = !!record.orderDetails;

                            return (
                                <>
                                    <tr key={recordId} onClick={() => hasDetails && toggleRow(recordId)} className={hasDetails ? styles.clickableRow : ''}>
                                        <td>
                                            {hasDetails && (
                                                <button className={styles.expandBtn}>
                                                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                </button>
                                            )}
                                        </td>
                                        <td className={styles.dateCell}>
                                            <div className={styles.cellContent}>
                                                <Calendar size={16} />
                                                <span>{formatDate(record.timestamp)}</span>
                                            </div>
                                        </td>
                                        <td>
                                            <div className={styles.cellContent}>
                                                <User size={16} />
                                                <span>{user}</span>
                                            </div>
                                        </td>
                                        <td className={styles.summaryCell}>
                                            <span title={summary}>{summary}</span>
                                        </td>
                                    </tr>
                                    {isExpanded && record.orderDetails && (
                                        <tr key={`${recordId}-details`} className={styles.detailsRow}>
                                            <td colSpan={4}>
                                                <div className={styles.detailsContainer}>
                                                    <pre className={styles.jsonBlock}>
                                                        {JSON.stringify(record.orderDetails, null, 2)}
                                                    </pre>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
