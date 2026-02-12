/**
 * Enrich upcoming order payload with item details (name, price, value).
 * Resolves item IDs from items and itemsByDay to human-readable info.
 */

import type { OperatorUpcomingItemLine } from './types';
import { operatorGetItemDetailsByIds } from './db';

type RawUpcomingOrder = Record<string, unknown>;
type RawVendorSelection = Record<string, unknown>;

function collectItemIdsFromVendorSelection(vs: RawVendorSelection): string[] {
  const ids: string[] = [];
  const items = vs.items as Record<string, number> | undefined;
  if (items && typeof items === 'object') {
    ids.push(...Object.keys(items));
  }
  const itemsByDay = vs.itemsByDay as Record<string, Record<string, number>> | undefined;
  if (itemsByDay && typeof itemsByDay === 'object') {
    for (const dayItems of Object.values(itemsByDay)) {
      if (dayItems && typeof dayItems === 'object') {
        ids.push(...Object.keys(dayItems));
      }
    }
  }
  return [...new Set(ids.filter(Boolean))];
}

function buildItemLines(
  itemMap: Record<string, number>,
  details: Record<string, { name: string; price: number }>
): OperatorUpcomingItemLine[] {
  const lines: OperatorUpcomingItemLine[] = [];
  for (const [itemId, qty] of Object.entries(itemMap)) {
    const d = details[itemId];
    const name = d?.name ?? 'Unknown';
    const price = d?.price ?? 0;
    const quantity = Number(qty) || 1;
    const value = price * quantity;
    lines.push({ itemId, name, price, value, quantity });
  }
  return lines;
}

function buildItemsByDayWithDetails(
  itemsByDay: Record<string, Record<string, number>>,
  details: Record<string, { name: string; price: number }>
): Record<string, OperatorUpcomingItemLine[]> {
  const result: Record<string, OperatorUpcomingItemLine[]> = {};
  for (const [day, dayItems] of Object.entries(itemsByDay)) {
    if (dayItems && typeof dayItems === 'object') {
      result[day] = buildItemLines(dayItems, details);
    }
  }
  return result;
}

/**
 * Enrich raw upcoming order with itemsWithDetails and itemsByDayWithDetails.
 * For Food/Meal: resolves vendorSelections items via menu_items/breakfast_items.
 * For Boxes: resolves box type names; item IDs in box items are menu item IDs.
 * For Custom: no item resolution.
 */
export async function enrichUpcomingOrderWithItemDetails(
  raw: unknown
): Promise<unknown> {
  if (!raw || typeof raw !== 'object') return raw;

  const order = raw as RawUpcomingOrder;
  const serviceType = String(order.serviceType ?? '');

  if (serviceType === 'Custom') {
    return raw;
  }

  if (serviceType === 'Boxes') {
    // Box orders: boxOrders have boxTypeId, items (menu item IDs). Could enrich.
    // For now keep Boxes as-is; optional add box type name lookup later.
    return raw;
  }

  if (serviceType !== 'Food' && serviceType !== 'Meal') {
    return raw;
  }

  const vendorSelections = order.vendorSelections as RawVendorSelection[] | undefined;
  if (!Array.isArray(vendorSelections) || vendorSelections.length === 0) {
    return raw;
  }

  // Collect all item IDs across vendor selections
  const allIds: string[] = [];
  for (const vs of vendorSelections) {
    allIds.push(...collectItemIdsFromVendorSelection(vs));
  }
  const uniqueIds = [...new Set(allIds)];
  if (uniqueIds.length === 0) {
    return raw;
  }

  const details = await operatorGetItemDetailsByIds(uniqueIds);

  const enrichedSelections = vendorSelections.map((vs) => {
    const out = { ...vs } as RawVendorSelection;
    const items = vs.items as Record<string, number> | undefined;
    const itemsByDay = vs.itemsByDay as Record<string, Record<string, number>> | undefined;

    if (items && typeof items === 'object' && Object.keys(items).length > 0) {
      out.itemsWithDetails = buildItemLines(items, details);
    }
    if (itemsByDay && typeof itemsByDay === 'object' && Object.keys(itemsByDay).length > 0) {
      out.itemsByDayWithDetails = buildItemsByDayWithDetails(itemsByDay, details);
    }
    return out;
  });

  return { ...order, vendorSelections: enrichedSelections };
}
