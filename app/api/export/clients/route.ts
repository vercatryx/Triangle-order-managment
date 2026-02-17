import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

/** Allow time for paginated fetch + XLSX build when there are many clients (e.g. 10k+). */
export const maxDuration = 300;

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Derive "food box custom client type" from upcoming_order (source of truth). */
function foodBoxCustomClientTypeFromUpcoming(
    upcomingOrder: unknown,
    boxTypeNames: Map<string, string>
): string {
    if (!upcomingOrder || typeof upcomingOrder !== 'object') return '';
    const uo = upcomingOrder as Record<string, unknown>;
    const st = uo.serviceType;
    if (!st || typeof st !== 'string') return '';

    if (st === 'Food' || st === 'Meal' || st === 'Equipment') return st;
    if (st === 'Custom') return 'Custom';
    if (st === 'Boxes') {
        const boxOrders = uo.boxOrders;
        if (!Array.isArray(boxOrders) || boxOrders.length === 0) return 'Boxes';
        const names: string[] = [];
        for (const bo of boxOrders) {
            const bid = (bo as Record<string, unknown>)?.boxTypeId;
            if (typeof bid === 'string' && bid) {
                const n = boxTypeNames.get(bid);
                if (n) names.push(n);
                else names.push(bid);
            }
        }
        return names.length ? `Boxes: ${names.join(', ')}` : 'Boxes';
    }
    return st;
}

export type ExportClientRow = {
    full_name: string;
    address: string;
    phone_number: string;
    approved_meals_per_week: number | '';
    email: string;
    id: string;
    secondary_phone: string;
    authorized_amount: number | '';
    screening_status: string;
    expiration_date: string;
    food_box_custom_client_type: string;
};

const EXPORT_FIELD_LABELS: Record<keyof ExportClientRow, string> = {
    full_name: 'Client name',
    address: 'Address',
    phone_number: 'Phone number',
    approved_meals_per_week: 'Approved meals per week',
    email: 'Email',
    id: 'ID',
    secondary_phone: 'Secondary phone',
    authorized_amount: 'Auth amount',
    screening_status: 'Screening status',
    expiration_date: 'Exp date',
    food_box_custom_client_type: 'Food box / custom client type (from upcoming order)'
};

const VALID_KEYS = new Set<string>(Object.keys(EXPORT_FIELD_LABELS));

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const includeDependants = !!body.includeDependants;

        const { data: boxTypes } = await supabase.from('box_types').select('id, name');
        const boxTypeNames = new Map<string, string>();
        for (const bt of boxTypes ?? []) {
            boxTypeNames.set(bt.id, bt.name ?? bt.id);
        }

        const pageSize = 1000;
        let allClients: any[] = [];
        let page = 0;

        while (true) {
            let query = supabase
                .from('clients')
                .select('id, full_name, address, phone_number, secondary_phone_number, approved_meals_per_week, email, authorized_amount, screening_status, expiration_date, upcoming_order')
                .order('full_name', { ascending: true })
                .order('id', { ascending: true })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (!includeDependants) {
                query = query.is('parent_client_id', null);
            }

            const { data: chunk, error } = await query;

            if (error) {
                console.error('[export/clients]', error);
                return NextResponse.json({ error: error.message }, { status: 500 });
            }
            if (!chunk?.length) break;
            allClients.push(...chunk);
            if (chunk.length < pageSize) break;
            page++;
        }

        const rows: ExportClientRow[] = allClients.map((c: any) => ({
            full_name: c.full_name ?? '',
            address: c.address ?? '',
            phone_number: c.phone_number ?? '',
            approved_meals_per_week: c.approved_meals_per_week != null ? Number(c.approved_meals_per_week) : '',
            email: c.email ?? '',
            id: c.id ?? '',
            secondary_phone: c.secondary_phone_number ?? '',
            authorized_amount: c.authorized_amount != null ? Number(c.authorized_amount) : '',
            screening_status: c.screening_status ?? '',
            expiration_date: c.expiration_date ? String(c.expiration_date).slice(0, 10) : '',
            food_box_custom_client_type: foodBoxCustomClientTypeFromUpcoming(c.upcoming_order, boxTypeNames)
        }));

        const columns = Array.isArray(body.columns) ? (body.columns as string[]).filter(k => VALID_KEYS.has(k)) : [];
        if (columns.length === 0) {
            return NextResponse.json({ error: 'Select at least one column to export.' }, { status: 400 });
        }

        const sheetRows = rows.map(row => {
            const out: Record<string, string | number> = {};
            for (const k of columns) {
                const label = EXPORT_FIELD_LABELS[k as keyof ExportClientRow];
                const v = row[k as keyof ExportClientRow];
                if (v === '' || v == null) out[label] = '';
                else out[label] = v as string | number;
            }
            return out;
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(
            sheetRows.length ? sheetRows : [{ [EXPORT_FIELD_LABELS[columns[0] as keyof ExportClientRow]]: 'No clients' }]
        );
        XLSX.utils.book_append_sheet(wb, ws, 'Clients');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const filename = `clients_export_${new Date().toISOString().slice(0, 10)}.xlsx`;

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${filename}"`
            }
        });
    } catch (e) {
        console.error('[export/clients]', e);
        return NextResponse.json({ error: e instanceof Error ? e.message : 'Export failed' }, { status: 500 });
    }
}
