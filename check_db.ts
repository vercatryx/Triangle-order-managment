
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!; // Using anon key, hope RLS allows reading or I use service role if needed

// Try to get service role key if possible for admin access
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const client = serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log("Checking meal_types...");
    const { data: mealTypes, error: mtError } = await client.from('meal_types').select('*').limit(1);
    if (mtError) console.log("meal_types error:", mtError.message);
    else console.log("meal_types found:", mealTypes);

    console.log("Checking item_categories...");
    const { data: cats, error: cError } = await client.from('item_categories').select('*').limit(1);
    if (cError) console.log("item_categories error:", cError.message);
    else console.log("item_categories sample:", cats);

    console.log("Checking breakfast_categories...");
    const { data: bCats, error: bError } = await client.from('breakfast_categories').select('*').limit(1);
    if (bError) console.log("breakfast_categories error:", bError.message);
    else console.log("breakfast_categories sample:", bCats);
}

check();
