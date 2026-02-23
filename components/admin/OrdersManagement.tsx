'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getCreationIds, deleteOrdersByCreationId } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { PlayCircle, RefreshCw, X, Calendar, Trash2, AlertTriangle, CalendarDays, Layers } from 'lucide-react';
import { CreateOrdersByName } from '@/components/admin/CreateOrdersByName';
import styles from './OrdersManagement.module.css';

export function OrdersManagement() {
    const { invalidateReferenceData } = useDataCache();
    const [showDateDialog, setShowDateDialog] = useState(false);
    const [selectedDate, setSelectedDate] = useState('');
    const [simulating, setSimulating] = useState(false);
    const [simulationResult, setSimulationResult] = useState<{
        success: boolean;
        message: string;
        skippedReasons?: string[];
        skippedReasonCounts?: Record<string, number>;
        errors?: string[];
        skippedCount?: number;
    } | null>(null);
    const [creationIds, setCreationIds] = useState<Array<{ creation_id: number; count: number; created_at: string }>>([]);
    const [loadingCreationIds, setLoadingCreationIds] = useState(false);
    const [deletingCreationId, setDeletingCreationId] = useState<number | null>(null);
    const [nextWeekCreating, setNextWeekCreating] = useState(false);
    const [nextWeekResult, setNextWeekResult] = useState<{
        success: boolean;
        totalCreated?: number;
        breakdown?: { Food: number; Meal: number; Boxes: number; Custom: number };
        weekStart?: string;
        weekEnd?: string;
        error?: string;
        failuresCount?: number;
        fromBatched?: boolean;
    } | null>(null);
    const [nextWeekBatchedCreating, setNextWeekBatchedCreating] = useState(false);
    const [nextWeekBatchedProgress, setNextWeekBatchedProgress] = useState<string | null>(null);

    useEffect(() => {
        loadCreationIds();
    }, []);

    async function loadCreationIds() {
        setLoadingCreationIds(true);
        try {
            const ids = await getCreationIds();
            setCreationIds(ids);
        } catch (error) {
            console.error('Error loading creation IDs:', error);
        } finally {
            setLoadingCreationIds(false);
        }
    }

    async function handleDeleteCreationId(creationId: number) {
        const creation = creationIds.find(c => c.creation_id === creationId);
        if (!creation) return;

        if (!confirm(`Are you sure you want to delete all ${creation.count} order(s) with creation ID ${creationId}? This action cannot be undone.`)) {
            return;
        }

        setDeletingCreationId(creationId);
        try {
            const result = await deleteOrdersByCreationId(creationId);
            if (result.success) {
                await loadCreationIds();
                invalidateReferenceData();
            } else {
                alert(`Failed to delete orders: ${result.error || 'Unknown error'}`);
            }
        } catch (error: any) {
            alert(`Error deleting orders: ${error.message || 'Unknown error'}`);
        } finally {
            setDeletingCreationId(null);
        }
    }

    const formatForDateInput = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    useEffect(() => {
        setSelectedDate(formatForDateInput(new Date()));
    }, []);

    async function handleCreateOrders() {
        if (!selectedDate) {
            alert('Please select a date');
            return;
        }

        if (!confirm('This will create orders for all scheduled upcoming orders using the selected date. The original Upcoming Orders will be preserved. Proceed?')) return;

        setSimulating(true);
        setSimulationResult(null);
        setShowDateDialog(false);

        try {
            const [year, month, day] = selectedDate.split('-').map(Number);
            const selectedDateObj = new Date(year, month - 1, day, 0, 0, 0, 0);
            document.cookie = `x-fake-time=${selectedDateObj.toISOString()}; path=/; max-age=86400; SameSite=Lax`;

            const res = await fetch('/api/simulate-delivery-cycle', { method: 'POST' });
            const data = await res.json();

            document.cookie = 'x-fake-time=; path=/; max-age=0; SameSite=Lax';

            setSimulationResult({
                success: data.success,
                message: data.message || (data.success ? 'Orders created successfully.' : 'Failed to create orders.'),
                skippedReasons: data.skippedReasons,
                skippedReasonCounts: data.skippedReasonCounts,
                errors: data.errors,
                skippedCount: data.skippedCount
            });
        } catch (error) {
            document.cookie = 'x-fake-time=; path=/; max-age=0; SameSite=Lax';
            setSimulationResult({ success: false, message: 'An error occurred while creating orders.' });
        } finally {
            setSimulating(false);
        }
    }

    const BATCH_SIZE = 100;

    async function handleCreateOrdersNextWeek() {
        if (!confirm('This will create orders for the next week (Sunday–Saturday) based on upcoming orders. Report will be emailed to the addresses in Report Email. Proceed?')) return;
        setNextWeekCreating(true);
        setNextWeekResult(null);
        try {
            const res = await fetch('/api/create-orders-next-week', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
            const data = await res.json();
            if (data.success) {
                setNextWeekResult({
                    success: true,
                    totalCreated: data.totalCreated,
                    breakdown: data.breakdown,
                    weekStart: data.weekStart,
                    weekEnd: data.weekEnd
                });
                await loadCreationIds();
                invalidateReferenceData();
            } else {
                setNextWeekResult({ success: false, error: data.error || 'Request failed' });
            }
        } catch (error: any) {
            setNextWeekResult({ success: false, error: error.message || 'Network error' });
        } finally {
            setNextWeekCreating(false);
        }
    }

    async function handleCreateOrdersNextWeekBatched() {
        if (!confirm(`Create orders for the next week in batches of ${BATCH_SIZE} clients to avoid timeouts? No email will be sent; you will get one combined Excel download at the end. Proceed?`)) return;
        setNextWeekBatchedCreating(true);
        setNextWeekBatchedProgress('Starting…');
        setNextWeekResult(null);
        let creationId: number | undefined;
        const allExcelRows: Record<string, string | number>[] = [];
        const vendorBreakdownMap = new Map<string, { vendorId: string; vendorName: string; byDay: Record<string, number>; total: number }>();
        let totalCreated = 0;
        const breakdown = { Food: 0, Meal: 0, Boxes: 0, Custom: 0 };
        let weekStart = '';
        let weekEnd = '';
        const allFailures: { clientName: string; orderType: string; date: string; reason: string }[] = [];
        const allDiagnostics: { clientId?: string; clientName?: string; vendorId?: string; vendorName?: string; date?: string; orderType?: string; outcome?: string; orderId?: string; reason?: string }[] = [];
        const debugBatches: { batchIndex: number; debug: { clientCount: number; workToDo: { foodOrders: number; mealOrders: number; boxOrders: number; customOrders: number }; skipped: { foodBlocking: number; foodNoData: number; mealBlocking: number } } }[] = [];
        const debugAgg = { clientCount: 0, workToDo: { foodOrders: 0, mealOrders: 0, boxOrders: 0, customOrders: 0 }, skipped: { foodBlocking: 0, foodNoData: 0, mealBlocking: 0 } };
        try {
            let batchIndex = 0;
            while (true) {
                setNextWeekBatchedProgress(`Batch ${batchIndex + 1} (clients ${batchIndex * BATCH_SIZE + 1}–${(batchIndex + 1) * BATCH_SIZE})…`);
                const body: { batchIndex: number; batchSize: number; creationId?: number } = { batchIndex, batchSize: BATCH_SIZE };
                if (creationId != null) body.creationId = creationId;
                const res = await fetch('/api/create-orders-next-week', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json();
                if (!data.success) {
                    setNextWeekResult({ success: false, error: data.error || 'Request failed' });
                    break;
                }
                if (data.batch == null) {
                    setNextWeekResult({ success: false, error: 'Batch response missing. Only the first batch may have run. Try the non-batched "Create orders for the next week" button, or run batched again.' });
                    break;
                }
                if (data.batch.creationId != null) creationId = data.batch.creationId;
                totalCreated += data.totalCreated ?? 0;
                if (data.breakdown) {
                    breakdown.Food += data.breakdown.Food ?? 0;
                    breakdown.Meal += data.breakdown.Meal ?? 0;
                    breakdown.Boxes += data.breakdown.Boxes ?? 0;
                    breakdown.Custom += data.breakdown.Custom ?? 0;
                }
                if (data.weekStart) weekStart = data.weekStart;
                if (data.weekEnd) weekEnd = data.weekEnd;
                if (data.errors?.length) {
                    for (const e of data.errors) {
                        if (e && typeof e === 'object' && 'reason' in e) {
                            allFailures.push({
                                clientName: (e as any).clientName ?? 'Unknown',
                                orderType: (e as any).orderType ?? '-',
                                date: (e as any).date ?? '-',
                                reason: (e as any).reason ?? String(e)
                            });
                        }
                    }
                }
                const rows = data.batch?.excelRows ?? [];
                allExcelRows.push(...rows);
                for (const v of data.batch?.vendorBreakdown ?? []) {
                    const existing = vendorBreakdownMap.get(v.vendorId);
                    if (!existing) {
                        vendorBreakdownMap.set(v.vendorId, { vendorId: v.vendorId, vendorName: v.vendorName ?? v.vendorId, byDay: { ...v.byDay }, total: v.total ?? 0 });
                    } else {
                        existing.total += v.total ?? 0;
                        for (const [day, n] of Object.entries(v.byDay ?? {})) {
                            existing.byDay[day] = (existing.byDay[day] ?? 0) + (typeof n === 'number' ? n : Number(n) || 0);
                        }
                    }
                }
                allDiagnostics.push(...(data.batch?.diagnostics ?? []));
                const batchDebug = data.debug ?? data.batch?.debug;
                if (batchDebug) {
                    debugBatches.push({ batchIndex, debug: batchDebug });
                    debugAgg.clientCount += batchDebug.clientCount ?? 0;
                    if (batchDebug.workToDo) {
                        debugAgg.workToDo.foodOrders += batchDebug.workToDo.foodOrders ?? 0;
                        debugAgg.workToDo.mealOrders += batchDebug.workToDo.mealOrders ?? 0;
                        debugAgg.workToDo.boxOrders += batchDebug.workToDo.boxOrders ?? 0;
                        debugAgg.workToDo.customOrders += batchDebug.workToDo.customOrders ?? 0;
                    }
                    if (batchDebug.skipped) {
                        debugAgg.skipped.foodBlocking += batchDebug.skipped.foodBlocking ?? 0;
                        debugAgg.skipped.foodNoData += batchDebug.skipped.foodNoData ?? 0;
                        debugAgg.skipped.mealBlocking += batchDebug.skipped.mealBlocking ?? 0;
                    }
                }
                if (!data.batch?.hasMore) break;
                batchIndex++;
            }
            setNextWeekBatchedProgress('Sending report email…');
            const vendorBreakdownArray = Array.from(vendorBreakdownMap.values()).sort((a, b) => (a.vendorName || '').localeCompare(b.vendorName || ''));
            const sendRes = await fetch('/api/create-orders-next-week/send-batched-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    weekStart,
                    weekEnd,
                    totalCreated,
                    breakdown,
                    creationId,
                    excelRows: allExcelRows,
                    failures: allFailures,
                    vendorBreakdown: vendorBreakdownArray,
                    diagnostics: allDiagnostics,
                    debug: debugBatches.length > 0 ? debugAgg : undefined,
                    debugBatches: debugBatches.length > 0 ? debugBatches : undefined
                })
            });
            const sendData = await sendRes.json();
            if (!sendData.success) {
                setNextWeekResult({ success: false, error: sendData.error || 'Report email failed' });
            } else {
                setNextWeekResult({
                    success: true,
                    totalCreated,
                    breakdown,
                    weekStart,
                    weekEnd,
                    failuresCount: allFailures.length > 0 ? allFailures.length : undefined,
                    fromBatched: true
                });
            }
            await loadCreationIds();
            invalidateReferenceData();
        } catch (error: any) {
            setNextWeekResult({ success: false, error: error.message || 'Network error' });
        } finally {
            setNextWeekBatchedCreating(false);
            setNextWeekBatchedProgress(null);
        }
    }

    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Orders</h2>
            <p className={styles.subtitle}>Create orders and manage order creation runs.</p>
            <p className={styles.toolsBar}>
                <Link href="/admin/cleanup" className={styles.toolsLink}>Cleanup</Link>
                <br />
                <Link href="/missing-orders" className={styles.toolsLink}>Validate client orders</Link>
            </p>

            {/* Create Orders (date-based) */}
            <div className={styles.card}>
                <h3 className={styles.sectionTitle}>Create Orders</h3>
                <p className={styles.description}>
                    Create orders for all scheduled upcoming orders. You will be prompted to select a date that will be used for order creation.
                </p>
                <div className={styles.formGroup}>
                    <button
                        className="btn btn-primary"
                        onClick={() => setShowDateDialog(true)}
                        disabled={simulating}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                        {simulating ? <RefreshCw className="spin" size={16} /> : <PlayCircle size={16} />}
                        {simulating ? 'Creating Orders...' : 'Create Orders'}
                    </button>
                </div>
                {simulationResult && (
                    <div className={styles.resultBox} style={{ borderColor: simulationResult.success ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        <div className={simulationResult.success ? styles.resultSuccess : styles.resultError}>{simulationResult.message}</div>
                        {simulationResult.skippedCount !== undefined && simulationResult.skippedCount > 0 && (
                            <div className={styles.resultMeta}>Skipped: {simulationResult.skippedCount} orders</div>
                        )}
                    </div>
                )}

                <div className={styles.formGroup} style={{ marginTop: 'var(--spacing-lg)', paddingTop: 'var(--spacing-lg)', borderTop: '1px solid var(--border-color)' }}>
                    <p className={styles.description} style={{ marginBottom: '0.75rem' }}>
                        Create orders for the next week (Sunday–Saturday) in one go. Uses upcoming orders only. Sends an Excel report to the Report Email addresses in Settings.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                        <button
                            className="btn btn-primary"
                            onClick={handleCreateOrdersNextWeek}
                            disabled={nextWeekCreating || nextWeekBatchedCreating}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            {nextWeekCreating ? <RefreshCw className="spin" size={16} /> : <CalendarDays size={16} />}
                            {nextWeekCreating ? 'Creating Orders...' : 'Create orders for the next week'}
                        </button>
                        <button
                            className="btn btn-secondary"
                            onClick={handleCreateOrdersNextWeekBatched}
                            disabled={nextWeekCreating || nextWeekBatchedCreating}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                            title={`Runs in batches of ${BATCH_SIZE} clients to avoid timeouts. One combined Excel download at the end (no email).`}
                        >
                            {nextWeekBatchedCreating ? <RefreshCw className="spin" size={16} /> : <Layers size={16} />}
                            {nextWeekBatchedCreating ? (nextWeekBatchedProgress ?? 'Creating…') : `Create orders (batched, ${BATCH_SIZE} per batch)`}
                        </button>
                    </div>
                </div>
                {nextWeekResult && (
                    <div className={styles.resultBox} style={{ marginTop: '1rem', borderColor: nextWeekResult.success ? 'var(--color-success)' : 'var(--color-danger)' }}>
                        <div className={nextWeekResult.success ? styles.resultSuccess : styles.resultError}>
                            {nextWeekResult.success
                                ? `Created ${nextWeekResult.totalCreated ?? 0} order(s) for ${nextWeekResult.weekStart ?? ''} to ${nextWeekResult.weekEnd ?? ''}.${nextWeekResult.failuresCount != null && nextWeekResult.failuresCount > 0 ? ` ${nextWeekResult.failuresCount} failed (see Failed Creations attachment in email).` : ' Report emailed.'}`
                                : nextWeekResult.error}
                        </div>
                        {nextWeekResult.success && nextWeekResult.breakdown && (
                            <div className={styles.resultMeta}>Food: {nextWeekResult.breakdown.Food} · Meal: {nextWeekResult.breakdown.Meal} · Boxes: {nextWeekResult.breakdown.Boxes} · Custom: {nextWeekResult.breakdown.Custom}</div>
                        )}
                        {nextWeekResult.success && nextWeekResult.failuresCount != null && nextWeekResult.failuresCount > 0 && (
                            <div className={styles.resultWarning}>Failed creations are in the email attachment (Customer Name, Order Type, Date, Why Failed).</div>
                        )}
                    </div>
                )}
            </div>

            {/* Create by Name */}
            <div className={styles.createByNameSection}>
                <CreateOrdersByName onSuccess={loadCreationIds} />
            </div>

            {/* Order Creation Management */}
            <div className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                <h3 className={styles.sectionTitle}>Order Creation Management</h3>
                <p className={styles.description}>
                    Manage orders by creation ID. Each round of order creation gets a unique numeric ID. You can delete all orders from a specific creation round.
                </p>
                {loadingCreationIds ? (
                    <div className={styles.loading}>
                        <RefreshCw className="spin" size={20} style={{ display: 'inline-block', marginRight: '0.5rem' }} />
                        Loading creation IDs...
                    </div>
                ) : creationIds.length === 0 ? (
                    <div className={styles.loading}>No orders with creation IDs found.</div>
                ) : (
                    <div style={{ marginTop: '1rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Creation ID</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Order Count</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Created At</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600 }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {creationIds.map((creation) => (
                                    <tr key={creation.creation_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td style={{ padding: '0.75rem' }}>{creation.creation_id}</td>
                                        <td style={{ padding: '0.75rem' }}>{creation.count}</td>
                                        <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                            {new Date(creation.created_at).toLocaleString('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                hour12: true
                                            })}
                                        </td>
                                        <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                            <button
                                                className="btn btn-danger"
                                                onClick={() => handleDeleteCreationId(creation.creation_id)}
                                                disabled={deletingCreationId === creation.creation_id}
                                                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                                            >
                                                {deletingCreationId === creation.creation_id ? <><RefreshCw className="spin" size={14} /> Deleting...</> : <><Trash2 size={14} /> Delete All</>}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div className={styles.warning}>
                            <AlertTriangle size={16} style={{ display: 'inline-block', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                            <strong>Warning:</strong> Deleting orders by creation ID will permanently remove all orders, order items, vendor selections, box selections, and related billing records for that creation round. This action cannot be undone.
                        </div>
                    </div>
                )}
            </div>

            {showDateDialog && (
                <div className={styles.modalOverlay}>
                    <div className={styles.modal}>
                        <div className={styles.modalHeader}>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Select Date for Order Creation</h3>
                            <button onClick={() => setShowDateDialog(false)} className={styles.modalClose}><X size={20} /></button>
                        </div>
                        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            This date will be used as the &quot;current date&quot; when creating orders. Orders will be created based on this date.
                        </p>
                        <div style={{ marginBottom: '1rem' }}>
                            <label className="label" style={{ marginBottom: '0.5rem' }}>Date</label>
                            <input type="date" className="input" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} style={{ width: '100%' }} />
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary" onClick={() => setShowDateDialog(false)} disabled={simulating}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleCreateOrders} disabled={simulating || !selectedDate} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                {simulating ? <><RefreshCw className="spin" size={16} /> Creating...</> : <><Calendar size={16} /> Create Orders</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
