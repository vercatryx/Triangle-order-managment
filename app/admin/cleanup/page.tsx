'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ClientProfileDetail } from '@/components/clients/ClientProfile';
import {
    getStatuses,
    getNavigators,
    getVendors,
    getBoxTypes,
    getMenuItems,
    getMealItems,
    getSettings,
    getCategories,
    getEquipment,
    getMealCategories,
    getClients
} from '@/lib/cached-data';
import { getRegularClients } from '@/lib/actions';
import type { ClientStatus, Navigator, Vendor, MenuItem, BoxType, AppSettings, ItemCategory, MealCategory, MealItem } from '@/lib/types';
import styles from './Cleanup.module.css';

interface MealIssue {
    clientId: string;
    clientName: string;
    invalidKeys: string[];
    invalidRootMealType: string | null;
}

interface VendorDayIssue {
    clientId: string;
    clientName: string;
    orderDeliveryDay: string;
    vendorId: string;
    vendorName: string;
    vendorSupportedDays: string[];
    serviceType: string;
    itemCount: number;
}

interface InvalidVendorIssue {
    clientId: string;
    clientName: string;
    vendorId: string;
    vendorName?: string;
    isActive: boolean;
    where: 'deliveryDayOrders' | 'mealSelections' | 'vendorSelections' | 'boxOrders';
    day?: string;
    mealKey?: string;
    serviceType: string;
    boxIndex?: number;
}

interface ItemDayIssue {
    clientId: string;
    clientName: string;
    orderDeliveryDay: string;
    vendorId: string;
    vendorName: string;
    itemId: string;
    itemName: string;
    itemAllowedDays: string[];
    quantity: number;
    serviceType: string;
}

interface DeletedMenuItemIssue {
    clientId: string;
    clientName: string;
    orderDeliveryDay: string | null;
    vendorId: string;
    vendorName: string;
    itemId: string;
    quantity: number;
    serviceType: string;
    where: 'deliveryDayOrders' | 'vendorSelections';
}

interface BoxQuotaMismatch {
    boxIndex: number;
    boxTypeId: string;
    boxTypeName: string;
    categoryId: string;
    categoryName: string;
    required: number;
    actual: number;
}

interface BoxQuotaIssue {
    clientId: string;
    clientName: string;
    mismatches: BoxQuotaMismatch[];
}

interface DeletedBoxItemIssue {
    clientId: string;
    clientName: string;
    missingItems: { itemId: string; quantity: number; boxIndex: number }[];
}

function issueKeyVendor(issue: InvalidVendorIssue): string {
    return `${issue.clientId}-${issue.vendorId}-${issue.where}-${issue.day ?? ''}-${issue.mealKey ?? ''}-${issue.boxIndex ?? ''}`;
}

