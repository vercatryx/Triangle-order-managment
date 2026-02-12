/**
 * Inquire current orders for a client. Operator's own implementation.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import type { OperatorCurrentOrder } from './types';
import { operatorGetClientById } from './db';
import { operatorGetCurrentOrders } from './db';
import { operatorGetClientUpcomingOrder } from './db';
import { checkClientEligibility } from './eligibility';

export interface InquireCurrentOrdersResult {
  success: boolean;
  currentOrders?: OperatorCurrentOrder[];
  upcomingOrder?: unknown;
  error?: string;
}

/**
 * Inquire current week orders and upcoming order for a client.
 */
export async function inquireCurrentOrders(clientId: string): Promise<InquireCurrentOrdersResult> {
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
    return { success: false, error: eligibility.reason ?? 'Client is not eligible' };
  }

  const { orders, error: ordersErr } = await operatorGetCurrentOrders(id);
  if (ordersErr) {
    return { success: false, error: 'Could not fetch current orders' };
  }

  const { upcomingOrder } = await operatorGetClientUpcomingOrder(id);

  return {
    success: true,
    currentOrders: orders,
    upcomingOrder: upcomingOrder ?? undefined,
  };
}
