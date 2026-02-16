'use client';

import React, { useMemo } from 'react';
import { Vendor, MenuItem, MealCategory, MealItem, ItemCategory } from '@/lib/types';
import { getItemPoints } from '@/lib/utils';
import { ShoppingCart, Package } from 'lucide-react';
import styles from './ClientPortal.module.css';

function isItemActive(item: { isActive?: boolean; is_active?: boolean } | null | undefined): boolean {
    if (!item) return false;
    const v = (item as any).isActive ?? (item as any).is_active;
    return v === true;
}

function isVendorActive(v: { isActive?: boolean; is_active?: boolean } | null | undefined): boolean {
    if (!v) return false;
    const val = (v as any).isActive ?? (v as any).is_active;
    return val === true;
}

/** Same as center (ClientPortalInterface box section): item is available for this box if it matches vendor and is in an active category. */
function isMenuItemAvailableForBox(
    item: MenuItem,
    box: { vendorId?: string | null },
    activeCategoryIds: Set<string>
): boolean {
    if (!isItemActive(item)) return false;
    const catOk = item.categoryId != null && activeCategoryIds.has(item.categoryId);
    if (!catOk) return false;
    const vendorOk = !box.vendorId || (item.vendorId === box.vendorId) || (item.vendorId === null || item.vendorId === '');
    return vendorOk;
}

interface Props {
    orderConfig: any;
    vendors: Vendor[];
    menuItems: MenuItem[];
    mealCategories: MealCategory[];
    mealItems: MealItem[];
    categories?: ItemCategory[];
}

