/**
 * Client lookup by phone or client ID for the operator.
 * Uses only lib/operator/* — no imports from lib/actions, lib/types, etc.
 */

import type { OperatorClientInfo } from './types';
import { getPhoneLookupVariants } from './phone-normalize';
import { operatorGetClientByPhone, operatorGetClientById, operatorGetClientByName, operatorGetClientByFirstName } from './db';
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
    phoneNumber: client.phone_number ?? null,
    secondaryPhoneNumber: client.secondary_phone_number ?? null,
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
    phoneNumber: client.phone_number ?? null,
    secondaryPhoneNumber: client.secondary_phone_number ?? null,
    serviceType: (client.service_type as OperatorClientInfo['serviceType']) ?? 'Food',
    eligibility: eligibility.eligible,
    eligibilityReason: eligibility.reason,
  };

  return { success: true, client: info };
}

/**
 * Look up client by full name (exact match, with first-name fallback when caller gave only first name).
 */
export async function lookupClientByName(clientName: string | null | undefined): Promise<LookupResult> {
  const name = typeof clientName === 'string' ? clientName.trim() : '';
  if (!name) {
    return { success: false, error: 'Invalid or missing client name' };
  }

  let { client, error } = await operatorGetClientByName(name);

  // When exact match fails and name is a single word, try first-name match (e.g. "David" -> "David Cohen")
  if (!client && !error && !name.includes(' ')) {
    ({ client, error } = await operatorGetClientByFirstName(name));
  }

  if (error) {
    return { success: false, error: error.message };
  }
  if (!client) {
    return { success: false, error: 'No client found for this name' };
  }

  const eligibility = await checkClientEligibility(client);
  const info: OperatorClientInfo = {
    clientId: client.id!,
    fullName: client.full_name ?? 'Unknown',
    phoneNumber: client.phone_number ?? null,
    secondaryPhoneNumber: client.secondary_phone_number ?? null,
    serviceType: (client.service_type as OperatorClientInfo['serviceType']) ?? 'Food',
    eligibility: eligibility.eligible,
    eligibilityReason: eligibility.reason,
  };

  return { success: true, client: info };
}

/**
 * Look up client by phone, client ID, or client name. Tries in order: phone, clientId, clientName.
 */
export async function lookupClient(params: {
  phone?: string | null;
  clientId?: string | null;
  clientName?: string | null;
}): Promise<LookupResult> {
  if (params.phone) {
    const byPhone = await lookupClientByPhone(params.phone);
    if (byPhone.success) return byPhone;
    if (params.clientId) return lookupClientById(params.clientId);
    if (params.clientName) return lookupClientByName(params.clientName);
    return byPhone;
  }
  if (params.clientId) return lookupClientById(params.clientId);
  if (params.clientName) return lookupClientByName(params.clientName);
  return { success: false, error: 'Provide phone number, client ID, or client name' };
}
