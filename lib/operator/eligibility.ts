/**
 * Client eligibility check for operator (deliveries allowed).
 * Uses operator's own DB layer only.
 */

import type { OperatorDbRow } from './db';
import { operatorGetClientStatus } from './db';

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Check if a client is eligible for deliveries (create upcoming order).
 * - status_id must have deliveries_allowed = true
 * - expiration_date must not be in the past (if set)
 */
export async function checkClientEligibility(client: OperatorDbRow | null): Promise<EligibilityResult> {
  if (!client) {
    return { eligible: false, reason: 'Client not found' };
  }

  if (client.status_id) {
    const { deliveriesAllowed, error } = await operatorGetClientStatus(client.status_id);
    if (error) {
      return { eligible: false, reason: 'Could not verify client status' };
    }
    if (!deliveriesAllowed) {
      return { eligible: false, reason: 'Client status does not allow deliveries' };
    }
  }

  if (client.expiration_date) {
    const exp = client.expiration_date instanceof Date
      ? client.expiration_date
      : new Date(String(client.expiration_date));
    if (!isNaN(exp.getTime()) && exp < new Date()) {
      return { eligible: false, reason: 'Client has expired' };
    }
  }

  return { eligible: true };
}