export default function ClientPortalOrderSummary({
    orderConfig,
    vendors,
    menuItems,
    mealCategories,
    mealItems,
    categories = []
}: Props) {
    const activeMenuItems = useMemo(() => menuItems.filter(i => isItemActive(i)), [menuItems]);
    const activeMealItems = useMemo(() => mealItems.filter(i => isItemActive(i)), [mealItems]);
    const activeVendors = useMemo(() => vendors.filter(v => isVendorActive(v)), [vendors]);
    const activeCategoryIds = useMemo(
        () => new Set((categories || []).filter(c => c.isActive !== false).map(c => c.id)),
        [categories]
    );

    const sections: {
        title: string;
        items: { name: string; qty: number; note?: string; value: number; sortOrder: number }[];
    }[] = [];

    if (orderConfig.vendorSelections) {
        orderConfig.vendorSelections.forEach((selection: any) => {
            if (!selection.vendorId) return;
            const vendor = activeVendors.find(v => v.id === selection.vendorId);
            if (!vendor) return;

            const vendorId = selection.vendorId;
            const itemsList: { name: string; qty: number; note?: string; value: number; sortOrder: number }[] = [];

            const addItem = (itemId: string, qty: number, note?: string) => {
                const item = activeMenuItems.find(i => i.id === itemId);
                const matchVendor = item && (item as any).vendorId === vendorId;
                const ok = !!item && matchVendor && qty > 0;
                if (ok && item) {
                    itemsList.push({
                        name: item.name,
                        qty: qty,
                        note: note,
                        value: getItemPoints(item) * qty,
                        sortOrder: item.sortOrder ?? 0
                    });
                }
            };

            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                for (const day of selection.selectedDeliveryDays) {
                    const dayItems = selection.itemsByDay[day] || {};
                    const dayNotes = selection.itemNotesByDay?.[day] || {};

                    Object.entries(dayItems).forEach(([itemId, qty]) => {
                        const q = Number(qty) || 0;
                        if (q <= 0) return;
                        const note = dayNotes[itemId];
                        const item = activeMenuItems.find(i => i.id === itemId);
                        const matchVendor = item && (item as any).vendorId === vendorId;
                        if (item && matchVendor) {
                            itemsList.push({
                                name: `${item.name} (${day})`,
                                qty: q,
                                note: note as string,
                                value: getItemPoints(item) * q,
                                sortOrder: item.sortOrder ?? 0
                            });
                        }
                    });
                }
            } else if (selection.items) {
                const notes = selection.itemNotes || {};
                Object.entries(selection.items).forEach(([itemId, qty]) => {
                    addItem(itemId, Number(qty), notes[itemId]);
                });
            }

            sections.push({
                title: vendor.name,
                items: itemsList.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
            });
        });
    }

    if (orderConfig.mealSelections) {
        Object.entries(orderConfig.mealSelections).forEach(([mealType, config]: [string, any]) => {
            const itemsList: { name: string; qty: number; note?: string; value: number; sortOrder: number }[] = [];

            if (config.items) {
                const notes = config.itemNotes || {};
                Object.entries(config.items).forEach(([itemId, qty]) => {
                    const q = Number(qty) || 0;
                    const item = activeMealItems.find(i => i.id === itemId);
                    if (item && q > 0) {
                        itemsList.push({
                            name: item.name,
                            qty: q,
                            note: notes[itemId],
                            value: getItemPoints(item) * q,
                            sortOrder: item.sortOrder ?? 0
                        });
                    }
                });
            }

            sections.push({
                title: `${mealType} Order`,
                items: itemsList.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
            });
        });
    }

    if (orderConfig.boxOrders && orderConfig.serviceType === 'Boxes') {
        orderConfig.boxOrders.forEach((box: any, index: number) => {
            const itemsList: { name: string; qty: number; note?: string; value: number; sortOrder: number }[] = [];

            if (box.items) {
                const notes = box.itemNotes || {};
                Object.entries(box.items).forEach(([itemId, qty]) => {
                    const q = Number(qty) || 0;
                    if (q <= 0) return;
                    const item = menuItems.find(i => i.id === itemId);
                    if (!item) return;
                    if (!isMenuItemAvailableForBox(item, box, activeCategoryIds)) return;
                    itemsList.push({
                        name: item.name,
                        qty: q,
                        note: notes[itemId],
                        value: getItemPoints(item) * q,
                        sortOrder: item.sortOrder ?? 0
                    });
                });
            }

            sections.push({
                title: `Box #${index + 1}`,
                items: itemsList.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
            });
        });
    }


    return (
        <div className={styles.summaryColumn} style={{ padding: '24px' }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginBottom: '24px',
                paddingBottom: '16px',
                borderBottom: '1px solid var(--border-color)'
            }}>
                <ShoppingCart size={20} color="var(--color-primary)" />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Order Summary</h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {sections.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        color: 'var(--text-tertiary)',
                        fontStyle: 'italic',
                        padding: '24px 0'
                    }}>
                        Your cart is empty.
                    </div>
                ) : (
                    sections.map((section, idx) => (
                        <div key={idx} className="summary-section">
                            <h3 style={{
                                fontSize: '0.9rem',
                                fontWeight: 600,
                                marginBottom: '12px',
                                color: 'var(--text-primary)',
                                backgroundColor: 'var(--bg-app)',
                                padding: '6px 10px',
                                borderRadius: '4px'
                            }}>
                                {section.title}
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {section.items.map((item, i) => (
                                    <div key={i} style={{
                                        paddingLeft: '10px',
                                        borderLeft: '2px solid var(--border-color)'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                                {item.name}
                                            </span>
                                            <span style={{
                                                background: 'var(--bg-surface-active)',
                                                fontSize: '0.8rem',
                                                fontWeight: 600,
                                                padding: '2px 6px',
                                                borderRadius: '12px',
                                                minWidth: '24px',
                                                textAlign: 'center'
                                            }}>
                                                {item.qty}
                                            </span>
                                        </div>
                                        {item.note && (
                                            <div style={{
                                                fontSize: '0.8rem',
                                                color: 'var(--text-tertiary)',
                                                marginTop: '4px',
                                                fontStyle: 'italic'
                                            }}>
                                                Note: "{item.note}"
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
