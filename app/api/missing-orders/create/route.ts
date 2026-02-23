import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { computeMissingOrders, type ExpectedOrder } from '@/lib/missing-orders';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const weekStart = body.weekStart as string;
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : undefined;
    const missingFromCheck = Array.isArray(body.missing) ? body.missing as ExpectedOrder[] : undefined;

    if (missingFromCheck?.length) {
      // Create the provided missing orders (from a previous check response)
      const creationIdParam = body.creationId != null ? Number(body.creationId) : undefined;
      const result = await createMissingOrders(supabase, missingFromCheck, creationIdParam);
      return NextResponse.json(result);
    }

    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return NextResponse.json({ error: 'Valid weekStart (YYYY-MM-DD, Sunday) is required' }, { status: 400 });
    }

    const weekEnd = new Date(weekStart + 'T00:00:00');
    weekEnd.setDate(weekEnd.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const clientIds = clientId ? [clientId] : undefined;
    const { missing } = await computeMissingOrders(supabase, weekStart, weekEndStr, { clientIds });

    if (missing.length === 0) {
      return NextResponse.json({
        created: 0,
        orderNumbers: [],
        message: 'No missing orders to create.'
      });
    }

    const creationIdParam = body.creationId != null ? Number(body.creationId) : undefined;
    const result = await createMissingOrders(supabase, missing, creationIdParam);
    return NextResponse.json(result);
  } catch (e) {
    console.error('[missing-orders/create]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

async function createMissingOrders(supabase: SupabaseClient, missing: ExpectedOrder[], requestedCreationId?: number) {
  const now = new Date().toISOString();
  const { data: maxOrder } = await supabase.from('orders').select('order_number').order('order_number', { ascending: false }).limit(1).maybeSingle();
  let nextOrderNumber = Math.max(100000, ((maxOrder as any)?.order_number || 0) + 1);
  const { data: maxCreation } = await supabase.from('orders').select('creation_id').not('creation_id', 'is', null).order('creation_id', { ascending: false }).limit(1).maybeSingle();
  const creationId = requestedCreationId ?? ((maxCreation as any)?.creation_id || 0) + 1;

  const created: { orderId: string; orderNumber: number; clientName: string; date: string }[] = [];

  for (const exp of missing) {
    const { data: newOrder, error: orderErr } = await supabase
      .from('orders')
      .insert({
        client_id: exp.client_id,
        service_type: exp.service_type,
        status: 'scheduled',
        scheduled_delivery_date: exp.scheduled_delivery_date,
        total_value: exp.payload.totalValue,
        total_items: exp.payload.totalItems,
        order_number: nextOrderNumber,
        last_updated: now,
        notes: exp.payload.notes,
        case_id: exp.payload.case_id || `CASE-${Date.now()}`,
        creation_id: creationId
      })
      .select('id')
      .single();

    if (orderErr || !newOrder) {
      console.error(`[missing-orders/create] Failed ${exp.clientName}:`, orderErr?.message);
      continue;
    }

    const { data: vs, error: vsErr } = await supabase
      .from('order_vendor_selections')
      .insert({ order_id: newOrder.id, vendor_id: exp.vendor_id })
      .select('id')
      .single();

    if (vsErr || !vs) {
      console.error('[missing-orders/create] order_vendor_selections failed:', vsErr?.message);
      continue;
    }

    const itemsList = exp.payload.itemsList;
    if (itemsList?.length) {
      const isFood = exp.service_type === 'Food';
      await supabase.from('order_items').insert(
        itemsList.map((i) => ({
          order_id: newOrder.id,
          vendor_selection_id: vs.id,
          menu_item_id: isFood ? i.menu_item_id : null,
          meal_item_id: isFood ? null : i.menu_item_id,
          quantity: i.quantity,
          unit_value: i.unit_value,
          total_value: i.total_value,
          notes: i.notes ?? null
        }))
      );
    }

    created.push({
      orderId: newOrder.id,
      orderNumber: nextOrderNumber,
      clientName: exp.clientName,
      date: exp.scheduled_delivery_date
    });
    nextOrderNumber++;
  }

  return {
    created: created.length,
    orderNumbers: created.map((c) => c.orderNumber),
    details: created,
    creationId
  };
}
