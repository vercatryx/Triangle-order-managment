'use client';

import React from 'react';
import { ClientProfile, Vendor, MenuItem, MealCategory, MealItem } from '@/lib/types';
import { Plus, Trash2, Calendar, Check, AlertTriangle } from 'lucide-react';
import styles from './ClientProfile.module.css'; // Assuming we can reuse styles

interface Props {
    orderConfig: any;
    setOrderConfig: (config: any) => void;
    client: ClientProfile;
    vendors: Vendor[];
    menuItems: MenuItem[];
    mealCategories: MealCategory[];
    mealItems: MealItem[];
}

export default function FoodServiceWidget({
    orderConfig,
    setOrderConfig,
    client,
    vendors,
    menuItems,
    mealCategories,
    mealItems
}: Props) {

    // -- LOGIC HELPERS --

    function getVendorMenuItems(vendorId: string) {
        return menuItems
            .filter(i => i.vendorId === vendorId && i.isActive)
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }

    function getVendorSelectionsForDay(day: string | null): any[] {
        if (!orderConfig.deliveryDayOrders) {
            return orderConfig.vendorSelections || [];
        }
        if (day && orderConfig.deliveryDayOrders[day]) {
            return orderConfig.deliveryDayOrders[day].vendorSelections || [];
        }
        // If getting all (null) but in multi-day format, we need to flatten/combine.
        let allSelections: any[] = [];
        if (orderConfig.deliveryDayOrders) {
            Object.values(orderConfig.deliveryDayOrders).forEach((dayOrder: any) => {
                if (dayOrder.vendorSelections) {
                    allSelections = [...allSelections, ...dayOrder.vendorSelections];
                }
            });
        }
        return allSelections;
    }

    function getVendorMealCount(vendorId: string, selection: any): number {
        if (!selection) return 0;
        // Handle per-vendor delivery days (itemsByDay)
        if (selection.itemsByDay && selection.selectedDeliveryDays) {
            let total = 0;
            for (const deliveryDay of selection.selectedDeliveryDays) {
                const dayItems = selection.itemsByDay[deliveryDay] || {};
                total += Object.entries(dayItems).reduce((sum: number, [itemId, qty]) => {
                    const item = menuItems.find(i => i.id === itemId);
                    // Use item.quotaValue for meal count, defaulting to 1
                    const multiplier = item ? (item.quotaValue || 1) : 1;
                    return sum + ((Number(qty) || 0) * multiplier);
                }, 0);
            }
            return total;
        }
        // Normal items structure
        if (!selection.items) return 0;
        let total = 0;
        for (const [itemId, qty] of Object.entries(selection.items)) {
            const item = menuItems.find(i => i.id === itemId);
            // Use item.quotaValue for meal count, defaulting to 1
            const multiplier = item ? (item.quotaValue || 1) : 1;
            total += ((qty as number) || 0) * multiplier;
        }
        return total;
    }

    function getTotalMealCountAllDays(): number {
        let total = 0;

        // If editing in 'vendorSelections' mode (transient state before save)
        if (orderConfig.vendorSelections) {
            for (const selection of orderConfig.vendorSelections) {
                total += getVendorMealCount(selection.vendorId, selection);
            }
        } else if (orderConfig.deliveryDayOrders) {
            // If in saved/multi-day format
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                // simple summation of items in that day
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const sel of daySelections) {
                    const items = sel.items || {};
                    total += Object.entries(items).reduce((sum: number, [itemId, qty]) => {
                        const item = menuItems.find(i => i.id === itemId);
                        // Use item.quotaValue for meal count, defaulting to 1
                        const multiplier = item ? (item.quotaValue || 1) : 1;
                        return sum + ((Number(qty) || 0) * multiplier);
                    }, 0);
                }
            }
        }

        // Include meal selections (Breakfast, Lunch, etc.)
        if (orderConfig.mealSelections) {
            for (const config of Object.values(orderConfig.mealSelections) as any[]) {
                if (config.items) {
                    for (const [itemId, qty] of Object.entries(config.items)) {
                        const item = mealItems.find(i => i.id === itemId);
                        const multiplier = item ? (item.quotaValue || 1) : 1;
                        total += (Number(qty) || 0) * multiplier;
                    }
                }
            }
        }

        return total;
    }

    // --- MEAL SELECTION HANDLERS ---

    function handleAddMeal(mealType: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (!newConfig.mealSelections) newConfig.mealSelections = {};
            if (!newConfig.mealSelections[mealType]) {
                newConfig.mealSelections[mealType] = {
                    vendorId: '', // User can select optional vendor
                    items: {}
                };
            }
            return newConfig;
        });
    }

    function handleRemoveMeal(mealType: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections) {
                delete newConfig.mealSelections[mealType];
                if (Object.keys(newConfig.mealSelections).length === 0) {
                    delete newConfig.mealSelections;
                }
            }
            return newConfig;
        });
    }

    function handleMealVendorChange(mealType: string, vendorId: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections && newConfig.mealSelections[mealType]) {
                newConfig.mealSelections[mealType].vendorId = vendorId;
            }
            return newConfig;
        });
    }

    function handleMealItemChange(mealType: string, itemId: string, qty: number) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections && newConfig.mealSelections[mealType]) {
                const updatedItems = { ...newConfig.mealSelections[mealType].items };
                if (qty > 0) {
                    updatedItems[itemId] = qty;
                } else {
                    delete updatedItems[itemId];
                }
                newConfig.mealSelections[mealType].items = updatedItems;
            }
            return newConfig;
        });
    }

    // --- VENDOR SELECTION HANDLERS (Generic/Lunch) ---

    function handleAddVendorBlock() {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (!newConfig.vendorSelections) newConfig.vendorSelections = [];
            newConfig.vendorSelections.push({
                vendorId: '',
                items: {}
            });
            return newConfig;
        });
    }

    function handleRemoveVendorBlock(index: number) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.vendorSelections) {
                const updated = [...newConfig.vendorSelections];
                updated.splice(index, 1);
                newConfig.vendorSelections = updated;
            }
            return newConfig;
        });
    }

    function handleVendorSelectionChange(index: number, vendorId: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.vendorSelections) {
                const updated = [...newConfig.vendorSelections];
                updated[index] = { ...updated[index], vendorId };
                newConfig.vendorSelections = updated;
            }
            return newConfig;
        });
    }

    function handleVendorItemChange(blockIndex: number, itemId: string, qty: number) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.vendorSelections && newConfig.vendorSelections[blockIndex]) {
                const updated = [...newConfig.vendorSelections];
                const block = { ...updated[blockIndex] };
                const items = { ...block.items };

                if (qty > 0) {
                    items[itemId] = qty;
                } else {
                    delete items[itemId];
                }
                block.items = items;
                updated[blockIndex] = block;
                newConfig.vendorSelections = updated;
            }
            return newConfig;
        });
    }

    // --- RENDER HELPERS ---

    const renderVendorBlocks = () => {
        const selections = orderConfig.vendorSelections || [];
        // If empty, show nothing? Or rely on Add button.
        // If selections is empty, we don't render any blocks.

        return selections.map((selection: any, index: number) => {
            const vendorId = selection.vendorId;
            const vendorItems = vendorId ? getVendorMenuItems(vendorId) : [];

            return (
                <div key={index} className={styles.vendorBlock}>
                    {/* Header */}
                    <div className={styles.vendorHeader}>
                        <select
                            className="input"
                            value={vendorId || ''}
                            onChange={(e) => handleVendorSelectionChange(index, e.target.value)}
                        >
                            <option value="">Select Vendor...</option>
                            {vendors
                                .filter(v => v.serviceTypes.includes('Food') && v.isActive)
                                .map(v => (
                                    <option key={v.id} value={v.id}>{v.name}</option>
                                ))}
                        </select>
                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleRemoveVendorBlock(index)}>
                            <Trash2 size={16} />
                        </button>
                    </div>

                    {/* Items */}
                    {vendorId && (
                        <div className={styles.menuItemsGrid}>
                            {vendorItems.map(item => {
                                const qty = selection.items?.[item.id] || 0;
                                return (
                                    <div key={item.id} className={styles.menuItemCard}>
                                        <div className={styles.menuItemName}>{item.name}</div>
                                        <div className={styles.quantityControl}>
                                            <button onClick={() => handleVendorItemChange(index, item.id, Math.max(0, qty - 1))} className="btn btn-secondary">-</button>
                                            <span>{qty}</span>
                                            <button onClick={() => handleVendorItemChange(index, item.id, qty + 1)} className="btn btn-secondary">+</button>
                                        </div>
                                    </div>
                                );
                            })}
                            {vendorItems.length === 0 && <span className={styles.hint}>No items available for this vendor.</span>}
                        </div>
                    )}
                </div>
            );
        });
    };

    const renderMealBlocks = () => {
        if (!orderConfig?.mealSelections) return null;
        return Object.entries(orderConfig.mealSelections).map(([mealType, config]: [string, any]) => {

            // Get categories for this meal type
            const subCategories = mealCategories.filter(c => c.mealType === mealType);

            return (
                <div key={mealType} className={styles.vendorBlock} style={{
                    borderLeft: '4px solid var(--color-primary)'
                }}>
                    {/* Header */}
                    <div className={styles.vendorHeader}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{mealType}</span>
                            <select
                                className="input"
                                style={{ padding: '4px 8px', fontSize: '0.9rem', maxWidth: '200px' }}
                                value={config.vendorId || ''}
                                onChange={(e) => {
                                    const newSelections = { ...orderConfig.mealSelections };
                                    newSelections[mealType] = {
                                        ...newSelections[mealType],
                                        vendorId: e.target.value || null
                                    };
                                    setOrderConfig({ ...orderConfig, mealSelections: newSelections });
                                }}
                            >
                                <option value="">Select Vendor (Optional)</option>
                                {vendors
                                    .filter(v => v.serviceTypes.includes('Food') && v.isActive)
                                    .map(v => (
                                        <option key={v.id} value={v.id}>{v.name}</option>
                                    ))}
                            </select>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleRemoveMeal(mealType)}>
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Items Grouped by Category */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {subCategories.map(subCat => {
                            const catItems = mealItems
                                .filter(i => i.categoryId === subCat.id)
                                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

                            if (catItems.length === 0) return null;

                            // Calculate quota for this specific category
                            let categorySelectedValue = 0;
                            if (config.items) {
                                for (const [itemId, qty] of Object.entries(config.items)) {
                                    const item = catItems.find(i => i.id === itemId); // only check items in this cat
                                    if (item) {
                                        categorySelectedValue += (item.quotaValue * (qty as number));
                                    }
                                }
                            }
                            const requiredValue = subCat.setValue;
                            const isInvalid = requiredValue !== undefined && requiredValue !== null && categorySelectedValue !== requiredValue;

                            return (
                                <div key={subCat.id} style={{
                                    border: isInvalid ? '1px solid #ef4444' : '1px solid transparent',
                                    padding: isInvalid ? '8px' : '0',
                                    borderRadius: '8px',
                                    backgroundColor: isInvalid ? '#fef2f2' : 'transparent'
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'baseline',
                                        marginBottom: '0.75rem',
                                        borderBottom: '1px solid var(--border-color)',
                                        paddingBottom: '0.25rem'
                                    }}>
                                        <h5 style={{
                                            fontSize: '0.9rem',
                                            fontWeight: 600,
                                            color: isInvalid ? '#ef4444' : 'var(--text-secondary)',
                                            margin: 0
                                        }}>
                                            {subCat.name}
                                        </h5>
                                        {requiredValue !== undefined && requiredValue !== null && (
                                            <span style={{ fontSize: '0.85em', color: isInvalid ? '#ef4444' : 'var(--text-secondary)' }}>
                                                Selected: {categorySelectedValue} / {requiredValue}
                                            </span>
                                        )}
                                    </div>
                                    <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                        {catItems.map(item => {
                                            const qty = config.items?.[item.id] || 0;
                                            return (
                                                <div key={item.id} className={styles.menuItemCard} style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)' }}>
                                                    <div style={{ marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>
                                                        {item.name}
                                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginLeft: '4px' }}>
                                                            (Value: {item.quotaValue})
                                                        </span>
                                                    </div>
                                                    <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <button onClick={() => handleMealItemChange(mealType, item.id, Math.max(0, qty - 1))} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                        <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                        <button onClick={() => handleMealItemChange(mealType, item.id, qty + 1)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                        {mealItems.filter(i => mealCategories.find(c => c.id === i.categoryId)?.mealType === mealType).length === 0 && (
                            <span className={styles.hint}>No items found for {mealType}.</span>
                        )}
                    </div>
                </div>
            );
        });
    };

    // Main Render Logic
    // Multi-day parsing logic for UI
    const isAlreadyMultiDay = orderConfig.deliveryDayOrders && typeof orderConfig.deliveryDayOrders === 'object';
    let currentSelections = orderConfig.vendorSelections || [];

    if (isAlreadyMultiDay && (!orderConfig.vendorSelections || orderConfig.vendorSelections.length === 0)) {
        // Convert saved deliveryDayOrders back to per-vendor format for editing if not already done
        const deliveryDays = Object.keys(orderConfig.deliveryDayOrders).sort();
        const vendorMap = new Map<string, any>();

        const vendorsByDay: { [day: string]: any[] } = {};
        for (const day of deliveryDays) {
            const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
            for (const sel of daySelections) {
                if (!sel.vendorId) continue;
                if (!vendorsByDay[day]) vendorsByDay[day] = [];
                vendorsByDay[day].push(sel);
            }
        }

        for (const day of deliveryDays) {
            for (const sel of vendorsByDay[day] || []) {
                if (!vendorMap.has(sel.vendorId)) {
                    vendorMap.set(sel.vendorId, {
                        vendorId: sel.vendorId,
                        selectedDeliveryDays: [],
                        itemsByDay: {}
                    });
                }
                const vendorSel = vendorMap.get(sel.vendorId);
                if (!vendorSel.selectedDeliveryDays.includes(day)) {
                    vendorSel.selectedDeliveryDays.push(day);
                }
                vendorSel.itemsByDay[day] = sel.items || {};
            }
        }
        if (Array.from(vendorMap.values()).length > 0) {
            currentSelections = Array.from(vendorMap.values());
        }
    }

    const selectionsToRender = (orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0)
        ? orderConfig.vendorSelections
        : currentSelections;

    const totalMeals = getTotalMealCountAllDays();

    return (
        <div className={styles.vendorsList}>
            {/* Budget Header */}
            <div className={styles.orderHeader} style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4>Your Selections</h4>
                    <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <div className={styles.budget} style={{
                            color: getTotalMealCountAllDays() > (client.approvedMealsPerWeek || 0) ? 'white' : 'inherit',
                            backgroundColor: getTotalMealCountAllDays() > (client.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'var(--bg-surface-hover)',
                            padding: '8px 12px',
                            borderRadius: '6px',
                            fontSize: '1rem',
                            fontWeight: 700,
                            border: getTotalMealCountAllDays() > (client.approvedMealsPerWeek || 0) ? '2px solid #991b1b' : 'none',
                            boxShadow: getTotalMealCountAllDays() > (client.approvedMealsPerWeek || 0) ? '0 2px 5px rgba(220, 38, 38, 0.3)' : 'none'
                        }}>
                            Meals: {getTotalMealCountAllDays()} / {client.approvedMealsPerWeek || 0}
                            {getTotalMealCountAllDays() > (client.approvedMealsPerWeek || 0) && <span style={{ marginLeft: '8px' }}>(OVER LIMIT)</span>}
                        </div>
                    </div>
                </div>
                {/* Meal Buttons - Moved to Top */}
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                    <button
                        className="btn btn-primary"
                        onClick={handleAddVendorBlock}
                    >
                        <Plus size={16} /> Add Vendor
                    </button>
                    {Array.from(new Set(mealCategories.map(c => c.mealType)))
                        .filter(type => !orderConfig?.mealSelections?.[type])
                        .map(type => (
                            <button
                                key={type}
                                className="btn btn-secondary"
                                onClick={() => handleAddMeal(type)}
                                style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                            >
                                <Plus size={16} /> Add {type}
                            </button>
                        ))}
                </div>

                {getTotalMealCountAllDays() > (client.approvedMealsPerWeek || 0) && (
                    <div style={{
                        padding: '12px',
                        backgroundColor: '#fee2e2',
                        border: '1px solid #ef4444',
                        borderRadius: '6px',
                        color: '#b91c1c',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginTop: '8px',
                        width: '100%'
                    }}>
                        <AlertTriangle size={24} />
                        <span>You have exceeded your meal allowance of {client.approvedMealsPerWeek || 0} meals. Please remove some items.</span>
                    </div>
                )}
            </div>

            {/* Generic Vendor Blocks (Main/Lunch) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
                {renderVendorBlocks()}
            </div>



            {/* Meal blocks are now the primary UI */}
            {renderMealBlocks()}




        </div >
    );
}
