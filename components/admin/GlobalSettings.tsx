'use client';

import { useState, useEffect } from 'react';
import { AppSettings } from '@/lib/types';
import { updateSettings, getCreationIds, deleteOrdersByCreationId } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Save, PlayCircle, RefreshCw, X, Calendar, Trash2, AlertTriangle } from 'lucide-react';
import styles from './GlobalSettings.module.css';


const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function GlobalSettings() {
    const { getSettings, invalidateReferenceData } = useDataCache();
    const [settings, setSettings] = useState<AppSettings>({
        weeklyCutoffDay: 'Friday',
        weeklyCutoffTime: '17:00',
        reportEmail: ''
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [showDateDialog, setShowDateDialog] = useState(false);
    const [selectedDate, setSelectedDate] = useState('');
    const [simulating, setSimulating] = useState(false);
    const [simulationResult, setSimulationResult] = useState<{
        success: boolean;
        message: string;
        skippedReasons?: string[];
        skippedReasonCounts?: Record<string, number>;
        errors?: string[];
        skippedCount?: number;
    } | null>(null);
    const [creationIds, setCreationIds] = useState<Array<{ creation_id: number; count: number; created_at: string }>>([]);
    const [loadingCreationIds, setLoadingCreationIds] = useState(false);
    const [deletingCreationId, setDeletingCreationId] = useState<number | null>(null);

    useEffect(() => {
        loadData();
        loadCreationIds();
    }, []);

    async function loadData() {
        const data = await getSettings();
        setSettings(data);
    }

    async function loadCreationIds() {
        setLoadingCreationIds(true);
        try {
            const ids = await getCreationIds();
            setCreationIds(ids);
        } catch (error) {
            console.error('Error loading creation IDs:', error);
        } finally {
            setLoadingCreationIds(false);
        }
    }

    async function handleDeleteCreationId(creationId: number) {
        const creation = creationIds.find(c => c.creation_id === creationId);
        if (!creation) return;

        if (!confirm(`Are you sure you want to delete all ${creation.count} order(s) with creation ID ${creationId}? This action cannot be undone.`)) {
            return;
        }

        setDeletingCreationId(creationId);
        try {
            const result = await deleteOrdersByCreationId(creationId);
            if (result.success) {
                setMessage(`Successfully deleted ${result.deletedCount} order(s) with creation ID ${creationId}`);
                setTimeout(() => setMessage(null), 5000);
                await loadCreationIds();
                invalidateReferenceData();
            } else {
                alert(`Failed to delete orders: ${result.error || 'Unknown error'}`);
            }
        } catch (error: any) {
            alert(`Error deleting orders: ${error.message || 'Unknown error'}`);
        } finally {
            setDeletingCreationId(null);
        }
    }

    async function handleSave() {
        setSaving(true);
        await updateSettings(settings);
        invalidateReferenceData();
        setSaving(false);
        setMessage('Settings saved successfully!');
        setTimeout(() => setMessage(null), 3000);
    }

    // Format for date input: YYYY-MM-DD
    const formatForDateInput = (date: Date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    useEffect(() => {
        // Set default date to today
        setSelectedDate(formatForDateInput(new Date()));
    }, []);

    async function handleCreateOrders() {
        if (!selectedDate) {
            alert('Please select a date');
            return;
        }

        if (!confirm('This will create orders for all scheduled upcoming orders using the selected date. The original Upcoming Orders will be preserved. Proceed?')) return;

        setSimulating(true);
        setSimulationResult(null);
        setShowDateDialog(false);

        try {
            // Set the fake time cookie with the selected date (at start of day)
            const selectedDateObj = new Date(selectedDate);
            selectedDateObj.setHours(0, 0, 0, 0);
            document.cookie = `x-fake-time=${selectedDateObj.toISOString()}; path=/; max-age=86400; SameSite=Lax`;

            console.log('[Create Orders] Starting with date:', selectedDateObj.toISOString());
            const res = await fetch('/api/simulate-delivery-cycle', { method: 'POST' });
            const data = await res.json();

            // Clear the cookie after the request
            document.cookie = 'x-fake-time=; path=/; max-age=0; SameSite=Lax';

            console.log('[Create Orders] Response:', data);

            setSimulationResult({
                success: data.success,
                message: data.message || (data.success ? 'Orders created successfully.' : 'Failed to create orders.'),
                skippedReasons: data.skippedReasons,
                skippedReasonCounts: data.skippedReasonCounts,
                errors: data.errors,
                skippedCount: data.skippedCount
            });
        } catch (error) {
            console.error('[Create Orders] Exception:', error);
            // Clear the cookie on error
            document.cookie = 'x-fake-time=; path=/; max-age=0; SameSite=Lax';
            setSimulationResult({ success: false, message: 'An error occurred while creating orders.' });
        } finally {
            setSimulating(false);
        }
    }


    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Global Application Settings</h2>
            <p className={styles.subtitle}>Configure system-wide rules and cutoff times.</p>

            <div className={styles.card}>
                <h3 className={styles.sectionTitle}>Weekly Order Cutoff</h3>
                <p className={styles.description}>
                    Orders placed or modified after this time will apply to the following week's delivery cycle.
                </p>

                <div className={styles.row}>
                    <div className={styles.formGroup}>
                        <label className="label">Cutoff Day</label>
                        <select
                            className="input"
                            value={settings.weeklyCutoffDay}
                            onChange={e => setSettings({ ...settings, weeklyCutoffDay: e.target.value })}
                        >
                            {DAYS.map(day => <option key={day} value={day}>{day}</option>)}
                        </select>
                    </div>

                    <div className={styles.formGroup}>
                        <label className="label">Cutoff Time (24h)</label>
                        <input
                            type="time"
                            className="input"
                            value={settings.weeklyCutoffTime}
                            onChange={e => setSettings({ ...settings, weeklyCutoffTime: e.target.value })}
                        />
                    </div>
                </div>

                <div className={styles.formGroup} style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <label className="label">Report Email Address</label>
                    <input
                        type="text"
                        className="input"
                        placeholder="email@example.com, another@example.com"
                        value={settings.reportEmail || ''}
                        onChange={e => setSettings({ ...settings, reportEmail: e.target.value })}
                    />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
                        Email address(es) to receive delivery simulation reports for skipped orders. Separate multiple addresses with commas.
                    </p>
                </div>

                <div className={styles.formGroup} style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                            <label className="label" style={{ marginBottom: 0 }}>Enable Passwordless Login (Email OTP)</label>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                                When enabled, customers will log in using a 6-digit code sent to their email.
                            </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={settings.enablePasswordlessLogin || false}
                                onChange={e => setSettings({ ...settings, enablePasswordlessLogin: e.target.checked })}
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
                </div>

                <div className={styles.actions}>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        <Save size={16} /> {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                    {message && <span className={styles.successMessage}>{message}</span>}
                </div>
            </div>

            <div className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                <h3 className={styles.sectionTitle}>Create Orders</h3>
                <p className={styles.description}>
                    Create orders for all scheduled upcoming orders. You will be prompted to select a date that will be used for order creation.
                </p>

                <div className={styles.formGroup}>
                    <button 
                        className="btn btn-primary" 
                        onClick={() => setShowDateDialog(true)}
                        disabled={simulating}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem'
                        }}
                    >
                        {simulating ? <RefreshCw className="spin" size={16} /> : <PlayCircle size={16} />}
                        {simulating ? 'Creating Orders...' : 'Create Orders'}
                    </button>
                </div>

                {simulationResult && (
                    <div style={{
                        marginTop: '1rem',
                        padding: '1rem',
                        backgroundColor: 'var(--bg-panel)',
                        border: `1px solid ${simulationResult.success ? 'var(--color-success)' : 'var(--color-danger)'}`,
                        borderRadius: '0.5rem',
                        fontSize: '0.9rem'
                    }}>
                        <div style={{
                            color: simulationResult.success ? 'var(--color-success)' : 'var(--color-danger)',
                            fontWeight: 600,
                            marginBottom: '0.5rem'
                        }}>
                            {simulationResult.message}
                        </div>
                        {simulationResult.skippedCount !== undefined && simulationResult.skippedCount > 0 && (
                            <div style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
                                Skipped: {simulationResult.skippedCount} orders
                            </div>
                        )}
                    </div>
                )}
            </div>

            {showDateDialog && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: 'var(--bg-panel)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '0.5rem',
                        padding: '1.5rem',
                        minWidth: '400px',
                        maxWidth: '90%'
                    }}>
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: '1rem'
                        }}>
                            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600 }}>Select Date for Order Creation</h3>
                            <button
                                onClick={() => setShowDateDialog(false)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    color: 'var(--text-secondary)',
                                    padding: '0.25rem'
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            This date will be used as the "current date" when creating orders. Orders will be created based on this date.
                        </p>
                        <div style={{ marginBottom: '1rem' }}>
                            <label className="label" style={{ marginBottom: '0.5rem' }}>Date</label>
                            <input
                                type="date"
                                className="input"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                style={{ width: '100%' }}
                            />
                        </div>
                        <div style={{
                            display: 'flex',
                            gap: '0.5rem',
                            justifyContent: 'flex-end'
                        }}>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowDateDialog(false)}
                                disabled={simulating}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleCreateOrders}
                                disabled={simulating || !selectedDate}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem'
                                }}
                            >
                                {simulating ? (
                                    <>
                                        <RefreshCw className="spin" size={16} />
                                        Creating...
                                    </>
                                ) : (
                                    <>
                                        <Calendar size={16} />
                                        Create Orders
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                <h3 className={styles.sectionTitle}>Order Creation Management</h3>
                <p className={styles.description}>
                    Manage orders by creation ID. Each round of order creation gets a unique numeric ID. You can delete all orders from a specific creation round.
                </p>

                {loadingCreationIds ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        <RefreshCw className="spin" size={20} style={{ display: 'inline-block', marginRight: '0.5rem' }} />
                        Loading creation IDs...
                    </div>
                ) : creationIds.length === 0 ? (
                    <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No orders with creation IDs found.
                    </div>
                ) : (
                    <div style={{ marginTop: '1rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Creation ID</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Order Count</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>Created At</th>
                                    <th style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600 }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {creationIds.map((creation) => (
                                    <tr key={creation.creation_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                        <td style={{ padding: '0.75rem' }}>{creation.creation_id}</td>
                                        <td style={{ padding: '0.75rem' }}>{creation.count}</td>
                                        <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                            {new Date(creation.created_at).toLocaleString()}
                                        </td>
                                        <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                            <button
                                                className="btn btn-danger"
                                                onClick={() => handleDeleteCreationId(creation.creation_id)}
                                                disabled={deletingCreationId === creation.creation_id}
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem',
                                                    padding: '0.5rem 1rem',
                                                    fontSize: '0.875rem'
                                                }}
                                            >
                                                {deletingCreationId === creation.creation_id ? (
                                                    <>
                                                        <RefreshCw className="spin" size={14} />
                                                        Deleting...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Trash2 size={14} />
                                                        Delete All
                                                    </>
                                                )}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg-panel)', borderRadius: '0.5rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                            <AlertTriangle size={16} style={{ display: 'inline-block', marginRight: '0.5rem', verticalAlign: 'middle' }} />
                            <strong>Warning:</strong> Deleting orders by creation ID will permanently remove all orders, order items, vendor selections, box selections, and related billing records for that creation round. This action cannot be undone.
                        </div>
                    </div>
                )}
            </div>

        </div >
    );
}
