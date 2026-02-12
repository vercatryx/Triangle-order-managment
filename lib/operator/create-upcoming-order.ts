/**
 * Create upcoming order for operator.
 * Supports: Custom, Food, Meal.
 * Uses only lib/operator/* — no imports from lib/actions, lib/upcoming-order-converter, etc.
 * Per UPCOMING_ORDER_SCHEMA.md.
 */

import type { OperatorCustomOrderPayload, OperatorVendorSelection } from './types';
import {
  operatorGetClientById,
  operatorVendorExists,
  operatorUpdateClientUpcomingOrder,
  operatorAppendOrderHistory,
} from './db';
import { checkClientEligibility } from './eligibility';

const VALID_DELIVERY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface CreateOrderResult {
  success: boolean;
  error?: string;
}

/**
 * Build Custom order payload from input (per schema).
 */
function buildCustomPayload(input: {
  custom_name?: string;
  custom_price?: string | number;
  vendorId?: string;
  deliveryDay?: string;
  notes?: string;
  caseId?: string;
}): OperatorCustomOrderPayload {
  const payload: OperatorCustomOrderPayload = {
    serviceType: 'Custom',
  };
  if (input.caseId) payload.caseId = String(input.caseId).trim();
  if (input.custom_name != null) payload.custom_name = String(input.custom_name).trim() || undefined;
  if (input.custom_price != null) payload.custom_price = input.custom_price;
  if (input.vendorId) payload.vendorId = String(input.vendorId).trim();
  if (input.deliveryDay) payload.deliveryDay = String(input.deliveryDay).trim();
  if (input.notes != null) payload.notes = String(input.notes).trim() || undefined;
  return payload;
}

/**
 * Create a Custom upcoming order for a client.
 */
export async function createCustomUpcomingOrder(params: {
  clientId: string;
  custom_name?: string;
  custom_price?: string | number;
  vendorId?: string;
  deliveryDay?: string;
  notes?: string;
  caseId?: string;
}): Promise<CreateOrderResult> {
  const clientId = String(params.clientId).trim();
  if (!clientId) {
    return { success: false, error: 'Client ID is required' };
  }

  const { client, error: clientErr } = await operatorGetClientById(clientId);
  if (clientErr) {
    return { success: false, error: 'Could not fetch client' };
  }
  if (!client) {
    return { success: false, error: 'Client not found' };
  }

  const eligibility = await checkClientEligibility(client);
  if (!eligibility.eligible) {
    return { success: false, error: eligibility.reason ?? 'Client is not eligible for deliveries' };
  }

  if (client.service_type !== 'Custom') {
    return { success: false, error: `Client service type is ${client.service_type}; Custom order requires Custom service type` };
  }

  if (params.vendorId) {
    const vendorExists = await operatorVendorExists(params.vendorId);
    if (!vendorExists) {
      return { success: false, error: 'Vendor not found or inactive' };
    }
  }

  if (params.deliveryDay) {
    const day = String(params.deliveryDay).trim();
    if (!VALID_DELIVERY_DAYS.some((d) => d.toLowerCase() === day.toLowerCase())) {
      return { success: false, error: `Invalid delivery day. Use one of: ${VALID_DELIVERY_DAYS.join(', ')}` };
    }
  }

  const payload = buildCustomPayload({
    custom_name: params.custom_name,
    custom_price: params.custom_price,
    vendorId: params.vendorId,
    deliveryDay: params.deliveryDay,
    notes: params.notes,
    caseId: params.caseId,
  });

  const { error: updateErr } = await operatorUpdateClientUpcomingOrder(clientId, payload);
  if (updateErr) {
    return { success: false, error: 'Failed to save upcoming order' };
  }

  // Optional: append to order_history (plan leaves this as open question; we do it for audit)
  const historyEntry = {
    type: 'upcoming_order_created',
    serviceType: 'Custom',
    at: new Date().toISOString(),
    payload,
  };
  await operatorAppendOrderHistory(clientId, historyEntry);

  return { success: true };
}

/** Food/Meal vendor selection input (items: menu_item_id or meal_item_id -> quantity) */
export interface OperatorItemsInput {
  vendorId: string;
  items: Record<string, number>;
  itemNotes?: Record<string, string>;
}

