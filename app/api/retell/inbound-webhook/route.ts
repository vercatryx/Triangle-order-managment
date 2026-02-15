/**
 * Retell Inbound Webhook — runs when an inbound call arrives (before the call connects).
 * Performs client lookup by caller ID immediately so dynamic variables are ready
 * when the welcome message plays. The call stays ringing until this webhook responds.
 *
 * Enables: lookup during welcome message, personalized greeting when client found.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRetellSignature } from '../_lib/verify-retell';
import { normalizePhone } from '../_lib/phone-utils';
import { lookupByPhone } from '../_lib/lookup-by-phone';

const PERSONALIZED_BEGIN_MESSAGE =
    'Hello {{full_name}}, thank you for calling Triangle Square Services. I\'m an AI secretary. I can help you review or make changes to your upcoming selections, or hear details about previous orders that are scheduled or have already been completed.';

const LOG = '[retell:inbound-webhook]';

export async function POST(request: NextRequest) {
    const rawBody = await request.text();
    const signature = request.headers.get('x-retell-signature');
    console.log(LOG, 'request received');
    if (!verifyRetellSignature(rawBody, signature)) {
        console.error(LOG, 'auth failed: invalid or missing signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let body: { event?: string; call_inbound?: { from_number?: string; to_number?: string; agent_id?: string; agent_version?: number } };
    try {
        body = rawBody ? JSON.parse(rawBody) : {};
    } catch (e) {
        console.error(LOG, 'invalid JSON body', e);
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (body.event !== 'call_inbound' || !body.call_inbound) {
        console.error(LOG, 'invalid event', { event: body.event, hasCallInbound: !!body.call_inbound });
        return NextResponse.json({ error: 'Invalid event' }, { status: 400 });
    }

    const fromNumber = body.call_inbound.from_number ?? '';
    const agentId = body.call_inbound.agent_id;
    const phone = normalizePhone(fromNumber);
    console.log(LOG, 'call_inbound', { fromLast4: fromNumber ? `${fromNumber.slice(-4)}****` : null, agentId });

    // Look up client by caller ID (runs while call is ringing)
    const result = await lookupByPhone(phone);
    console.log(LOG, 'lookupByPhone result', { success: result.success, multiple_matches: result.success ? result.multiple_matches : undefined });

    const dynamicVariables: Record<string, string> = {
        pre_call_lookup_done: 'true'
    };

    // Include override_agent_id to accept the call (required by Retell when webhook is enabled)
    const callInbound: {
        override_agent_id?: string;
        dynamic_variables: Record<string, string>;
        agent_override?: { retell_llm: { begin_message: string } };
    } = {
        dynamic_variables: dynamicVariables
    };
    if (agentId) callInbound.override_agent_id = agentId;

    if (result.success && !result.multiple_matches) {
        // Single match — inject client data and personalize the begin message
        const c = result.client;
        dynamicVariables.client_id = c.id;
        dynamicVariables.full_name = c.full_name;
        dynamicVariables.phone_number = c.phone_number;
        dynamicVariables.secondary_phone_number = c.secondary_phone_number;
        dynamicVariables.address = c.address;
        dynamicVariables.service_type = c.service_type;
        dynamicVariables.approved_meals_per_week = String(c.approved_meals_per_week);
        dynamicVariables.pre_call_lookup_result = 'single_match';

        callInbound.agent_override = {
            retell_llm: { begin_message: PERSONALIZED_BEGIN_MESSAGE }
        };
        console.log(LOG, 'responding: single match, personalized greeting', result.client?.id);
        return NextResponse.json({ call_inbound: callInbound });
    }

    if (result.success && result.multiple_matches) {
        dynamicVariables.pre_call_lookup_result = 'multiple_matches';
        dynamicVariables.pre_call_clients = JSON.stringify(result.clients);
        console.log(LOG, 'responding: multiple matches');
        return NextResponse.json({ call_inbound: callInbound });
    }

    // No match — use default begin message, AI will ask for phone/name
    dynamicVariables.pre_call_lookup_result = 'no_match';
    console.log(LOG, 'responding: no match');
    return NextResponse.json({ call_inbound: callInbound });
}
