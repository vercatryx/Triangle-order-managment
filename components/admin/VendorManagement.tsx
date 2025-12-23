'use client';

import { useState, useEffect } from 'react';
import { Vendor, ServiceType } from '@/lib/types';
import { getVendors, addVendor, updateVendor, deleteVendor } from '@/lib/actions';
import { Plus, Edit2, Trash2, X, Check, Truck } from 'lucide-react';
import styles from './VendorManagement.module.css';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes']; // Only managing relevant vendors here

export function VendorManagement() {
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [isMultiCreating, setIsMultiCreating] = useState(false); // New state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Vendor>>({
        name: '',
        isActive: true,
        deliveryDays: [],
        allowsMultipleDeliveries: false,
        serviceType: 'Food'
    });
    const [multiCreateInput, setMultiCreateInput] = useState(''); // New state

    useEffect(() => {
        loadVendors();
    }, []);

    async function loadVendors() {
        const data = await getVendors();
        setVendors(data);
    }

    function resetForm() {
        setFormData({
            name: '',
            isActive: true,
            deliveryDays: [],
            allowsMultipleDeliveries: false,
            serviceType: 'Food'
        });
        setIsCreating(false);
        setIsMultiCreating(false);
        setEditingId(null);
        setMultiCreateInput('');
    }

    function handleEditInit(vendor: Vendor) {
        setFormData({ ...vendor });
        setEditingId(vendor.id);
        setIsCreating(false);
    }

    async function handleSubmit() {
        if (!formData.name) return;
        // Validation for single create
        if (!formData.deliveryDays || formData.deliveryDays.length === 0) {
            alert('Please select at least one delivery day.');
            return;
        }

        if (editingId) {
            await updateVendor(editingId, formData);
        } else {
            await addVendor(formData as Omit<Vendor, 'id'>);
        }
        await loadVendors();
        resetForm();
    }

    async function handleMultiSubmit() {
        if (!multiCreateInput.trim()) return;
        const names = multiCreateInput.split('\n').map(n => n.trim()).filter(n => n);

        // Parallel creation (could be optimized with a bulk insert endpoint ideally)
        await Promise.all(names.map(name => addVendor({
            name,
            serviceType: 'Food', // Defaults
            isActive: true,
            deliveryDays: ['Monday'], // Default? Or maybe prompt? Assume basic default.
            allowsMultipleDeliveries: false
        })));

        await loadVendors();
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this vendor?')) {
            await deleteVendor(id);
            await loadVendors();
        }
    }

    function toggleDay(day: string) {
        const current = formData.deliveryDays || [];
        if (current.includes(day)) {
            setFormData({ ...formData, deliveryDays: current.filter(d => d !== day) });
        } else {
            setFormData({ ...formData, deliveryDays: [...current, day] });
        }
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>Vendor Management</h2>
                    <p className={styles.subtitle}>Configure food and box vendors.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {!isCreating && !editingId && !isMultiCreating && (
                        <>
                            <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                                <Plus size={16} /> New Vendor
                            </button>
                            <button className="btn btn-secondary" onClick={() => setIsMultiCreating(true)}>
                                <Plus size={16} /> Multi-Create
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Multi Create Modal/Form */}
            {isMultiCreating && (
                <div className={styles.formCard}>
                    <h3 className={styles.formTitle}>Add Multiple Vendors</h3>
                    <p className={styles.hint}>Enter one vendor name per line. They will be created with default settings (Food, Active, Monday delivery).</p>
                    <textarea
                        className="input"
                        rows={6}
                        value={multiCreateInput}
                        onChange={e => setMultiCreateInput(e.target.value)}
                        placeholder="Vendor A&#10;Vendor B&#10;Vendor C"
                        style={{ marginBottom: '1rem' }}
                    />
                    <div className={styles.formActions}>
                        <button className="btn btn-primary" onClick={handleMultiSubmit}>
                            <Check size={16} /> Create All
                        </button>
                        <button className="btn btn-secondary" onClick={resetForm}>
                            <X size={16} /> Cancel
                        </button>
                    </div>
                </div>
            )}

            {(isCreating || editingId) && (
                <div className={styles.formCard}>
                    <h3 className={styles.formTitle}>{editingId ? 'Edit Vendor' : 'New Vendor'}</h3>
                    {/* Reuse existing form structure */}
                    <div className={styles.formGroup}>
                        <label className="label">Vendor Name</label>
                        <input
                            className="input"
                            value={formData.name}
                            onChange={e => setFormData({ ...formData, name: e.target.value })}
                        />
                    </div>
                    {/* ... (Existing form fields for Type, Status, Days, Frequency) ... */}
                    <div className={styles.row}>
                        <div className={styles.formGroup}>
                            <label className="label">Service Type</label>
                            <select
                                className="input"
                                value={formData.serviceType}
                                onChange={e => setFormData({ ...formData, serviceType: e.target.value as ServiceType })}
                            >
                                {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div className={styles.formGroup}>
                            <label className="label">Status</label>
                            <label className={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={formData.isActive}
                                    onChange={e => setFormData({ ...formData, isActive: e.target.checked })}
                                />
                                Active
                            </label>
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">Delivery Days</label>
                        <div className={styles.daysGrid}>
                            {DAYS_OF_WEEK.map(day => (
                                <label key={day} className={`${styles.daySelect} ${formData.deliveryDays?.includes(day) ? styles.dayActive : ''}`}>
                                    <input
                                        type="checkbox"
                                        className={styles.hiddenCheck}
                                        checked={formData.deliveryDays?.includes(day)}
                                        onChange={() => toggleDay(day)}
                                    />
                                    {day}
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">Delivery Frequency</label>
                        <label className={styles.checkboxLabel}>
                            <input
                                type="checkbox"
                                checked={formData.allowsMultipleDeliveries}
                                onChange={e => setFormData({ ...formData, allowsMultipleDeliveries: e.target.checked })}
                            />
                            Allow multiple deliveries per week?
                        </label>
                    </div>

                    <div className={styles.formActions}>
                        <button className="btn btn-primary" onClick={handleSubmit}>
                            <Check size={16} /> Save Vendor
                        </button>
                        <button className="btn btn-secondary" onClick={resetForm}>
                            <X size={16} /> Cancel
                        </button>
                    </div>
                </div>
            )}

            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Status</th>
                            <th>Days</th>
                            <th>Frequency</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vendors.map(vendor => (
                            <tr key={vendor.id}>
                                <td style={{ fontWeight: 500 }}>{vendor.name}</td>
                                <td><span className="badge">{vendor.serviceType}</span></td>
                                <td>{vendor.isActive ? <span style={{ color: 'var(--color-success)' }}>Active</span> : <span style={{ color: 'var(--text-tertiary)' }}>Inactive</span>}</td>
                                <td>{vendor.deliveryDays.join(', ')}</td>
                                <td>{vendor.allowsMultipleDeliveries ? 'Multiple' : 'Once'}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <div className={styles.actions}>
                                        <button className={styles.iconBtn} onClick={() => handleEditInit(vendor)}>
                                            <Edit2 size={16} />
                                        </button>
                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(vendor.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {vendors.length === 0 && !isCreating && !isMultiCreating && (
                    <div className={styles.emptyState}>No vendors configured. Create one to get started.</div>
                )}
            </div>
        </div>
    );
}
