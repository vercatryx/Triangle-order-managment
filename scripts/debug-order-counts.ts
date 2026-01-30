import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, '');
            process.env[key] = value;
        }
    });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkCounts() {
    console.log('Checking Order Counts...');

    // 1. Total Raw Count
    const { count: total, error: err1 } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true });

    if (err1) console.error('Error fetching total:', err1);
    console.log(`[DB] Total Orders (Raw): ${total}`);

    // 2. Count by Status
    const { data: statusData, error: err2 } = await supabase
        .from('orders')
        .select('status'); // Fetch all statuses to group locally (or could use rpc)

    if (err2) {
        console.error('Error fetching statuses:', err2);
    } else {
        const counts: Record<string, number> = {};
        let nullStatus = 0;
        statusData?.forEach(o => {
            if (!o.status) nullStatus++;
            else counts[o.status] = (counts[o.status] || 0) + 1;
        });
        console.log('[DB] Counts by Status:', counts);
        if (nullStatus > 0) console.log(`[DB] Null Status: ${nullStatus}`);

        const billingPending = counts['billing_pending'] || 0;
        console.log(`[DB] Billing Pending: ${billingPending}`);

        // "Visible" on Orders Page (approximate logic: total - billing_pending)
        // Also checks scheduled_delivery_date is not null
        console.log(`[Expected] Orders Page Count (~Total - BillingPending): ${total! - billingPending}`);
    }

    // 3. Check Scheduled Delivery Date Nulls
    const { count: nullDates, error: err3 } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .is('scheduled_delivery_date', null);

    console.log(`[DB] Orders with NULL scheduled_delivery_date: ${nullDates}`);
}

checkCounts().catch(console.error);
