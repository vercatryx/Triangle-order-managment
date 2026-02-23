import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const weekStart = searchParams.get('weekStart');
    const page = Math.max(0, parseInt(searchParams.get('page') ?? '0', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? String(PAGE_SIZE), 10)));
    const authMealsParam = searchParams.get('authMeals');
    const amountTargetParam = searchParams.get('amountTarget');
    const amountToleranceParam = searchParams.get('amountTolerance');

    const authMeals = authMealsParam != null && authMealsParam !== '' ? parseInt(authMealsParam, 10) : null;
    const amountTarget = amountTargetParam != null && amountTargetParam !== '' ? parseFloat(amountTargetParam) : null;
    const amountTolerance = amountToleranceParam != null && amountToleranceParam !== '' ? Math.max(0, parseFloat(amountToleranceParam)) : 0;
    const amountDirectionParam = searchParams.get('amountDirection');
    const amountDirection = (amountDirectionParam === '+' || amountDirectionParam === '-' || amountDirectionParam === '+/-') ? amountDirectionParam : '+/-';
    const hasFilter = authMeals != null && !Number.isNaN(authMeals) || amountTarget != null && !Number.isNaN(amountTarget);

    if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return NextResponse.json({ error: 'Valid weekStart (YYYY-MM-DD, Sunday) is required' }, { status: 400 });
    }

    const weekStartDate = new Date(weekStart + 'T00:00:00');
    const day = weekStartDate.getDay();
    if (day !== 0) {
      return NextResponse.json({ error: 'weekStart must be a Sunday' }, { status: 400 });
    }

    const weekEnd = new Date(weekStartDate);
    weekEnd.setDate(weekStartDate.getDate() + 6);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    // Only non-dependants; service type from client.upcoming_order (Food or Meal only, not Boxes/Custom).
    const { data: allClients, error: clientsError } = await supabase
      .from('clients')
      .select('id, full_name, approved_meals_per_week, upcoming_order')
      .is('parent_client_id', null)
      .order('full_name', { ascending: true });

    if (clientsError) {
      console.error('[missing-orders/clients]', clientsError);
      return NextResponse.json({ error: clientsError.message }, { status: 500 });
    }

    const serviceTypeFromUpcoming = (c: any): string | null => {
      const uo = c.upcoming_order;
      if (!uo || typeof uo !== 'object') return null;
      return uo.serviceType ?? uo.service_type ?? null;
    };

    let foodOrMealClients = (allClients || []).filter((c: any) => {
      const st = serviceTypeFromUpcoming(c);
      return st === 'Food' || st === 'Meal';
    });

    if (authMeals != null && !Number.isNaN(authMeals)) {
      foodOrMealClients = foodOrMealClients.filter((c: any) => (c.approved_meals_per_week ?? null) === authMeals);
    }

    const parentIdsAll = foodOrMealClients.map((c: any) => c.id);
    if (parentIdsAll.length === 0) {
      return NextResponse.json({
        clients: [],
        total: 0,
        page,
        pageSize
      });
    }

    // Dependents for all parents (needed when filtering by amount, or for current page)
    const { data: dependents } = await supabase
      .from('clients')
      .select('id, parent_client_id')
      .in('parent_client_id', parentIdsAll);
    const dependentToParent = new Map<string, string>();
    const allClientIds = new Set<string>(parentIdsAll);
    for (const d of dependents || []) {
      if (d.parent_client_id) {
        dependentToParent.set(d.id, d.parent_client_id);
        allClientIds.add(d.id);
      }
    }
    const effectiveClientId = (orderClientId: string) => dependentToParent.get(orderClientId) || orderClientId;

    type ClientOrderRec = { orderNumbers: number[]; total: number; orderIds: string[] };
    let byClientAll: Map<string, ClientOrderRec> = new Map();

    const fetchAllOrdersForWeek = async (): Promise<{ id: string; client_id: string; order_number: number | null; total_value: number | null }[]> => {
      const allOrders: { id: string; client_id: string; order_number: number | null; total_value: number | null }[] = [];
      const chunkSize = 1000;
      let offset = 0;
      let page: typeof allOrders;
      const baseQuery = () =>
        supabase
          .from('orders')
          .select('id, client_id, order_number, total_value')
          .in('client_id', Array.from(allClientIds))
          .gte('scheduled_delivery_date', weekStart)
          .lte('scheduled_delivery_date', weekEndStr);
      do {
        const { data, error } = await baseQuery().range(offset, offset + chunkSize - 1);
        if (error) throw error;
        page = (data || []) as typeof allOrders;
        allOrders.push(...page);
        offset += chunkSize;
      } while (page.length === chunkSize);
      return allOrders;
    };

    if (hasFilter) {
      // Fetch all orders for the week (paginated so we never hit row limit)
      let ordersAll: { id: string; client_id: string; order_number: number | null; total_value: number | null }[];
      try {
        ordersAll = await fetchAllOrdersForWeek();
      } catch (ordersError: any) {
        console.error('[missing-orders/clients] orders fetch:', ordersError);
        return NextResponse.json({ error: ordersError?.message ?? 'Failed to fetch orders' }, { status: 500 });
      }

      for (const cid of parentIdsAll) {
        byClientAll.set(cid, { orderNumbers: [], total: 0, orderIds: [] });
      }
      for (const o of ordersAll) {
        const rowClientId = effectiveClientId(o.client_id);
        if (!byClientAll.has(rowClientId)) continue;
        const rec = byClientAll.get(rowClientId)!;
        rec.orderIds.push(o.id);
        if (o.order_number != null) rec.orderNumbers.push(Number(o.order_number));
        const amt = o.total_value ?? 0;
        rec.total += Number(amt);
      }

      if (amountTarget != null && !Number.isNaN(amountTarget)) {
        const low = amountTarget - amountTolerance;
        const high = amountTarget + amountTolerance;
        foodOrMealClients = foodOrMealClients.filter((c: any) => {
          const rec = byClientAll.get(c.id);
          const total = rec?.total ?? 0;
          if (amountDirection === '+') return total > high;
          if (amountDirection === '-') return total < low;
          return total < low || total > high; // +/-
        });
      }
    }

    const total = foodOrMealClients.length;
    const from = page * pageSize;
    const clients = foodOrMealClients.slice(from, from + pageSize);
    const parentIds = clients.map((c: any) => c.id);

    if (parentIds.length === 0) {
      return NextResponse.json({
        clients: [],
        total,
        page,
        pageSize
      });
    }

    let byClient = byClientAll;
    if (!hasFilter || byClientAll.size === 0) {
      byClient = new Map();
      for (const cid of parentIds) {
        byClient.set(cid, { orderNumbers: [], total: 0, orderIds: [] });
      }
      let orders: { id: string; client_id: string; order_number: number | null; total_value: number | null }[];
      try {
        orders = await fetchAllOrdersForWeek();
      } catch (ordersError: any) {
        console.error('[missing-orders/clients] orders fetch:', ordersError);
        return NextResponse.json({ error: ordersError?.message ?? 'Failed to fetch orders' }, { status: 500 });
      }
      for (const o of orders) {
        const rowClientId = effectiveClientId(o.client_id);
        if (!byClient.has(rowClientId)) continue;
        const rec = byClient.get(rowClientId)!;
        rec.orderIds.push(o.id);
        if (o.order_number != null) rec.orderNumbers.push(Number(o.order_number));
        const amt = o.total_value ?? 0;
        rec.total += Number(amt);
      }
    }

    // Resolve vendor names for current page clients' orders
    const orderIdsForPage = new Set<string>();
    for (const c of clients || []) {
      const rec = byClient.get(c.id);
      if (rec?.orderIds?.length) rec.orderIds.forEach((id: string) => orderIdsForPage.add(id));
    }
    const vendorNamesByOrderId = new Map<string, string[]>();
    if (orderIdsForPage.size > 0) {
      const orderIdsArr = Array.from(orderIdsForPage);
      const allVendorIds = new Set<string>();
      const pairs: { orderId: string; vendorId: string | null }[] = [];
      const chunk = 500;
      for (let i = 0; i < orderIdsArr.length; i += chunk) {
        const batch = orderIdsArr.slice(i, i + chunk);
        const [ovs, obs] = await Promise.all([
          supabase.from('order_vendor_selections').select('order_id, vendor_id').in('order_id', batch),
          supabase.from('order_box_selections').select('order_id, vendor_id').in('order_id', batch)
        ]);
        const ovsData = (ovs.data || []) as { order_id: string; vendor_id: string | null }[];
        const obsData = (obs.data || []) as { order_id: string; vendor_id: string | null }[];
        ovsData.forEach((r) => { pairs.push({ orderId: r.order_id, vendorId: r.vendor_id }); if (r.vendor_id) allVendorIds.add(r.vendor_id); });
        obsData.forEach((r) => { pairs.push({ orderId: r.order_id, vendorId: r.vendor_id }); if (r.vendor_id) allVendorIds.add(r.vendor_id); });
      }
      const vendorById = new Map<string, string>();
      if (allVendorIds.size > 0) {
        const { data: vendors } = await supabase.from('vendors').select('id, name').in('id', Array.from(allVendorIds));
        (vendors || []).forEach((v: any) => vendorById.set(v.id, v.name));
      }
      for (const { orderId, vendorId } of pairs) {
        const name = vendorId ? (vendorById.get(vendorId) ?? 'Unknown') : 'Unknown';
        const existing = vendorNamesByOrderId.get(orderId) || [];
        if (!existing.includes(name)) existing.push(name);
        vendorNamesByOrderId.set(orderId, existing);
      }
    }

    const rows = (clients || []).map((c: any) => {
      const rec = byClient.get(c.id) ?? { orderNumbers: [] as number[], total: 0, orderIds: [] as string[] };
      const vendorSet = new Set<string>();
      for (const oid of rec.orderIds || []) {
        const names = vendorNamesByOrderId.get(oid) || [];
        names.forEach((n) => vendorSet.add(n));
      }
      const vendors = Array.from(vendorSet).sort();
      return {
        id: c.id,
        fullName: c.full_name || c.id,
        approvedMealsPerWeek: c.approved_meals_per_week ?? null,
        orderNumbers: [...rec.orderNumbers].sort((a, b) => a - b),
        ordersTotal: rec.total,
        vendors
      };
    });

    return NextResponse.json({
      clients: rows,
      total,
      page,
      pageSize
    });
  } catch (e) {
    console.error('[missing-orders/clients]', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
