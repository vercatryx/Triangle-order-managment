'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Loader2, Search, PlusCircle, X, Trash2, Download } from 'lucide-react';
import ClientPortalOrderSummary from '@/components/clients/ClientPortalOrderSummary';
import { deleteOrder } from '@/lib/actions';

const PAGE_SIZE = 100;

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d;
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart + 'T00:00:00');
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/** Strip trailing _digits from meal type for display (e.g. "Lunch_1771369928664" -> "Lunch"). */
function formatMealType(value: string | undefined | null): string {
  if (value == null || value === '') return '\u2014';
  return value.replace(/_\d+$/, '').trim() || '\u2014';
}

type ClientRow = {
  id: string;
  fullName: string;
  approvedMealsPerWeek: number | null;
  orderNumbers: number[];
  ordersTotal: number;
  vendors?: string[];
};

type MissingItem = {
  client_id: string;
  clientName: string;
  scheduled_delivery_date: string;
  service_type: string;
  vendorName: string;
  mealType?: string;
  payload: { totalValue: number; totalItems: number };
};

type ExpectedSummaryItem = MissingItem & {
  existingOrderNumber: number | null;
};

export default function MissingOrdersPage() {
  const [weekStart, setWeekStart] = useState(() => {
    const nextSun = getWeekStart(new Date());
    return nextSun.toISOString().split('T')[0];
  });
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [checkingClientId, setCheckingClientId] = useState<string | null>(null);
  const [modalClient, setModalClient] = useState<{
    id: string;
    name: string;
    missing: MissingItem[];
    expectedSummary: ExpectedSummaryItem[];
    cutoffUsedAt: string | null;
    /** Day name for cutoff label, e.g. "Tuesday". */
    cutoffDayName: string | null;
    snapshotUsedAt: string | null;
    /** Exact time the order was set (from order_history), for display. */
    snapshotCreatedAt: string | null;
    /** 'order_history' = snapshot from history at cutoff; 'upcoming_order' = using current order (not changed since before cutoff) */
    snapshotSource: 'order_history' | 'upcoming_order' | null;
    snapshotOrderConfig: any;
    /** Existing orders in week (matched + extra) so user can see/delete extras. */
    existingOrders: { orderId: string; order_number: number; scheduled_delivery_date: string; vendorName: string; mealType: string; status: 'matched' | 'extra'; total_items?: number | null; total_value?: number | null }[];
  } | null>(null);
  const [creating, setCreating] = useState(false);
  /** Index into modalClient.missing for the single order we're creating (for per-row Create). */
  const [creatingMissingIndex, setCreatingMissingIndex] = useState<number | null>(null);
  /** Creation ID for new orders. Empty = use new batch (API will return it and we keep it here). */
  const [creationId, setCreationId] = useState('');
  /** When deleting an order (extra), disable its button. */
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  /** Search: auth meals (exact), amount target ($), +/- tolerance ($). */
  const [authMealsFilter, setAuthMealsFilter] = useState('');
  const [amountTargetFilter, setAmountTargetFilter] = useState('');
  const [amountToleranceFilter, setAmountToleranceFilter] = useState('');
  /** Amount filter direction: '+' = above target, '-' = below target, '+/-' = either (outside range). */
  const [amountDirection, setAmountDirection] = useState<'+' | '-' | '+/-'>('+/-');
  /** Ref so loadPage can read latest filters without triggering search on every keystroke. */
  const filtersRef = useRef({ authMealsFilter, amountTargetFilter, amountToleranceFilter, amountDirection });
  useEffect(() => {
    filtersRef.current = { authMealsFilter, amountTargetFilter, amountToleranceFilter, amountDirection };
  }, [authMealsFilter, amountTargetFilter, amountToleranceFilter, amountDirection]);
  const [referenceData, setReferenceData] = useState<{
    vendors: any[];
    menuItems: any[];
    mealCategories: any[];
    mealItems: any[];
    categories: any[];
  } | null>(null);

  const loadPage = useCallback(async (overridePage?: number) => {
    setLoading(true);
    try {
      const pageToUse = overridePage ?? page;
      const f = filtersRef.current;
      const params = new URLSearchParams();
      params.set('weekStart', weekStart);
      params.set('page', String(pageToUse));
      params.set('pageSize', String(PAGE_SIZE));
      if (f.authMealsFilter.trim() !== '') params.set('authMeals', f.authMealsFilter.trim());
      if (f.amountTargetFilter.trim() !== '') params.set('amountTarget', f.amountTargetFilter.trim());
      if (f.amountToleranceFilter.trim() !== '') params.set('amountTolerance', f.amountToleranceFilter.trim());
      params.set('amountDirection', f.amountDirection);
      const res = await fetch(`/api/missing-orders/clients?${params.toString()}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setClients(data.clients || []);
      setTotal(data.total ?? 0);
      if (overridePage !== undefined) setPage(overridePage);
    } catch (e) {
      console.error(e);
      setClients([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [weekStart, page]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  const handleSearch = () => {
    setPage(0);
    loadPage(0);
  };

  useEffect(() => {
    let cancelled = false;
    fetch('/api/missing-orders/reference-data')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (!cancelled && data) setReferenceData(data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const handleCheckMissing = async (clientId: string, clientName: string) => {
    setCheckingClientId(clientId);
    try {
      const res = await fetch('/api/missing-orders/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, clientIds: [clientId] })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const byClient = data.byClient?.[0];
      const missing = byClient?.missing ?? [];
      const expectedSummary = byClient?.expectedSummary ?? [];
      const cutoffUsedAt = data.cutoffUsedAt ?? null;
      const cutoffDayName = data.cutoffDayName ?? null;
      const snapshotUsedAt = byClient?.snapshotUsedAt?.timestamp ?? null;
      const snapshotCreatedAt = byClient?.snapshotUsedAt?.createdAt ?? null;
      const snapshotSource = (byClient?.snapshotUsedAt?.source ?? null) as 'order_history' | 'upcoming_order' | null;
      const snapshotOrderConfig = byClient?.snapshotOrderConfig ?? null;
      const existingOrders = byClient?.existingOrders ?? [];
      setModalClient({ id: clientId, name: clientName, missing, expectedSummary, cutoffUsedAt, cutoffDayName, snapshotUsedAt, snapshotCreatedAt, snapshotSource, snapshotOrderConfig, existingOrders });
    } catch (e) {
      console.error(e);
      setModalClient({ id: clientId, name: clientName, missing: [], expectedSummary: [], cutoffUsedAt: null, cutoffDayName: null, snapshotUsedAt: null, snapshotCreatedAt: null, snapshotSource: null, snapshotOrderConfig: null, existingOrders: [] });
    } finally {
      setCheckingClientId(null);
    }
  };

  const getCreationIdToSend = (): number | undefined => {
    const trimmed = creationId.trim();
    if (!trimmed) return undefined;
    const num = parseInt(trimmed, 10);
    return Number.isNaN(num) ? undefined : num;
  };

  const handleCreateOneMissing = async (missingItem: MissingItem) => {
    if (!modalClient) return;
    const idx = modalClient.missing.findIndex(
      (m) =>
        m.scheduled_delivery_date === missingItem.scheduled_delivery_date &&
        (m.mealType ?? m.service_type) === (missingItem.mealType ?? missingItem.service_type) &&
        m.vendorName === missingItem.vendorName
    );
    setCreatingMissingIndex(idx >= 0 ? idx : null);
    try {
      const res = await fetch('/api/missing-orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, clientId: modalClient.id, missing: [missingItem], creationId: getCreationIdToSend() })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.creationId != null && creationId.trim() === '') setCreationId(String(data.creationId));
      if (data.created > 0 && data.orderNumbers?.length) {
        await handleCheckMissing(modalClient.id, modalClient.name);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCreatingMissingIndex(null);
    }
  };

  const handleCreateMissing = async () => {
    if (!modalClient?.missing?.length) return;
    setCreating(true);
    try {
      const res = await fetch('/api/missing-orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, missing: modalClient.missing, creationId: getCreationIdToSend() })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      if (data.creationId != null && creationId.trim() === '') setCreationId(String(data.creationId));
      alert(`Created ${data.created} order(s). Order numbers: ${(data.orderNumbers || []).join(', ')}`);
      setModalClient(null);
      loadPage();
    } catch (e) {
      console.error(e);
      alert('Failed to create orders: ' + String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteExtraOrder = async (orderId: string) => {
    if (!modalClient) return;
    if (!window.confirm('Delete this order? This cannot be undone.')) return;
    setDeletingOrderId(orderId);
    try {
      const result = await deleteOrder(orderId);
      if (result.success) {
        await handleCheckMissing(modalClient.id, modalClient.name);
      } else {
        alert(result.message || 'Failed to delete order');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to delete order');
    } finally {
      setDeletingOrderId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleDownloadList = () => {
    const headers = ['Client name', 'Auth meals/week', 'Orders total', 'Order numbers', 'Vendors'];
    const escape = (v: string) => {
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows = clients.map((row) => [
      row.fullName,
      row.approvedMealsPerWeek ?? '',
      row.ordersTotal > 0 ? row.ordersTotal.toFixed(2) : '',
      (row.orderNumbers || []).join(', '),
      (row.vendors || []).join(', ')
    ]);
    const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `missing-orders-list-${weekStart}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Missing Orders</h1>
        <Link href="/clients" style={{ color: 'var(--color-primary)', fontSize: '0.9rem' }}>← Client Dashboard</Link>
      </div>

      <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontWeight: 500 }}>Week (Sun–Sat):</span>
          <input
            type="date"
            value={weekStart}
            onChange={(e) => {
              const d = new Date(e.target.value + 'T00:00:00');
              const sun = getWeekStart(d);
              setWeekStart(sun.toISOString().split('T')[0]);
              setPage(0);
            }}
            style={{
              padding: '0.5rem 0.75rem',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              background: 'var(--bg-panel)',
              color: 'var(--text-primary)'
            }}
          />
        </label>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{formatWeekRange(weekStart)}</span>
      </div>

      <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', background: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Search by auth meals and order total</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.9rem' }}>Auth meals:</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="e.g. 21"
              value={authMealsFilter}
              onChange={(e) => setAuthMealsFilter(e.target.value.replace(/\D/g, ''))}
              style={{ width: '4rem', padding: '0.5rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-panel)', color: 'var(--text-primary)' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.9rem' }}>Amount ($):</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 336"
              value={amountTargetFilter}
              onChange={(e) => setAmountTargetFilter(e.target.value.replace(/[^\d.]/g, ''))}
              style={{ width: '5rem', padding: '0.5rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-panel)', color: 'var(--text-primary)' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.9rem' }}>Direction:</span>
            <select
              value={amountDirection}
              onChange={(e) => setAmountDirection(e.target.value as '+' | '-' | '+/-')}
              style={{ padding: '0.5rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-panel)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
            >
              <option value="+/-">+/- (either)</option>
              <option value="+">+ (above)</option>
              <option value="-">- (below)</option>
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.9rem' }}>Tolerance ($):</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="e.g. 15"
              value={amountToleranceFilter}
              onChange={(e) => setAmountToleranceFilter(e.target.value.replace(/[^\d.]/g, ''))}
              style={{ width: '4rem', padding: '0.5rem 0.5rem', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-panel)', color: 'var(--text-primary)' }}
            />
          </label>
          <button
            type="button"
            onClick={handleSearch}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--color-primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            Search
          </button>
        </div>
        <p style={{ margin: '0.5rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Auth meals = exact match. Amount: <strong>+/-</strong> = outside [target − tolerance, target + tolerance]; <strong>+</strong> = above target + tolerance; <strong>−</strong> = below target − tolerance.
        </p>
      </div>

      <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', background: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 500 }}>Creation ID for new orders:</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="Leave blank to create a new batch"
            value={creationId}
            onChange={(e) => setCreationId(e.target.value.replace(/\D/g, ''))}
            style={{
              width: '8rem',
              padding: '0.5rem 0.75rem',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              background: 'var(--bg-panel)',
              color: 'var(--text-primary)'
            }}
          />
        </label>
        <p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Leave blank to assign a new batch when you create orders; it will then be kept here for subsequent creates.
        </p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '2rem' }}>
          <Loader2 size={20} className="animate-spin" />
          <span>Loading clients…</span>
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-panel)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-app)' }}>
                  <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600 }}>Client name</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 1rem', fontWeight: 600 }}>Auth meals/week</th>
                  <th style={{ textAlign: 'right', padding: '0.75rem 1rem', fontWeight: 600 }}>Orders total</th>
                  <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600 }}>Order numbers</th>
                  <th style={{ textAlign: 'left', padding: '0.75rem 1rem', fontWeight: 600 }}>Vendors</th>
                  <th style={{ textAlign: 'center', padding: '0.75rem 1rem', fontWeight: 600 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <Link href={`/clients/${row.id}`} style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>{row.fullName}</Link>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{row.approvedMealsPerWeek ?? '–'}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                      {row.ordersTotal > 0 ? `$${row.ordersTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '–'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.9rem' }}>
                      {row.orderNumbers.length ? row.orderNumbers.join(', ') : '–'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.9rem' }}>
                      {(row.vendors && row.vendors.length) ? row.vendors.join(', ') : '–'}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleCheckMissing(row.id, row.fullName)}
                        disabled={!!checkingClientId}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: '0.4rem 0.75rem',
                          fontSize: '0.85rem',
                          background: 'var(--color-primary)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: checkingClientId ? 'not-allowed' : 'pointer',
                          opacity: checkingClientId ? 0.7 : 1
                        }}
                      >
                        {checkingClientId === row.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Search size={14} />
                        )}
                        Check missing
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Page {page + 1} of {totalPages} · {total} client{total !== 1 ? 's' : ''}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handleDownloadList}
                disabled={clients.length === 0}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.5rem 0.75rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--bg-panel)',
                  cursor: clients.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: clients.length === 0 ? 0.5 : 1,
                  fontSize: '0.9rem',
                  fontWeight: 500
                }}
              >
                <Download size={16} />
                Download list (CSV)
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  padding: '0.5rem 0.75rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--bg-panel)',
                  cursor: page === 0 ? 'not-allowed' : 'pointer',
                  opacity: page === 0 ? 0.5 : 1
                }}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={{
                  padding: '0.5rem 0.75rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--bg-panel)',
                  cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
                  opacity: page >= totalPages - 1 ? 0.5 : 1
                }}
              >
                <ChevronRight size={18} />
              </button>
              </div>
            </div>
          </div>
        </>
      )}

      {modalClient && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: '1rem'
          }}
          onClick={() => !creating && setModalClient(null)}
        >
          <div
            style={{
              background: 'var(--bg-panel)',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              maxWidth: 'min(960px, 95vw)',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: 'var(--shadow-lg)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Missing orders – {modalClient.name}</h2>
              <button type="button" onClick={() => !creating && setModalClient(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem' }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ padding: '1.25rem' }}>
              <div style={{ marginBottom: '1rem', padding: '0.75rem', background: 'var(--bg-app)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Order history used for “should be” orders</div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  <strong>Cutoff ({modalClient.cutoffDayName ?? 'Tuesday'} before this week):</strong>{' '}
                  {modalClient.cutoffUsedAt
                    ? new Date(modalClient.cutoffUsedAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
                    : '–'}
                </div>
                <div style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                  <strong>Snapshot saved at:</strong>{' '}
                  {modalClient.snapshotSource === 'order_history' && (modalClient.snapshotCreatedAt ?? modalClient.snapshotUsedAt)
                    ? new Date(modalClient.snapshotCreatedAt ?? modalClient.snapshotUsedAt!).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })
                    : modalClient.snapshotSource === 'upcoming_order'
                      ? 'Current upcoming order (no history entry at cutoff; using order as it is now)'
                      : '–'}
                </div>
              </div>

              {modalClient.snapshotOrderConfig && referenceData && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.95rem' }}>Upcoming order (as in snapshot)</div>
                  <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg-app)' }}>
                    <ClientPortalOrderSummary
                      orderConfig={modalClient.snapshotOrderConfig}
                      vendors={referenceData.vendors}
                      menuItems={referenceData.menuItems}
                      mealCategories={referenceData.mealCategories}
                      mealItems={referenceData.mealItems}
                      categories={referenceData.categories}
                    />
                  </div>
                </div>
              )}

              <div style={{ fontWeight: 600, marginBottom: '0.5rem', fontSize: '0.9rem' }}>Orders by snapshot part (date / vendor / type)</div>
              {(() => {
                type PartKey = string;
                const partKey = (date: string, vendor: string, type: string) => `${date}|${vendor}|${type}`;
                const parts = new Map<PartKey, { date: string; vendorName: string; type: string; expected: ExpectedSummaryItem | null; existing: typeof modalClient.existingOrders }>();
                for (const row of modalClient.expectedSummary) {
                  const key = partKey(row.scheduled_delivery_date, row.vendorName, (row.mealType ?? row.service_type) ?? '');
                  if (!parts.has(key)) parts.set(key, { date: row.scheduled_delivery_date, vendorName: row.vendorName, type: (row.mealType ?? row.service_type) ?? '', expected: row, existing: [] });
                  else parts.get(key)!.expected = row;
                }
                const expectedOrderNumbers = new Set(modalClient.expectedSummary.map((e) => e.existingOrderNumber).filter((n): n is number => n != null));
                for (const o of modalClient.existingOrders || []) {
                  const matchedToExpected = o.status === 'matched' && expectedOrderNumbers.has(o.order_number);
                  if (matchedToExpected) {
                    const expectedRow = modalClient.expectedSummary.find(
                      (e) => e.scheduled_delivery_date === o.scheduled_delivery_date && e.vendorName === o.vendorName && e.existingOrderNumber === o.order_number
                    );
                    if (expectedRow) {
                      const key = partKey(expectedRow.scheduled_delivery_date, expectedRow.vendorName, (expectedRow.mealType ?? expectedRow.service_type) ?? '');
                      if (parts.has(key)) parts.get(key)!.existing.push(o);
                      else parts.set(key, { date: o.scheduled_delivery_date, vendorName: o.vendorName, type: o.mealType, expected: expectedRow, existing: [o] });
                      continue;
                    }
                  }
                  const key = partKey(o.scheduled_delivery_date, o.vendorName, o.mealType);
                  if (!parts.has(key)) parts.set(key, { date: o.scheduled_delivery_date, vendorName: o.vendorName, type: o.mealType, expected: null, existing: [] });
                  parts.get(key)!.existing.push(o);
                }
                const sortedParts = Array.from(parts.entries()).sort((a, b) => a[1].date.localeCompare(b[1].date) || a[1].vendorName.localeCompare(b[1].vendorName));
                if (sortedParts.length === 0) {
                  return <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No expected or existing orders in this week.</p>;
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {sortedParts.map(([key, part]) => {
                      const isMissing = modalClient.missing.some(
                        (m) => m.scheduled_delivery_date === part.date && (m.mealType ?? m.service_type) === part.type && m.vendorName === part.vendorName
                      );
                      const missingItem = modalClient.missing.find(
                        (m) => m.scheduled_delivery_date === part.date && (m.mealType ?? m.service_type) === part.type && m.vendorName === part.vendorName
                      );
                      const isCreatingThis = missingItem && creatingMissingIndex === modalClient.missing.indexOf(missingItem);
                      return (
                        <div key={key} style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg-app)' }}>
                          <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)', fontWeight: 600, fontSize: '0.9rem' }}>
                            {part.date} {' \u00B7 '} {part.vendorName} {' \u00B7 '} {formatMealType(part.type)}
                          </div>
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-app)' }}>
                                  <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', fontWeight: 600 }}>Order #</th>
                                  <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', fontWeight: 600 }}>Items</th>
                                  <th style={{ textAlign: 'right', padding: '0.4rem 0.6rem', fontWeight: 600 }}>Total</th>
                                  <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', fontWeight: 600 }}>Status</th>
                                  <th style={{ width: 80 }} />
                                </tr>
                              </thead>
                              <tbody>
                                {part.expected && (() => {
                                      const matchedExisting = part.existing.find((r) => r.order_number === part.expected!.existingOrderNumber);
                                      const displayItems = matchedExisting?.total_items ?? part.expected.payload?.totalItems ?? 0;
                                      const displayValue = matchedExisting?.total_value ?? part.expected.payload?.totalValue ?? 0;
                                      return (
                                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={{ padding: '0.4rem 0.6rem', fontWeight: part.expected.existingOrderNumber ? 600 : undefined }}>
                                      {part.expected.existingOrderNumber ?? '\u2014'}
                                    </td>
                                    <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{displayItems}</td>
                                    <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                                      ${Number(displayValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </td>
                                    <td style={{ padding: '0.4rem 0.6rem' }}>
                                      {isMissing ? <span style={{ color: 'var(--color-danger, #dc2626)', fontWeight: 500 }}>Missing</span> : <span style={{ color: 'var(--color-success, #16a34a)' }}>Expected</span>}
                                    </td>
                                    <td style={{ padding: '0.4rem 0.6rem' }}>
                                      {isMissing && missingItem && (
                                        <button
                                          type="button"
                                          onClick={() => handleCreateOneMissing(missingItem)}
                                          disabled={creating || !!isCreatingThis}
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.25rem',
                                            padding: '0.3rem 0.5rem',
                                            background: 'var(--color-success, #22c55e)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            fontWeight: 600,
                                            fontSize: '0.8rem',
                                            cursor: creating ? 'not-allowed' : 'pointer',
                                            opacity: creating ? 0.7 : 1
                                          }}
                                        >
                                          {isCreatingThis ? <Loader2 size={14} className="animate-spin" /> : <PlusCircle size={14} />}
                                          Create
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ); })()}
                                {part.existing
                                  .filter((row) => row.order_number !== part.expected?.existingOrderNumber)
                                  .map((row) => (
                                  <tr key={row.orderId} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: row.status === 'extra' ? 'var(--bg-panel)' : undefined }}>
                                    <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600 }}>{row.order_number}</td>
                                    <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{row.total_items != null ? row.total_items : '\u2014'}</td>
                                    <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>{row.total_value != null ? `$${Number(row.total_value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '\u2014'}</td>
                                    <td style={{ padding: '0.4rem 0.6rem' }}>
                                      {row.status === 'extra' ? <span style={{ color: 'var(--color-warning, #ca8a04)', fontWeight: 500 }}>Extra</span> : <span style={{ color: 'var(--color-success, #16a34a)' }}>Exists</span>}
                                    </td>
                                    <td style={{ padding: '0.4rem 0.6rem' }}>
                                      {row.status === 'extra' && (
                                        <button
                                          type="button"
                                          onClick={() => handleDeleteExtraOrder(row.orderId)}
                                          disabled={!!deletingOrderId}
                                          title="Delete order"
                                          style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            padding: '0.3rem 0.5rem',
                                            background: 'var(--color-danger, #dc2626)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: deletingOrderId ? 'not-allowed' : 'pointer',
                                            opacity: deletingOrderId === row.orderId ? 0.7 : 1
                                          }}
                                        >
                                          {deletingOrderId === row.orderId ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
