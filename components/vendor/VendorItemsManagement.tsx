'use client';

import { useState } from 'react';
import { Vendor, MenuItem } from '@/lib/types';
import { addVendorMenuItem, updateVendorMenuItem, deleteVendorMenuItem } from '@/lib/actions';
import { Plus, Edit2, Trash2, X, Check } from 'lucide-react';

interface Props {
    vendor: Vendor;
    menuItems: MenuItem[];
}

export function VendorItemsManagement({ vendor, menuItems: initialMenuItems }: Props) {
    const [menuItems, setMenuItems] = useState(initialMenuItems);
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<MenuItem>>({
        name: '',
        value: 0,
        priceEach: 0,
        isActive: true
    });

    function resetForm() {
        setFormData({
            name: '',
            value: 0,
            priceEach: 0,
            isActive: true,
            quotaValue: 1,
            categoryId: ''
        });
        setIsCreating(false);
        setEditingId(null);
    }

    function handleEditInit(item: MenuItem) {
        setFormData({ ...item });
        setEditingId(item.id);
        setIsCreating(false);
    }

    async function handleSubmit() {
        if (!formData.name) return;
        if (!formData.priceEach || formData.priceEach <= 0) {
            alert('Price must be greater than 0');
            return;
        }

        try {
            if (editingId) {
                await updateVendorMenuItem(editingId, formData);
            } else {
                await addVendorMenuItem({
                    ...formData,
                    vendorId: vendor.id
                } as Omit<MenuItem, 'id'>);
            }
            // Reload page to get updated data
            window.location.reload();
        } catch (error) {
            console.error('Error saving item:', error);
            alert('Failed to save item');
        }
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this menu item?')) {
            try {
                await deleteVendorMenuItem(id);
                // Reload page to get updated data
                window.location.reload();
            } catch (error) {
                console.error('Error deleting item:', error);
                alert('Failed to delete item');
            }
        }
    }

    return (
        <div style={{ padding: '2rem' }}>
            <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '1rem' }}>
                Menu Items
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                Manage your menu items for {vendor.name}
            </p>

            {!isCreating && !editingId && (
                <button
                    onClick={() => setIsCreating(true)}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.75rem 1.5rem',
                        backgroundColor: 'var(--color-primary)',
                        color: 'white',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        marginBottom: '2rem',
                        fontWeight: 500
                    }}
                >
                    <Plus size={16} />
                    Add Item
                </button>
            )}

            {(isCreating || editingId) && (
                <div style={{
                    backgroundColor: 'var(--bg-app)',
                    border: '1px solid var(--color-primary)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.5rem',
                    marginBottom: '2rem'
                }}>
                    <h3 style={{ marginBottom: '1rem', fontWeight: 600 }}>
                        {editingId ? 'Edit Item' : 'New Item'}
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                                Item Name
                            </label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                style={{
                                    width: '100%',
                                    padding: '0.75rem',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-sm)',
                                    backgroundColor: 'var(--bg-surface)',
                                    color: 'var(--text-primary)'
                                }}
                                autoFocus
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                                    Value (Price/Points)
                                </label>
                                <input
                                    type="number"
                                    value={formData.value}
                                    onChange={e => setFormData({ ...formData, value: Number(e.target.value) })}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-sm)',
                                        backgroundColor: 'var(--bg-surface)',
                                        color: 'var(--text-primary)'
                                    }}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                                    Price Each *
                                </label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={formData.priceEach ?? ''}
                                    onChange={e => setFormData({ ...formData, priceEach: Number(e.target.value) || undefined })}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-sm)',
                                        backgroundColor: 'var(--bg-surface)',
                                        color: 'var(--text-primary)'
                                    }}
                                />
                            </div>
                        </div>
                        <div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                />
                                <span style={{ fontSize: '0.875rem' }}>Active</span>
                            </label>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                                onClick={handleSubmit}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.75rem 1.5rem',
                                    backgroundColor: 'var(--color-primary)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 'var(--radius-md)',
                                    cursor: 'pointer',
                                    fontWeight: 500
                                }}
                            >
                                <Check size={16} />
                                Save
                            </button>
                            <button
                                onClick={resetForm}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    padding: '0.75rem 1.5rem',
                                    backgroundColor: 'var(--bg-surface)',
                                    color: 'var(--text-primary)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    cursor: 'pointer',
                                    fontWeight: 500
                                }}
                            >
                                <X size={16} />
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                overflow: 'hidden'
            }}>
                <div style={{
                    display: 'flex',
                    padding: '1.5rem',
                    borderBottom: '2px solid var(--border-color)',
                    fontWeight: 600,
                    backgroundColor: 'var(--bg-app)'
                }}>
                    <span style={{ flex: 3 }}>Name</span>
                    <span style={{ flex: 1 }}>Value</span>
                    <span style={{ flex: 1 }}>Price Each</span>
                    <span style={{ flex: 1 }}>Status</span>
                    <span style={{ width: '120px', textAlign: 'right' }}>Actions</span>
                </div>
                {menuItems.length === 0 ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No menu items found. Add your first item above.
                    </div>
                ) : (
                    menuItems.map(item => (
                        <div
                            key={item.id}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '1.5rem',
                                borderBottom: '1px solid var(--border-color)'
                            }}
                        >
                            <span style={{ flex: 3, fontWeight: 500 }}>{item.name}</span>
                            <span style={{ flex: 1 }}>{item.value}</span>
                            <span style={{ flex: 1 }}>${(item.priceEach || 0).toFixed(2)}</span>
                            <span style={{ flex: 1 }}>
                                {item.isActive ? (
                                    <span style={{
                                        padding: '0.25rem 0.75rem',
                                        backgroundColor: 'rgba(34, 197, 94, 0.1)',
                                        color: 'var(--color-success)',
                                        borderRadius: 'var(--radius-sm)',
                                        fontSize: '0.875rem'
                                    }}>
                                        Active
                                    </span>
                                ) : (
                                    <span style={{
                                        padding: '0.25rem 0.75rem',
                                        backgroundColor: 'var(--bg-app)',
                                        color: 'var(--text-secondary)',
                                        borderRadius: 'var(--radius-sm)',
                                        fontSize: '0.875rem'
                                    }}>
                                        Inactive
                                    </span>
                                )}
                            </span>
                            <div style={{ width: '120px', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button
                                    onClick={() => handleEditInit(item)}
                                    style={{
                                        padding: '0.5rem',
                                        border: 'none',
                                        background: 'transparent',
                                        color: 'var(--text-secondary)',
                                        cursor: 'pointer',
                                        borderRadius: 'var(--radius-sm)'
                                    }}
                                >
                                    <Edit2 size={18} />
                                </button>
                                <button
                                    onClick={() => handleDelete(item.id)}
                                    style={{
                                        padding: '0.5rem',
                                        border: 'none',
                                        background: 'transparent',
                                        color: 'var(--color-danger)',
                                        cursor: 'pointer',
                                        borderRadius: 'var(--radius-sm)'
                                    }}
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}

