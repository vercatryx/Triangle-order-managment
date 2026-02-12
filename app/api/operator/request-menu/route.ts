/**
 * Operator request menu API.
 * GET /api/operator/request-menu?vendorId=... (optional)
 * Returns: { menuItems, mealItems? } or error.
 * Uses only lib/operator/* — no imports from main app lib.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requestMenuForVendor, requestAllMenu } from '@/lib/operator/request-menu';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const vendorId = searchParams.get('vendorId') || searchParams.get('vendor_id') || undefined;

    const result = vendorId
      ? await requestMenuForVendor(vendorId)
      : await requestAllMenu();

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      menuItems: result.menuItems ?? [],
      mealItems: result.mealItems ?? [],
    });
  } catch (err) {
    console.error('[operator/request-menu]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
