'use client';

import { useState, useEffect } from 'react';
import { Vendor, ServiceType, VendorLocation, GlobalLocation } from '@/lib/types';
import {
    addVendor,
    updateVendor,
    deleteVendor,
    getVendorLocations,
    addVendorLocation,
    deleteVendorLocation,
    getGlobalLocations,
    addGlobalLocation,
    deleteGlobalLocation
} from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Plus, Edit2, Trash2, X, Check, MapPin } from 'lucide-react';
import styles from './VendorManagement.module.css';

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes', 'Equipment'];

export function VendorManagement() {
    const { getVendors, invalidateReferenceData } = useDataCache();
    const [vendors, setVendors] = useState<Vendor[]>([]);

    // Global Locations State
    const [globalLocations, setGlobalLocations] = useState<GlobalLocation[]>([]);
    const [newGlobalLocationName, setNewGlobalLocationName] = useState('');

    // Vendor Form State
    const [isCreating, setIsCreating] = useState(false);
    const [isMultiCreating, setIsMultiCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Vendor>>({
        name: '',
        email: '',
        password: '',
        isActive: true,
        deliveryDays: [],
        allowsMultipleDeliveries: false,
        serviceTypes: ['Food'],
        minimumMeals: 0,
        cutoffDays: 0
    });

    // Locations for the specific vendor being edited/created
    // linkedLocations represents the CURRENT UI STATE (what is checked)
    // originalLinkedLocations represents the DATABASE STATE (what was loaded) - used for diffing updates
    const [linkedLocations, setLinkedLocations] = useState<VendorLocation[]>([]);
    const [originalLinkedLocations, setOriginalLinkedLocations] = useState<VendorLocation[]>([]);

    const [multiCreateInput, setMultiCreateInput] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const [vData, lData] = await Promise.all([
            getVendors(),
            getGlobalLocations()
        ]);
        setVendors(vData);
        setGlobalLocations(lData);
    }

    async function refreshGlobalLocations() {
        const data = await getGlobalLocations();
        setGlobalLocations(data);
    }

    function resetForm() {
        setFormData({
            name: '',
            email: '',
            password: '',
            isActive: true,
            deliveryDays: [],
            allowsMultipleDeliveries: false,
            serviceTypes: ['Food'],
            minimumMeals: 0,
            cutoffDays: 0
        });
        setIsCreating(false);
        setIsMultiCreating(false);
        setEditingId(null);
        setMultiCreateInput('');
        setLinkedLocations([]);
        setOriginalLinkedLocations([]);
    }

    async function loadVendorLinkedLocations(vendorId: string) {
        const locs = await getVendorLocations(vendorId);
        setLinkedLocations(locs);
        setOriginalLinkedLocations(locs);
    }

    function handleEditInit(vendor: Vendor) {
        setFormData({
            ...vendor,
            password: ''
        });
        setEditingId(vendor.id);
        setIsCreating(false);
        loadVendorLinkedLocations(vendor.id);
    }

    async function handleSubmit() {
        if (!formData.name) return;
        if (!formData.deliveryDays || formData.deliveryDays.length === 0) {
            alert('Please select at least one delivery day.');
            return;
        }

        if (editingId) {
            // 1. Update Vendor Fields
            const dataToUpdate = {
                ...formData,
                password: formData.password ?? undefined
            };
            await updateVendor(editingId, dataToUpdate);

            // 2. Sync Locations (Diffing)
            // Identify what to ADD (in linked but not in original)
            const toAdd = linkedLocations.filter(l => !originalLinkedLocations.some(ol => ol.locationId === l.locationId));

            // Identify what to REMOVE (in original but not in linked)
            const toRemove = originalLinkedLocations.filter(ol => !linkedLocations.some(l => l.locationId === ol.locationId));

            await Promise.all([
                ...toAdd.map(l => addVendorLocation(editingId, l.locationId)),
                ...toRemove.map(l => deleteVendorLocation(l.id))
            ]);

        } else {
            // Create New Vendor
            const dataToAdd = {
                ...formData,
                password: formData.password ?? undefined,
                email: formData.email ?? undefined
            };
            const newVendor = await addVendor(dataToAdd as Omit<Vendor, 'id'> & { password?: string; email?: string });

            // Create links for the new vendor
            if (linkedLocations.length > 0) {
                await Promise.all(linkedLocations.map(loc =>
                    addVendorLocation(newVendor.id, loc.locationId)
                ));
            }
        }
        invalidateReferenceData();
        await loadData();
        resetForm();
    }

    function handleStartCreate() {
        // Pre-select ALL global locations by default for new vendors
        const allLinks: VendorLocation[] = globalLocations.map(gl => ({
            id: `temp-${Date.now()}-${Math.random()}`,
            vendorId: '',
            locationId: gl.id,
            name: gl.name
        }));
        setLinkedLocations(allLinks);
        setIsCreating(true);
    }

    async function handleMultiSubmit() {
        if (!multiCreateInput.trim()) return;
        const names = multiCreateInput.split('\n').map(n => n.trim()).filter(n => n);

        // Fetch latest global locations to ensures defaults are applied even if UI is stale
        const currentGlobalLocations = await getGlobalLocations();

        // Create vendors AND link all locations to them
        await Promise.all(names.map(async (name) => {
            const newVendor = await addVendor({
                name,
                serviceTypes: ['Food'],
                isActive: true,
                deliveryDays: ['Monday'],
                allowsMultipleDeliveries: false
            });

            // Link ALL locations to this new vendor
            if (currentGlobalLocations.length > 0) {
                await Promise.all(currentGlobalLocations.map((gl: GlobalLocation) =>
                    addVendorLocation(newVendor.id, gl.id)
                ));
            }
        }));

        invalidateReferenceData();
        await loadData();
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this vendor?')) {
            await deleteVendor(id);
            invalidateReferenceData();
            await loadData();
        }
    }

    // --- FORM HANDLERS ---

    function toggleDay(day: string) {
        const current = formData.deliveryDays || [];
        const nextDays = current.includes(day)
            ? current.filter(d => d !== day)
            : [...current, day];

        setFormData({
            ...formData,
            deliveryDays: nextDays,
            allowsMultipleDeliveries: nextDays.length > 1
        });
    }

    function toggleServiceType(type: ServiceType) {
        const current = formData.serviceTypes || [];
        const nextTypes = current.includes(type)
            ? current.filter(t => t !== type)
            : [...current, type];

        if (nextTypes.length === 0) return;
        setFormData({ ...formData, serviceTypes: nextTypes });
    }

    // --- GLOBAL LOCATION ACTIONS ---

    async function handleAddGlobalLocation() {
        if (!newGlobalLocationName.trim()) return;
        await addGlobalLocation(newGlobalLocationName.trim());
        setNewGlobalLocationName('');
        await refreshGlobalLocations();
    }

    async function handleDeleteGlobalLocation(id: string) {
        if (confirm('Delete this global location? This will remove it from all vendors.')) {
            await deleteGlobalLocation(id);
            await refreshGlobalLocations();
            // Also refresh vendor links if currently editing
            if (editingId) loadVendorLinkedLocations(editingId);
        }
    }

    // --- LINKING ACTIONS (Deferred/Checkbox Logic) ---

    function isLocationLinked(globalId: string) {
        return linkedLocations.some(l => l.locationId === globalId);
    }

    function toggleLocationLink(globalId: string) {
        const location = globalLocations.find(l => l.id === globalId);
        if (!location) return;

        if (isLocationLinked(globalId)) {
            // Remove from local state
            setLinkedLocations(prev => prev.filter(l => l.locationId !== globalId));
        } else {
            // Add to local state
            const newLink: VendorLocation = {
                id: `temp-${Date.now()}-${Math.random()}`, // Temp ID, will be resolved on save
                vendorId: editingId || '',
                locationId: globalId,
                name: location.name
            };
            setLinkedLocations(prev => [...prev, newLink]);
        }
    }

    function handleSelectAllLocations() {
        const allLinks: VendorLocation[] = globalLocations.map(gl => ({
            id: `temp-${Date.now()}-${Math.random()}`,
            vendorId: editingId || '',
            locationId: gl.id,
            name: gl.name
        }));
        setLinkedLocations(allLinks);
    }

    function handleDeselectAllLocations() {
        setLinkedLocations([]);
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
                            <button className="btn btn-primary" onClick={handleStartCreate}>
                                <Plus size={16} /> New Vendor
                            </button>
                            <button className="btn btn-secondary" onClick={() => setIsMultiCreating(true)}>
                                <Plus size={16} /> Multi-Create
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Multi Create Modal Omitted logic remains same */}
            {isMultiCreating && (
                <div className={styles.formCard}>
                    <h3 className={styles.formTitle}>Add Multiple Vendors</h3>
                    <textarea
                        className="input"
                        rows={6}
                        value={multiCreateInput}
                        onChange={e => setMultiCreateInput(e.target.value)}
                        placeholder="Vendor A&#10;Vendor B"
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

                    <div className={styles.formGroup}>
                        <label className="label">Vendor Name</label>
                        <input className="input" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                    </div>

                    <div className={styles.row}>
                        <div className={styles.formGroup} style={{ flex: 1 }}>
                            <label className="label">Email</label>
                            <input className="input" type="email" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                        </div>
                        <div className={styles.formGroup} style={{ flex: 1 }}>
                            <label className="label">Password</label>
                            <input className="input" type="password" value={formData.password || ''} onChange={e => setFormData({ ...formData, password: e.target.value })} placeholder={editingId ? "Unchanged" : "Required"} />
                        </div>
                    </div>

                    <div className={styles.row}>
                        <div className={styles.formGroup} style={{ flex: 2 }}>
                            <label className="label">Service Types</label>
                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                {SERVICE_TYPES.map(t => (
                                    <button
                                        key={t}
                                        type="button"
                                        className={`btn ${formData.serviceTypes?.includes(t) ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => toggleServiceType(t)}
                                        style={{
                                            padding: '0.5rem 1rem',
                                            fontSize: '0.875rem',
                                            border: formData.serviceTypes?.includes(t) ? '2px solid var(--color-primary)' : '1px solid var(--border-color)',
                                            backgroundColor: formData.serviceTypes?.includes(t) ? 'var(--color-primary)' : 'var(--bg-surface)',
                                            color: formData.serviceTypes?.includes(t) ? 'white' : 'var(--text-primary)',
                                        }}
                                    >
                                        {t}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className={styles.formGroup} style={{ flex: 1 }}>
                            <label className="label">Status</label>
                            <label className={styles.checkboxLabel}>
                                <input type="checkbox" checked={formData.isActive} onChange={e => setFormData({ ...formData, isActive: e.target.checked })} />
                                Active
                            </label>
                        </div>
                    </div>

                    <div className={styles.row}>
                        <div className={styles.formGroup} style={{ flex: 1 }}>
                            <label className="label">Cutoff Days</label>
                            <input
                                className="input"
                                type="number"
                                min="0"
                                max="14"
                                value={formData.cutoffDays ?? 0}
                                onChange={e => setFormData({ ...formData, cutoffDays: parseInt(e.target.value) || 0 })}
                                placeholder="0"
                            />
                            <p className={styles.hint} style={{ marginTop: '0.25rem' }}>Days before delivery to close orders.</p>
                        </div>
                        <div className={styles.formGroup} style={{ flex: 1 }}>
                            <label className="label">Min. Meals</label>
                            <input
                                className="input"
                                type="number"
                                min="0"
                                value={formData.minimumMeals ?? 0}
                                onChange={e => setFormData({ ...formData, minimumMeals: parseInt(e.target.value) || 0 })}
                                placeholder="0"
                            />
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">Delivery Days</label>
                        <div className={styles.daysGrid}>
                            {DAYS_OF_WEEK.map(day => (
                                <label key={day} className={`${styles.daySelect} ${formData.deliveryDays?.includes(day) ? styles.dayActive : ''}`}>
                                    <input type="checkbox" className={styles.hiddenCheck} checked={formData.deliveryDays?.includes(day)} onChange={() => toggleDay(day)} />
                                    {day}
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Linked Locations Multi-Select Section */}
                    <div className={styles.formGroup} style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem', marginTop: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <MapPin size={18} />
                                <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Locations</h4>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button className="btn btn-sm" type="button" onClick={handleSelectAllLocations} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>Select All</button>
                                <button className="btn btn-sm btn-secondary" type="button" onClick={handleDeselectAllLocations} style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>None</button>
                            </div>
                        </div>

                        <div style={{
                            maxHeight: '200px',
                            overflowY: 'auto',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '0.5rem',
                            background: 'var(--bg-surface)'
                        }}>
                            {/* Checkbox List */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem' }}>
                                {globalLocations.map(loc => (
                                    <label key={loc.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.25rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={isLocationLinked(loc.id)}
                                            onChange={() => toggleLocationLink(loc.id)}
                                        />
                                        <span style={{ fontSize: '0.9rem' }}>{loc.name}</span>
                                    </label>
                                ))}
                                {globalLocations.length === 0 && (
                                    <div style={{ gridColumn: '1 / -1', color: 'var(--text-tertiary)', fontStyle: 'italic', padding: '1rem', textAlign: 'center' }}>
                                        No global locations defined. Add them strictly below.
                                    </div>
                                )}
                            </div>
                        </div>
                        <p className={styles.hint} style={{ marginTop: '0.5rem' }}>
                            Select which locations this vendor serves. Manage global locations below.
                        </p>
                    </div>

                    <div className={styles.formActions}>
                        <button className="btn btn-primary" onClick={handleSubmit}><Check size={16} /> Save Vendor</button>
                        <button className="btn btn-secondary" onClick={resetForm}><X size={16} /> Cancel</button>
                    </div>
                </div>
            )}

            {/* Vendor List Table (Unchanged) */}
            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Services</th>
                            <th>Status</th>
                            <th>Days</th>
                            <th>Cutoff</th>
                            <th>Frequency</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {vendors.map(vendor => (
                            <tr key={vendor.id}>
                                <td style={{ fontWeight: 500 }}>{vendor.name}</td>
                                <td>{vendor.serviceTypes.join(', ')}</td>
                                <td>{vendor.isActive ? 'Active' : 'Inactive'}</td>
                                <td>{vendor.deliveryDays.join(', ')}</td>
                                <td>{vendor.cutoffDays || 0} days</td>
                                <td>{vendor.allowsMultipleDeliveries ? 'Multiple' : 'Once'}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <div className={styles.actions}>
                                        <button className={styles.iconBtn} onClick={() => handleEditInit(vendor)}><Edit2 size={16} /></button>
                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(vendor.id)}><Trash2 size={16} /></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {vendors.length === 0 && !isCreating && !isMultiCreating && (
                    <div className={styles.emptyState}>No vendors configured.</div>
                )}
            </div>

            {/* Global Locations Management Table */}
            <div className={styles.header} style={{ marginTop: '3rem' }}>
                <div>
                    <h2 className={styles.title}>Locations</h2>
                    <p className={styles.subtitle}>Manage the master list of delivery locations.</p>
                </div>
            </div>

            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Location Name</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {globalLocations.map(loc => (
                            <tr key={loc.id}>
                                <td style={{ fontWeight: 500 }}>{loc.name}</td>
                                <td style={{ textAlign: 'right' }}>
                                    <button
                                        className={`${styles.iconBtn} ${styles.danger}`}
                                        onClick={() => handleDeleteGlobalLocation(loc.id)}
                                        title="Delete Global Location"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {/* Add Global Location Row */}
                <div style={{ padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '0.5rem', background: 'var(--bg-surface-subtle)' }}>
                    <input
                        className="input"
                        placeholder="New Location Name (e.g. North Campus)"
                        value={newGlobalLocationName}
                        onChange={e => setNewGlobalLocationName(e.target.value)}
                        style={{ flex: 1 }}
                    />
                    <button className="btn btn-primary" onClick={handleAddGlobalLocation} disabled={!newGlobalLocationName}>
                        <Plus size={16} /> Add Location
                    </button>
                </div>
            </div>
        </div>
    );
}
