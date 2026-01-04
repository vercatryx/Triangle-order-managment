'use client';

import { useState, useEffect } from 'react';
import { AppSettings } from '@/lib/types';
import { updateSettings } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Save, PlayCircle, AlertCircle, RefreshCw, Truck, Clock, Mail, ChevronDown, ChevronUp } from 'lucide-react';
import styles from './GlobalSettings.module.css';
import { useTime } from '@/lib/time-context';

function TimeOverrideControl() {
    const { isFakeTime, currentTime, setFakeTime } = useTime();

    // Local state for the input so we don't update context on every keystroke if we wanted, 
    // but dealing with date-time-local input, it's easier to just sync or have a "Set" button.
    // Let's use a "Set" button approach for clarity.

    // Format for datetime-local: YYYY-MM-DDThh:mm
    const formatForInput = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
        return localISOTime;
    };

    const [inputValue, setInputValue] = useState(formatForInput(currentTime));

    // When context changes (e.g. initial load), sync input if we aren't editing? 
    // Actually, if isFakeTime is true, input should reflect it.
    useEffect(() => {
        setInputValue(formatForInput(currentTime));
    }, [currentTime]);

    const handleToggle = () => {
        if (isFakeTime) {
            setFakeTime(null); // Reset to real time
        } else {
            // Enable with current input value or current time
            const date = new Date(inputValue);
            setFakeTime(date);
        }
    };

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
        if (isFakeTime) {
            // Update immediately if already enabled? Or wait for set?
            // "The user might have a settings switch" implies toggle.
            // Let's update immediately if enabled to see feedback.
            const date = new Date(e.target.value);
            if (!isNaN(date.getTime())) {
                setFakeTime(date);
            }
        }
    };

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
            <div className="flex items-center gap-2">
                <label className="relative inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={isFakeTime}
                        onChange={handleToggle}
                    />
                    <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    <span className="ml-3 text-sm font-medium text-gray-300">
                        {isFakeTime ? 'Enabled' : 'Disabled (Using Real Time)'}
                    </span>
                </label>
            </div>

            {isFakeTime && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Clock size={16} className="text-blue-400" />
                    <input
                        type="datetime-local"
                        className="input"
                        value={inputValue}
                        onChange={handleDateChange}
                        style={{ maxWidth: '250px' }}
                    />
                </div>
            )}
        </div>
    );
}


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

    const [simulating, setSimulating] = useState(false);
    const [simulationResult, setSimulationResult] = useState<{ 
        success: boolean; 
        message: string;
        skippedReasons?: string[];
        errors?: string[];
        skippedCount?: number;
    } | null>(null);
    const [showSkippedDetails, setShowSkippedDetails] = useState(false);
    const [sendingEmail, setSendingEmail] = useState(false);
    const [emailSent, setEmailSent] = useState(false);

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

    async function handleSendEmail(skipData?: { skippedReasons?: string[]; errors?: string[]; skippedCount?: number }) {
        const dataToUse = skipData || simulationResult;
        
        if (!dataToUse?.skippedReasons || dataToUse.skippedReasons.length === 0) {
            if (!skipData) {
                alert('No skipped orders to report.');
            }
            return;
        }

        if (!settings.reportEmail || !settings.reportEmail.trim()) {
            if (!skipData) {
                alert('Please configure a report email address in settings first.');
            }
            return;
        }

        setSendingEmail(true);
        setEmailSent(false);

        try {
            const res = await fetch('/api/send-skipped-orders-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: settings.reportEmail.trim(),
                    skippedReasons: dataToUse.skippedReasons,
                    errors: dataToUse.errors || [],
                    skippedCount: dataToUse.skippedCount || 0
                })
            });

            const result = await res.json();
            if (result.success) {
                setEmailSent(true);
                setTimeout(() => setEmailSent(false), 5000);
            } else {
                if (!skipData) {
                    alert(`Failed to send email: ${result.error || 'Unknown error'}`);
                } else {
                    console.error('Failed to send email automatically:', result.error);
                }
            }
        } catch (error) {
            console.error('Error sending email:', error);
            if (!skipData) {
                alert('Failed to send email. Please check the console for details.');
            }
        } finally {
            setSendingEmail(false);
        }
    }

    async function handleSimulateRun() {
        if (!confirm('This will create orders for all scheduled upcoming orders. The original Upcoming Orders will be preserved. Proceed?')) return;

        setSimulating(true);
        setSimulationResult(null);
        setShowSkippedDetails(false);
        setEmailSent(false);

        try {
            console.log('[Simulate Delivery] Starting simulation...');
            const res = await fetch('/api/simulate-delivery-cycle', { method: 'POST' });
            const data = await res.json();

            // Log detailed results to browser console
            console.log('[Simulate Delivery] Response:', data);
            console.log(`[Simulate Delivery] Summary: Found ${data.totalFound || 0} upcoming orders, Created ${data.processedCount || 0} orders, Skipped ${data.skippedCount || 0} orders`);
            
            if (data.skippedReasons && data.skippedReasons.length > 0) {
                console.group('[Simulate Delivery] Skipped Orders:');
                data.skippedReasons.forEach((reason: string, index: number) => {
                    console.warn(`${index + 1}. ${reason}`);
                });
                console.groupEnd();
            }
            
            if (data.errors && data.errors.length > 0) {
                console.group('[Simulate Delivery] Errors:');
                data.errors.forEach((error: string, index: number) => {
                    console.error(`${index + 1}. ${error}`);
                });
                console.groupEnd();
            }

            if (data.debugLogs && data.debugLogs.length > 0) {
                console.group('[Simulate Delivery] Debug Logs:');
                data.debugLogs.forEach((log: string) => {
                    console.log(log);
                });
                console.groupEnd();
            }

            setSimulationResult({
                success: data.success,
                message: data.message || (data.success ? 'Simulation completed successfully.' : 'Simulation failed.'),
                skippedReasons: data.skippedReasons,
                errors: data.errors,
                skippedCount: data.skippedCount
            });
            // Auto-expand skipped details if there are skipped orders
            if (data.skippedReasons && data.skippedReasons.length > 0) {
                setShowSkippedDetails(true);
                // Automatically send email if email is configured
                if (settings.reportEmail && settings.reportEmail.trim()) {
                    // Pass the data directly to avoid state timing issues
                    handleSendEmail({
                        skippedReasons: data.skippedReasons,
                        errors: data.errors,
                        skippedCount: data.skippedCount
                    });
                }
            }
        } catch (error) {
            console.error('[Simulate Delivery] Exception:', error);
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

                <div className={styles.formGroup} style={{ marginBottom: 'var(--spacing-lg)' }}>
                    <label className="label">Report Email Address</label>
                    <input
                        type="email"
                        className="input"
                        placeholder="email@example.com"
                        value={settings.reportEmail || ''}
                        onChange={e => setSettings({ ...settings, reportEmail: e.target.value })}
                    />
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
                        Email address to receive delivery simulation reports for skipped orders.
                    </p>
                </div>

                <div className={styles.actions}>
                    <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                        <Save size={16} /> {saving ? 'Saving...' : 'Save Settings'}
                    </button>
                    {message && <span className={styles.successMessage}>{message}</span>}
                </div>
            </div>

            <div className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                <h3 className={styles.sectionTitle}>Testing & Debugging</h3>
                <p className={styles.description}>
                    Override system behavior for testing purposes.
                </p>

                <div className={styles.row} style={{ alignItems: 'flex-end' }}>
                    <div className={styles.formGroup}>
                        <label className="label">Fake System Time</label>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
                            Force the application to perceive the current time as:
                        </p>
                        <TimeOverrideControl />
                    </div>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
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

                            {(simulationResult.skippedReasons && simulationResult.skippedReasons.length > 0) && (
                                <div style={{
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '4px',
                                    backgroundColor: 'var(--bg-surface)',
                                    overflow: 'hidden'
                                }}>
                                    <button
                                        onClick={() => setShowSkippedDetails(!showSkippedDetails)}
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            backgroundColor: 'transparent',
                                            border: 'none',
                                            color: 'var(--text-primary)',
                                            cursor: 'pointer',
                                            fontSize: '0.9rem',
                                            fontWeight: 500
                                        }}
                                    >
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <AlertCircle size={16} style={{ color: 'var(--color-warning)' }} />
                                            {simulationResult.skippedCount || simulationResult.skippedReasons.length} Skipped Order(s) - Click to view details
                                        </span>
                                        {showSkippedDetails ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                    </button>

                                    {showSkippedDetails && (
                                        <div style={{
                                            padding: '12px',
                                            borderTop: '1px solid var(--border-color)',
                                            backgroundColor: 'rgba(239, 68, 68, 0.05)',
                                            maxHeight: '300px',
                                            overflowY: 'auto'
                                        }}>
                                            <ul style={{
                                                margin: 0,
                                                paddingLeft: '20px',
                                                listStyle: 'disc',
                                                fontSize: '0.875rem',
                                                color: 'var(--text-secondary)'
                                            }}>
                                                {simulationResult.skippedReasons.map((reason, index) => (
                                                    <li key={index} style={{ marginBottom: '8px' }}>
                                                        {reason}
                                                    </li>
                                                ))}
                                            </ul>

                                            <div style={{
                                                marginTop: '12px',
                                                paddingTop: '12px',
                                                borderTop: '1px solid var(--border-color)',
                                                display: 'flex',
                                                gap: '8px',
                                                alignItems: 'center'
                                            }}>
                                                {settings.reportEmail ? (
                                                    <>
                                                        <button
                                                            onClick={handleSendEmail}
                                                            disabled={sendingEmail || emailSent}
                                                            className="btn"
                                                            style={{
                                                                fontSize: '0.875rem',
                                                                padding: '6px 12px',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '6px',
                                                                backgroundColor: emailSent ? 'var(--color-success)' : 'var(--color-secondary)',
                                                                opacity: sendingEmail ? 0.6 : 1
                                                            }}
                                                        >
                                                            {sendingEmail ? (
                                                                <>
                                                                    <RefreshCw className="spin" size={14} />
                                                                    Sending...
                                                                </>
                                                            ) : emailSent ? (
                                                                <>
                                                                    <Mail size={14} />
                                                                    Email Sent!
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <Mail size={14} />
                                                                    Send Email Report
                                                                </>
                                                            )}
                                                        </button>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                                                            Will send to: {settings.reportEmail}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <span style={{ fontSize: '0.875rem', color: 'var(--color-warning)' }}>
                                                        Please configure a report email address in settings to send reports.
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {(simulationResult.errors && simulationResult.errors.length > 0) && (
                                <div style={{
                                    border: '1px solid var(--color-danger)',
                                    borderRadius: '4px',
                                    padding: '12px',
                                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                    maxHeight: '200px',
                                    overflowY: 'auto'
                                }}>
                                    <div style={{
                                        fontSize: '0.875rem',
                                        fontWeight: 600,
                                        color: 'var(--color-danger)',
                                        marginBottom: '8px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px'
                                    }}>
                                        <AlertCircle size={14} />
                                        Errors ({simulationResult.errors.length})
                                    </div>
                                    <ul style={{
                                        margin: 0,
                                        paddingLeft: '20px',
                                        listStyle: 'disc',
                                        fontSize: '0.875rem',
                                        color: 'var(--text-secondary)'
                                    }}>
                                        {simulationResult.errors.map((error, index) => (
                                            <li key={index} style={{ marginBottom: '4px' }}>
                                                {error}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div >
    );
}
