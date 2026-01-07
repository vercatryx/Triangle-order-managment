
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const client = createClient(supabaseUrl, supabaseKey);

async function verify() {
    console.log("Starting Verification for Meal Selection Actions...");

    // 1. Add Category (Lunch)
    const mealType = "Lunch";
    const catName = "Test Category " + Date.now();

    const { data: cat, error: catError } = await client
        .from('breakfast_categories')
        .insert([{ name: catName, meal_type: mealType, set_value: 5 }])
        .select()
        .single();

    if (catError) {
        console.error("Failed to add category:", catError.message);
        return;
    }
    console.log("Added Category:", cat);

    // 2. Add Item
    const itemName = "Test Item " + Date.now();
    const { data: item, error: itemError } = await client
        .from('breakfast_items')
        .insert([{ category_id: cat.id, name: itemName, quota_value: 1, is_active: true, price_each: 10 }])
        .select()
        .single();

    if (itemError) {
        console.error("Failed to add item:", itemError.message);
        return;
    }
    console.log("Added Item:", item);

    // 3. Verify Fetch
    const { data: fetchedCats } = await client.from('breakfast_categories').select('*').eq('id', cat.id);
    const { data: fetchedItems } = await client.from('breakfast_items').select('*').eq('id', item.id);

    if (fetchedCats?.length && fetchedCats[0].meal_type === mealType) {
        console.log("Verification Passed: Category exists with correct meal_type.");
    } else {
        console.error("Verification Failed: Category meal_type mismatch or not found.");
    }

    // 4. Update Category
    const { error: updateError } = await client
        .from('breakfast_categories')
        .update({ name: catName + " Updated" })
        .eq('id', cat.id);

    if (updateError) console.error("Update failed:", updateError.message);
    else console.log("Category Updated.");

    // 5. Clean up (Delete)
    const { error: delItemError } = await client.from('breakfast_items').delete().eq('id', item.id);
    const { error: delCatError } = await client.from('breakfast_categories').delete().eq('id', cat.id);

    if (!delItemError && !delCatError) console.log("Cleanup Successful.");
    else console.error("Cleanup Failed:", delItemError, delCatError);
}

verify();
