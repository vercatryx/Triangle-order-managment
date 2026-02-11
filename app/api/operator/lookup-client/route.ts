/**
 * Operator client lookup API.
 * GET /api/operator/lookup-client?phone=... | ?clientId=...
 * Returns: { clientId, fullName, serviceType, eligibility } or error.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import { NextRequest, NextResponse } from 'next/server';
import { lookupClient } from '@/lib/operator/client-lookup';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get('phone') || undefined;
    const clientId = searchParams.get('clientId') || searchParams.get('client_id') || undefined;

    const result = await lookupClient({ phone, clientId });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 404 }
      );
    }

    return NextResponse.json({
      clientId: result.client!.clientId,
      fullName: result.client!.fullName,
      serviceType: result.client!.serviceType,
      eligibility: result.client!.eligibility,
      eligibilityReason: result.client!.eligibilityReason,
    });
  } catch (err) {
    console.error('[operator/lookup-client]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
