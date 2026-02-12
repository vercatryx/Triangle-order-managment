/**
 * Operator inquire current orders API.
 * GET /api/operator/inquire-current-orders?clientId=... | ?phone=...
 * Returns: { currentOrders, upcomingOrder } or error.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import { NextRequest, NextResponse } from 'next/server';
import { inquireCurrentOrders } from '@/lib/operator/inquire-current-orders';
import { lookupClient } from '@/lib/operator/client-lookup';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId') || searchParams.get('client_id') || undefined;
    const phone = searchParams.get('phone') || undefined;

    let resolvedClientId = clientId;

    if (!resolvedClientId && phone) {
      const lookup = await lookupClient({ phone });
      if (!lookup.success || !lookup.client) {
        return NextResponse.json(
          { error: lookup.error ?? 'Client not found for this phone number' },
          { status: 404 }
        );
      }
      resolvedClientId = lookup.client.clientId;
    }

    if (!resolvedClientId) {
      return NextResponse.json(
        { error: 'clientId or phone is required' },
        { status: 400 }
      );
    }

    const result = await inquireCurrentOrders(resolvedClientId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      currentOrders: result.currentOrders ?? [],
      upcomingOrder: result.upcomingOrder ?? null,
    });
  } catch (err) {
    console.error('[operator/inquire-current-orders]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
