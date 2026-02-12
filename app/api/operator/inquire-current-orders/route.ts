/**
 * Operator inquire current orders API.
 * GET /api/operator/inquire-current-orders?clientId=...
 * Returns: { currentOrders, upcomingOrder } or error.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import { NextRequest, NextResponse } from 'next/server';
import { inquireCurrentOrders } from '@/lib/operator/inquire-current-orders';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId') || searchParams.get('client_id') || undefined;

    if (!clientId) {
      return NextResponse.json(
        { error: 'clientId is required' },
        { status: 400 }
      );
    }

    const result = await inquireCurrentOrders(clientId);

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
