'use client';

import { useState, useEffect } from 'react';
import { Navigator } from '@/lib/types';
import { getNavigators, addNavigator, updateNavigator, deleteNavigator } from '@/lib/actions';
import { Plus, Edit2, Trash2, X, Check, Users } from 'lucide-react';
import styles from './NavigatorManagement.module.css';

export function NavigatorManagement() {
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [isCreating, setIsCreating] = useState(false);
    const [isMultiCreating, setIsMultiCreating] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState<Partial<Navigator>>({
        name: '',
        isActive: true
    });
    const [multiCreateInput, setMultiCreateInput] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const data = await getNavigators();
        setNavigators(data);
    }

    function resetForm() {
        setFormData({
            name: '',
            isActive: true
        });
        setIsCreating(false);
        setIsMultiCreating(false);
        setEditingId(null);
        setMultiCreateInput('');
    }

    function handleEditInit(nav: Navigator) {
        setFormData({ ...nav });
        setEditingId(nav.id);
        setIsCreating(false);
    }

    async function handleSubmit() {
        if (!formData.name) return;

        if (editingId) {
            await updateNavigator(editingId, formData);
        } else {
            await addNavigator(formData as Omit<Navigator, 'id'>);
        }

        await loadData();
        resetForm();
    }

    async function handleMultiSubmit() {
        if (!multiCreateInput.trim()) return;
        const names = multiCreateInput.split('\n').map(n => n.trim()).filter(n => n);

        await Promise.all(names.map(name => addNavigator({
            name,
            isActive: true
        })));

        await loadData();
        resetForm();
    }

    async function handleDelete(id: string) {
        if (confirm('Delete this navigator?')) {
            await deleteNavigator(id);
            await loadData();
        }
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h2 className={styles.title}>Navigator Management</h2>
                    <p className={styles.subtitle}>Manage staff members who manage clients.</p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {!isCreating && !editingId && !isMultiCreating && (
                        <>
                            <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                                <Plus size={16} /> New Navigator
                            </button>
                            <button className="btn btn-secondary" onClick={() => setIsMultiCreating(true)}>
                                <Plus size={16} /> Multi-Create
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Multi Create Modal */}
            {isMultiCreating && (
                <div className={styles.formCard}>
                    <h3 className={styles.formTitle}>Add Multiple Navigators</h3>
                    <p className={styles.hint}>Enter one name per line.</p>
                    <textarea
                        className="input"
                        rows={6}
                        value={multiCreateInput}
                        onChange={e => setMultiCreateInput(e.target.value)}
                        placeholder="Navigator A&#10;Navigator B"
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
                    <h3 className={styles.formTitle}>{editingId ? 'Edit Navigator' : 'New Navigator'}</h3>

                    <div className={styles.formGroup}>
                        <label className="label">Full Name</label>
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

            <div className={styles.tableContainer}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th style={{ width: '100px' }}>Status</th>
                            <th style={{ textAlign: 'right', width: '100px' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {navigators.map(nav => (
                            <tr key={nav.id}>
                                <td style={{ fontWeight: 500 }}>{nav.name}</td>
                                <td>
                                    {nav.isActive ?
                                        <span style={{ color: 'var(--color-success)' }}>Active</span> :
                                        <span style={{ color: 'var(--text-tertiary)' }}>Inactive</span>
                                    }
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <div className={styles.actions}>
                                        <button className={styles.iconBtn} onClick={() => handleEditInit(nav)}>
                                            <Edit2 size={16} />
                                        </button>
                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => handleDelete(nav.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {navigators.length === 0 && !isCreating && !isMultiCreating && (
                    <div className={styles.emptyState}>No navigators configured.</div>
                )}
            </div>
        </div>
    );
}
