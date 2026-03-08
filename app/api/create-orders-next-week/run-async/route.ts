import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getNextCreationId } from '@/lib/actions';
import { after } from 'next/server';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BATCH_SIZE = 100;

/** Base URL for self-calls (trigger next batch / send report). */
function getBaseUrl(): string {
    const url = process.env.VERCEL_URL;
    if (url) return `https://${url}`;
    return process.env.NEXT_PUBLIC_APP_URL || 'https://trianglesquareservices.com';
}

export async function POST() {
    try {
        const creationId = await getNextCreationId();
        const { error } = await supabase
            .from('create_orders_run')
            .insert({ creation_id: creationId, batch_results: [] });

        if (error) {
            console.error('[run-async] Failed to insert create_orders_run:', error);
            return NextResponse.json(
                { success: false, error: 'Failed to start async run' },
                { status: 500 }
            );
        }

        const baseUrl = getBaseUrl();
        const batchUrl = `${baseUrl}/api/create-orders-next-week`;

        after(async () => {
            try {
                await fetch(batchUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        batchIndex: 0,
                        batchSize: BATCH_SIZE,
                        creationId
                    })
                });
            } catch (e) {
                console.error('[run-async] Failed to trigger batch 0:', e);
            }
        });

        return NextResponse.json(
            {
                accepted: true,
                creationId,
                message: 'Weekly order creation started in the background. Report will be emailed when complete.'
            },
            { status: 202 }
        );
    } catch (err: any) {
        console.error('[run-async] Error:', err);
        return NextResponse.json(
            { success: false, error: err?.message || 'Failed to start async run' },
            { status: 500 }
        );
    }
}