/** Create Food upcoming order with items and quantities. */
export async function createFoodUpcomingOrder(params: {
  clientId: string;
  vendorSelections?: OperatorItemsInput[];
  deliveryDayOrders?: Record<string, { vendorSelections: OperatorItemsInput[] }>;
  notes?: string;
  caseId?: string;
}): Promise<CreateOrderResult> {
  const clientId = String(params.clientId).trim();
  if (!clientId) {
    return { success: false, error: 'Client ID is required' };
  }

  const { client, error: clientErr } = await operatorGetClientById(clientId);
  if (clientErr) return { success: false, error: 'Could not fetch client' };
  if (!client) return { success: false, error: 'Client not found' };

  const eligibility = await checkClientEligibility(client);
  if (!eligibility.eligible) {
    return { success: false, error: eligibility.reason ?? 'Client is not eligible for deliveries' };
  }

  if (client.service_type !== 'Food') {
    return { success: false, error: `Client service type is ${client.service_type}; Food order requires Food service type` };
  }

  function validateAndBuildSelections(
    inputList: OperatorItemsInput[] | undefined
  ): OperatorVendorSelection[] {
    const out: OperatorVendorSelection[] = [];
    for (const vs of inputList ?? []) {
      if (!vs.vendorId || !vs.items || Object.keys(vs.items).length === 0) continue;
      const items: Record<string, number> = {};
      for (const [k, v] of Object.entries(vs.items)) {
        const q = Math.max(0, Math.floor(Number(v) || 0));
        if (q > 0) items[k] = q;
      }
      if (Object.keys(items).length > 0) {
        out.push({ vendorId: vs.vendorId, items, itemNotes: vs.itemNotes });
      }
    }
    return out;
  }

  let payload: Record<string, unknown> = { serviceType: 'Food' };

  if (params.deliveryDayOrders && Object.keys(params.deliveryDayOrders).length > 0) {
    const deliveryDayOrders: Record<string, { vendorSelections: OperatorVendorSelection[] }> = {};
    for (const [day, dayData] of Object.entries(params.deliveryDayOrders)) {
      const vsList = validateAndBuildSelections(dayData.vendorSelections);
      if (vsList.length > 0) {
        for (const vs of vsList) {
          const vendorExists = await operatorVendorExists(vs.vendorId);
          if (!vendorExists) {
            return { success: false, error: `Vendor ${vs.vendorId} not found or inactive` };
          }
        }
        deliveryDayOrders[day] = { vendorSelections: vsList };
      }
    }
    if (Object.keys(deliveryDayOrders).length === 0) {
      return { success: false, error: 'No valid items with quantities provided' };
    }
    payload.deliveryDayOrders = deliveryDayOrders;
  } else {
    const selections = validateAndBuildSelections(params.vendorSelections);
    if (selections.length === 0) {
      return { success: false, error: 'No valid items with quantities provided' };
    }
    for (const vs of selections) {
      const vendorExists = await operatorVendorExists(vs.vendorId);
      if (!vendorExists) {
        return { success: false, error: `Vendor ${vs.vendorId} not found or inactive` };
      }
    }
    payload.vendorSelections = selections;
  }
  if (params.notes) payload.notes = String(params.notes).trim();
  if (params.caseId) payload.caseId = String(params.caseId).trim();

  const { error: updateErr } = await operatorUpdateClientUpcomingOrder(clientId, payload);
  if (updateErr) return { success: false, error: 'Failed to save upcoming order' };

  await operatorAppendOrderHistory(clientId, {
    type: 'upcoming_order_created',
    serviceType: 'Food',
    at: new Date().toISOString(),
    payload,
  });

  return { success: true };
}

/** Create Meal upcoming order with items and quantities. */
export async function createMealUpcomingOrder(params: {
  clientId: string;
  mealSelections?: Record<string, { vendorId?: string; items: Record<string, number>; itemNotes?: Record<string, string> }>;
  notes?: string;
  caseId?: string;
}): Promise<CreateOrderResult> {
  const clientId = String(params.clientId).trim();
  if (!clientId) {
    return { success: false, error: 'Client ID is required' };
  }

  const { client, error: clientErr } = await operatorGetClientById(clientId);
  if (clientErr) return { success: false, error: 'Could not fetch client' };
  if (!client) return { success: false, error: 'Client not found' };

  const eligibility = await checkClientEligibility(client);
  if (!eligibility.eligible) {
    return { success: false, error: eligibility.reason ?? 'Client is not eligible for deliveries' };
  }

  if (client.service_type !== 'Meal') {
    return { success: false, error: `Client service type is ${client.service_type}; Meal order requires Meal service type` };
  }

  if (!params.mealSelections || Object.keys(params.mealSelections).length === 0) {
    return { success: false, error: 'No meal selections with items provided' };
  }

  const mealSelections: Record<string, { vendorId?: string; items: Record<string, number>; itemNotes?: Record<string, string> }> = {};
  for (const [mealType, sel] of Object.entries(params.mealSelections)) {
    if (!sel.items || Object.keys(sel.items).length === 0) continue;
    if (sel.vendorId) {
      const vendorExists = await operatorVendorExists(sel.vendorId);
      if (!vendorExists) {
        return { success: false, error: `Vendor ${sel.vendorId} not found or inactive` };
      }
    }
    const items: Record<string, number> = {};
    for (const [k, v] of Object.entries(sel.items)) {
      const q = Math.max(0, Math.floor(Number(v) || 0));
      if (q > 0) items[k] = q;
    }
    if (Object.keys(items).length > 0) {
      mealSelections[mealType] = {
        vendorId: sel.vendorId,
        items,
        itemNotes: sel.itemNotes,
      };
    }
  }

  if (Object.keys(mealSelections).length === 0) {
    return { success: false, error: 'No valid meal items with quantities provided' };
  }

  const payload: Record<string, unknown> = {
    serviceType: 'Meal',
    mealSelections,
  };
  if (params.notes) payload.notes = String(params.notes).trim();
  if (params.caseId) payload.caseId = String(params.caseId).trim();

  const { error: updateErr } = await operatorUpdateClientUpcomingOrder(clientId, payload);
  if (updateErr) return { success: false, error: 'Failed to save upcoming order' };

  await operatorAppendOrderHistory(clientId, {
    type: 'upcoming_order_created',
    serviceType: 'Meal',
    at: new Date().toISOString(),
    payload,
  });

  return { success: true };
}
