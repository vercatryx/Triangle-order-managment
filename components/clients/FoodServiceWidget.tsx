'use client';

import React from 'react';
import { ClientProfile, Vendor, MenuItem, MealCategory, MealItem } from '@/lib/types';
import { isMeetingMinimum, isMeetingExactTarget } from '@/lib/utils';
import { Plus, Trash2, Calendar, Check, AlertTriangle, MessageSquare, Info } from 'lucide-react';
import { calculateVendorEffectiveDate } from '@/lib/order-dates';
import TextareaAutosize from 'react-textarea-autosize';
import styles from './ClientProfile.module.css';
import MenuItemCard from './MenuItemCard';

interface Props {
    orderConfig: any;
    setOrderConfig: (config: any) => void;
    client: ClientProfile;
    vendors: Vendor[];
    menuItems: MenuItem[];
    mealCategories: MealCategory[];
    mealItems: MealItem[];
    settings?: any; // AppSettings for take effect date
    isClientPortal?: boolean;
    validationStatus?: {
        isValid: boolean;
        totalValue: number;
        error: string | null;
    };
}

export default function FoodServiceWidget({
    orderConfig,
    setOrderConfig,
    client,
    vendors,
    menuItems,
    mealCategories,
    mealItems,
    settings,
    isClientPortal,
    validationStatus
}: Props) {


    // --- EFFECTIVE DATE BANNER LOGIC ---
    const renderEffectiveDateBanner = () => {
        if (!orderConfig) return null;

        const uniqueVendorIds = new Set<string>();
        // Collect vendors from either format
        if (orderConfig.deliveryDayOrders) {
            Object.values(orderConfig.deliveryDayOrders).forEach((dayOrder: any) => {
                if (dayOrder.vendorSelections) {
                    dayOrder.vendorSelections.forEach((s: any) => s.vendorId && uniqueVendorIds.add(s.vendorId));
                }
            });
        } else if (orderConfig.vendorSelections) {
            orderConfig.vendorSelections.forEach((s: any) => s.vendorId && uniqueVendorIds.add(s.vendorId));
        }

        const messages: React.ReactNode[] = [];
        uniqueVendorIds.forEach(vId => {
            const v = vendors.find(vend => vend.id === vId);
            if (v) {
                const cutoff = v.cutoffDays || 0;
                const effectiveDate = calculateVendorEffectiveDate(cutoff);
                const dateString = effectiveDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
                messages.push(
                    <div key={v.id}>
                        Changes for <strong>{v.name}</strong> will take effect from <strong>{dateString}</strong>.
                    </div>
                );
            }
        });

        if (messages.length > 0) {
            return (
                <div className={styles.alert} style={{ marginBottom: '1rem', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                    <Info size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
                        {messages}
                    </div>
                </div>
            );
        }
        return null;
    };

    // -- LOGIC HELPERS --

    function getVendorMenuItems(vendorId: string) {
        return menuItems
            .filter(i => i.vendorId === vendorId && i.isActive)
            .sort((a, b) => {
                const sortOrderA = a.sortOrder ?? 0;
                const sortOrderB = b.sortOrder ?? 0;
                if (sortOrderA !== sortOrderB) return sortOrderA - sortOrderB;
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });
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
        // Multi-day logic
        if (selection.itemsByDay && selection.selectedDeliveryDays) {
            let total = 0;
            for (const deliveryDay of selection.selectedDeliveryDays) {
                const dayItems = selection.itemsByDay[deliveryDay] || {};
                total += Object.entries(dayItems).reduce((sum: number, [itemId, qty]) => {
                    const item = menuItems.find(i => i.id === itemId);
                    // Use item.value for meal count
                    const multiplier = item ? (item.value || 0) : 0;
                    const val = ((Number(qty) || 0) * multiplier);
                    return sum + val;
                }, 0);
            }
            return total;
        }

        // Normal items structure
        if (!selection.items) return 0;
        let total = 0;

        // Calculate Days Count for Flat Mode multiplier (matching ClientPortalInterface validation)
        const daysCount = (selection.selectedDeliveryDays && selection.selectedDeliveryDays.length > 0)
            ? selection.selectedDeliveryDays.length
            : ((client as any).delivery_days?.length || 1);

        for (const [itemId, qty] of Object.entries(selection.items)) {
            const item = menuItems.find(i => i.id === itemId);
            // Use item.value for meal count
            const multiplier = item ? (item.value || 0) : 0;
            const val = ((qty as number) || 0) * multiplier * daysCount;
            total += val;
        }
        return total;
    }

    function getVendorMealCountForDay(vendorId: string, selection: any, day: string): number {
        if (!selection || !selection.itemsByDay || !selection.itemsByDay[day]) return 0;

        const dayItems = selection.itemsByDay[day] || {};
        return Object.entries(dayItems).reduce((sum: number, [itemId, qty]) => {
            const item = menuItems.find(i => i.id === itemId);
            const multiplier = item ? (item.value || 0) : 0;
            return sum + ((Number(qty) || 0) * multiplier);
        }, 0);
    }

    function getTotalMealCountAllDays(): number {
        // PREFER PASSED VALIDATION STATUS if available
        if (validationStatus) {
            return validationStatus.totalValue;
        }

        let total = 0;
        const countedItemIdsGlobally = new Set<string>();

        // If editing in 'vendorSelections' mode (transient state before save)
        if (orderConfig.vendorSelections) {
            for (const selection of orderConfig.vendorSelections) {
                const count = getVendorMealCount(selection.vendorId, selection);
                total += count;

                // Track IDs to prevent overlap with mealSelections
                if (selection.itemsByDay) {
                    Object.values(selection.itemsByDay).forEach((dayItems: any) => {
                        Object.keys(dayItems).forEach(id => countedItemIdsGlobally.add(id));
                    });
                } else if (selection.items) {
                    Object.keys(selection.items).forEach(id => countedItemIdsGlobally.add(id));
                }
            }
        } else if (orderConfig.deliveryDayOrders) {
            // If in saved/multi-day format
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                // simple summation of items in that day
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const sel of daySelections) {
                    const items = sel.items || {};
                    total += Object.entries(items).reduce((sum: number, [itemId, qty]) => {
                        countedItemIdsGlobally.add(itemId);
                        const item = menuItems.find(i => i.id === itemId);
                        // Use item.value for meal count
                        const multiplier = item ? (item.value || 0) : 0;
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
                        // OMIT if already counted in vendor selections
                        if (countedItemIdsGlobally.has(itemId)) continue;

                        const item = mealItems.find(i => i.id === itemId);
                        const multiplier = item ? (item.value || 0) : 0;
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

            // Create a unique key for this meal selection instance
            const uniqueKey = `${mealType}_${Date.now()}`;

            newConfig.mealSelections[uniqueKey] = {
                mealType, // Store the original meal type for filtering/labels
                vendorId: '', // User can select optional vendor
                items: {}
            };
            return newConfig;
        });
    }

    function handleRemoveMeal(uniqueKey: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections) {
                delete newConfig.mealSelections[uniqueKey];
                if (Object.keys(newConfig.mealSelections).length === 0) {
                    newConfig.mealSelections = {};
                }
            }
            return newConfig;
        });
    }

    function handleMealVendorChange(uniqueKey: string, vendorId: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections && newConfig.mealSelections[uniqueKey]) {
                const newSelections = { ...newConfig.mealSelections };
                newSelections[uniqueKey] = {
                    ...newSelections[uniqueKey],
                    vendorId
                };
                newConfig.mealSelections = newSelections;
            }
            return newConfig;
        });
    }

    function handleMealItemChange(uniqueKey: string, itemId: string, qty: number, note?: string) {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.mealSelections && newConfig.mealSelections[uniqueKey]) {
                const updatedItems = { ...newConfig.mealSelections[uniqueKey].items };
                const updatedNotes = { ...newConfig.mealSelections[uniqueKey].itemNotes };

                if (qty > 0) {
                    updatedItems[itemId] = qty;
                    if (note !== undefined) {
                        updatedNotes[itemId] = note;
                    }
                } else {
                    delete updatedItems[itemId];
                    delete updatedNotes[itemId];
                }

                const newSelections = { ...newConfig.mealSelections };
                newSelections[uniqueKey] = {
                    ...newSelections[uniqueKey],
                    items: updatedItems,
                    itemNotes: updatedNotes
                };
                newConfig.mealSelections = newSelections;
            }
            return newConfig;
        });
    }

    // --- VENDOR SELECTION HANDLERS (Generic/Lunch) ---

    function handleAddVendorBlock() {
        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            // FIX: Deep copy the array to prevent double-push in Strict Mode
            newConfig.vendorSelections = newConfig.vendorSelections ? [...newConfig.vendorSelections] : [];
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

                // Find vendor to check delivery days
                const vendor = vendors.find(v => v.id === vendorId);
                // Auto-select day if vendor only has one delivery day
                const autoSelectDay = (vendor?.deliveryDays?.length === 1) ? vendor.deliveryDays[0] : null;

                updated[index] = {
                    ...updated[index],
                    vendorId,
                    items: {},
                    itemsByDay: autoSelectDay ? { [autoSelectDay]: {} } : {},
                    selectedDeliveryDays: autoSelectDay ? [autoSelectDay] : []
                };
                newConfig.vendorSelections = updated;
            }
            return newConfig;
        });
    }

    function handleVendorItemChange(blockIndex: number, itemId: string, qty: number, day?: string, note?: string) {

        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.vendorSelections && newConfig.vendorSelections[blockIndex]) {
                const updated = [...newConfig.vendorSelections];
                const block = { ...updated[blockIndex] };

                // Handle multi-day format (itemsByDay)
                if (day && block.selectedDeliveryDays && block.selectedDeliveryDays.length > 0) {
                    if (!block.itemsByDay) block.itemsByDay = {};
                    if (!block.itemsByDay[day]) block.itemsByDay[day] = {};

                    // Ensure itemNotesByDay initialization
                    if (!block.itemNotesByDay) block.itemNotesByDay = {};
                    if (!block.itemNotesByDay[day]) block.itemNotesByDay[day] = {};

                    if (qty > 0) {
                        block.itemsByDay[day][itemId] = qty;

                        if (note !== undefined) {
                            if (note.trim() === '') {
                                delete block.itemNotesByDay[day][itemId];
                            } else {
                                block.itemNotesByDay[day][itemId] = note;
                            }
                        }
                    } else {
                        delete block.itemsByDay[day][itemId];
                        delete block.itemNotesByDay[day][itemId]; // Clean up note if item removed
                    }
                } else {
                    // Handle single-day format (items)
                    const items = { ...block.items };
                    const itemNotes = { ...(block.itemNotes || {}) };

                    if (qty > 0) {
                        items[itemId] = qty;
                        if (note !== undefined) {
                            if (note.trim() === '') {
                                delete itemNotes[itemId];
                            } else {
                                itemNotes[itemId] = note;
                            }
                        }
                    } else {
                        delete items[itemId];
                        delete itemNotes[itemId];
                    }
                    block.items = items;
                    block.itemNotes = itemNotes;
                }

                updated[blockIndex] = block;
                newConfig.vendorSelections = updated;
            }
            return newConfig;
        });
    }

    function handleDeliveryDayToggle(blockIndex: number, day: string) {

        setOrderConfig((prev: any) => {
            const newConfig = { ...prev };
            if (newConfig.vendorSelections && newConfig.vendorSelections[blockIndex]) {
                const updated = [...newConfig.vendorSelections];
                const block = { ...updated[blockIndex] };

                // Deep copy selectedDeliveryDays to avoid mutation
                block.selectedDeliveryDays = block.selectedDeliveryDays ? [...block.selectedDeliveryDays] : [];

                const dayIndex = block.selectedDeliveryDays.indexOf(day);
                if (dayIndex > -1) {
                    // Remove day
                    block.selectedDeliveryDays.splice(dayIndex, 1);

                    // Clean up itemsByDay for this day
                    if (block.itemsByDay) {
                        // Deep copy itemsByDay to avoid mutation
                        block.itemsByDay = { ...block.itemsByDay };
                        if (block.itemsByDay[day]) {
                            delete block.itemsByDay[day];
                        }
                    }

                    // If no days selected, revert to simple items structure
                    if (block.selectedDeliveryDays.length === 0) {
                        delete block.selectedDeliveryDays;
                        delete block.itemsByDay;
                        if (!block.items) block.items = {};
                    }
                } else {
                    // Add day
                    block.selectedDeliveryDays.push(day);
                    block.selectedDeliveryDays.sort(); // Sort makes UI consistent

                    // Initialize itemsByDay structure
                    if (!block.itemsByDay) {
                        block.itemsByDay = {};
                    } else {
                        block.itemsByDay = { ...block.itemsByDay };
                    }

                    if (!block.itemsByDay[day]) {
                        block.itemsByDay[day] = {};
                    }

                    // Clear the single-day items structure when switching to multi-day
                    if (block.items) {
                        block.items = {};
                    }
                }

                updated[blockIndex] = block;
                newConfig.vendorSelections = updated;
            }
            return newConfig;
        });
    }

    // --- RENDER HELPERS ---

    // State to track active tab for each vendor block
    const [activeDays, setActiveDays] = React.useState<{ [key: number]: string }>({});

    const renderVendorBlocks = () => {
        const selections = orderConfig.vendorSelections || [];

        return (
            <>
                {/* banner moved to sticky header */}
                {selections.map((selection: any, index: number) => {
                    const vendorId = selection.vendorId;
                    const vendor = vendors.find(v => v.id === vendorId);
                    const vendorItems = vendorId ? getVendorMenuItems(vendorId) : [];

                    // Calculate vendor meal count
                    const vendorMealCount = getVendorMealCount(vendorId, selection);
                    const vendorMinimum = vendor?.minimumMeals || 0;
                    const meetsMinimum = vendorMinimum === 0 || isMeetingMinimum(vendorMealCount, vendorMinimum);

                    // Get vendor's delivery days
                    const vendorDeliveryDays = vendor?.deliveryDays || [];
                    const hasMultipleDays = vendorDeliveryDays.length > 1;

                    // Check if multi-day mode is active for this vendor
                    const selectedDays = selection.selectedDeliveryDays || [];

                    return (
                        <div key={index} id={`vendor-block-${index}`} className={styles.vendorBlock}>
                            {/* Header */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                                <select
                                    className="input"
                                    value={vendorId || ''}
                                    onChange={(e) => handleVendorSelectionChange(index, e.target.value)}
                                >
                                    <option value="">Select Vendor...</option>
                                    {vendors
                                        .filter(v => {
                                            if (!v.serviceTypes.includes('Food') || !v.isActive) return false;

                                            // Feature: Filter by Client Location (if assigned)
                                            if (client.locationId) {
                                                const vendorHasLocation = v.locations?.some(l => l.locationId === client.locationId);
                                                if (!vendorHasLocation) return false;
                                            }

                                            // Feature: Filter out vendors already selected in OTHER blocks
                                            return !selections.some((s: any, idx: number) => s.vendorId === v.id && idx !== index);
                                        })
                                        .map(v => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                        ))}
                                </select>

                                {/* Multi-Day Selection - Toggle Buttons */}
                                {vendorId && hasMultipleDays && (
                                    <div style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '6px',
                                        padding: '8px',
                                        backgroundColor: 'var(--bg-surface-hover)',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-color)'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            <Calendar size={14} />
                                            <span style={{ fontWeight: 600 }}>Select Delivery Days:</span>
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                            {vendorDeliveryDays.map(day => {
                                                const isSelected = selectedDays.includes(day);
                                                return (
                                                    <button
                                                        key={day}
                                                        type="button"
                                                        onClick={() => {
                                                            handleDeliveryDayToggle(index, day);
                                                        }}
                                                        style={{
                                                            padding: '6px 14px',
                                                            backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--bg-surface)',
                                                            color: isSelected ? 'white' : 'var(--text-primary)',
                                                            borderRadius: '20px',
                                                            cursor: 'pointer',
                                                            fontSize: '0.85rem',
                                                            fontWeight: isSelected ? 600 : 400,
                                                            border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                                            transition: 'all 0.2s ease',
                                                            outline: 'none',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '6px'
                                                        }}
                                                    >
                                                        {day}
                                                        {isSelected && <Check size={12} />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleRemoveVendorBlock(index)}>
                                <Trash2 size={16} />
                            </button>


                            {/* Items Display */}
                            {
                                vendorId && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {hasMultipleDays && selectedDays.length === 0 ? (
                                            <div className={styles.hint} style={{ textAlign: 'center', padding: '1rem', fontStyle: 'italic', color: 'var(--text-tertiary)' }}>
                                                Please select at least one delivery day to view the menu.
                                            </div>
                                        ) : selectedDays.length > 0 ? (
                                            // Multi-day view - show STACKED menu blocks for each selected day
                                            selectedDays.map((day: string) => {
                                                const visibleItems = vendorItems.filter(item => {
                                                    if (!item.deliveryDays || item.deliveryDays.length === 0) return true;
                                                    return item.deliveryDays.includes(day);
                                                });

                                                return (
                                                    <div key={day} className="animate-in fade-in slide-in-from-top-1 duration-200" style={{
                                                        border: '1px solid var(--border-color)',
                                                        borderRadius: '8px',
                                                        padding: '16px',
                                                        backgroundColor: 'var(--bg-surface)'
                                                    }}>
                                                        <div style={{
                                                            marginBottom: '12px',
                                                            paddingBottom: '8px',
                                                            borderBottom: '1px solid var(--border-color)',
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center'
                                                        }}>
                                                            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '1rem' }}>
                                                                {day} Menu
                                                            </span>
                                                            {vendorMinimum > 0 && (() => {
                                                                const dayCount = getVendorMealCountForDay(vendorId, selection, day);
                                                                const dayMet = isMeetingMinimum(dayCount, vendorMinimum);
                                                                return (
                                                                    <span style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '6px',
                                                                        padding: '4px 8px',
                                                                        borderRadius: '6px',
                                                                        backgroundColor: dayMet ? '#d1fae5' : '#fee2e2',
                                                                        color: dayMet ? '#065f46' : '#991b1b',
                                                                        fontSize: '0.85rem',
                                                                        fontWeight: 600
                                                                    }}>
                                                                        {dayMet ? <Check size={14} /> : <AlertTriangle size={14} />}
                                                                        {dayCount} / {vendorMinimum} meals
                                                                    </span>
                                                                );
                                                            })()}
                                                        </div>

                                                        <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                                            {visibleItems.map(item => {
                                                                const dayItems = selection.itemsByDay?.[day] || {};
                                                                const qty = dayItems[item.id] || 0;
                                                                const dayNotes = selection.itemNotesByDay?.[day] || {};
                                                                const note = dayNotes[item.id] || '';

                                                                return (
                                                                    <MenuItemCard
                                                                        key={item.id}
                                                                        item={item}
                                                                        quantity={qty}
                                                                        note={note}
                                                                        onQuantityChange={(newQty) => handleVendorItemChange(index, item.id, newQty, day)}
                                                                        onNoteChange={(newNote) => handleVendorItemChange(index, item.id, qty, day, newNote)}
                                                                    />
                                                                );
                                                            })}
                                                            {visibleItems.length === 0 && <span className={styles.hint}>No items available for this day.</span>}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            // Single-day / No-day view (fallback for vendors without multiple delivery days or no days selected)
                                            <>
                                                {vendorMinimum > 0 && (
                                                    <div style={{
                                                        marginBottom: '1rem',
                                                        padding: '8px 12px',
                                                        borderRadius: '6px',
                                                        backgroundColor: meetsMinimum ? '#d1fae5' : '#fee2e2',
                                                        color: meetsMinimum ? '#065f46' : '#991b1b',
                                                        border: `1px solid ${meetsMinimum ? '#10b981' : '#ef4444'}`,
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        fontSize: '0.9rem',
                                                        fontWeight: 600
                                                    }}>
                                                        {meetsMinimum ? <Check size={16} /> : <AlertTriangle size={16} />}
                                                        <span>Minimum: {vendorMinimum} meals | Selected: {vendorMealCount} meals</span>
                                                    </div>
                                                )}
                                                <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                                                    {(() => {
                                                        // Filter for Flat View
                                                        // Determine implied days (Vendor's single day OR Client's default days)
                                                        let impliedDays: string[] = [];
                                                        if (vendorDeliveryDays.length === 1) {
                                                            impliedDays = vendorDeliveryDays;
                                                        } else if ((client as any).delivery_days && (client as any).delivery_days.length > 0) {
                                                            impliedDays = (client as any).delivery_days;
                                                        }

                                                        const visibleItems = vendorItems.filter(item => {
                                                            if (!item.deliveryDays || item.deliveryDays.length === 0) return true;
                                                            // If we have implied days, item must be valid for ALL of them
                                                            if (impliedDays.length > 0) {
                                                                return impliedDays.every(day => item.deliveryDays!.includes(day));
                                                            }
                                                            // If we don't know the days, hide restricted items to be safe
                                                            return false;
                                                        });

                                                        if (visibleItems.length === 0) return <span className={styles.hint}>No items available.</span>;

                                                        return visibleItems.map(item => {
                                                            const qty = selection.items?.[item.id] || 0;
                                                            const note = selection.itemNotes?.[item.id] || '';
                                                            return (
                                                                <MenuItemCard
                                                                    key={item.id}
                                                                    item={item}
                                                                    quantity={qty}
                                                                    note={note}
                                                                    onQuantityChange={(newQty) => handleVendorItemChange(index, item.id, newQty)}
                                                                    onNoteChange={(newNote) => handleVendorItemChange(index, item.id, qty, undefined, newNote)}
                                                                />
                                                            );
                                                        });
                                                    })()}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )
                            }
                        </div>
                    );
                })}
            </>
        );
    };

    const renderMealBlocks = () => {
        if (!orderConfig?.mealSelections) return null;
        return Object.entries(orderConfig.mealSelections).map(([uniqueKey, config]: [string, any]) => {
            const mealType = config.mealType || uniqueKey.split('_')[0];

            // Get categories for this meal type
            const subCategories = mealCategories
                .filter(c => c.mealType === mealType)
                .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

            return (
                <div key={uniqueKey} id={`meal-block-${uniqueKey}`} className={styles.vendorBlock} style={{
                    borderLeft: '4px solid var(--color-primary)'
                }}>
                    {/* Header */}
                    <div className={styles.vendorHeader}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{mealType}</span>
                            {!isClientPortal && (
                                <select
                                    className="input"
                                    style={{ padding: '4px 8px', fontSize: '0.9rem', maxWidth: '200px' }}
                                    value={config.vendorId || ''}
                                    onChange={(e) => handleMealVendorChange(uniqueKey, e.target.value)}
                                >
                                    <option value="">Select Vendor (Optional)</option>
                                    {vendors
                                        .filter(v => v.serviceTypes.includes('Food') && v.isActive)
                                        .map(v => (
                                            <option key={v.id} value={v.id}>{v.name}</option>
                                        ))}
                                </select>
                            )}
                            {isClientPortal && config.vendorId && (
                                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    {vendors.find(v => v.id === config.vendorId)?.name}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleRemoveMeal(uniqueKey)}>
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Items Grouped by Category */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {subCategories.map(subCat => {
                            const catItems = mealItems
                                .filter(i => i.categoryId === subCat.id)
                                .sort((a, b) => {
                                    const sortOrderA = a.sortOrder ?? 0;
                                    const sortOrderB = b.sortOrder ?? 0;
                                    if (sortOrderA !== sortOrderB) return sortOrderA - sortOrderB;
                                    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
                                });

                            if (catItems.length === 0) return null;

                            // Calculate quota for this specific category
                            let categorySelectedValue = 0;
                            if (config.items) {
                                for (const [itemId, qty] of Object.entries(config.items)) {
                                    const item = catItems.find(i => i.id === itemId); // only check items in this cat
                                    if (item) {
                                        categorySelectedValue += ((item.value || 0) * (qty as number));
                                    }
                                }
                            }
                            const requiredValue = subCat.setValue;
                            const isInvalid = requiredValue !== undefined && requiredValue !== null && !isMeetingExactTarget(categorySelectedValue, requiredValue);

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
                                    <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                                        {catItems.map(item => {
                                            const qty = config.items?.[item.id] || 0;
                                            return (
                                                <MenuItemCard
                                                    key={item.id}
                                                    item={item}
                                                    quantity={qty}
                                                    note={config.itemNotes?.[item.id] || ''}
                                                    onQuantityChange={(newQty) => handleMealItemChange(uniqueKey, item.id, newQty)}
                                                    onNoteChange={(newNote) => handleMealItemChange(uniqueKey, item.id, qty, newNote)}
                                                    contextLabel={mealType}
                                                />
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
                        itemsByDay: {},
                        itemNotesByDay: {}
                    });
                }
                const vendorSel = vendorMap.get(sel.vendorId);
                if (!vendorSel.selectedDeliveryDays.includes(day)) {
                    vendorSel.selectedDeliveryDays.push(day);
                }
                vendorSel.itemsByDay[day] = sel.items || {};

                // Populate item notes
                if (!vendorSel.itemNotesByDay) vendorSel.itemNotesByDay = {};
                vendorSel.itemNotesByDay[day] = sel.itemNotes || {};
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

    // Calculate take effect date
    const getTakeEffectDate = (): string | null => {
        if (!settings) return null;
        try {
            const now = new Date();
            const cutoffHour = settings.cutoffHour || 11;
            const cutoffMinute = settings.cutoffMinute || 0;
            const cutoffDay = settings.cutoffDay || 4; // Thursday = 4

            // Calculate the next Sunday (start of the delivery week)
            let nextSunday = new Date(now);
            nextSunday.setDate(now.getDate() + ((7 - now.getDay()) % 7 || 7));
            nextSunday.setHours(0, 0, 0, 0);

            // Check if we've passed the cutoff for this week
            const cutoffDate = new Date(nextSunday);
            cutoffDate.setDate(cutoffDate.getDate() - (7 - cutoffDay));
            cutoffDate.setHours(cutoffHour, cutoffMinute, 0, 0);

            if (now >= cutoffDate) {
                // Cutoff passed, move to next week
                nextSunday.setDate(nextSunday.getDate() + 7);
            }

            return nextSunday.toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch (error) {
            return null;
        }
    };

    const takeEffectDate = getTakeEffectDate();

    return (
        <div className={styles.vendorsList}>
            {/* Sticky Action Header - ADMIN ONLY (Portal has its own header) */}
            {!isClientPortal && (
                <div style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 40,
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(8px)',
                    borderBottom: '1px solid var(--border-color)',
                    padding: '12px 16px',
                    marginBottom: '16px',
                    boxShadow: '0 4px 20px -10px rgba(0, 0, 0, 0.05)',
                    margin: '-16px -16px 16px -16px', // Negative margin to stretch full width of container padding
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between', // Changed to space-between
                    flexWrap: 'wrap'
                }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        {/* Add Vendor Button - Food Only */}
                        {client.serviceType === 'Food' && (
                            <button
                                type="button"
                                onClick={handleAddVendorBlock}
                                className="btn btn-warning"
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    backgroundColor: '#fbbf24',
                                    border: 'none',
                                    color: 'black',
                                    fontWeight: 600,
                                    padding: '8px 16px',
                                    borderRadius: '8px',
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                    fontSize: '0.9rem'
                                }}
                            >
                                <Plus size={16} /> Add Vendor
                            </button>
                        )}
                        {/* Add Meal Buttons */}
                        {(() => {
                            const availableMealTypes = mealCategories
                                .map(c => c.mealType)
                                .filter((val, idx, arr) => arr.indexOf(val) === idx);

                            return availableMealTypes.map(type => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => handleAddMeal(type)}
                                    className="btn"
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        backgroundColor: '#fbbf24',
                                        border: 'none',
                                        color: 'black',
                                        fontWeight: 600,
                                        padding: '8px 16px',
                                        borderRadius: '8px',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                        fontSize: '0.9rem'
                                    }}
                                >
                                    <Plus size={16} /> Add {type}
                                </button>
                            ));
                        })()}
                    </div>


                    {/* Effective Date For Admin Header */}
                    {client.serviceType === 'Food' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>

                            {/* Meal Counter */}
                            {(() => {
                                const total = getTotalMealCountAllDays();
                                const limit = client.approvedMealsPerWeek || 0;
                                const isOver = limit > 0 && total > limit;

                                return (
                                    <div style={{
                                        padding: '6px 12px',
                                        borderRadius: '6px',
                                        backgroundColor: isOver ? '#fee2e2' : '#f3f4f6',
                                        color: isOver ? '#991b1b' : 'var(--text-secondary)',
                                        border: `1px solid ${isOver ? '#ef4444' : 'var(--border-color)'}`,
                                        fontSize: '0.9rem',
                                        fontWeight: 600,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}>
                                        {isOver ? <AlertTriangle size={16} /> : <Check size={16} />}
                                        <span>Items: {total} / {limit}</span>
                                    </div>
                                );
                            })()}

                            {/* Effective Date Banner */}
                            {(() => {
                                const banner = renderEffectiveDateBanner();
                                // We need to extract the content or re-render somewhat cleaner for header
                                // But re-using the logic is easiest.
                                // However, renderEffectiveDateBanner returns a div with margin/style.
                                // Let's just create a modified version right here inline or reuse the logic.
                                const uniqueVendorIds = new Set<string>();
                                if (orderConfig.deliveryDayOrders) {
                                    Object.values(orderConfig.deliveryDayOrders).forEach((dayOrder: any) => {
                                        if (dayOrder.vendorSelections) {
                                            dayOrder.vendorSelections.forEach((s: any) => s.vendorId && uniqueVendorIds.add(s.vendorId));
                                        }
                                    });
                                } else if (orderConfig.vendorSelections) {
                                    orderConfig.vendorSelections.forEach((s: any) => s.vendorId && uniqueVendorIds.add(s.vendorId));
                                }

                                const dates: React.ReactNode[] = [];
                                uniqueVendorIds.forEach(vId => {
                                    const v = vendors.find(vend => vend.id === vId);
                                    if (v) {
                                        const cutoff = v.cutoffDays || 0;
                                        // Pass delivery days to find the next actual delivery date
                                        const effectiveDate = calculateVendorEffectiveDate(cutoff, undefined, v.deliveryDays);
                                        const dateString = effectiveDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
                                        dates.push(
                                            <div key={v.id} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                Changes for <strong>{v.name}</strong>: <strong>{dateString}</strong>
                                            </div>
                                        );
                                    }
                                });

                                if (dates.length > 0) {
                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                            <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: '2px' }}>
                                                Changes Take Effect
                                            </div>
                                            {dates}
                                        </div>
                                    );
                                }
                                return null;
                            })()}
                        </div>
                    )}
                </div>
            )}

            {/* Generic Vendor Blocks (Main/Lunch) */}
            {/* Generic Vendor Blocks (Main/Lunch) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1rem' }}>
                {renderVendorBlocks()}
            </div>



            {/* Meal blocks are now the primary UI */}
            {renderMealBlocks()}




        </div >
    );
}
