/**
 * Shared logic to decide if a client's upcoming_order has issues that should block order creation.
 * Used by: create-orders-next-week, process-weekly-orders, simulate-delivery-cycle, and processUpcomingOrders.
 * Same semantics as cleanup page: invalid vendor, deleted/inactive menu or meal items, inactive/deleted box items.
 */

export type BlockContext = {
  activeMenuItemIds: Set<string>;
  activeBreakfastItemIds: Set<string>;
  allMenuItemIds: Set<string>;
  allBreakfastItemIds: Set<string>;
  vendorMap: Map<string, { is_active: boolean }>;
};

/**
 * Returns true if this upcoming_order config should block order creation (client must fix on cleanup page first).
 */
export function hasBlockingCleanupIssues(
  uo: Record<string, unknown> | null | undefined,
  ctx: BlockContext
): boolean {
  if (!uo || typeof uo !== 'object') return false;
  const { activeMenuItemIds, activeBreakfastItemIds, allMenuItemIds, allBreakfastItemIds, vendorMap } = ctx;

  const isItemBlocking = (itemId: string) => {
    if (allMenuItemIds.has(itemId) || allBreakfastItemIds.has(itemId)) {
      return !activeMenuItemIds.has(itemId) && !activeBreakfastItemIds.has(itemId);
    }
    return true; // deleted = blocking
  };

  const vendorBlocking = (vid: string) => {
    const v = vendorMap.get(vid);
    return !v || !v.is_active;
  };

  // Only block when vendor missing from DB (not when inactive) — same as Meal so clients get orders when cleanup shows nothing
  const vendorMissing = (vid: string) => !vendorMap.has(vid);
  const itemDeleted = (itemId: string) => !allMenuItemIds.has(itemId) && !allBreakfastItemIds.has(itemId);

  // Food: deliveryDayOrders or vendorSelections (relaxed: block only on missing vendor or deleted item)
  const ddo = uo.deliveryDayOrders as Record<string, { vendorSelections?: { vendorId?: string; items?: Record<string, number> }[] }> | undefined;
  if (ddo && typeof ddo === 'object') {
    for (const dayData of Object.values(ddo)) {
      const selections = dayData?.vendorSelections;
      if (!Array.isArray(selections)) continue;
      for (const vs of selections) {
        const vid = vs.vendorId;
        if (vid && vendorMissing(vid)) return true;
        const items = vs.items && typeof vs.items === 'object' ? vs.items : {};
        for (const itemId of Object.keys(items)) {
          if (Number(items[itemId]) > 0 && itemDeleted(itemId)) return true;
        }
      }
    }
  }

  const vsel = uo.vendorSelections as { vendorId?: string; itemsByDay?: Record<string, Record<string, number>> }[] | undefined;
  if (Array.isArray(vsel) && (!ddo || typeof ddo !== 'object' || Object.keys(ddo).length === 0)) {
    for (const vs of vsel) {
      const vid = vs.vendorId;
      if (!vid) continue;
      if (vendorMissing(vid)) return true;
      const itemsByDay = vs.itemsByDay && typeof vs.itemsByDay === 'object' ? vs.itemsByDay : {};
      for (const dayItems of Object.values(itemsByDay)) {
        if (!dayItems || typeof dayItems !== 'object') continue;
        for (const itemId of Object.keys(dayItems)) {
          if (Number(dayItems[itemId]) > 0 && itemDeleted(itemId)) return true;
        }
      }
    }
  }

  // Meal: mealSelections (support snake_case meal_selections)
  // Relaxed: only block on missing vendor or deleted item, so meal orders can be created when cleanup page shows nothing (e.g. inactive item/vendor still allow creation).
  const mealSel = (uo.mealSelections ?? (uo as any).meal_selections) as Record<string, { vendorId?: string; vendor_id?: string; items?: Record<string, number> }> | undefined;
  if (mealSel && typeof mealSel === 'object') {
    const mealVendorBlocking = (vid: string) => !vendorMap.has(vid); // only block if vendor missing, not if inactive
    const mealItemBlocking = (itemId: string) => !allMenuItemIds.has(itemId) && !allBreakfastItemIds.has(itemId); // only block if item deleted (not in DB)
    for (const data of Object.values(mealSel)) {
      const vid = data?.vendorId ?? data?.vendor_id;
      if (vid && mealVendorBlocking(vid)) return true;
      const items = data?.items && typeof data.items === 'object' ? data.items : {};
      for (const itemId of Object.keys(items)) {
        if (Number(items[itemId]) > 0 && mealItemBlocking(itemId)) return true;
      }
    }
  }

  // Boxes: boxOrders
  const rawBoxOrders = (uo.boxOrders ?? (uo as any).box_orders) as { vendorId?: string; vendor_id?: string; items?: Record<string, number | { quantity?: number }> }[] | undefined;
  if (rawBoxOrders && Array.isArray(rawBoxOrders)) {
    for (const box of rawBoxOrders) {
      const vid = box.vendorId ?? box.vendor_id;
      if (vid && vendorBlocking(vid)) return true;
      const items = box.items && typeof box.items === 'object' ? box.items : {};
      for (const [itemId, val] of Object.entries(items)) {
        const qty = typeof val === 'object' && val != null && 'quantity' in val ? Number((val as any).quantity) || 0 : Number(val) || 0;
        if (qty > 0 && isItemBlocking(itemId)) return true;
      }
    }
  }

  return false;
}
