/**
 * Operator inquire current orders API.
 * GET /api/operator/inquire-current-orders?clientId=... | ?phone=...
 * POST /api/operator/inquire-current-orders — body: { clientId?, phone? }
 * Returns: { currentOrders, upcomingOrder } or error.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import { NextRequest, NextResponse } from 'next/server';
import { inquireCurrentOrders } from '@/lib/operator/inquire-current-orders';
import { lookupClient } from '@/lib/operator/client-lookup';

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
    data: { currentOrders: result.currentOrders ?? [], upcomingOrder: result.upcomingOrder ?? null },
    status: 200,
  } as const;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId') || searchParams.get('client_id') || undefined;
    const phone = searchParams.get('phone') || undefined;

    const outcome = await resolveAndInquire(clientId, phone);

    if ('error' in outcome) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json(outcome.data);
  } catch (err) {
    console.error('[operator/inquire-current-orders]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: { clientId?: string; client_id?: string; phone?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const clientId = body.clientId ?? body.client_id ?? undefined;
    const phone = body.phone ?? undefined;

    const outcome = await resolveAndInquire(clientId, phone);

    if ('error' in outcome) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    return NextResponse.json(outcome.data);
  } catch (err) {
    console.error('[operator/inquire-current-orders]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
