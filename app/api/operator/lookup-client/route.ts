/**
 * Operator client lookup API.
 * GET /api/operator/lookup-client?phone=... | ?clientId=... | ?clientName=... | ?name=...
 * POST /api/operator/lookup-client
 *   - Flat body: { phone?, clientId?, clientName?, fullName?, select?, attach? }
 *   - Retell format: { body: { args: { fullName? } } } — fullName from body.args.fullName
 * Returns: { clientId, fullName, phoneNumber, serviceType, eligibility } or error.
 * POST supports optional select (which fields to return) and attach (extra data to include).
 * Uses only lib/operator/* — no imports from main app lib.
 */

import { NextRequest, NextResponse } from 'next/server';
import { lookupClient } from '@/lib/operator/client-lookup';
import { operatorGetCurrentOrders, operatorGetClientUpcomingOrder } from '@/lib/operator/db';

/**
 * Remove special characters from name field (e.g. ".", ",", etc.).
 * Keeps only letters, digits, spaces, hyphens, and apostrophes.
 */
function sanitizeName(name: string | null | undefined): string | undefined {
  if (typeof name !== 'string') return undefined;
  const sanitized = name.replace(/[^a-zA-Z0-9\s'-]/g, '').trim();
  return sanitized || undefined;
}

function logLookupParams(method: 'GET' | 'POST', params: Record<string, unknown>) {
  console.log(`[operator/lookup-client] ${method} params:`, JSON.stringify(params));
}

const VALID_SELECT_FIELDS = [
  'clientId',
  'fullName',
  'phoneNumber',
  'secondaryPhoneNumber',
  'serviceType',
  'eligibility',
  'eligibilityReason',
] as const;

const VALID_ATTACH_FIELDS = ['currentOrders', 'upcomingOrder'] as const;

type SelectField = (typeof VALID_SELECT_FIELDS)[number];
type AttachField = (typeof VALID_ATTACH_FIELDS)[number];

function buildClientResponse(
  client: NonNullable<Awaited<ReturnType<typeof lookupClient>>['client']>,
  select?: string[] | null
): Record<string, unknown> {
  const full = {
    clientId: client.clientId,
    fullName: client.fullName,
    phoneNumber: client.phoneNumber ?? null,
    secondaryPhoneNumber: client.secondaryPhoneNumber ?? null,
    serviceType: client.serviceType,
    eligibility: client.eligibility,
    eligibilityReason: client.eligibilityReason ?? null,
  };

  if (!select || select.length === 0) {
    return full;
  }

  const result: Record<string, unknown> = {};
  for (const key of select) {
    if (VALID_SELECT_FIELDS.includes(key as SelectField) && key in full) {
      result[key] = (full as Record<string, unknown>)[key];
    }
  }
  return result;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone') || undefined;
    const clientId = searchParams.get('clientId') || searchParams.get('client_id') || undefined;
    const clientName = sanitizeName(
      searchParams.get('clientName') || searchParams.get('client_name') || searchParams.get('name')
    );

    logLookupParams('GET', { phone, clientId, clientName });
    const result = await lookupClient({ phone, clientId, clientName });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      );
    }

    return NextResponse.json(
      buildClientResponse(result.client!, null)
    );
  } catch (err) {
    console.error('[operator/lookup-client]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: {
      phone?: string;
      phone_number?: string;
      clientId?: string;
      client_id?: string;
      clientName?: string;
      client_name?: string;
      fullName?: string;
      name?: string;
      select?: string[];
      attach?: string[];
    } = {};

    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      );
    }

    // Support both flat body and Retell format (body.args.*).
    // Retell may nest body.body or body.body.body; traverse to find args.
    const bodyAny = body as Record<string, unknown>;
    let args = bodyAny?.args as { fullName?: string; phone_number?: string; client_id?: string; client_name?: string } | undefined;
    let cursor: Record<string, unknown> | undefined = bodyAny?.body as Record<string, unknown> | undefined;
    while (cursor && !args) {
      args = cursor.args as typeof args | undefined;
      cursor = cursor.body as Record<string, unknown> | undefined;
    }

    const phone = body.phone ?? body.phone_number ?? args?.phone_number ?? undefined;
    const clientId = body.clientId ?? body.client_id ?? args?.client_id ?? undefined;
    // Prefer args.fullName over body.name — body.name can be the tool name (e.g. "look_up_client_post")
    const clientName = sanitizeName(
      body.clientName ?? body.client_name ?? body.fullName ?? args?.fullName ?? args?.client_name ?? body.name
    );

    logLookupParams('POST', {
      body,
      extracted: { phone, clientId, clientName },
    });
    const result = await lookupClient({ phone, clientId, clientName });

    if (!result.success) {
      console.warn('[operator/lookup-client] lookup failed', {
        searchParams: { phone, clientId, clientName },
        error: result.error,
      });
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      );
    }

    const client = result.client!;
    const response: Record<string, unknown> = buildClientResponse(
      client,
      body.select ?? null
    );

    // Attach extra data when requested
    const attach = Array.isArray(body.attach) ? body.attach : [];
    for (const key of attach) {
      if (!VALID_ATTACH_FIELDS.includes(key as AttachField)) continue;

      if (key === 'currentOrders') {
        const { orders, error } = await operatorGetCurrentOrders(client.clientId);
        response.currentOrders = error ? [] : orders ?? [];
      } else if (key === 'upcomingOrder') {
        const { upcomingOrder } = await operatorGetClientUpcomingOrder(client.clientId);
        response.upcomingOrder = upcomingOrder ?? null;
      }
    }

    return NextResponse.json(response);
  } catch (err) {
    console.error('[operator/lookup-client]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
