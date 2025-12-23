'use client';

import { useState, useEffect } from 'react';
import { BoxType, Vendor } from '@/lib/types';
import { getVendors, getBoxTypes, addBoxType, updateBoxType, deleteBoxType } from '@/lib/actions';
import { Plus, Edit2, Trash2, X, Check, Package } from 'lucide-react';
import styles from './BoxTypeManagement.module.css';

export function BoxTypeManagement() {
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [selectedVendorId, setSelectedVendorId] = useState<string>('');
    const [isCreating, setIsCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<BoxType>>({
        name: '',
        isActive: true,
        vendorIds: []
    });

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const [bData, vData] = await Promise.all([getBoxTypes(), getVendors()]);
        // Filter: Box configuration only for companies that ship 'Boxes'
        const boxVendors = vData.filter(v => v.serviceType === 'Boxes');
        setVendors(boxVendors);
        setBoxTypes(bData);
        if (boxVendors.length > 0 && !selectedVendorId) {
            setSelectedVendorId(boxVendors[0].id);
        }
    }

    // Filter boxes: In this new model, are boxes global or per vendor? 
    // The previous model had `vendorIds: string[]` on BoxType, implying many-to-many.
    // The user request "Box types should allow company selection using the same UI pattern as menus"
    // implies we select a company on left, and see THEIR boxes.
    // So we should filter boxes where box.vendorIds includes selectedVendorId.
    const filteredBoxes = boxTypes.filter(box => box.vendorIds.includes(selectedVendorId));

    function resetForm() {
        setFormData({
            name: '',
            isActive: true,
            vendorIds: []
        });
        setIsCreating(false);
        setEditingId(null);
    }

    function handleEditInit(box: BoxType) {
        setFormData({ ...box });
        setEditingId(box.id);
        setIsCreating(false);
    }

    async function handleSubmit() {
        if (!formData.name) return;
        if (!selectedVendorId) return;

        // When creating/editing in context of a vendor, ensure that vendor is linked
        const currentVendorIds = formData.vendorIds || [];
        const newVendorIds = currentVendorIds.includes(selectedVendorId)
            ? currentVendorIds
            : [...currentVendorIds, selectedVendorId];

        const payload = { ...formData, vendorIds: newVendorIds };

        if (editingId) {
            await updateBoxType(editingId, payload);
        } else {
            await addBoxType(payload as Omit<BoxType, 'id'>);
        }

        const bData = await getBoxTypes(); // Reload all
        setBoxTypes(bData);
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this box type?')) {
            await deleteBoxType(id);
            const bData = await getBoxTypes();
            setBoxTypes(bData);
        }
    }

    async function handleUnlink(boxId: string) {
        // Just remove the current vendor from this box type, effectively "deleting" it from this view
        const box = boxTypes.find(b => b.id === boxId);
        if (!box) return;

        const newVendorIds = box.vendorIds.filter(id => id !== selectedVendorId);
        // If no vendors left, should we delete the box? Or just leave it orphaned?
        // Let's just update for now.

        await updateBoxType(boxId, { ...box, vendorIds: newVendorIds });
        const bData = await getBoxTypes();
        setBoxTypes(bData);
    }

    if (vendors.length === 0) {
        return <div className={styles.emptyState}>No box vendors available. Please configure a vendor with 'Boxes' service type first.</div>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.sidebar}>
                <h3 className={styles.sidebarTitle}>Vendors</h3>
                <div className={styles.vendorList}>
                    {vendors.map(v => (
                        <button
                            key={v.id}
                            className={`${styles.vendorBtn} ${selectedVendorId === v.id ? styles.activeVendor : ''}`}
                            onClick={() => { setSelectedVendorId(v.id); resetForm(); }}
                        >
                            {v.name}
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.main}>
                <div className={styles.header}>
                    <div>
                        <h2 className={styles.title}>Box Types</h2>
                        <p className={styles.subtitle}>Manage boxes for {vendors.find(v => v.id === selectedVendorId)?.name}</p>
                    </div>
                    {!isCreating && !editingId && (
                        <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                            <Plus size={16} /> Add Box Type
                        </button>
                    )}
                </div>

                {(isCreating || editingId) && (
                    <div className={styles.formCard}>
                        <h3 className={styles.formTitle}>{editingId ? 'Edit Box Type' : 'New Box Type'}</h3>

                        <div className={styles.formGroup}>
                            <label className="label">Box Name</label>
                            <input
                                className="input"
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label className={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                />
                                Active
                            </label>
                        </div>

                        <div className={styles.formActions}>
                            <button className="btn btn-primary" onClick={handleSubmit}>
                                <Check size={16} /> Save
                            </button>
                            <button className="btn btn-secondary" onClick={resetForm}>
                                <X size={16} /> Cancel
                            </button>
                        </div>
                    </div>
                )}

                <div className={styles.list}>
                    <div className={styles.listHeader}>
                        <span style={{ flex: 2 }}>Name</span>
                        <span style={{ width: '100px' }}>Status</span>
                        <span style={{ width: '80px' }}>Actions</span>
                    </div>
                    {filteredBoxes.map(box => (
                        <div key={box.id} className={styles.item}>
                            <span style={{ flex: 2, fontWeight: 500 }}>{box.name}</span>
                            <span style={{ width: '100px' }}>
                                {box.isActive ? <span className="badge" style={{ color: 'var(--color-success)', background: 'rgba(34, 197, 94, 0.1)' }}>Active</span> : <span className="badge">Inactive</span>}
                            </span>
                            <div className={styles.actions}>
                                <button className={styles.iconBtn} onClick={() => handleEditInit(box)} title="Edit">
                                    <Edit2 size={16} />
                                </button>
                                {/* We offer Unlink (Remove from this vendor) or Delete (Global delete)? 
                                    Given req "Box types should visually match menus", I'll stick to a delete button 
                                    but explicitly implementing it as a global delete is simpler for now, 
                                    or maybe a "Remove" that unlinks? 
                                    User said "visually match menus", menus have delete. 
                                    I'll stick to delete.
                                */}
                                <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(box.id)} title="Delete Global Box Type">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    ))}
                    {filteredBoxes.length === 0 && !isCreating && (
                        <div className={styles.emptyList}>No box types found for this vendor.</div>
                    )}
                </div>
            </div>
        </div>
    );
}
