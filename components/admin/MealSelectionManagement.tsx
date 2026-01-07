'use client';

import { useState, useEffect } from 'react';
import { MealCategory, MealItem } from '@/lib/types';
import { getMealCategories, addMealCategory, updateMealCategory, deleteMealCategory, getMealItems, addMealItem, updateMealItem, deleteMealItem, deleteMealType } from '@/lib/actions';
import { Plus, Edit2, Trash2, X, Check, Utensils } from 'lucide-react';
import styles from './BoxTypeManagement.module.css'; // Reusing styles

export function MealSelectionManagement() {
    const [categories, setCategories] = useState<MealCategory[]>([]);
    const [items, setItems] = useState<MealItem[]>([]);
    const [activeMealType, setActiveMealType] = useState<string>('Breakfast');
    const [mealTypes, setMealTypes] = useState<string[]>(['Breakfast', 'Lunch', 'Dinner']);

    // Category Creation
    const [isAddingCategory, setIsAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    const [newCategorySetValue, setNewCategorySetValue] = useState<string>('');

    // Inline Item Creation
    const [newItemName, setNewItemName] = useState('');
    const [newItemQuotaValue, setNewItemQuotaValue] = useState(1);
    const [newItemPrice, setNewItemPrice] = useState<number>(0);
    const [addingItemForCategory, setAddingItemForCategory] = useState<string | null>(null);

    // Category Editing
    const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
    const [tempCategoryName, setTempCategoryName] = useState('');
    const [tempCategorySetValue, setTempCategorySetValue] = useState<string>('');

    // Item Editing
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [tempItemName, setTempItemName] = useState('');
    const [tempItemQuotaValue, setTempItemQuotaValue] = useState<number>(1);
    const [tempItemPrice, setTempItemPrice] = useState<number>(0);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const [cData, iData] = await Promise.all([getMealCategories(), getMealItems()]);
        setCategories(cData);
        setItems(iData);

        // Extract unique meal types from data + defaults
        const existingTypes = Array.from(new Set(cData.map(c => c.mealType)));
        const allTypes = Array.from(new Set([...mealTypes, ...existingTypes]));
        setMealTypes(allTypes);
    }

    // --- MEAL TYPE MANAGEMENT ---
    function handleAddMealType() {
        const name = prompt("Enter new Meal Type name (e.g. 'Snack'):");
        if (name && name.trim()) {
            setMealTypes(prev => Array.from(new Set([...prev, name.trim()])));
            setActiveMealType(name.trim());
        }
    }

    async function handleDeleteMealType(type: string) {
        if (confirm(`Are you sure you want to delete '${type}'? This will remove ALL categories and items associated with it.`)) {
            await deleteMealType(type);
            await loadData();

            // Allow deleting defaults from the UI list if the user explicitly actioned it
            setMealTypes(prev => prev.filter(t => t !== type));
            if (activeMealType === type) {
                setActiveMealType(mealTypes.find(t => t !== type) || 'Breakfast');
            }
        }
    }

    // --- CATEGORY ACTIONS ---
    async function handleAddCategory() {
        if (!newCategoryName.trim()) return;
        const setValue = newCategorySetValue.trim() === '' ? null : parseInt(newCategorySetValue, 10);
        if (setValue !== null && (isNaN(setValue) || setValue <= 0)) {
            alert('Set value must be a positive number or empty');
            return;
        }

        await addMealCategory(activeMealType, newCategoryName, setValue);
        await loadData();

        setIsAddingCategory(false);
        setNewCategoryName('');
        setNewCategorySetValue('');
    }

    async function handleDeleteCategory(id: string) {
        const hasItems = items.some(i => i.categoryId === id);
        if (hasItems) {
            alert('Cannot delete category with items. Remove items first.');
            return;
        }
        if (confirm('Delete this category?')) {
            await deleteMealCategory(id);
            await loadData();
        }
    }

    async function handleUpdateCategory() {
        if (!editingCategoryId || !tempCategoryName.trim()) return;
        const setValue = tempCategorySetValue.trim() === '' ? null : parseInt(tempCategorySetValue, 10);
        if (setValue !== null && (isNaN(setValue) || setValue <= 0)) {
            alert('Set value must be a positive number or empty');
            return;
        }
        await updateMealCategory(editingCategoryId, tempCategoryName, setValue);
        await loadData();
        setEditingCategoryId(null);
    }

    // --- ITEM ACTIONS ---
    async function handleAddItem(categoryId: string) {
        if (!newItemName.trim()) return;
        if (newItemPrice < 0) {
            alert('Price cannot be negative');
            return;
        }

        await addMealItem({
            categoryId,
            name: newItemName,
            quotaValue: newItemQuotaValue,
            priceEach: newItemPrice > 0 ? newItemPrice : undefined,
            isActive: true
        });
        await loadData();

        setAddingItemForCategory(null);
        setNewItemName('');
        setNewItemQuotaValue(1);
        setNewItemPrice(0);
    }

    async function handleUpdateItem() {
        if (!editingItemId) return;
        if (tempItemPrice < 0) {
            alert('Price cannot be negative');
            return;
        }
        await updateMealItem(editingItemId, {
            name: tempItemName,
            quotaValue: tempItemQuotaValue,
            priceEach: tempItemPrice > 0 ? tempItemPrice : undefined
        });
        await loadData();
        setEditingItemId(null);
    }

    async function handleDeleteItem(id: string) {
        if (confirm('Delete this item?')) {
            await deleteMealItem(id);
            await loadData();
        }
    }

    // --- RENDER HELPERS ---
    const currentCategories = categories.filter(c => c.mealType === activeMealType);

    return (
        <div className={styles.container} style={{ flexDirection: 'column', display: 'flex', width: '100%', alignItems: 'stretch' }}>
            <div className={styles.header} style={{ marginBottom: '1rem', paddingBottom: '0.5rem' }}>
                <div>
                    <h2 className={styles.title}>Meal Selection Management</h2>
                    <p className={styles.subtitle}>Configure meals, categories, and items.</p>
                </div>
            </div>

            {/* MEAL TYPE TABS - Compact horizontal scroll if needed */}
            <div style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '1rem',
                overflowX: 'auto',
                paddingBottom: '0.5rem',
                borderBottom: '1px solid var(--border-color)',
                alignItems: 'center'
            }}>
                {mealTypes.map(type => {
                    const isActive = activeMealType === type;
                    return (
                        <div
                            key={type}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.5rem 1rem',
                                borderRadius: '9999px',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                backgroundColor: isActive ? 'var(--color-primary)' : 'rgba(255, 255, 255, 0.05)',
                                color: isActive ? '#000000' : 'var(--text-secondary)',
                                fontWeight: isActive ? 600 : 400,
                                border: isActive ? '1px solid var(--color-primary)' : '1px solid transparent',
                            }}
                            onClick={() => setActiveMealType(type)}
                            onMouseEnter={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                                    e.currentTarget.style.color = 'var(--text-primary)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                                    e.currentTarget.style.color = 'var(--text-secondary)';
                                }
                            }}
                        >
                            <Utensils size={14} />
                            <span>{type}</span>
                            {isActive && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteMealType(type);
                                    }}
                                    style={{
                                        marginLeft: '0.5rem',
                                        padding: '2px',
                                        borderRadius: '50%',
                                        border: 'none',
                                        background: 'rgba(0,0,0,0.1)',
                                        color: '#000',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                    }}
                                    title={`Delete ${type}`}
                                >
                                    <X size={12} />
                                </button>
                            )}
                        </div>
                    );
                })}
                <button
                    onClick={handleAddMealType}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.5rem 1rem',
                        borderRadius: '9999px',
                        border: '1px dashed var(--text-tertiary)',
                        background: 'transparent',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--text-primary)';
                        e.currentTarget.style.color = 'var(--text-primary)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--text-tertiary)';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                    }}
                >
                    <Plus size={14} /> Add Type
                </button>
            </div>

            {/* TOOLBAR */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 600 }}>{activeMealType} Menu</h3>
                <button
                    className="btn btn-primary"
                    onClick={() => setIsAddingCategory(true)}
                >
                    <Plus size={16} /> Add Category
                </button>
            </div>

            {/* ADD CATEGORY FORM */}
            {isAddingCategory && (
                <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--bg-surface-hover)', borderRadius: '6px', border: '1px solid var(--color-primary)' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                            className="input"
                            placeholder="Category Name (e.g., Starters, Main Course)"
                            value={newCategoryName}
                            onChange={e => setNewCategoryName(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                            autoFocus
                            style={{ flex: 1 }}
                        />
                        <input
                            type="number"
                            className="input"
                            placeholder="Set Value (opt)"
                            value={newCategorySetValue}
                            onChange={e => setNewCategorySetValue(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                            min="1"
                            style={{ width: '120px' }}
                            title="Required quota value for this category"
                        />
                        <button className="btn btn-primary" onClick={handleAddCategory}><Check size={16} /> Save</button>
                        <button className="btn btn-secondary" onClick={() => { setIsAddingCategory(false); setNewCategoryName(''); setNewCategorySetValue(''); }}><X size={16} /></button>
                    </div>
                </div>
            )}

            {/* CATEGORY LIST */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {currentCategories.length === 0 && !isAddingCategory && (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontStyle: 'italic', border: '1px dashed var(--border-color)', borderRadius: '6px' }}>
                        No categories for {activeMealType}. Add one to start.
                    </div>
                )}

                {currentCategories.map(cat => (
                    <div key={cat.id} style={{ background: 'var(--bg-surface-hover)', padding: '1rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                        {/* Category Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                            {editingCategoryId === cat.id ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                    <input
                                        className="input"
                                        value={tempCategoryName}
                                        onChange={e => setTempCategoryName(e.target.value)}
                                        style={{ flex: 1 }}
                                    />
                                    <input
                                        type="number"
                                        className="input"
                                        value={tempCategorySetValue}
                                        onChange={e => setTempCategorySetValue(e.target.value)}
                                        style={{ width: '100px' }}
                                        placeholder="Set Value"
                                    />
                                    <button onClick={handleUpdateCategory} style={{ color: 'var(--color-success)', background: 'transparent', border: 'none', cursor: 'pointer' }}><Check size={18} /></button>
                                    <button onClick={() => setEditingCategoryId(null)} style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
                                </div>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontWeight: 600, fontSize: '1rem' }}>{cat.name}</span>
                                        {cat.setValue && (
                                            <span style={{ fontSize: '0.75rem', background: 'var(--color-primary)', color: '#000', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
                                                Set: {cat.setValue}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <button onClick={() => {
                                            setEditingCategoryId(cat.id);
                                            setTempCategoryName(cat.name);
                                            setTempCategorySetValue(cat.setValue?.toString() || '');
                                        }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}><Edit2 size={16} /></button>
                                        <button onClick={() => handleDeleteCategory(cat.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-danger)' }}><Trash2 size={16} /></button>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* ITEMS */}
                        <div style={{ padding: '0.5rem', background: 'var(--bg-app)', borderRadius: '4px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                {items.filter(i => i.categoryId === cat.id).map(item => (
                                    editingItemId === item.id ? (
                                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface)', padding: '4px', borderRadius: '4px', border: '1px solid var(--color-primary)' }}>
                                            <input value={tempItemName} onChange={e => setTempItemName(e.target.value)} className="input" style={{ width: '120px', fontSize: '0.85rem', padding: '2px' }} />
                                            <input type="number" value={tempItemQuotaValue} onChange={e => setTempItemQuotaValue(Number(e.target.value))} className="input" style={{ width: '50px', fontSize: '0.85rem', padding: '2px' }} />
                                            <input type="number" value={tempItemPrice} onChange={e => setTempItemPrice(parseFloat(e.target.value))} className="input" style={{ width: '60px', fontSize: '0.85rem', padding: '2px' }} step="0.01" />
                                            <button onClick={handleUpdateItem} style={{ border: 'none', background: 'transparent', color: 'var(--color-success)', cursor: 'pointer' }}><Check size={14} /></button>
                                            <button onClick={() => setEditingItemId(null)} style={{ border: 'none', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={14} /></button>
                                        </div>
                                    ) : (
                                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface)', padding: '4px 10px', borderRadius: '4px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                                            <span>{item.name}</span>
                                            <span style={{ color: 'var(--text-tertiary)' }}>(x{item.quotaValue})</span>
                                            {item.priceEach && <span style={{ fontWeight: 600 }}>${item.priceEach.toFixed(2)}</span>}
                                            <button onClick={() => {
                                                setEditingItemId(item.id);
                                                setTempItemName(item.name);
                                                setTempItemQuotaValue(item.quotaValue);
                                                setTempItemPrice(item.priceEach || 0);
                                            }} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--text-primary)' }}><Edit2 size={12} /></button>
                                            <button onClick={() => handleDeleteItem(item.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, color: 'var(--text-tertiary)' }}><X size={12} /></button>
                                        </div>
                                    )
                                ))}
                            </div>

                            {/* ADD ITEM BTN/FORM */}
                            {addingItemForCategory === cat.id ? (
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input autoFocus placeholder="Name" value={newItemName} onChange={e => setNewItemName(e.target.value)} className="input" style={{ width: '150px', fontSize: '0.85rem', padding: '4px' }} onKeyDown={e => e.key === 'Enter' && handleAddItem(cat.id)} />
                                    <input type="number" placeholder="Qty" value={newItemQuotaValue} onChange={e => setNewItemQuotaValue(Number(e.target.value))} className="input" style={{ width: '60px', fontSize: '0.85rem', padding: '4px' }} min="1" />
                                    <input type="number" placeholder="Price" value={newItemPrice} onChange={e => setNewItemPrice(parseFloat(e.target.value))} className="input" style={{ width: '70px', fontSize: '0.85rem', padding: '4px' }} min="0" step="0.01" />
                                    <button className="btn btn-primary" style={{ padding: '2px 8px', fontSize: '0.8rem' }} onClick={() => handleAddItem(cat.id)}>Add</button>
                                    <button className="btn btn-secondary" style={{ padding: '2px 8px', fontSize: '0.8rem' }} onClick={() => setAddingItemForCategory(null)}>Cancel</button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => {
                                        setAddingItemForCategory(cat.id);
                                        setNewItemName('');
                                        setNewItemQuotaValue(1);
                                        setNewItemPrice(0);
                                    }}
                                    style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                                >
                                    <Plus size={14} /> Add Item
                                </button>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
