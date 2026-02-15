/**
 * Shared phone lookup logic for Retell look-up-client and inbound-webhook.
 * Returns client data when searching by phone (primary or secondary).
 */
import { createClient } from '@supabase/supabase-js';
import { phoneMatches } from './phone-utils';

export type LookupByPhoneResult =
    | { success: true; multiple_matches: false; client: ClientRecord }
    | { success: true; multiple_matches: true; clients: ClientSummary[] }
    | { success: false; error: 'no_client_found'; message: string }
    | { success: false; error: 'database_error'; message: string };

type ClientRecord = {
    id: string;
    full_name: string;
    phone_number: string;
    secondary_phone_number: string;
    address: string;
    service_type: string;
    approved_meals_per_week: number;
    expiration_date: string | null;
};

type ClientSummary = {
    index: number;
    client_id: string;
    full_name: string;
    address: string;
    service_type: string;
};

export async function lookupByPhone(normalizedPhone: string): Promise<LookupByPhoneResult> {
    if (!normalizedPhone) {
        return {
            success: false,
            error: 'no_client_found',
            message: 'No client was found matching that information. Please try again with a different phone number or name.'
        };
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: candidates, error: phoneError } = await supabase
        .from('clients')
        .select('id, full_name, phone_number, secondary_phone_number, address, service_type, approved_meals_per_week, expiration_date')
        .order('id', { ascending: true })
        .limit(100000);

    if (phoneError) {
        return { success: false, error: 'database_error', message: 'Lookup failed.' };
    }

    const list = (candidates ?? []).filter(
        (r: { id?: string; phone_number?: string | null; secondary_phone_number?: string | null }) => {
            if (!r.id) return false;
            return phoneMatches(r.phone_number, normalizedPhone) || phoneMatches(r.secondary_phone_number, normalizedPhone);
        }
    );

    if (list.length === 0) {
        return {
            success: false,
            error: 'no_client_found',
            message: 'No client was found matching that information. Please try again with a different phone number or name.'
        };
    }

    if (list.length === 1) {
        const c = list[0];
        return {
            success: true,
            multiple_matches: false,
            client: {
                id: c.id,
                full_name: c.full_name ?? '',
                phone_number: (c.phone_number ?? '').replace(/\D/g, ''),
                secondary_phone_number: (c.secondary_phone_number ?? '').replace(/\D/g, ''),
                address: c.address ?? '',
                service_type: c.service_type ?? '',
                approved_meals_per_week: c.approved_meals_per_week ?? 0,
                expiration_date: c.expiration_date ?? null
            }
        };
    }

    return {
        success: true,
        multiple_matches: true,
        clients: list.map((c: any, i: number) => ({
            index: i + 1,
            client_id: c.id,
            full_name: c.full_name ?? '',
            address: c.address ?? '',
            service_type: c.service_type ?? ''
        }))
    };
}
