
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const client = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log("Checking meal_categories...");
    const { data: mCats, error: mError } = await client.from('meal_categories').select('*').limit(1);
    if (mError) console.log("meal_categories error:", mError.message);
    else console.log("meal_categories found:", mCats);

    console.log("Checking breakfast_items...");
    const { data: bItems, error: biError } = await client.from('breakfast_items').select('*').limit(1);
    if (biError) console.log("breakfast_items error:", biError.message);
    else console.log("breakfast_items sample:", bItems);
}

check();
