/**
 * Operator create upcoming order API.
 * POST /api/operator/create-upcoming-order
 * Body: { clientId, serviceType: "Custom", custom_name?, custom_price?, vendorId?, deliveryDay?, notes?, caseId? }
 * MVP: Custom service type only.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createCustomUpcomingOrder } from '@/lib/operator/create-upcoming-order';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { clientId, serviceType, custom_name, custom_price, vendorId, deliveryDay, notes, caseId } = body;

    if (!clientId) {
      return NextResponse.json(
        { error: 'clientId is required' },
        { status: 400 }
      );
    }

    if (serviceType !== 'Custom') {
      return NextResponse.json(
        { error: 'Only Custom service type is supported in MVP' },
        { status: 400 }
      );
    }

    const result = await createCustomUpcomingOrder({
      clientId,
      custom_name,
      custom_price,
      vendorId,
      deliveryDay,
      notes,
      caseId,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[operator/create-upcoming-order]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
