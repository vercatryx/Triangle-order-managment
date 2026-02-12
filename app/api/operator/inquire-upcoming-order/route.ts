/**
 * Operator inquire upcoming order API.
 * POST /api/operator/inquire-upcoming-order — body: { phone } (or clientId)
 * Returns: { upcomingOrder } only. 404 when client not found for phone.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import { NextRequest, NextResponse } from 'next/server';
import { inquireCurrentOrders } from '@/lib/operator/inquire-current-orders';
import { lookupClient } from '@/lib/operator/client-lookup';

function logInquireParams(params: Record<string, unknown>) {
  console.log('[operator/inquire-upcoming-order] POST input payload:', JSON.stringify(params));
}

async function resolveAndInquire(clientId: string | undefined, phone: string | undefined) {
  let resolvedClientId = clientId;

  if (!resolvedClientId && phone) {
    const lookup = await lookupClient({ phone });
    if (!lookup.success || !lookup.client) {
      return { error: lookup.error ?? 'Client not found for this phone number', status: 404 } as const;
    }
    resolvedClientId = lookup.client.clientId;
  }

  if (!resolvedClientId) {
    return { error: 'clientId or phone is required', status: 400 } as const;
  }

  const result = await inquireCurrentOrders(resolvedClientId);

  if (!result.success) {
    return { error: result.error, status: 400 } as const;
  }

  return {
    data: { upcomingOrder: result.upcomingOrder ?? null },
    status: 200,
  } as const;
}

export async function POST(request: NextRequest) {
  try {
    let body: {
      clientId?: string;
      client_id?: string;
      phone?: string;
      body?: unknown;
      args?: { client_id?: string; phone?: string };
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Support flat body and Retell format (body.args.*)
    const bodyAny = body as Record<string, unknown>;
    let args = bodyAny?.args as { client_id?: string; phone?: string } | undefined;
    let cursor: Record<string, unknown> | undefined = bodyAny?.body as Record<string, unknown> | undefined;
    while (cursor && !args) {
      args = cursor.args as typeof args | undefined;
      cursor = cursor.body as Record<string, unknown> | undefined;
    }

    const clientId = body.clientId ?? body.client_id ?? args?.client_id ?? undefined;
    const phone = body.phone ?? args?.phone ?? undefined;

    logInquireParams({ clientId, phone });

    const outcome = await resolveAndInquire(clientId, phone);

    if ('error' in outcome) {
      if (outcome.status === 404) {
        console.warn('[operator/inquire-upcoming-order] 404 — client not found', { clientId, phone, error: outcome.error });
      }
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json(outcome.data);
  } catch (err) {
    console.error('[operator/inquire-upcoming-order]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
