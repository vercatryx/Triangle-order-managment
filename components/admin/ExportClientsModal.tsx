'use client';

import { useState, useCallback } from 'react';
import { Loader2, X } from 'lucide-react';
import type { ExportClientRow } from '@/app/api/export/clients/route';
import styles from './ExportClientsModal.module.css';

const EXPORT_FIELDS: { key: keyof ExportClientRow; label: string }[] = [
    { key: 'full_name', label: 'Client name' },
    { key: 'address', label: 'Address' },
    { key: 'phone_number', label: 'Phone number' },
    { key: 'approved_meals_per_week', label: 'Approved meals per week' },
    { key: 'email', label: 'Email' },
    { key: 'id', label: 'ID' },
    { key: 'secondary_phone', label: 'Secondary phone' },
    { key: 'authorized_amount', label: 'Auth amount' },
    { key: 'screening_status', label: 'Screening status' },
    { key: 'expiration_date', label: 'Exp date' },
    { key: 'food_box_custom_client_type', label: 'Food box / custom client type (from upcoming order)' }
];

const defaultFields: Record<keyof ExportClientRow, boolean> = {
    full_name: true,
    address: false,
    phone_number: false,
    approved_meals_per_week: false,
    email: false,
    id: false,
    secondary_phone: false,
    authorized_amount: false,
    screening_status: false,
    expiration_date: false,
    food_box_custom_client_type: false
};

interface ExportClientsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function ExportClientsModal({ isOpen, onClose }: ExportClientsModalProps) {
    const [includeDependants, setIncludeDependants] = useState(false);
    const [fields, setFields] = useState<Record<keyof ExportClientRow, boolean>>(defaultFields);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const toggleField = useCallback((key: keyof ExportClientRow) => {
        setFields(prev => ({ ...prev, [key]: !prev[key] }));
    }, []);

    const handleExport = useCallback(async () => {
        const selectedKeys = (Object.keys(fields) as (keyof ExportClientRow)[]).filter(k => fields[k]);
        if (selectedKeys.length === 0) {
            setError('Select at least one column to export.');
            return;
        }
        setError(null);
        setExporting(true);
        try {
            const res = await fetch('/api/export/clients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ includeDependants, columns: selectedKeys })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Export failed');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `clients_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            onClose();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Export failed');
        } finally {
            setExporting(false);
        }
    }, [fields, includeDependants, onClose]);

    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} onClick={onClose}>
            <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
                <div className={styles.modalHeader}>
                    <h2 className={styles.modalTitle}>Export clients</h2>
                    <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                <span className={styles.sectionLabel}>Columns to include (toggle on/off)</span>
                <div className={styles.fieldsGrid}>
                    {EXPORT_FIELDS.map(({ key, label }) => (
                        <label key={key} className={styles.fieldToggle}>
                            <input
                                type="checkbox"
                                checked={!!fields[key]}
                                onChange={() => toggleField(key)}
                            />
                            {label}
                        </label>
                    ))}
                </div>

                <div className={styles.dependantsRow}>
                    <span className={styles.sectionLabel} style={{ marginBottom: 0 }}>Include dependants in export</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={includeDependants}
                            onChange={e => setIncludeDependants(e.target.checked)}
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600" />
                    </label>
                </div>

                {error && (
                    <p style={{ color: 'var(--color-error, #dc2626)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                        {error}
                    </p>
                )}

                <div className={styles.actions}>
                    <button type="button" className="btn btn-secondary" onClick={onClose} disabled={exporting}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={handleExport}
                        disabled={exporting}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                        {exporting && <Loader2 className="animate-spin" size={16} />}
                        {exporting ? 'Exporting...' : 'Export and download XLSX'}
                    </button>
                </div>
            </div>
        </div>
    );
}