export default function CleanupPage() {
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const [validMealTypes, setValidMealTypes] = useState<string[]>([]);
    const [mealIssues, setMealIssues] = useState<MealIssue[]>([]);
    const [vendorDayIssues, setVendorDayIssues] = useState<VendorDayIssue[]>([]);
    const [invalidVendorIssues, setInvalidVendorIssues] = useState<InvalidVendorIssue[]>([]);
    const [itemDayIssues, setItemDayIssues] = useState<ItemDayIssue[]>([]);
    const [deletedMenuItemIssues, setDeletedMenuItemIssues] = useState<DeletedMenuItemIssue[]>([]);
    const [boxQuotaIssues, setBoxQuotaIssues] = useState<BoxQuotaIssue[]>([]);
    const [deletedBoxItemIssues, setDeletedBoxItemIssues] = useState<DeletedBoxItemIssue[]>([]);
    const [activeVendors, setActiveVendors] = useState<{ id: string; name: string }[]>([]);

    const [cleaningMealClientId, setCleaningMealClientId] = useState<string | null>(null);
    const [cleanAllMealInProgress, setCleanAllMealInProgress] = useState(false);
    const [selectedMealClients, setSelectedMealClients] = useState<Set<string>>(new Set());

    const [reassignDay, setReassignDay] = useState<Record<string, string>>({});
    const [reassigningDay, setReassigningDay] = useState<string | null>(null);
    const [reassignItemDay, setReassignItemDay] = useState<Record<string, string>>({});
    const [reassigningItemDay, setReassigningItemDay] = useState<string | null>(null);
    const [removingDeletedItem, setRemovingDeletedItem] = useState<string | null>(null);
    const [removingDeletedBoxItemsClientId, setRemovingDeletedBoxItemsClientId] = useState<string | null>(null);

    const [profileClientId, setProfileClientId] = useState<string | null>(null);
    const [profileLookupsReady, setProfileLookupsReady] = useState(false);
    const [profileLookups, setProfileLookups] = useState<{
        statuses: ClientStatus[];
        navigators: Navigator[];
        vendors: Vendor[];
        menuItems: MenuItem[];
        boxTypes: BoxType[];
        settings: AppSettings | null;
        categories: ItemCategory[];
        mealCategories: MealCategory[];
        mealItems: MealItem[];
        equipment: any[];
        allClients: any[];
        regularClients: any[];
    } | null>(null);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            const res = await fetch('/api/cleanup-clients-upcoming');
            const data = await res.json();
            if (data.success) {
                setValidMealTypes(data.validMealTypes || []);
                setMealIssues(data.mealIssues || []);
                setVendorDayIssues(data.vendorDayIssues || []);
                setInvalidVendorIssues(data.invalidVendorIssues || []);
                setItemDayIssues(data.itemDayIssues || []);
                setDeletedMenuItemIssues(data.deletedMenuItemIssues || []);
                setBoxQuotaIssues(data.boxQuotaIssues || []);
                setDeletedBoxItemIssues(data.deletedBoxItemIssues || []);
                setActiveVendors(data.activeVendors || []);
                setSelectedMealClients(new Set());
                const dayInitial: Record<string, string> = {};
                (data.vendorDayIssues || []).forEach((m: VendorDayIssue) => {
                    const key = `${m.clientId}-${m.orderDeliveryDay}-${m.vendorId}`;
                    dayInitial[key] = m.vendorSupportedDays[0] || '';
                });
                setReassignDay(dayInitial);
                const itemDayInitial: Record<string, string> = {};
                (data.itemDayIssues || []).forEach((m: ItemDayIssue) => {
                    const key = `${m.clientId}-${m.orderDeliveryDay}-${m.vendorId}-${m.itemId}`;
                    itemDayInitial[key] = m.itemAllowedDays[0] || '';
                });
                setReassignItemDay(itemDayInitial);
            } else {
                setMessage({ type: 'error', text: data.error || 'Failed to load' });
            }
        } catch (e: unknown) {
            setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Network error' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // Load lookups when opening profile modal (same as dashboard)
    useEffect(() => {
        if (!profileClientId) {
            setProfileLookupsReady(false);
            setProfileLookups(null);
            return;
        }
        let cancelled = false;
        setProfileLookupsReady(false);
        (async () => {
            try {
                const [sData, nData, vData, bData, mData, mealData, appSettings, catData, eData, mealCatData, allClients, regClients] = await Promise.all([
                    getStatuses(),
                    getNavigators(),
                    getVendors(),
                    getBoxTypes(),
                    getMenuItems(),
                    getMealItems(),
                    getSettings(),
                    getCategories(),
                    getEquipment(),
                    getMealCategories(),
                    getClients(),
                    getRegularClients()
                ]);
                if (cancelled) return;
                setProfileLookups({
                    statuses: sData,
                    navigators: nData,
                    vendors: vData,
                    menuItems: mData,
                    boxTypes: bData,
                    settings: appSettings,
                    categories: catData,
                    mealCategories: mealCatData,
                    mealItems: mealData as MealItem[],
                    equipment: eData,
                    allClients: allClients || [],
                    regularClients: regClients || []
                });
                setProfileLookupsReady(true);
            } catch (e) {
                console.error('Error loading profile lookups:', e);
            }
        })();
        return () => { cancelled = true; };
    }, [profileClientId]);

    const runFix = async (body: Record<string, unknown>) => {
        setMessage(null);
        try {
            const res = await fetch('/api/cleanup-clients-upcoming', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (data.success) {
                setMessage({ type: 'success', text: data.message || 'Done.' });
                fetchAll();
            } else {
                setMessage({ type: 'error', text: data.error || 'Fix failed' });
            }
        } catch (e: unknown) {
            setMessage({ type: 'error', text: e instanceof Error ? e.message : 'Request failed' });
        }
    };

    const handleCleanMealOne = async (issue: MealIssue) => {
        setCleaningMealClientId(issue.clientId);
        await runFix({
            fix: 'meal',
            clientId: issue.clientId,
            removeMealSelectionKeys: issue.invalidKeys,
            clearMealType: !!issue.invalidRootMealType
        });
        setCleaningMealClientId(null);
    };

    const handleCleanMealSelected = async () => {
        if (selectedMealClients.size === 0) {
            setMessage({ type: 'error', text: 'Select at least one client.' });
            return;
        }
        setCleanAllMealInProgress(true);
        for (const clientId of selectedMealClients) {
            const issue = mealIssues.find((m) => m.clientId === clientId);
            if (issue) {
                await runFix({
                    fix: 'meal',
                    clientId: issue.clientId,
                    removeMealSelectionKeys: issue.invalidKeys,
                    clearMealType: !!issue.invalidRootMealType
                });
            }
        }
        setCleanAllMealInProgress(false);
        fetchAll();
    };

    const handleCleanMealAll = async () => {
        if (!confirm('Clean all invalid meal types in clients.upcoming_order?')) return;
        setCleanAllMealInProgress(true);
        for (const issue of mealIssues) {
            await runFix({
                fix: 'meal',
                clientId: issue.clientId,
                removeMealSelectionKeys: issue.invalidKeys,
                clearMealType: !!issue.invalidRootMealType
            });
        }
        setCleanAllMealInProgress(false);
        fetchAll();
    };

    const toggleMealClient = (clientId: string) => {
        setSelectedMealClients((prev) => {
            const next = new Set(prev);
            if (next.has(clientId)) next.delete(clientId);
            else next.add(clientId);
            return next;
        });
    };

    const handleReassignDay = async (m: VendorDayIssue) => {
        const key = `${m.clientId}-${m.orderDeliveryDay}-${m.vendorId}`;
        const newDay = reassignDay[key] || m.vendorSupportedDays[0];
        if (!newDay || newDay === m.orderDeliveryDay) return;
        setReassigningDay(key);
        await runFix({
            fix: 'vendorDay',
            clientId: m.clientId,
            oldDay: m.orderDeliveryDay,
            newDay,
            vendorId: m.vendorId
        });
        setReassigningDay(null);
    };

    const itemDayKey = (m: ItemDayIssue) => `${m.clientId}-${m.orderDeliveryDay}-${m.vendorId}-${m.itemId}`;

    const handleMoveItemDay = async (m: ItemDayIssue) => {
        const key = itemDayKey(m);
        const newDay = reassignItemDay[key] || m.itemAllowedDays[0];
        if (!newDay || newDay === m.orderDeliveryDay) return;
        setReassigningItemDay(key);
        await runFix({
            fix: 'itemDay',
            clientId: m.clientId,
            oldDay: m.orderDeliveryDay,
            newDay,
            vendorId: m.vendorId,
            itemId: m.itemId
        });
        setReassigningItemDay(null);
    };

    const deletedItemKey = (m: DeletedMenuItemIssue) => `${m.clientId}-${m.orderDeliveryDay ?? 'flat'}-${m.vendorId}-${m.itemId}`;

    const handleRemoveDeletedItem = async (m: DeletedMenuItemIssue) => {
        const key = deletedItemKey(m);
        setRemovingDeletedItem(key);
        await runFix({
            fix: 'deletedItem',
            clientId: m.clientId,
            vendorId: m.vendorId,
            itemId: m.itemId,
            orderDeliveryDay: m.orderDeliveryDay ?? undefined,
            where: m.where
        });
        setRemovingDeletedItem(null);
    };

    const handleCloseProfile = () => {
        setProfileClientId(null);
        fetchAll();
    };

    const handleRemoveDeletedBoxItems = async (issue: DeletedBoxItemIssue) => {
        const itemIds = [...new Set(issue.missingItems.map((m) => m.itemId))];
        setRemovingDeletedBoxItemsClientId(issue.clientId);
        await runFix({ fix: 'deletedBoxItems', clientId: issue.clientId, itemIds });
        setRemovingDeletedBoxItemsClientId(null);
    };

    const mealTotal = mealIssues.length;
    const totalIssues = mealTotal + vendorDayIssues.length + invalidVendorIssues.length + itemDayIssues.length + deletedMenuItemIssues.length + boxQuotaIssues.length + deletedBoxItemIssues.length;

    return (
        <div className={styles.container}>
            <Link href="/admin" className={styles.backLink}>
                ← Back to Admin
            </Link>
            <div className={styles.header}>
                <h1 className={styles.title}>Cleanup </h1>

            </div>

            {message && (
                <div className={message.type === 'success' ? styles.successMessage : styles.errorMessage}>
                    {message.text}
                </div>
            )}

            {loading ? (
                <div className={styles.loading}>
                    <div className={styles.spinner} />
                    Loading…
                </div>
            ) : (
                <>
                    <div className={styles.statsBar}>
                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Invalid meal types</div>
                            <div className={`${styles.statValue} ${mealTotal > 0 ? styles.statValueWarning : ''}`}>{mealTotal}</div>
                        </div>
                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Vendor day mismatch</div>
                            <div className={`${styles.statValue} ${vendorDayIssues.length > 0 ? styles.statValueWarning : ''}`}>
                                {vendorDayIssues.length}
                            </div>
                        </div>
                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Vendor missing/inactive</div>
                            <div className={`${styles.statValue} ${invalidVendorIssues.length > 0 ? styles.statValueWarning : ''}`}>
                                {invalidVendorIssues.length}
                            </div>
                        </div>
                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Item on disallowed day</div>
                            <div className={`${styles.statValue} ${itemDayIssues.length > 0 ? styles.statValueWarning : ''}`}>
                                {itemDayIssues.length}
                            </div>
                        </div>
                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Deleted menu item</div>
                            <div className={`${styles.statValue} ${deletedMenuItemIssues.length > 0 ? styles.statValueWarning : ''}`}>
                                {deletedMenuItemIssues.length}
                            </div>
                        </div>
                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Box quota mismatch</div>
                            <div className={`${styles.statValue} ${boxQuotaIssues.length > 0 ? styles.statValueWarning : ''}`}>
                                {boxQuotaIssues.length}
                            </div>
                        </div>
                        <div className={styles.statCard}>
                            <div className={styles.statLabel}>Deleted items in box orders</div>
                            <div className={`${styles.statValue} ${deletedBoxItemIssues.length > 0 ? styles.statValueWarning : ''}`}>
                                {deletedBoxItemIssues.length}
                            </div>
                        </div>
                        <button className={styles.refreshButton} onClick={fetchAll} disabled={loading}>
                            ↻ Refresh
                        </button>
                    </div>

                    {totalIssues === 0 && (
                        <div className={styles.emptyState}>
                            <div className={styles.emptyIcon}>✓</div>
                            <p>No issues found in clients.upcoming_order.</p>
                        </div>
                    )}

                    {/* Section 1: Invalid meal types */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>1. Invalid meal types</h2>
                        <p className={styles.sectionDesc}>
                            Valid types: {validMealTypes.length ? validMealTypes.join(', ') : '(none)'}. Clients whose upcoming_order has invalid mealSelections keys or mealType.
                        </p>
                        {mealTotal > 0 && (
                            <>
                                <div className={styles.bulkActions}>
                                    <button
                                        className={styles.btnCleanSelected}
                                        onClick={handleCleanMealSelected}
                                        disabled={selectedMealClients.size === 0 || cleanAllMealInProgress}
                                    >
                                        Clean selected ({selectedMealClients.size})
                                    </button>
                                    <button
                                        className={styles.btnCleanAll}
                                        onClick={handleCleanMealAll}
                                        disabled={cleanAllMealInProgress}
                                    >
                                        {cleanAllMealInProgress ? 'Cleaning…' : `Clean all (${mealTotal})`}
                                    </button>
                                </div>
                                <div className={styles.table}>
                                    <div className={styles.tableHeader}>
                                        <div className={`${styles.tableRow} ${styles.rowMeal}`}>
                                            <div className={styles.tableHeaderCell} style={{ width: 32 }}></div>
                                            <div className={styles.tableHeaderCell}>Client</div>
                                            <div className={styles.tableHeaderCell}>Invalid keys / mealType</div>
                                            <div className={styles.tableHeaderCell}>Fix</div>
                                        </div>
                                    </div>
                                    {mealIssues.map((issue) => (
                                        <div key={issue.clientId} className={styles.tableRowWrapper}>
                                            <div className={`${styles.tableRow} ${styles.rowMeal}`}>
                                                <div className={styles.tableCell}>
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedMealClients.has(issue.clientId)}
                                                        onChange={() => toggleMealClient(issue.clientId)}
                                                    />
                                                </div>
                                                <div className={styles.tableCell}>
                                                    <Link href={`/clients?id=${issue.clientId}`} className={styles.clientLink}>
                                                        {issue.clientName}
                                                    </Link>
                                                </div>
                                                <div className={`${styles.tableCell} ${styles.invalidKeys}`}>
                                                    {issue.invalidKeys.length > 0 && <span>Keys: {issue.invalidKeys.join(', ')}</span>}
                                                    {issue.invalidKeys.length > 0 && issue.invalidRootMealType && ' · '}
                                                    {issue.invalidRootMealType && <span>mealType: {issue.invalidRootMealType}</span>}
                                                </div>
                                                <div className={styles.tableCell}>
                                                    <button
                                                        className={`${styles.actionButton} ${styles.btnClean}`}
                                                        onClick={() => handleCleanMealOne(issue)}
                                                        disabled={cleaningMealClientId === issue.clientId}
                                                    >
                                                        {cleaningMealClientId === issue.clientId ? '…' : 'Clean'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                        {mealTotal === 0 && (
                            <div className={styles.emptyState}>No invalid meal type issues.</div>
                        )}
                    </section>

                    {/* Section 2: Vendor day mismatch */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>2. Vendor delivery day mismatch</h2>
                        <p className={styles.sectionDesc}>
                            Order is on a day this vendor does not deliver. Choose a new day and fix.
                        </p>
                        {vendorDayIssues.length === 0 && (
                            <div className={styles.emptyState}>No vendor day mismatches.</div>
                        )}
                        {vendorDayIssues.length > 0 && (
                            <div className={styles.table}>
                                <div className={styles.tableHeader}>
                                    <div className={`${styles.tableRow} ${styles.rowDay}`}>
                                        <div className={styles.tableHeaderCell}>Client</div>
                                        <div className={styles.tableHeaderCell}>Vendor</div>
                                        <div className={styles.tableHeaderCell}>Current day</div>
                                        <div className={styles.tableHeaderCell}>Vendor’s days</div>
                                        <div className={styles.tableHeaderCell}>Reassign to</div>
                                        <div className={styles.tableHeaderCell}>Fix</div>
                                    </div>
                                </div>
                                {vendorDayIssues.map((m) => {
                                    const key = `${m.clientId}-${m.orderDeliveryDay}-${m.vendorId}`;
                                    const isReassigning = reassigningDay === key;
                                    return (
                                        <div key={key} className={styles.tableRowWrapper}>
                                            <div className={`${styles.tableRow} ${styles.rowDay}`}>
                                                <div className={styles.tableCell}>
                                                    <Link href={`/clients?id=${m.clientId}`} className={styles.clientLink}>
                                                        {m.clientName}
                                                    </Link>
                                                    <div className={styles.cellMeta}>{m.serviceType} · {m.itemCount} items</div>
                                                </div>
                                                <div className={styles.tableCell}>{m.vendorName}</div>
                                                <div className={styles.tableCell}>
                                                    <span className={styles.invalidDay}>{m.orderDeliveryDay}</span>
                                                </div>
                                                <div className={styles.tableCell}>
                                                    <span className={styles.cellMeta}>{m.vendorSupportedDays.join(', ') || 'None'}</span>
                                                </div>
                                                <div className={styles.tableCell}>
                                                    <select
                                                        className={styles.daySelect}
                                                        value={reassignDay[key] || ''}
                                                        onChange={(e) => setReassignDay((prev) => ({ ...prev, [key]: e.target.value }))}
                                                        disabled={isReassigning}
                                                    >
                                                        {(m.vendorSupportedDays.length ? m.vendorSupportedDays : ['—']).map((d) => (
                                                            <option key={d} value={d}>{d}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className={styles.tableCell}>
                                                    <button
                                                        className={`${styles.actionButton} ${styles.btnClean}`}
                                                        onClick={() => handleReassignDay(m)}
                                                        disabled={isReassigning || !reassignDay[key] || reassignDay[key] === m.orderDeliveryDay}
                                                    >
                                                        {isReassigning ? '…' : 'Fix'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {/* Section 3: Vendor missing/inactive — open profile to edit */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>3. Vendor missing or inactive</h2>
                        <p className={styles.sectionDesc}>
                            upcoming_order references a vendor that no longer exists or is inactive. Open the client profile to edit the order directly (same as on the dashboard).
                        </p>
                        {invalidVendorIssues.length === 0 && (
                            <div className={styles.emptyState}>No invalid vendor issues.</div>
                        )}
                        {invalidVendorIssues.length > 0 && (
                            <div className={styles.table}>
                                <div className={styles.tableHeader}>
                                    <div className={`${styles.tableRow} ${styles.rowVendor}`}>
                                        <div className={styles.tableHeaderCell}>Client</div>
                                        <div className={styles.tableHeaderCell}>Vendor</div>
                                        <div className={styles.tableHeaderCell}>Where</div>
                                        <div className={styles.tableHeaderCell}>Action</div>
                                    </div>
                                </div>
                                {invalidVendorIssues.map((issue) => {
                                    const key = issueKeyVendor(issue);
                                    const whereLabel = issue.where === 'deliveryDayOrders' ? `Day: ${issue.day}`
                                        : issue.where === 'mealSelections' ? `Meal: ${issue.mealKey || '—'}`
                                        : issue.where === 'vendorSelections' ? 'vendorSelections'
                                        : issue.where === 'boxOrders' ? `Box #${(issue.boxIndex ?? 0) + 1}` : issue.where;
                                    return (
                                        <div key={key} className={styles.tableRowWrapper}>
                                            <div className={`${styles.tableRow} ${styles.rowVendor}`}>
                                                <div className={styles.tableCell}>
                                                    <Link href={`/clients?id=${issue.clientId}`} className={styles.clientLink}>
                                                        {issue.clientName}
                                                    </Link>
                                                    <div className={styles.cellMeta}>{issue.serviceType}</div>
                                                </div>
                                                <div className={styles.tableCell}>
                                                    <span className={styles.invalidVendor}>
                                                        {issue.vendorName || issue.vendorId}
                                                        {!issue.isActive && ' (inactive)'}
                                                    </span>
                                                </div>
                                                <div className={styles.tableCell}>{whereLabel}</div>
                                                <div className={styles.tableCell}>
                                                    <button
                                                        className={`${styles.actionButton} ${styles.btnOpenProfile}`}
                                                        onClick={() => setProfileClientId(issue.clientId)}
                                                    >
                                                        Open profile
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {/* Section 4: Item on disallowed day */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>4. Item on disallowed day</h2>
                        <p className={styles.sectionDesc}>
                            A menu item is restricted to certain delivery days (in Menu Management) but appears on another day in this client&apos;s order. Choose an allowed day and move the item there.
                        </p>
                        {itemDayIssues.length === 0 && (
                            <div className={styles.emptyState}>No item-on-disallowed-day issues.</div>
                        )}
                        {itemDayIssues.length > 0 && (
                            <div className={styles.table}>
                                <div className={styles.tableHeader}>
                                    <div className={`${styles.tableRow} ${styles.rowItemDay}`}>
                                        <div className={styles.tableHeaderCell}>Client</div>
                                        <div className={styles.tableHeaderCell}>Current day</div>
                                        <div className={styles.tableHeaderCell}>Vendor</div>
                                        <div className={styles.tableHeaderCell}>Item</div>
                                        <div className={styles.tableHeaderCell}>Qty</div>
                                        <div className={styles.tableHeaderCell}>Allowed days</div>
                                        <div className={styles.tableHeaderCell}>Move to</div>
                                        <div className={styles.tableHeaderCell}>Fix</div>
                                    </div>
                                </div>
                                {itemDayIssues.map((m) => {
                                    const key = itemDayKey(m);
                                    const isReassigning = reassigningItemDay === key;
                                    return (
                                        <div key={key} className={styles.tableRowWrapper}>
                                            <div className={`${styles.tableRow} ${styles.rowItemDay}`}>
                                                <div className={styles.tableCell}>
                                                    <Link href={`/clients?id=${m.clientId}`} className={styles.clientLink}>
                                                        {m.clientName}
                                                    </Link>
                                                    <div className={styles.cellMeta}>{m.serviceType}</div>
                                                </div>
                                                <div className={styles.tableCell}>
                                                    <span className={styles.invalidDay}>{m.orderDeliveryDay}</span>
                                                </div>
                                                <div className={styles.tableCell}>{m.vendorName}</div>
                                                <div className={styles.tableCell}>{m.itemName}</div>
                                                <div className={styles.tableCell}>{m.quantity}</div>
                                                <div className={styles.tableCell}>
                                                    <span className={styles.cellMeta}>{m.itemAllowedDays.join(', ') || 'None'}</span>
                                                </div>
                                                <div className={styles.tableCell}>
                                                    <select
                                                        className={styles.daySelect}
                                                        value={reassignItemDay[key] || ''}
                                                        onChange={(e) => setReassignItemDay((prev) => ({ ...prev, [key]: e.target.value }))}
                                                        disabled={isReassigning}
                                                    >
                                                        {(m.itemAllowedDays.length ? m.itemAllowedDays : ['—']).map((d) => (
                                                            <option key={d} value={d}>{d}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className={styles.tableCell}>
                                                    <button
                                                        className={`${styles.actionButton} ${styles.btnClean}`}
                                                        onClick={() => handleMoveItemDay(m)}
                                                        disabled={isReassigning || !reassignItemDay[key] || reassignItemDay[key] === m.orderDeliveryDay}
                                                    >
                                                        {isReassigning ? '…' : 'Move'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {/* Section 5: Deleted menu item */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>5. Deleted menu item</h2>
                        <p className={styles.sectionDesc}>
                            The client&apos;s order references a menu item that no longer exists (was deleted). Remove it from the order.
                        </p>
                        {deletedMenuItemIssues.length === 0 && (
                            <div className={styles.emptyState}>No deleted menu item issues.</div>
                        )}
                        {deletedMenuItemIssues.length > 0 && (
                            <div className={styles.table}>
                                <div className={styles.tableHeader}>
                                    <div className={`${styles.tableRow} ${styles.rowDeletedItem}`}>
                                        <div className={styles.tableHeaderCell}>Client</div>
                                        <div className={styles.tableHeaderCell}>Day</div>
                                        <div className={styles.tableHeaderCell}>Vendor</div>
                                        <div className={styles.tableHeaderCell}>Item ID</div>
                                        <div className={styles.tableHeaderCell}>Qty</div>
                                        <div className={styles.tableHeaderCell}>Action</div>
                                    </div>
                                </div>
                                {deletedMenuItemIssues.map((m) => {
                                    const key = deletedItemKey(m);
                                    const isRemoving = removingDeletedItem === key;
                                    return (
                                        <div key={key} className={styles.tableRowWrapper}>
                                            <div className={`${styles.tableRow} ${styles.rowDeletedItem}`}>
                                                <div className={styles.tableCell}>
                                                    <Link href={`/clients?id=${m.clientId}`} className={styles.clientLink}>
                                                        {m.clientName}
                                                    </Link>
                                                    <div className={styles.cellMeta}>{m.serviceType}</div>
                                                </div>
                                                <div className={styles.tableCell}>
                                                    {m.orderDeliveryDay ?? '—'}
                                                </div>
                                                <div className={styles.tableCell}>{m.vendorName}</div>
                                                <div className={styles.tableCell}>
                                                    <span className={styles.invalidVendor}>{m.itemId}</span>
                                                </div>
                                                <div className={styles.tableCell}>{m.quantity}</div>
                                                <div className={styles.tableCell}>
                                                    <button
                                                        className={`${styles.actionButton} ${styles.btnClean}`}
                                                        onClick={() => handleRemoveDeletedItem(m)}
                                                        disabled={isRemoving}
                                                    >
                                                        {isRemoving ? '…' : 'Remove'}
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {/* Section 6: Box clients with category quota mismatch */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>6. Box clients — category quota off</h2>
                        <p className={styles.sectionDesc}>
                            Box clients whose upcoming order has one or more categories where the selected quota value does not match the required amount for that box type. Open the client profile to adjust items (same as on the clients dashboard).
                        </p>
                        {boxQuotaIssues.length === 0 && (
                            <div className={styles.emptyState}>No box quota mismatch issues.</div>
                        )}
                        {boxQuotaIssues.length > 0 && (
                            <div className={styles.table}>
                                <div className={styles.tableHeader}>
                                    <div className={`${styles.tableRow} ${styles.rowVendor}`}>
                                        <div className={styles.tableHeaderCell}>Client</div>
                                        <div className={styles.tableHeaderCell}>Mismatches</div>
                                        <div className={styles.tableHeaderCell}>Action</div>
                                    </div>
                                </div>
                                {boxQuotaIssues.map((issue) => (
                                    <div key={issue.clientId} className={styles.tableRowWrapper}>
                                        <div className={`${styles.tableRow} ${styles.rowVendor}`}>
                                            <div className={styles.tableCell}>
                                                <Link href={`/clients?id=${issue.clientId}`} className={styles.clientLink}>
                                                    {issue.clientName}
                                                </Link>
                                                <div className={styles.cellMeta}>Boxes · {issue.mismatches.length} category mismatch{issue.mismatches.length !== 1 ? 'es' : ''}</div>
                                            </div>
                                            <div className={styles.tableCell}>
                                                <ul className={styles.mismatchList}>
                                                    {issue.mismatches.map((m, i) => (
                                                        <li key={i}>
                                                            Box {m.boxIndex + 1} ({m.boxTypeName}): <strong>{m.categoryName}</strong> — {m.actual} / {m.required}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                            <div className={styles.tableCell}>
                                                <button
                                                    className={`${styles.actionButton} ${styles.btnOpenProfile}`}
                                                    onClick={() => setProfileClientId(issue.clientId)}
                                                >
                                                    Open profile
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Section 7: Clients with deleted items in box orders */}
                    <section className={styles.section}>
                        <h2 className={styles.sectionTitle}>7. Clients with deleted items in box orders</h2>
                        <p className={styles.sectionDesc}>
                            These clients have item IDs in their <strong>boxOrders</strong> that no longer exist in <strong>menu_items</strong> or <strong>breakfast_items</strong>. Open the client profile to remove or replace the missing items.
                        </p>
                        {deletedBoxItemIssues.length === 0 && (
                            <div className={styles.emptyState}>No clients with deleted box items.</div>
                        )}
                        {deletedBoxItemIssues.length > 0 && (
                            <div className={styles.table}>
                                <div className={styles.tableHeader}>
                                    <div className={`${styles.tableRow} ${styles.rowVendor}`}>
                                        <div className={styles.tableHeaderCell}>Client</div>
                                        <div className={styles.tableHeaderCell}>Missing items (item ID · qty · box #)</div>
                                        <div className={styles.tableHeaderCell}>Action</div>
                                    </div>
                                </div>
                                {deletedBoxItemIssues.map((issue) => (
                                    <div key={issue.clientId} className={styles.tableRowWrapper}>
                                        <div className={`${styles.tableRow} ${styles.rowVendor}`}>
                                            <div className={styles.tableCell}>
                                                <Link href={`/clients?id=${issue.clientId}`} className={styles.clientLink}>
                                                    {issue.clientName}
                                                </Link>
                                                <div className={styles.cellMeta}>Boxes · {issue.missingItems.length} missing item{issue.missingItems.length !== 1 ? 's' : ''}</div>
                                            </div>
                                            <div className={styles.tableCell}>
                                                <ul className={styles.mismatchList}>
                                                    {issue.missingItems.map((m, i) => (
                                                        <li key={i}>
                                                            <span className={styles.invalidVendor}>{m.itemId}</span> · qty {m.quantity} · Box {m.boxIndex + 1}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                            <div className={styles.tableCell}>
                                                <button
                                                    className={`${styles.actionButton} ${styles.btnClean}`}
                                                    onClick={() => handleRemoveDeletedBoxItems(issue)}
                                                    disabled={removingDeletedBoxItemsClientId === issue.clientId}
                                                    style={{ marginRight: '8px' }}
                                                >
                                                    {removingDeletedBoxItemsClientId === issue.clientId ? '…' : 'Remove deleted items'}
                                                </button>
                                                <button
                                                    className={`${styles.actionButton} ${styles.btnOpenProfile}`}
                                                    onClick={() => setProfileClientId(issue.clientId)}
                                                >
                                                    Open profile
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Profile modal (same as dashboard) */}
                    {profileClientId && (
                        <div className={styles.profileModal}>
                            <div className={styles.profileCard}>
                                {profileLookupsReady && profileLookups ? (
                                    <ClientProfileDetail
                                        clientId={profileClientId}
                                        statuses={profileLookups.statuses}
                                        navigators={profileLookups.navigators}
                                        vendors={profileLookups.vendors}
                                        menuItems={profileLookups.menuItems}
                                        boxTypes={profileLookups.boxTypes}
                                        settings={profileLookups.settings}
                                        categories={profileLookups.categories}
                                        mealCategories={profileLookups.mealCategories}
                                        mealItems={profileLookups.mealItems}
                                        equipment={profileLookups.equipment}
                                        allClients={profileLookups.allClients}
                                        regularClients={profileLookups.regularClients}
                                        onClose={handleCloseProfile}
                                    />
                                ) : (
                                    <div className={styles.profileModalLoading}>
                                        <div className={styles.spinner} />
                                        Loading profile…
                                    </div>
                                )}
                            </div>
                            <div
                                className={styles.profileOverlay}
                                onClick={handleCloseProfile}
                                aria-hidden
                            />
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
