/**
 * Request menu items for the operator. Operator's own implementation.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import type { OperatorMenuItem } from './types';
import { operatorGetMenuItemsForVendor, operatorGetAllMenuItems, operatorGetMealItems } from './db';
import { operatorVendorExists } from './db';

export interface RequestMenuResult {
  success: boolean;
  menuItems?: OperatorMenuItem[];
  mealItems?: OperatorMenuItem[];
  error?: string;
}

/**
 * Request menu for a specific vendor (Food) or all items.
 */
export async function requestMenuForVendor(vendorId: string): Promise<RequestMenuResult> {
  const id = String(vendorId).trim();
  if (!id) {
    return { success: false, error: 'Vendor ID is required' };
  }

  const exists = await operatorVendorExists(id);
  if (!exists) {
    return { success: false, error: 'Vendor not found or inactive' };
  }

  const { items, error } = await operatorGetMenuItemsForVendor(id);
  if (error) {
    return { success: false, error: 'Could not fetch menu items' };
  }

  return { success: true, menuItems: items };
}

/**
 * Request all menu items (when caller doesn't specify vendor).
 */
export async function requestAllMenu(): Promise<RequestMenuResult> {
  const { items, error } = await operatorGetAllMenuItems();
  if (error) {
    return { success: false, error: 'Could not fetch menu items' };
  }

  const { items: mealItems, error: mealErr } = await operatorGetMealItems();
  if (mealErr) {
    return { success: true, menuItems: items };
  }

  return { success: true, menuItems: items, mealItems };
}
