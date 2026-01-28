
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { appendOrderHistory } from '@/lib/actions';

// Use Service Role to bypass RLS for debugging
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

export async function GET(req: NextRequest) {
    const searchParams = req.nextUrl.searchParams;
    const clientId = searchParams.get('clientId');

    if (!clientId) {
        return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
    }

    try {
        console.log(`[DEBUG API] Fetching history for ${clientId}`);
        const { data, error } = await supabase
            .from('clients')
            .select('id, full_name, order_history')
            .eq('id', clientId)
            .maybeSingle();

        if (error) {
            console.error('[DEBUG API] Error fetching client:', error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        if (!data) {
            return NextResponse.json({ error: 'Client not found' }, { status: 404 });
        }

        let parsedHistory = data.order_history;
        if (typeof parsedHistory === 'string') {
            try {
                parsedHistory = JSON.parse(parsedHistory);
            } catch (e) {
                console.warn('[DEBUG API] Failed to parse history string:', e);
                parsedHistory = { raw: data.order_history, error: 'Parse Error' };
            }
        }

        return NextResponse.json({
            message: 'Client history fetched',
            client: {
                id: data.id,
                name: data.full_name,
                historyType: typeof data.order_history,
                historyIsArray: Array.isArray(parsedHistory),
                historyLength: Array.isArray(parsedHistory) ? parsedHistory.length : 'N/A',
                historyData: parsedHistory
            }
        });
    } catch (err: any) {
        return NextResponse.json({ error: 'Unexpected crash', details: err.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { clientId, testDetails } = body;

        if (!clientId) {
            return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
        }

        console.log(`[DEBUG API] Appending test history for ${clientId}`);

        const mockOrderDetails = testDetails || {
            type: 'order',
            orderId: 'debug-' + Date.now(),
            serviceType: 'Food',
            timestamp: new Date().toISOString(),
            notes: 'Debug entry via API',
            orderDetails: {
                vendorSelections: [
                    {
                        vendorName: 'Debug Vendor',
                        itemsDetails: [
                            { itemName: 'Debug Item', quantity: 1 }
                        ]
                    }
                ]
            }
        };

        // Call the actual action function
        // We pass the admin supabase client to ensure it has permissions
        // Note: appendOrderHistory is async void
        await appendOrderHistory(clientId, mockOrderDetails, supabase);

        return NextResponse.json({
            message: 'Append action triggered successfully',
            details: mockOrderDetails
        });

    } catch (err: any) {
        console.error('[DEBUG API] POST Error:', err);
        return NextResponse.json({ error: 'Unexpected crash', details: err.message }, { status: 500 });
    }
}
