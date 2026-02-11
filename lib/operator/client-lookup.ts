/**
 * Client lookup by phone or client ID for the operator.
 * Uses only lib/operator/* — no imports from lib/actions, lib/types, etc.
 */

import type { OperatorClientInfo } from './types';
import { getPhoneLookupVariants } from './phone-normalize';
import { operatorGetClientByPhone, operatorGetClientById } from './db';
import { checkClientEligibility } from './eligibility';

export interface LookupResult {
  success: boolean;
  client?: OperatorClientInfo;
  error?: string;
}

/**
 * Look up client by phone number (E.164 or common formats).
 */
export async function lookupClientByPhone(phone: string | null | undefined): Promise<LookupResult> {
  const variants = getPhoneLookupVariants(phone);
  if (variants.length === 0) {
    return { success: false, error: 'Invalid or missing phone number' };
  }

  const { client, error } = await operatorGetClientByPhone(variants);
  if (error) {
    return { success: false, error: error.message };
  }
  if (!client) {
    return { success: false, error: 'No client found for this phone number' };
  }

  const eligibility = await checkClientEligibility(client);
  const info: OperatorClientInfo = {
    clientId: client.id!,
    fullName: client.full_name ?? 'Unknown',
    serviceType: (client.service_type as OperatorClientInfo['serviceType']) ?? 'Food',
    eligibility: eligibility.eligible,
    eligibilityReason: eligibility.reason,
  };

  return { success: true, client: info };
}

/**
 * Look up client by client ID.
 */
export async function lookupClientById(clientId: string | null | undefined): Promise<LookupResult> {
  const id = typeof clientId === 'string' ? clientId.trim() : '';
  if (!id) {
    return { success: false, error: 'Invalid or missing client ID' };
  }

  const { client, error } = await operatorGetClientById(id);
  if (error) {
    return { success: false, error: error.message };
  }
  if (!client) {
    return { success: false, error: 'No client found for this client ID' };
  }

  const eligibility = await checkClientEligibility(client);
  const info: OperatorClientInfo = {
    clientId: client.id!,
    fullName: client.full_name ?? 'Unknown',
    serviceType: (client.service_type as OperatorClientInfo['serviceType']) ?? 'Food',
    eligibility: eligibility.eligible,
    eligibilityReason: eligibility.reason,
  };

  return { success: true, client: info };
}

/**
 * Look up client by phone or client ID. Tries phone first if both provided.
 */
export async function lookupClient(params: {
  phone?: string | null;
  clientId?: string | null;
}): Promise<LookupResult> {
  if (params.phone) {
    const byPhone = await lookupClientByPhone(params.phone);
    if (byPhone.success) return byPhone;
    if (params.clientId) return lookupClientById(params.clientId);
    return byPhone;
  }
  if (params.clientId) return lookupClientById(params.clientId);
  return { success: false, error: 'Provide phone number or client ID' };
}
