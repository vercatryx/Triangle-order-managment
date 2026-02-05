'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
    getClientsWithoutUpcomingOrders,
    migrateClientToUpcoming,
    MigrationCandidate
} from '@/lib/actions-migration';
import {
    Loader2,
    CheckCircle,
    AlertTriangle,
    XCircle,
    ArrowRight,
    RefreshCw,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Database,
    Package,
    FileJson,
    ShoppingBag,
    Truck,
    Tag,
    FileText,
    ChevronDown,
    ChevronRight,
    Layers,
    Search
} from 'lucide-react';
import { toast } from 'sonner';
import styles from './page.module.css';

type SortField = 'clientName' | 'serviceType' | 'validationStatus';
type SortDirection = 'asc' | 'desc';

export default function MigrateUpcomingPage() {
    const [candidates, setCandidates] = useState<MigrationCandidate[]>([]);
    const [loading, setLoading] = useState(true);
    const [migratingId, setMigratingId] = useState<string | null>(null);
    const [sortField, setSortField] = useState<SortField>('clientName');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    /** For invalid_day: chosen replacement day per client (clientId -> day) */
    const [fixDayChoice, setFixDayChoice] = useState<Record<string, string>>({});
    const [searchQuery, setSearchQuery] = useState('');
    /** When running "Run all valid": { current (1-based), total, clientName } so we show "Migrating 3 of 12: Name" */
    const [runningAllProgress, setRunningAllProgress] = useState<{ current: number; total: number; clientName: string } | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    /** Ready to migrate: valid (no fix) or invalid_day (has day fix + available days) */
    const validCandidates = useMemo(
        () =>
            candidates.filter(
                c =>
                    c.orderDetails?.previewJson &&
                    (c.validationStatus === 'valid' ||
                        (c.validationStatus === 'invalid_day' && c.invalidDayFix?.availableDays?.length))
            ),
        [candidates]
    );

    async function loadData() {
        setLoading(true);
        try {
            const data = await getClientsWithoutUpcomingOrders();
            setCandidates(data);
        } catch (error) {
            console.error('Failed to load migration candidates:', error);
            toast.error('Failed to load data');
        } finally {
            setLoading(false);
        }
    }

    async function handleMigrate(candidate: MigrationCandidate) {
        if (migratingId) return;
        setMigratingId(candidate.clientId);
        try {
            const result = await migrateClientToUpcoming(candidate.clientId);
            if (result.success) {
                toast.success(`Migrated ${candidate.clientName} to upcoming orders`);
                setCandidates(prev => prev.filter(c => c.clientId !== candidate.clientId));
            } else {
                toast.error(`Migration failed: ${result.error}`);
            }
        } catch (error) {
            toast.error('An unexpected error occurred');
        } finally {
            setMigratingId(null);
        }
    }

    async function handleMigrateWithDayFix(candidate: MigrationCandidate) {
        const fix = candidate.invalidDayFix;
        if (!fix || migratingId) return;
        const newDay = fixDayChoice[candidate.clientId] ?? fix.availableDays[0];
        if (!newDay) {
            toast.error('Please select a delivery day');
            return;
        }
        setMigratingId(candidate.clientId);
        try {
            const result = await migrateClientToUpcoming(candidate.clientId, {
                replaceDay: { badDay: fix.badDay, newDay }
            });
            if (result.success) {
                toast.success(`Migrated ${candidate.clientName} (${fix.badDay} → ${newDay})`);
                setCandidates(prev => prev.filter(c => c.clientId !== candidate.clientId));
                setFixDayChoice(prev => { const next = { ...prev }; delete next[candidate.clientId]; return next; });
            } else {
                toast.error(`Migration failed: ${result.error}`);
            }
        } catch (error) {
            toast.error('An unexpected error occurred');
        } finally {
            setMigratingId(null);
        }
    }

    async function handleRunAllValid() {
        if (validCandidates.length === 0 || migratingId || runningAllProgress) return;
        const toRun = [...validCandidates];
        let done = 0;
        let failed = 0;
        setRunningAllProgress({ current: 0, total: toRun.length, clientName: toRun[0]?.clientName ?? '' });
        for (let i = 0; i < toRun.length; i++) {
            const candidate = toRun[i];
            setMigratingId(candidate.clientId);
            setRunningAllProgress({ current: i + 1, total: toRun.length, clientName: candidate.clientName });
            try {
                let result;
                if (candidate.validationStatus === 'invalid_day' && candidate.invalidDayFix) {
                    const fix = candidate.invalidDayFix;
                    const newDay = fixDayChoice[candidate.clientId] ?? fix.availableDays[0];
                    if (!newDay) {
                        failed++;
                        toast.error(`${candidate.clientName}: no delivery day selected`);
                        continue;
                    }
                    result = await migrateClientToUpcoming(candidate.clientId, {
                        replaceDay: { badDay: fix.badDay, newDay }
                    });
                } else {
                    result = await migrateClientToUpcoming(candidate.clientId);
                }
                if (result.success) {
                    done++;
                    setCandidates(prev => prev.filter(c => c.clientId !== candidate.clientId));
                    if (candidate.validationStatus === 'invalid_day') {
                        setFixDayChoice(prev => {
                            const next = { ...prev };
                            delete next[candidate.clientId];
                            return next;
                        });
                    }
                } else {
                    failed++;
                    toast.error(`${candidate.clientName}: ${result.error}`);
                }
            } catch {
                failed++;
                toast.error(`${candidate.clientName}: unexpected error`);
            }
        }
        setMigratingId(null);
        setRunningAllProgress(null);
        if (done > 0) toast.success(`Migrated ${done} client${done !== 1 ? 's' : ''}.`);
        if (failed > 0) toast.error(`${failed} failed.`);
    }

    function handleSort(field: SortField) {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    }

    const sortedCandidates = useMemo(() => {
        return [...candidates].sort((a, b) => {
            let valA: string | number = a[sortField];
            let valB: string | number = b[sortField];
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();
            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }, [candidates, sortField, sortDirection]);

    const filteredCandidates = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return sortedCandidates;
        return sortedCandidates.filter(
            c =>
                c.clientName.toLowerCase().includes(q) ||
                c.clientId.toLowerCase().includes(q)
        );
    }, [sortedCandidates, searchQuery]);

    function getStatusBadge(status: MigrationCandidate['validationStatus']) {
        let badgeClass = styles.statusBadge;
        let icon = <CheckCircle size={12} style={{ marginRight: 4 }} />;
        let text = 'Ready';
        switch (status) {
            case 'valid':
                badgeClass += ` ${styles.statusValid}`;
                break;
            case 'invalid_vendor':
                badgeClass += ` ${styles.statusError}`;
                icon = <XCircle size={12} style={{ marginRight: 4 }} />;
                text = 'Invalid Vendor';
                break;
            case 'invalid_day':
                badgeClass += ` ${styles.statusWarning}`;
                icon = <XCircle size={12} style={{ marginRight: 4 }} />;
                text = 'Invalid Day';
                break;
            case 'missing_vendor':
                badgeClass += ` ${styles.statusWarning}`;
                icon = <AlertTriangle size={12} style={{ marginRight: 4 }} />;
                text = 'No Vendor';
                break;
            case 'no_order_data':
                badgeClass += ` ${styles.statusNeutral}`;
                icon = <AlertTriangle size={12} style={{ marginRight: 4 }} />;
                text = 'No Data';
                break;
            default:
                badgeClass += ` ${styles.statusNeutral}`;
                text = 'Unknown';
        }
        return <span className={badgeClass}>{icon} {text}</span>;
    }

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return <ArrowUpDown size={14} className={styles.sortIcon} />;
        return sortDirection === 'asc' ? <ArrowUp size={14} className={styles.sortIcon} /> : <ArrowDown size={14} className={styles.sortIcon} />;
    };

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div className={styles.headerContent}>
                    <h1>Migrate to Upcoming Orders</h1>
                    <p className={styles.subtitle}>
                        Migrate order data <strong>into</strong> <strong>clients.upcoming_order</strong>. Candidates: all primary clients who don&apos;t yet have that column filled.
                        <strong> Sources:</strong> <strong>upcoming_orders table</strong>, <strong>active order</strong>, <strong>food</strong>, <strong>meal</strong>, <strong>box</strong>, <strong>custom</strong>.
                        Vendors are validated to deliver on selected days.
                    </p>
                </div>
                <div className={styles.actions}>
                    <button
                        onClick={handleRunAllValid}
                        className={`${styles.button} ${styles.buttonPrimary}`}
                        disabled={loading || validCandidates.length === 0 || !!migratingId || !!runningAllProgress}
                        title={validCandidates.length === 0 ? 'No migratable clients (valid or invalid day with day selected)' : `Migrate all ${validCandidates.length} client(s); invalid-day rows use currently selected day`}
                    >
                        {runningAllProgress ? (
                            <>
                                <Loader2 size={16} className={styles.spin} style={{ marginRight: 8 }} />
                                Running {runningAllProgress.current} of {runningAllProgress.total}…
                            </>
                        ) : (
                            <>
                                <ArrowRight size={16} style={{ marginRight: 8 }} />
                                Run all valid ({validCandidates.length})
                            </>
                        )}
                    </button>
                    <button
                        onClick={loadData}
                        className={`${styles.button} ${styles.buttonSecondary}`}
                        disabled={loading || !!runningAllProgress}
                    >
                        <RefreshCw size={16} className={loading ? styles.spin : ''} style={{ marginRight: 8 }} />
                        Refresh
                    </button>
                </div>
            </div>

            <div className={styles.card}>
                <div className={styles.cardHeader}>
                    <h2><Database size={18} /> Clients to migrate ({candidates.length})</h2>
                    <div className={styles.searchWrap}>
                        <Search size={18} className={styles.searchIcon} />
                        <input
                            type="search"
                            placeholder="Search by name or client ID…"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            className={styles.searchInput}
                            aria-label="Search clients"
                        />
                        {searchQuery.trim() && (
                            <span className={styles.searchCount}>
                                showing {filteredCandidates.length} of {candidates.length}
                            </span>
                        )}
                    </div>
                </div>

                {loading ? (
                    <div className={styles.loadingState}>
                        <Loader2 className={styles.spin} size={40} style={{ marginBottom: 16, color: '#3b82f6' }} />
                        <p>Fetching all primary clients in batches…</p>
                        <p className={styles.loadingHint}>This may take a few seconds for large datasets.</p>
                    </div>
                ) : candidates.length === 0 ? (
                    <div className={styles.emptyState}>
                        <CheckCircle size={48} color="#22c55e" style={{ marginBottom: 16 }} />
                        <h3>All clear</h3>
                        <p>No clients need migration (everyone either has no order data or already has upcoming orders).</p>
                    </div>
                ) : filteredCandidates.length === 0 ? (
                    <div className={styles.emptyState}>
                        <Search size={48} color="#6b7280" style={{ marginBottom: 16 }} />
                        <h3>No matches</h3>
                        <p>No clients match &quot;{searchQuery.trim()}&quot;. Try a different name or client ID.</p>
                    </div>
                ) : (
                    <>
                        {runningAllProgress && (
                            <div className={styles.runningBanner} role="status" aria-live="polite">
                                <Loader2 size={20} className={styles.spin} />
                                <span>
                                    Migrating <strong>{runningAllProgress.current}</strong> of <strong>{runningAllProgress.total}</strong>: {runningAllProgress.clientName}
                                </span>
                            </div>
                        )}
                    <div className={styles.tableContainer}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th className={styles.colExpand}></th>
                                    <th onClick={() => handleSort('clientName')} className={styles.colName}>
                                        <div className={styles.thContent}>Name <SortIcon field="clientName" /></div>
                                    </th>
                                    <th onClick={() => handleSort('serviceType')} className={styles.colType}>
                                        <div className={styles.thContent}>Type <SortIcon field="serviceType" /></div>
                                    </th>
                                    <th className={styles.colNewColumn}>
                                        <div className={styles.thContent}>Raw JSON → new column</div>
                                    </th>
                                    <th onClick={() => handleSort('validationStatus')} className={styles.colStatus}>
                                        <div className={styles.thContent}>Status <SortIcon field="validationStatus" /></div>
                                    </th>
                                    <th className={styles.colAction}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredCandidates.map((candidate) => {
                                    const isExpanded = expandedId === candidate.clientId;
                                    const preview = candidate.orderDetails?.previewJson ?? null;
                                    return (
                                        <React.Fragment key={candidate.clientId}>
                                            <tr
                                                className={`${styles.row} ${migratingId === candidate.clientId ? styles.rowRunning : ''}`}
                                                onClick={() => setExpandedId(isExpanded ? null : candidate.clientId)}
                                            >
                                                <td className={styles.colExpand}>
                                                    {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                                </td>
                                                <td className={styles.colName}>
                                                    <span className={styles.clientName}>{candidate.clientName}</span>
                                                    <div className={styles.clientId}>{candidate.clientId}</div>
                                                    {candidate.sourcesRead?.length > 0 && (
                                                        <div className={styles.sourcesRead}>
                                                            <Layers size={10} /> {candidate.sourcesRead.join(', ')}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className={styles.colType}>
                                                    <span className={styles.typeBadge}>{candidate.serviceType}</span>
                                                </td>
                                                <td className={styles.colNewColumn}>
                                                    <pre className={styles.cellJson} title="JSON that will be stored in the new column when you migrate">
                                                        {preview
                                                            ? JSON.stringify(preview)
                                                            : '—'}
                                                    </pre>
                                                </td>
                                                <td className={styles.colStatus}>
                                                    {getStatusBadge(candidate.validationStatus)}
                                                    {candidate.validationMessage && candidate.validationStatus !== 'valid' && (
                                                        <span className={styles.statusMessage}>{candidate.validationMessage}</span>
                                                    )}
                                                    {candidate.validationStatus === 'invalid_day' && candidate.invalidDayFix && (
                                                        <div className={styles.fixDayRow} onClick={e => e.stopPropagation()}>
                                                            <span className={styles.fixDayLabel}>Day to use:</span>
                                                            <select
                                                                className={styles.fixDaySelect}
                                                                value={fixDayChoice[candidate.clientId] ?? candidate.invalidDayFix.availableDays[0] ?? ''}
                                                                onChange={e => setFixDayChoice(prev => ({ ...prev, [candidate.clientId]: e.target.value }))}
                                                            >
                                                                {candidate.invalidDayFix.availableDays.map(d => (
                                                                    <option key={d} value={d}>{d}</option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className={styles.colAction} onClick={e => e.stopPropagation()}>
                                                    <button
                                                        onClick={() => {
                                                            if (candidate.validationStatus === 'invalid_day' && candidate.invalidDayFix) {
                                                                handleMigrateWithDayFix(candidate);
                                                            } else {
                                                                handleMigrate(candidate);
                                                            }
                                                        }}
                                                        disabled={
                                                            migratingId !== null ||
                                                            candidate.validationStatus === 'no_order_data' ||
                                                            !preview ||
                                                            (candidate.validationStatus === 'invalid_day' && !candidate.invalidDayFix?.availableDays?.length)
                                                        }
                                                        className={`${styles.button} ${(candidate.validationStatus === 'valid' || candidate.validationStatus === 'invalid_day') ? styles.buttonPrimary : styles.buttonSecondary}`}
                                                        style={{ width: '100%', justifyContent: 'center' }}
                                                        title={candidate.validationStatus === 'invalid_day' ? 'Migrate using the day currently selected above' : undefined}
                                                    >
                                                        {migratingId === candidate.clientId ? (
                                                            <><Loader2 size={14} className={styles.spin} style={{ marginRight: 6 }} /> Migrating…</>
                                                        ) : (
                                                            <><MigrateLabel /> Migrate</>
                                                        )}
                                                    </button>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr key={`${candidate.clientId}-detail`} className={styles.detailRow}>
                                                    <td colSpan={6} className={styles.detailCell}>
                                                        <div className={styles.detailGrid}>
                                                            <div className={styles.detailBlock}>
                                                                <div className={styles.detailBlockTitle}>
                                                                    <FileText size={12} /> Summary
                                                                </div>
                                                                <div className={styles.detailBox}>
                                                                    <DetailRow label="Case ID" value={candidate.orderDetails?.details?.caseId} icon={<Tag size={10} />} />
                                                                    <DetailRow label="Vendor(s)" value={candidate.orderDetails?.details?.vendorName} icon={<Truck size={10} />} />
                                                                    <DetailRow label="Delivery day(s)" value={candidate.orderDetails?.details?.deliveryDays?.join(', ')} />
                                                                    <DetailRow label="Box type" value={candidate.orderDetails?.details?.boxType} icon={<Package size={10} />} />
                                                                    <DetailRow label="Items / meals" value={candidate.orderDetails?.details?.items?.join(', ')} icon={<ShoppingBag size={10} />} />
                                                                </div>
                                                            </div>
                                                            <div className={styles.detailBlockWide}>
                                                                <div className={styles.detailBlockTitle}>
                                                                    <FileJson size={12} /> Preview: JSON that will be written to upcoming orders when you click Migrate
                                                                </div>
                                                                <pre className={styles.previewJson}>
                                                                    {preview
                                                                        ? JSON.stringify(preview, null, 2)
                                                                        : 'No merged order (nothing to migrate).'}
                                                                </pre>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    </>
                )}
            </div>
        </div>
    );
}

function MigrateLabel() {
    return <ArrowRight size={14} style={{ marginRight: 6 }} />;
}

function DetailRow({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
    if (value == null || value === '') return null;
    return (
        <div className={styles.detailRowLine}>
            <span className={styles.detailLabel}>{icon && <span className={styles.detailIcon}>{icon}</span>}{label}</span>
            <span className={styles.detailValue}>{value}</span>
        </div>
    );
}
