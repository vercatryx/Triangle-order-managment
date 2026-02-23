import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeMissingOrders } from '@/lib/missing-orders';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const weekStart = body.weekStart as string;
    const clientIds = Array.isArray(body.clientIds) ? body.clientIds.filter((x: unknown) => typeof x === 'string') as string[] : undefined;

    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return NextResponse.json({ error: 'Valid weekStart (YYYY-MM-DD, Sunday) is required' }, { status: 400 });
    }

    const weekStartDate = new Date(weekStart + 'T00:00:00');
    const weekEnd = new Date(weekStartDate);
    weekEnd.setDate(weekStartDate.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const { missing, expectedCount, cutoffUsedAt, cutoffDayName, clientSnapshotUsedAt, expectedWithDetails, snapshotOrderConfig, existingOrdersByClient } = await computeMissingOrders(supabase, weekStart, weekEndStr, { clientIds });

    const byClient = new Map<string, {
      clientName: string;
      missing: typeof missing;
      expectedSummary: typeof expectedWithDetails;
      snapshotUsedAt: { timestamp: string | null; createdAt: string | null; source: 'order_history' | 'upcoming_order' } | null;
      snapshotOrderConfig: any;
      existingOrders: { orderId: string; order_number: number; scheduled_delivery_date: string; vendorName: string; mealType: string; status: 'matched' | 'extra'; total_items?: number | null; total_value?: number | null }[];
    }>();
    for (const m of missing) {
      if (!byClient.has(m.client_id)) {
        const snap = clientSnapshotUsedAt[m.client_id];
        byClient.set(m.client_id, {
          clientName: m.clientName,
          missing: [],
          expectedSummary: expectedWithDetails.filter((e) => e.client_id === m.client_id),
          snapshotUsedAt: snap ? { timestamp: snap.timestamp, createdAt: snap.createdAt, source: snap.source } : null,
          snapshotOrderConfig: snapshotOrderConfig[m.client_id] ?? null,
          existingOrders: existingOrdersByClient[m.client_id] ?? []
        });
      }
      byClient.get(m.client_id)!.missing.push(m);
    }
    for (const [clientId, info] of Object.entries(clientSnapshotUsedAt)) {
      if (!byClient.has(clientId)) {
        byClient.set(clientId, {
          clientName: info.clientName,
          missing: [],
          expectedSummary: expectedWithDetails.filter((e) => e.client_id === clientId),
          snapshotUsedAt: { timestamp: info.timestamp, createdAt: info.createdAt, source: info.source },
          snapshotOrderConfig: snapshotOrderConfig[clientId] ?? null,
          existingOrders: existingOrdersByClient[clientId] ?? []
        });
      } else {
        const existing = byClient.get(clientId)!;
        if (!existing.snapshotUsedAt) {
          existing.snapshotUsedAt = { timestamp: info.timestamp, createdAt: info.createdAt, source: info.source };
        }
        existing.expectedSummary = expectedWithDetails.filter((e) => e.client_id === clientId);
        existing.snapshotOrderConfig = snapshotOrderConfig[clientId] ?? existing.snapshotOrderConfig;
        existing.existingOrders = existingOrdersByClient[clientId] ?? existing.existingOrders;
      }
    }

    // Ensure one entry per requested client so the modal always has data
    if (clientIds?.length) {
      for (const cid of clientIds) {
        if (!byClient.has(cid)) {
          byClient.set(cid, {
            clientName: '',
            missing: [],
            expectedSummary: [],
            snapshotUsedAt: null,
            snapshotOrderConfig: null,
            existingOrders: existingOrdersByClient[cid] ?? []
          });
        }
      }
      const needNames = clientIds.filter((id) => byClient.get(id)!.clientName === '');
      if (needNames.length) {
        const { data: nameRows } = await supabase.from('clients').select('id, full_name').in('id', needNames);
        for (const r of nameRows ?? []) {
          const entry = byClient.get(r.id);
          if (entry) entry.clientName = r.full_name ?? '';
        }
      }
    }

    const byClientList = Array.from(byClient.entries()).map(([clientId, v]) => ({
      clientId,
      clientName: v.clientName,
      missing: v.missing,
      expectedSummary: v.expectedSummary,
      snapshotUsedAt: v.snapshotUsedAt,
      snapshotOrderConfig: v.snapshotOrderConfig,
      existingOrders: v.existingOrders
    }));

    return NextResponse.json({
      weekStart,
      weekEnd: weekEndStr,
      /** Cutoff datetime (e.g. Tuesday before week) — expected orders are from order_history at or before this. */
      cutoffUsedAt,
      /** Day name from app_settings for display, e.g. "Tuesday". */
      cutoffDayName: cutoffDayName ?? 'Tuesday',
      expectedCount,
      missingCount: missing.length,
      byClient: byClientList
    });
  } catch (e) {
    console.error('[missing-orders/check]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
