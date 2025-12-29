'use client';

import { useState, useEffect } from 'react';
import { AppSettings } from '@/lib/types';
import { updateSettings } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Save, PlayCircle, AlertCircle, RefreshCw, Truck } from 'lucide-react';
import styles from './GlobalSettings.module.css';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function GlobalSettings() {
    const { getSettings, invalidateReferenceData } = useDataCache();
    const [settings, setSettings] = useState<AppSettings>({
        weeklyCutoffDay: 'Friday',
        weeklyCutoffTime: '17:00'
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const [simulating, setSimulating] = useState(false);
    const [simulationResult, setSimulationResult] = useState<{ success: boolean; message: string } | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const data = await getSettings();
        setSettings(data);
    }

    async function handleSave() {
        setSaving(true);
        await updateSettings(settings);
        invalidateReferenceData();
        setSaving(false);
        setMessage('Settings saved successfully!');
        setTimeout(() => setMessage(null), 3000);
    }

    async function handleSimulateRun() {
        if (!confirm('This will create orders for all scheduled upcoming orders due today or earlier. The original Upcoming Orders will be preserved. Proceed?')) return;

        setSimulating(true);
        setSimulationResult(null);

        try {
            const res = await fetch('/api/simulate-delivery-cycle', { method: 'POST' });
            const data = await res.json();

            setSimulationResult({
                success: data.success,
                message: data.message || (data.success ? 'Simulation completed successfully.' : 'Simulation failed.')
            });
        } catch (error) {
            setSimulationResult({ success: false, message: 'An error occurred during simulation.' });
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

                <div className={styles.actions}>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        <Save size={16} /> {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                    {message && <span className={styles.successMessage}>{message}</span>}
                </div>
            </div>

            <div className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                <h3 className={styles.sectionTitle}>Simulate Delivery Cycle</h3>
                <p className={styles.description}>
                    Manually trigger the delivery generation cycle for today. This will:
                    <br />• Find all Upcoming Orders due today or earlier.
                    <br />• Create new Orders with status "Waiting for Proof".
                    <br />• Preserve the existing Upcoming Orders template.
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button
                        className="btn btn-primary"
                        onClick={handleSimulateRun}
                        disabled={simulating}
                        style={{ backgroundColor: 'var(--color-secondary)' }}
                    >
                        {simulating ? <RefreshCw className="spin" size={16} /> : <PlayCircle size={16} />}
                        {simulating ? 'Running Simulation...' : 'Run Delivery Simulation'}
                    </button>

                    {simulationResult && (
                        <div style={{
                            padding: '8px 12px',
                            borderRadius: '4px',
                            fontSize: '0.9rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            backgroundColor: simulationResult.success ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                            color: simulationResult.success ? 'var(--color-success)' : 'var(--color-danger)',
                            border: `1px solid ${simulationResult.success ? 'var(--color-success)' : 'var(--color-danger)'}`
                        }}>
                            {simulationResult.success ? <Truck size={16} /> : <AlertCircle size={16} />}
                            {simulationResult.message}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
