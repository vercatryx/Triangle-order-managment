'use client';

import React from 'react';
import { Vendor, MenuItem, MealCategory, MealItem } from '@/lib/types';
import { ShoppingCart, Package } from 'lucide-react';
import styles from './ClientPortal.module.css';

interface Props {
    orderConfig: any;
    vendors: Vendor[];
    menuItems: MenuItem[];
    mealCategories: MealCategory[];
    mealItems: MealItem[];
    // We might need to pass down handlers if we want items to be removable from here?
    // For now, let's keep it read-only summary as per request "summarizes everything".
}

export default function ClientPortalOrderSummary({
    orderConfig,
    vendors,
    menuItems,
    mealCategories,
    mealItems
}: Props) {

    // -- Calculation Helpers -- (similar to FoodServiceWidget but focused on display)

    const sections: {
        title: string;
        items: { name: string; qty: number; note?: string; value: number; sortOrder: number }[];
    }[] = [];

    // 1. Vendor Selections
    if (orderConfig.vendorSelections) {
        orderConfig.vendorSelections.forEach((selection: any) => {
            if (!selection.vendorId) return;
            const vendor = vendors.find(v => v.id === selection.vendorId);
            if (!vendor) return;

            const itemsList: { name: string; qty: number; note?: string; value: number; sortOrder: number }[] = [];

            // Helper to add item
            const addItem = (itemId: string, qty: number, note?: string) => {
                const item = menuItems.find(i => i.id === itemId);
                if (item && qty > 0) {
                    itemsList.push({
                        name: item.name,
                        qty: qty,
                        note: note,
                        value: (item.value || 0) * qty,
                        sortOrder: item.sortOrder ?? 0
                    });
                }
            };

            // Multi-day
            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                // For summary, we can flatten day structure or show per day? 
                // Request said "section for each vendor/meal type and each item".
                // Let's flatten for simplicity but maybe indicate day? 
                // Actually, if an item is ordered on Mon & Thu, it's 2 separate lines effectively in fulfillment.
                // Let's group by Item for "Total Qty" or list per day?
                // "Summarizes everything... section for each vendor... item and its note"
                // If notes differ by day, we must separate.

                for (const day of selection.selectedDeliveryDays) {
                    const dayItems = selection.itemsByDay[day] || {};
                    const dayNotes = selection.itemNotesByDay?.[day] || {};

                    Object.entries(dayItems).forEach(([itemId, qty]) => {
                        const note = dayNotes[itemId];
                        const item = menuItems.find(i => i.id === itemId);
                        if (item && (Number(qty) || 0) > 0) {
                            itemsList.push({
                                name: `${item.name} (${day})`, // Distinguish day
                                qty: Number(qty),
                                note: note as string,
                                value: (item.value || 0) * Number(qty),
                                sortOrder: item.sortOrder ?? 0
                            });
                        }
                    });
                }
            }
            // Flat / Single-Day
            else if (selection.items) {
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

    // 2. Meal Selections
    if (orderConfig.mealSelections) {
        Object.entries(orderConfig.mealSelections).forEach(([mealType, config]: [string, any]) => {
            const itemsList: { name: string; qty: number; note?: string; value: number; sortOrder: number }[] = [];

            if (config.items) {
                const notes = config.itemNotes || {};
                Object.entries(config.items).forEach(([itemId, qty]) => {
                    const item = mealItems.find(i => i.id === itemId);
                    if (item && (Number(qty) || 0) > 0) {
                        itemsList.push({
                            name: item.name,
                            qty: Number(qty),
                            note: notes[itemId],
                            value: (item.value || 0) * Number(qty),
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

    // 3. Boxes
    if (orderConfig.boxOrders && orderConfig.serviceType === 'Boxes') {
        // Boxes usually don't have individual items listed in the same way, but let's see.
        // They have "items" inside (custom box content).
        orderConfig.boxOrders.forEach((box: any, index: number) => {
            const itemsList: { name: string; qty: number; note?: string; value: number; sortOrder: number }[] = [];

            if (box.items) {
                const notes = box.itemNotes || {};
                Object.entries(box.items).forEach(([itemId, qty]) => {
                    const item = menuItems.find(i => i.id === itemId);
                    if (item && (Number(qty) || 0) > 0) {
                        itemsList.push({
                            name: item.name,
                            qty: Number(qty),
                            note: notes[itemId],
                            value: (item.value || 0) * Number(qty),
                            sortOrder: item.sortOrder ?? 0
                        });
                    }
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
