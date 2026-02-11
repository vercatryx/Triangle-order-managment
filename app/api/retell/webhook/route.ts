/**
 * Retell AI webhook handler.
 * POST /api/retell/webhook
 * Handles: call_started, call_ended, call_analyzed
 * Uses only lib/operator/* if needed (optional logging).
 * No imports from main app lib.
 *
 * Security: Add Retell signature verification when deploying.
 * Use retell-sdk: Retell.verify(body, RETELL_API_KEY, req.headers['x-retell-signature'])
 * See: https://docs.retellai.com/features/secure-webhook
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ received: false }, { status: 400 });
    }

    const eventType = body.event;
    const callId = body.call_id ?? body.callId;

    switch (eventType) {
      case 'call_started':
        // Optional: log, trigger lookup by from_number
        if (process.env.NODE_ENV === 'development') {
          console.log('[retell/webhook] call_started', { callId, from_number: body.from_number });
        }
        break;
      case 'call_ended':
        // Optional: log, store outcome
        if (process.env.NODE_ENV === 'development') {
          console.log('[retell/webhook] call_ended', { callId });
        }
        break;
      case 'call_analyzed':
        // Optional: store transcript, summary
        if (process.env.NODE_ENV === 'development') {
          console.log('[retell/webhook] call_analyzed', { callId });
        }
        break;
      default:
        if (process.env.NODE_ENV === 'development') {
          console.log('[retell/webhook] unknown event', eventType);
        }
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error('[retell/webhook]', err);
    return NextResponse.json({ received: false }, { status: 500 });
  }
}
