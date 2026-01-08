import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// WARNING: This is a temporary test route as requested.

export async function GET(request: Request) {
    try {
        console.log('[API] Starting Test Client Creation (Service Role mode)...');

        // Init Service Role Client
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!serviceRoleKey) {
            return NextResponse.json({ error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, serviceRoleKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });

        // 1. Create a new client
        const timestamp = new Date().getTime();
        const clientPayload = {
            full_name: `Test Client ${timestamp}`,
            email: `test${timestamp}@example.com`,
            address: '123 Test St',
            phone_number: '555-0100',
            service_type: 'Food',
            approved_meals_per_week: 14,
            screening_took_place: true,
            screening_signed: true,
            notes: 'Created via API (SR) for testing save/load logic',
            active_order: {} // Start empty
        };

        console.log('[API] Creating Client...');
        const { data: newClient, error: createError } = await supabase
            .from('clients')
            .insert([clientPayload])
            .select()
            .single();

        if (createError) {
            console.error('Create Client Error:', createError);
            return NextResponse.json({ error: createError.message }, { status: 500 });
        }
        console.log('[API] Client Created:', newClient.id);

        // 2. Fetch Meal Items to check IDs
        const { data: mealItems, error: mealError } = await supabase.from('breakfast_items').select('*').limit(1);
        if (mealError) return NextResponse.json({ error: mealError.message }, { status: 500 });

        if (!mealItems || mealItems.length === 0) {
            return NextResponse.json({ error: 'No meal items found in DB.' }, { status: 500 });
        }

        const testItem = mealItems[0];
        console.log('[API] Using Test Item:', testItem.name);

        const { data: category } = await supabase.from('breakfast_categories').select('*').eq('id', testItem.category_id).single();

        if (!category) {
            return NextResponse.json({ error: 'Test item has invalid category.' }, { status: 500 });
        }
        console.log('[API] Category:', category.name);

        // 3. Simulate "Saving" an Order (Draft - No Vendor)
        // Payload mirroring `orderConfig.mealSelections`
        const activeOrderPayload = {
            serviceType: 'Food',
            caseId: `CASE-${timestamp}`,
            service_type: 'Food', // Legacy field sometimes used
            mealSelections: {
                [category.meal_type]: { // e.g. 'Breakfast'
                    vendorId: null, // DRAFT: No vendor
                    items: {
                        [testItem.id]: 1 // Qty 1
                    }
                }
            }
        };

        console.log('[API] Simulating Save (update) of active_order...');

        const { error: updateError } = await supabase
            .from('clients')
            .update({ active_order: activeOrderPayload })
            .eq('id', newClient.id);

        if (updateError) throw updateError;

        console.log('[API] Update Complete. Reloading Client...');

        // 4. Verify Persistence
        const { data: reloadedClient, error: getError } = await supabase
            .from('clients')
            .select('active_order, full_name')
            .eq('id', newClient.id)
            .single();

        if (getError) throw getError;

        console.log('[API] Reloaded Client Active Order:', JSON.stringify(reloadedClient?.active_order, null, 2));

        const savedSelections = reloadedClient.active_order?.mealSelections;
        if (!savedSelections) {
            return NextResponse.json({
                status: 'FAILURE',
                message: 'mealSelections is MISSING in reloaded client json.',
                reloadedOrder: reloadedClient.active_order,
                clientName: reloadedClient.full_name
            });
        }

        const savedMealType = savedSelections[category.meal_type];
        // Note: use fuzzy match for items check if needed, but here exact id match
        if (!savedMealType || !savedMealType.items || Number(savedMealType.items[testItem.id]) !== 1) {
            return NextResponse.json({
                status: 'FAILURE',
                message: 'Saved items do not match input.',
                savedMealType
            });
        }

        return NextResponse.json({
            status: 'SUCCESS',
            message: 'Client created and Draft Order saved/loaded successfully via Backend.',
            clientId: newClient.id,
            clientName: reloadedClient.full_name,
            activeOrder: reloadedClient.active_order
        });

    } catch (error: any) {
        console.error('[API] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
