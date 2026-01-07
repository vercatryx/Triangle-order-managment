
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const client = createClient(supabaseUrl, supabaseKey);

async function verifyDelete() {
    console.log("Starting Verification for Delete Meal Type...");

    // 1. Setup: Add Category (ToDelete)
    const mealType = "ToDelete";
    const catName = "Temp Cat";

    const { data: cat, error: catError } = await client
        .from('breakfast_categories')
        .insert([{ name: catName, meal_type: mealType }])
        .select()
        .single();

    if (catError) {
        console.error("Failed to add category:", catError.message);
        return;
    }
    console.log("Added Category:", cat.id);

    // 2. Add Item
    const { data: item, error: itemError } = await client
        .from('breakfast_items')
        .insert([{ category_id: cat.id, name: "Temp Item", quota_value: 1, is_active: true, price_each: 5 }])
        .select()
        .single();

    if (itemError) {
        console.error("Failed to add item:", itemError.message);
        return;
    }
    console.log("Added Item:", item.id);

    // 3. Delete Meal Type (Simulating the server action logic)
    // Logic: delete from breakfast_categories where meal_type = 'ToDelete'
    const { error: deleteError } = await client
        .from('breakfast_categories')
        .delete()
        .eq('meal_type', mealType);

    if (deleteError) {
        console.error("Delete failed:", deleteError.message);
        return;
    }
    console.log("Executed Delete for meal_type:", mealType);

    // 4. Verify Gone
    const { data: checkCat } = await client.from('breakfast_categories').select('*').eq('id', cat.id);
    const { data: checkItem } = await client.from('breakfast_items').select('*').eq('id', item.id);

    if (checkCat?.length === 0 && checkItem?.length === 0) {
        console.log("Verification Passed: Category and Item deleted.");
    } else {
        console.error("Verification Failed:", { checkCat, checkItem });
    }
}

verifyDelete();
