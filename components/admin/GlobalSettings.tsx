'use client';

import { useState, useEffect } from 'react';
import { AppSettings } from '@/lib/types';
import { updateSettings } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Save } from 'lucide-react';
import { AdminManagement } from '@/components/admin/AdminManagement';
import styles from './GlobalSettings.module.css';

export function GlobalSettings() {
    const { getSettings, invalidateReferenceData } = useDataCache();
    const [settings, setSettings] = useState<AppSettings>({
        weeklyCutoffDay: 'Friday',
        weeklyCutoffTime: '17:00',
        reportEmail: '',
        sendVendorNextWeekEmails: true,
        clientLoginMaintenanceMode: true
    });
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

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

    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Global Application Settings</h2>
            <p className={styles.subtitle}>Configure system-wide rules and settings.</p>

            <div className={styles.card}>
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
                            <label className="label" style={{ marginBottom: 0 }}>Send vendor emails (next week orders)</label>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                                When enabled, &quot;Create orders for the next week&quot; will email each vendor their order count for that week, broken down by day.
                            </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={settings.sendVendorNextWeekEmails !== false}
                                onChange={e => setSettings({ ...settings, sendVendorNextWeekEmails: e.target.checked })}
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
                </div>

                <div className={styles.formGroup} style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                            <label className="label" style={{ marginBottom: 0 }}>Client login maintenance mode</label>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                                When ON, clients cannot log in and see a maintenance message. When OFF, clients can log in with OTP as usual.
                            </p>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={settings.clientLoginMaintenanceMode !== false}
                                onChange={e => setSettings({ ...settings, clientLoginMaintenanceMode: e.target.checked })}
                            />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>
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
                <AdminManagement />
            </div>
        </div>
    );
}
