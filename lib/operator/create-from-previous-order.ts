/**
 * Create upcoming order from client's previous order. Operator's own implementation.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import type { OperatorVendorSelection, OperatorBoxOrderItem } from './types';
import {
  operatorGetClientById,
  operatorGetLastOrderForClient,
  operatorUpdateClientUpcomingOrder,
  operatorAppendOrderHistory,
} from './db';
import { checkClientEligibility } from './eligibility';

export interface CreateFromPreviousOrderResult {
  success: boolean;
  error?: string;
}

/**
 * Create upcoming order by repeating the client's last order.
 */
export async function createUpcomingOrderFromPrevious(
  clientId: string
): Promise<CreateFromPreviousOrderResult> {
  const id = String(clientId).trim();
  if (!id) {
    return { success: false, error: 'Client ID is required' };
  }

  const { client, error: clientErr } = await operatorGetClientById(id);
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

  const { order, error: orderErr } = await operatorGetLastOrderForClient(id);
  if (orderErr) {
    return { success: false, error: 'Could not fetch previous order' };
  }
  if (!order) {
    return { success: false, error: 'No previous order found for this client' };
  }

  const serviceType = order.serviceType as 'Food' | 'Meal' | 'Boxes';
  if (!['Food', 'Meal', 'Boxes'].includes(serviceType)) {
    return { success: false, error: 'Previous order type cannot be repeated (Custom orders need custom flow)' };
  }

  let payload: object;
  if (serviceType === 'Boxes' && order.boxOrders && order.boxOrders.length > 0) {
    payload = {
      serviceType: 'Boxes',
      boxOrders: order.boxOrders.map((b): OperatorBoxOrderItem => ({
        boxTypeId: b.boxTypeId,
        vendorId: b.vendorId,
        quantity: b.quantity,
        items: b.items,
      })),
    };
  } else if (order.vendorSelections && order.vendorSelections.length > 0) {
    payload = {
      serviceType: serviceType,
      vendorSelections: order.vendorSelections.map((vs): OperatorVendorSelection => ({
        vendorId: vs.vendorId,
        items: vs.items,
      })),
    };
  } else {
    return { success: false, error: 'Previous order has no items to repeat' };
  }

  const { error: updateErr } = await operatorUpdateClientUpcomingOrder(id, payload);
  if (updateErr) {
    return { success: false, error: 'Failed to save upcoming order' };
  }

  const historyEntry = {
    type: 'upcoming_order_created_from_previous',
    serviceType,
    at: new Date().toISOString(),
    sourceOrderId: order.orderId,
    payload,
  };
  await operatorAppendOrderHistory(id, historyEntry);

  return { success: true };
}
