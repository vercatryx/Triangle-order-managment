/**
 * Script to fix orders with incorrect total_value
 * 
 * This script finds all Food/Meal orders where total_value is 0 or incorrect
 * and recalculates it from the order_items table.
 * 
 * Run with: npx tsx scripts/fix_order_total_values.ts
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env from .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
    console.error('Error: .env.local file not found');
    process.exit(1);
}

const envFile = fs.readFileSync(envPath, 'utf8');
const envConfig: Record<string, string> = {};
envFile.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values) {
        envConfig[key.trim()] = values.join('=').trim().replace(/(^"|"$)/g, '');
    }
});

const supabaseUrl = envConfig['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseServiceKey = envConfig['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
});

async function fixOrderTotalValues() {
    console.log('Starting to fix order total_values...\n');

    // Fetch meal items once for lookup
    const { data: mealItems, error: mealItemsError } = await supabase
        .from('breakfast_items')
        .select('id, price_each, quota_value');

    if (mealItemsError) {
        console.error('Error fetching meal items:', mealItemsError);
        return;
    }

    const mealItemsMap = new Map();
    if (mealItems) {
        mealItems.forEach(item => {
            mealItemsMap.set(item.id, {
                priceEach: parseFloat(item.price_each?.toString() || '0'),
                quotaValue: parseFloat(item.quota_value?.toString() || '0')
            });
        });
    }

    // Fetch menu items for Food orders
    const { data: menuItems, error: menuItemsError } = await supabase
        .from('menu_items')
        .select('id, price_each, value');

    if (menuItemsError) {
        console.error('Error fetching menu items:', menuItemsError);
        return;
    }

    const menuItemsMap = new Map();
    if (menuItems) {
        menuItems.forEach(item => {
            menuItemsMap.set(item.id, {
                priceEach: parseFloat(item.price_each?.toString() || '0'),
                value: parseFloat(item.value?.toString() || '0')
            });
        });
    }

    // First, find orders with total_value = 0 (or very close to 0)
    // Include Equipment orders too. We need status to skip billing-completed orders.
    const { data: zeroOrders, error: zeroOrdersError } = await supabase
        .from('orders')
        .select('id, service_type, total_value, order_number, notes, status')
        .in('service_type', ['Food', 'Meal', 'Equipment'])
        .lte('total_value', 0.01); // Orders with total_value <= 0.01

    if (zeroOrdersError) {
        console.error('Error fetching zero-value orders:', zeroOrdersError);
        return;
    }

    if (!zeroOrders || zeroOrders.length === 0) {
        console.log('No orders with total_value = 0 found.');
        return;
    }

    console.log(`Found ${zeroOrders.length} orders with total_value = 0 to check.\n`);

    let fixedCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    const fixedOrders: Array<{ id: string; orderNumber: number | null; oldValue: number; newValue: number }> = [];
    const billingCompletedSkipped: Array<{ id: string; orderNumber: number | null; status: string }> = [];

    for (const order of zeroOrders) {
        try {
            // Do not update orders that have billing completed - leave them as-is and report
            if (order.status === 'billing_successful') {
                billingCompletedSkipped.push({
                    id: order.id,
                    orderNumber: order.order_number,
                    status: order.status || 'billing_successful'
                });
                continue;
            }

            let calculatedTotal = 0;

            if (order.service_type === 'Equipment') {
                // Equipment orders store price in notes as JSON
                if (order.notes) {
                    try {
                        const notes = JSON.parse(order.notes);
                        if (notes && notes.price) {
                            calculatedTotal = parseFloat(notes.price.toString() || '0');
                        }
                    } catch (e) {
                        // Notes might not be JSON, skip
                    }
                }
            } else {
                // Food or Meal orders - get items from order_items
                // Use the same logic as getOrderById: custom_price OR (menuItem?.priceEach ?? item.unit_value)
                const { data: items, error: itemsError } = await supabase
                    .from('order_items')
                    .select('meal_item_id, menu_item_id, unit_value, quantity, total_value, custom_price, custom_name')
                    .eq('order_id', order.id);

                if (itemsError) {
                    console.error(`Error fetching items for order ${order.id}:`, itemsError);
                    errorCount++;
                    continue;
                }

                if (!items || items.length === 0) {
                    // No items, skip (might be a draft or empty order)
                    skippedCount++;
                    continue;
                }

                // Calculate total from items using the same logic as getOrderById
                // getOrderById uses: item.custom_price ? parseFloat(item.custom_price) : (menuItem?.priceEach ?? parseFloat(item.unit_value))
                for (const item of items) {
                    const quantity = parseFloat(item.quantity?.toString() || '0');
                    
                    if (quantity <= 0) continue;

                    let itemPrice = 0;

                    // First check for custom_price (like getOrderById does)
                    if (item.custom_price) {
                        itemPrice = parseFloat(item.custom_price.toString() || '0');
                    } else {
                        // Try to find the menu/meal item
                        let menuItem: any = null;
                        
                        // Check menu_item_id first (could be menu or meal item)
                        if (item.menu_item_id) {
                            // First try as menu item
                            menuItem = menuItemsMap.get(item.menu_item_id);
                            
                            // If not found and it's a Meal order, try as meal item
                            if (!menuItem && order.service_type === 'Meal') {
                                menuItem = mealItemsMap.get(item.menu_item_id);
                            }
                        }
                        
                        // Check meal_item_id explicitly
                        if (!menuItem && item.meal_item_id) {
                            menuItem = mealItemsMap.get(item.meal_item_id);
                        }

                        // Meal items: use only price_each (never quota_value). Menu items: price_each or value or unit_value.
                        if (menuItem) {
                            const itemKey = item.meal_item_id || item.menu_item_id;
                            const isMealItem = order.service_type === 'Meal' && itemKey && mealItemsMap.has(itemKey);
                            itemPrice = isMealItem
                                ? ((menuItem as any).priceEach ?? 0)
                                : ((menuItem as any).priceEach ?? (menuItem as any).value ?? parseFloat(item.unit_value?.toString() || '0'));
                        } else {
                            // No menu item found, use unit_value directly (fallback)
                            itemPrice = parseFloat(item.unit_value?.toString() || '0');
                        }
                    }

                    const itemTotal = itemPrice * quantity;
                    calculatedTotal += itemTotal;
                }
            }

            const currentTotal = parseFloat(order.total_value?.toString() || '0');

            // Debug: Log first few orders to see what's happening
            if (fixedCount < 5 && calculatedTotal > 0.01) {
                console.log(`\n[DEBUG] Order #${order.order_number} (${order.service_type}):`);
                console.log(`  Current total: ${currentTotal}`);
                console.log(`  Calculated total: ${calculatedTotal}`);
                const { data: debugItems } = await supabase
                    .from('order_items')
                    .select('meal_item_id, menu_item_id, unit_value, quantity, custom_price')
                    .eq('order_id', order.id)
                    .limit(3);
                if (debugItems) {
                    debugItems.forEach((item, idx) => {
                        console.log(`  Item ${idx + 1}: meal_id=${item.meal_item_id}, menu_id=${item.menu_item_id}, unit_value=${item.unit_value}, qty=${item.quantity}, custom_price=${item.custom_price}`);
                    });
                }
            }

            // If calculated total is > 0 and current is 0 (or very close), update it
            if (calculatedTotal > 0.01 && currentTotal <= 0.01) {
                const { error: updateError } = await supabase
                    .from('orders')
                    .update({ total_value: calculatedTotal })
                    .eq('id', order.id);

                if (updateError) {
                    console.error(`Error updating order ${order.id} (Order #${order.order_number}):`, updateError);
                    errorCount++;
                } else {
                    fixedOrders.push({
                        id: order.id,
                        orderNumber: order.order_number,
                        oldValue: currentTotal,
                        newValue: calculatedTotal
                    });
                    fixedCount++;
                    console.log(`✓ Fixed Order #${order.order_number} (${order.service_type}): ${currentTotal.toFixed(2)} → ${calculatedTotal.toFixed(2)}`);
                }
            } else if (calculatedTotal <= 0.01) {
                // Order has items but they all have 0 value - might be intentional
                skippedCount++;
            }
        } catch (error: any) {
            console.error(`Error processing order ${order.id}:`, error.message);
            errorCount++;
        }
    }

    console.log('\n=== Summary ===');
    console.log(`Total orders with total_value = 0: ${zeroOrders.length}`);
    console.log(`Orders fixed: ${fixedCount}`);
    console.log(`Orders skipped (no items or all items have 0 value): ${skippedCount}`);
    console.log(`Orders skipped (billing already completed - not updated): ${billingCompletedSkipped.length}`);
    console.log(`Errors: ${errorCount}`);

    if (fixedOrders.length > 0) {
        console.log('\n=== Fixed Orders ===');
        fixedOrders.forEach(order => {
            console.log(`Order #${order.orderNumber}: ${order.oldValue.toFixed(2)} → ${order.newValue.toFixed(2)}`);
        });
    }

    if (billingCompletedSkipped.length > 0) {
        console.log('\n=== Orders NOT updated (billing already completed) ===');
        console.log('The following orders have total_value = 0 but were not updated because their billing is completed. Update these manually if needed.');
        billingCompletedSkipped.forEach(o => {
            console.log(`  Order #${o.orderNumber} (id: ${o.id}, status: ${o.status})`);
        });
    }
}

// Run the script
fixOrderTotalValues()
    .then(() => {
        console.log('\nScript completed successfully.');
        process.exit(0);
    })
    .catch((error) => {
        console.error('Script failed:', error);
        process.exit(1);
    });
