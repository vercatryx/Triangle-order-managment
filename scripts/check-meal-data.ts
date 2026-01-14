
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMealData() {
    console.log('--- Checking Meal Categories (breakfast_categories) ---');
    const { data: categories, error: catError } = await supabase
        .from('breakfast_categories')
        .select('*');

    if (catError) console.error('Error fetching categories:', catError);
    else {
        console.log(`Found ${categories.length} categories.`);
        categories.slice(0, 5).forEach(c => console.log(`  ${c.name} (${c.meal_type})`));
    }

    console.log('\n--- Checking Meal Items (breakfast_items) ---');
    const { data: items, error: itemError } = await supabase
        .from('breakfast_items')
        .select('*');

    if (itemError) console.error('Error fetching items:', itemError);
    else console.log(`Found ${items.length} items.`);


    console.log('\n--- Checking Vendor Menu Items (menu_items) ---');
    const { data: menuItems, error: menuError } = await supabase
        .from('menu_items')
        .select('*, vendors(name), item_categories(name)')
        .limit(20);

    if (menuError) console.error('Error fetching menu items:', menuError);
    else {
        console.log(`Found ${menuItems.length} (showing top 20) items:`);
        menuItems.forEach((i: any) => {
            console.log(`- ID: ${i.id}, Name: ${i.name}, Vendor: ${i.vendors?.name}, Category: ${i.item_categories?.name}`);
        });
    }
}

checkMealData();
