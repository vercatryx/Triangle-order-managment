/**
 * Operator create upcoming order from previous order API.
 * POST /api/operator/create-from-previous-order
 * Body: { clientId }
 * Repeats the client's last order as their upcoming order.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUpcomingOrderFromPrevious } from '@/lib/operator/create-from-previous-order';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { clientId, client_id } = body;
    const id = clientId ?? client_id;

    if (!id) {
      return NextResponse.json(
        { error: 'clientId is required' },
        { status: 400 }
      );
    }

    const result = await createUpcomingOrderFromPrevious(id);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[operator/create-from-previous-order]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
