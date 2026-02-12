/**
 * Operator create upcoming order API.
 * POST /api/operator/create-upcoming-order
 * Body: { clientId, serviceType, ... }
 * - Custom: custom_name?, custom_price?, vendorId?, deliveryDay?, notes?, caseId?
 * - Food: vendorSelections? [{ vendorId, items: { itemId: quantity } }], deliveryDayOrders?, notes?, caseId?
 * - Meal: mealSelections? { "Breakfast"|"Lunch"|"Dinner": { vendorId?, items: { itemId: quantity } } }, notes?, caseId?
 * Uses only lib/operator/* — no imports from main app lib.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  createCustomUpcomingOrder,
  createFoodUpcomingOrder,
  createMealUpcomingOrder,
} from '@/lib/operator/create-upcoming-order';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      clientId,
      serviceType,
      custom_name,
      custom_price,
      vendorId,
      deliveryDay,
      notes,
      caseId,
      vendorSelections,
      deliveryDayOrders,
      mealSelections,
    } = body;

    if (!clientId) {
      return NextResponse.json(
        { error: 'clientId is required' },
        { status: 400 }
      );
    }

    const st = String(serviceType || 'Custom').trim();

    if (st === 'Custom') {
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
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    if (st === 'Food') {
      const result = await createFoodUpcomingOrder({
        clientId,
        vendorSelections,
        deliveryDayOrders,
        notes,
        caseId,
      });
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    if (st === 'Meal') {
      const result = await createMealUpcomingOrder({
        clientId,
        mealSelections,
        notes,
        caseId,
      });
      if (!result.success) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    if (st === 'Boxes') {
      return NextResponse.json(
        { error: 'Boxes service type: use create-from-previous-order or add Boxes support' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: `Unsupported service type: ${st}. Use Custom, Food, or Meal` },
      { status: 400 }
    );
  } catch (err) {
    console.error('[operator/create-upcoming-order]', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
