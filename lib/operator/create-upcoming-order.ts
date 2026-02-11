/**
 * Create upcoming order for operator. MVP: Custom type only.
 * Uses only lib/operator/* — no imports from lib/actions, lib/upcoming-order-converter, etc.
 * Per UPCOMING_ORDER_SCHEMA.md.
 */

import type { OperatorCustomOrderPayload } from './types';
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
