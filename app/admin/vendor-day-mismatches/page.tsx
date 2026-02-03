'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import styles from './VendorDayMismatches.module.css';

interface Mismatch {
    clientId: string;
    clientName: string;
    serviceType: string;
    orderDeliveryDay: string;
    vendorId: string;
    vendorName: string;
    vendorSupportedDays: string[];
    source: 'active_order' | 'upcoming_orders';
    upcomingOrderId?: string;
    itemCount: number;
}

export default function VendorDayMismatchesPage() {
    const [mismatches, setMismatches] = useState<Mismatch[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reassigning, setReassigning] = useState<string | null>(null);
    const [autoFixing, setAutoFixing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [selectedDays, setSelectedDays] = useState<Record<string, string>>({});

    const fetchMismatches = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/vendor-day-mismatches');
            const data = await response.json();
            if (data.success) {
                setMismatches(data.mismatches);
                const initial: Record<string, string> = {};
                data.mismatches.forEach((m: Mismatch) => {
                    const key = `${m.clientId}-${m.orderDeliveryDay}-${m.vendorId}`;
                    initial[key] = m.vendorSupportedDays[0] || '';
                });
                setSelectedDays(initial);
            } else {
                setError(data.error);
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMismatches();
    }, []);

    const handleReassign = async (mismatch: Mismatch, newDay?: string) => {
        const key = `${mismatch.clientId}-${mismatch.orderDeliveryDay}-${mismatch.vendorId}`;
        const targetDay = newDay || selectedDays[key];

        if (!targetDay) return;
        if (targetDay === mismatch.orderDeliveryDay) return;

        setReassigning(key);

        try {
            const response = await fetch('/api/vendor-day-mismatches/reassign', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clientId: mismatch.clientId,
                    oldDeliveryDay: mismatch.orderDeliveryDay,
                    newDeliveryDay: targetDay,
                    vendorId: mismatch.vendorId
                })
            });

            const data = await response.json();

            if (data.success) {
                setMismatches(prev => prev.filter(m =>
                    !(m.clientId === mismatch.clientId &&
                        m.orderDeliveryDay === mismatch.orderDeliveryDay &&
                        m.vendorId === mismatch.vendorId)
                ));
                return true;
            }
            return false;
        } catch {
            return false;
        } finally {
            setReassigning(null);
        }
    };

    const handleAutoFixSingleDay = async () => {
        const singleDayMismatches = mismatches.filter(m => m.vendorSupportedDays.length === 1);

        if (singleDayMismatches.length === 0) {
            setMessage({ type: 'error', text: 'No single-day vendors to auto-fix' });
            return;
        }

        setAutoFixing(true);
        setMessage(null);
        let fixedCount = 0;
        let failedCount = 0;

        for (const m of singleDayMismatches) {
            const success = await handleReassign(m, m.vendorSupportedDays[0]);
            if (success) fixedCount++;
            else failedCount++;
        }

        setAutoFixing(false);
        setMessage({
            type: fixedCount > 0 ? 'success' : 'error',
            text: `Auto-fixed ${fixedCount} order(s)${failedCount > 0 ? `, ${failedCount} failed` : ''}`
        });
    };

    const handleDayChange = (key: string, day: string) => {
        setSelectedDays(prev => ({ ...prev, [key]: day }));
    };

    const singleDayCount = mismatches.filter(m => m.vendorSupportedDays.length === 1).length;

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Vendor Day Mismatches</h1>
                <p className={styles.subtitle}>
                    Clients with orders on days their vendor no longer supports
                </p>
            </div>

            {message && (
                <div className={message.type === 'success' ? styles.successMessage : styles.errorMessage}>
                    <span className={styles.messageIcon}>{message.type === 'success' ? '✓' : '✕'}</span>
                    {message.text}
                </div>
            )}

            <div className={styles.statsBar}>
                <div className={styles.statCard}>
                    <div className={styles.statLabel}>Total Mismatches</div>
                    <div className={`${styles.statValue} ${mismatches.length > 0 ? styles.statValueWarning : ''}`}>
                        {mismatches.length}
                    </div>
                </div>
                <div className={styles.statCard}>
                    <div className={styles.statLabel}>Single-Day Vendors</div>
                    <div className={styles.statValue}>{singleDayCount}</div>
                </div>
                {singleDayCount > 0 && (
                    <button
                        className={`${styles.actionButton} ${styles.btnAutoFix}`}
                        onClick={handleAutoFixSingleDay}
                        disabled={autoFixing || loading}
                    >
                        {autoFixing ? 'Fixing...' : `Auto-Fix ${singleDayCount} Single-Day`}
                    </button>
                )}
                <button
                    className={styles.refreshButton}
                    onClick={fetchMismatches}
                    disabled={loading}
                >
                    {loading ? 'Loading...' : '↻ Refresh'}
                </button>
            </div>

            {loading ? (
                <div className={styles.loading}>
                    <div className={styles.spinner}></div>
                    Scanning for mismatches...
                </div>
            ) : error ? (
                <div className={styles.errorMessage}>{error}</div>
            ) : mismatches.length === 0 ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyIcon}>✓</div>
                    <h3>All Clear!</h3>
                    <p>No vendor day mismatches found. All orders are on valid delivery days.</p>
                </div>
            ) : (
                <div className={styles.table}>
                    <div className={styles.tableHeader}>
                        <div className={styles.tableRow}>
                            <div className={styles.tableHeaderCell}>Client</div>
                            <div className={styles.tableHeaderCell}>Vendor</div>
                            <div className={styles.tableHeaderCell}>Current Day</div>
                            <div className={styles.tableHeaderCell}>Reassign To</div>
                            <div className={styles.tableHeaderCell}>Actions</div>
                        </div>
                    </div>
                    {mismatches.map((mismatch) => {
                        const key = `${mismatch.clientId}-${mismatch.orderDeliveryDay}-${mismatch.vendorId}`;
                        const isReassigning = reassigning === key;
                        const isSingleDay = mismatch.vendorSupportedDays.length === 1;

                        return (
                            <div key={key} className={`${styles.tableRowWrapper} ${isSingleDay ? styles.singleDayRow : ''}`}>
                                <div className={styles.tableRow}>
                                    <div className={styles.tableCell}>
                                        <Link
                                            href={`/clients?id=${mismatch.clientId}`}
                                            className={styles.clientLink}
                                        >
                                            {mismatch.clientName}
                                        </Link>
                                        <div className={styles.cellMeta}>
                                            {mismatch.itemCount} items
                                        </div>
                                    </div>
                                    <div className={styles.tableCell}>
                                        <span className={styles.vendorName}>{mismatch.vendorName}</span>
                                        <div className={styles.cellMeta}>
                                            {mismatch.vendorSupportedDays.join(', ') || 'None'}
                                        </div>
                                    </div>
                                    <div className={styles.tableCell}>
                                        <span className={styles.invalidDay}>{mismatch.orderDeliveryDay}</span>
                                    </div>
                                    <div className={styles.tableCell}>
                                        <select
                                            className={styles.daySelect}
                                            value={selectedDays[key] || ''}
                                            onChange={(e) => handleDayChange(key, e.target.value)}
                                            disabled={isReassigning}
                                        >
                                            {mismatch.vendorSupportedDays.length === 0 ? (
                                                <option value="">No days</option>
                                            ) : (
                                                mismatch.vendorSupportedDays.map((day) => (
                                                    <option key={day} value={day}>{day}</option>
                                                ))
                                            )}
                                        </select>
                                    </div>
                                    <div className={styles.tableCell}>
                                        <button
                                            className={`${styles.actionButton} ${styles.btnPrimary}`}
                                            onClick={() => handleReassign(mismatch)}
                                            disabled={isReassigning || mismatch.vendorSupportedDays.length === 0}
                                        >
                                            {isReassigning ? '...' : 'Fix'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
