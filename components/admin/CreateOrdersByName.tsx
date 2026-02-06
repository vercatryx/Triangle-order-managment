'use client';

import { useState, useEffect, useCallback } from 'react';
import { searchClientsByName } from '@/lib/actions';
import { useDataCache } from '@/lib/data-cache';
import { Search, CalendarDays, RefreshCw, X } from 'lucide-react';
import styles from './CreateOrdersByName.module.css';

type SearchResult = { id: string; fullName: string };

type CreateOrdersByNameProps = { onSuccess?: () => void };

export function CreateOrdersByName({ onSuccess }: CreateOrdersByNameProps = {}) {
    const { invalidateReferenceData } = useDataCache();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<SearchResult | null>(null);
    const [creating, setCreating] = useState(false);
    const [result, setResult] = useState<{
        success: boolean;
        totalCreated?: number;
        breakdown?: { Food: number; Meal: number; Boxes: number; Custom: number };
        weekStart?: string;
        weekEnd?: string;
        error?: string;
    } | null>(null);

    const doSearch = useCallback(async (q: string) => {
        if (!q.trim()) {
            setResults([]);
            return;
        }
        setLoading(true);
        try {
            const data = await searchClientsByName(q.trim());
            setResults(data);
        } catch (e) {
            console.error('Search error:', e);
            setResults([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const t = setTimeout(() => {
            doSearch(query);
        }, 250);
        return () => clearTimeout(t);
    }, [query, doSearch]);

    function handleSelect(r: SearchResult) {
        setSelected(r);
        setResult(null);
    }

    function handleClear() {
        setSelected(null);
        setResult(null);
    }

    async function handleCreateOrders() {
        if (!selected) return;
        if (!confirm(`Create orders for the next week (Sunday–Saturday) for ${selected.fullName} only?`)) return;

        setCreating(true);
        setResult(null);
        try {
            const res = await fetch('/api/create-orders-next-week', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clientId: selected.id })
            });
            const data = await res.json();
            if (data.success) {
                setResult({
                    success: true,
                    totalCreated: data.totalCreated,
                    breakdown: data.breakdown,
                    weekStart: data.weekStart,
                    weekEnd: data.weekEnd
                });
                invalidateReferenceData();
                onSuccess?.();
            } else {
                setResult({ success: false, error: data.error || 'Request failed' });
            }
        } catch (e: any) {
            setResult({ success: false, error: e.message || 'Network error' });
        } finally {
            setCreating(false);
        }
    }

    return (
        <div className={styles.container}>
            <h2 className={styles.title}>Create Orders by Name</h2>
            <p className={styles.subtitle}>
                Search for a client by name and create orders for the next week (Sunday–Saturday) for that client only. Dependants are excluded from search.
            </p>

            <div className={styles.card}>
                <label className={styles.label}>Search by name</label>
                <div className={styles.searchRow}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        type="text"
                        className={styles.input}
                        placeholder="Type to search..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        disabled={!!selected}
                        autoComplete="off"
                    />
                    {selected && (
                        <button
                            type="button"
                            className={styles.clearBtn}
                            onClick={() => { setSelected(null); setResult(null); }}
                            title="Clear selection"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>

                {loading && (
                    <div className={styles.loading}>
                        <RefreshCw size={16} className={styles.spin} /> Searching...
                    </div>
                )}

                {!selected && query.trim().length >= 1 && !loading && (
                    <div className={styles.results}>
                        {results.length === 0 ? (
                            <div className={styles.noResults}>No clients found</div>
                        ) : (
                            <ul className={styles.list}>
                                {results.map((r) => (
                                    <li
                                        key={r.id}
                                        className={styles.resultItem}
                                        onClick={() => handleSelect(r)}
                                    >
                                        {r.fullName}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {selected && (
                    <div className={styles.selected}>
                        <span className={styles.selectedLabel}>Selected:</span>
                        <strong>{selected.fullName}</strong>
                        <button
                            className="btn btn-primary"
                            onClick={handleCreateOrders}
                            disabled={creating}
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem' }}
                        >
                            {creating ? <RefreshCw className={styles.spin} size={16} /> : <CalendarDays size={16} />}
                            {creating ? 'Creating...' : 'Create orders for next week'}
                        </button>
                    </div>
                )}
            </div>

            {result && (
                <div
                    className={styles.resultBox}
                    style={{
                        borderColor: result.success ? 'var(--color-success)' : 'var(--color-danger)',
                        backgroundColor: 'var(--bg-panel)'
                    }}
                >
                    {result.success ? (
                        <>
                            <div className={styles.resultSuccess}>
                                Created {result.totalCreated ?? 0} order(s) for {result.weekStart ?? ''} to {result.weekEnd ?? ''}.
                            </div>
                            {result.breakdown && (
                                <div className={styles.breakdown}>
                                    Food: {result.breakdown.Food} · Meal: {result.breakdown.Meal} · Boxes: {result.breakdown.Boxes} · Custom: {result.breakdown.Custom}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className={styles.resultError}>{result.error}</div>
                    )}
                </div>
            )}
        </div>
    );
}
