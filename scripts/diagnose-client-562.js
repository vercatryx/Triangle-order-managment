// Diagnostic script to check CLIENT-562's order data
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, '../data/local-orders-db.json');
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

const clientId = 'CLIENT-562';

console.log('=== DIAGNOSING CLIENT-562 ORDER ===\n');

// Get upcoming orders
const upcomingOrders = db.upcomingOrders.filter(
    o => o.client_id === clientId && o.status === 'scheduled'
);

console.log(`Found ${upcomingOrders.length} scheduled orders\n`);

if (upcomingOrders.length === 0) {
    console.log('No orders found!');
    process.exit(1);
}

// Simulate getUpcomingOrderForClientLocal logic
const order = upcomingOrders[0];

console.log('Raw Order Data:');
console.log(JSON.stringify(order, null, 2));
console.log('\n');

// Check condition: single order without delivery_day
if (upcomingOrders.length === 1 && !order.delivery_day) {
    console.log('✅ Would use single order format (line 711)\n');
    
    const orderConfig = {
        id: order.id,
        serviceType: order.service_type,
        caseId: order.case_id,
        status: order.status,
        lastUpdated: order.last_updated,
        updatedBy: order.updated_by,
        scheduledDeliveryDate: order.scheduled_delivery_date,
        takeEffectDate: order.take_effect_date,
        deliveryDistribution: order.delivery_distribution,
        totalValue: order.total_value,
        totalItems: order.total_items,
        notes: order.notes
    };

    if (order.service_type === 'Food') {
        const vendorSelections = db.upcomingOrderVendorSelections.filter(
            vs => vs.upcoming_order_id === order.id
        );
        
        console.log(`Vendor Selections found: ${vendorSelections.length}`);
        
        orderConfig.vendorSelections = [];
        
        if (vendorSelections.length > 0) {
            for (const vs of vendorSelections) {
                const items = db.upcomingOrderItems.filter(
                    item => item.vendor_selection_id === vs.id
                );
                const itemsMap = {};
                for (const item of items) {
                    itemsMap[item.menu_item_id] = item.quantity;
                }
                orderConfig.vendorSelections.push({
                    vendorId: vs.vendor_id,
                    items: itemsMap
                });
            }
        } else {
            console.log('No vendor selections - checking for items by upcoming_order_id...');
            const items = db.upcomingOrderItems.filter(
                item => item.upcoming_order_id === order.id
            );
            console.log(`Items found by upcoming_order_id: ${items.length}`);
            
            if (items.length > 0) {
                const itemsMap = {};
                for (const item of items) {
                    if (item.menu_item_id) {
                        itemsMap[item.menu_item_id] = item.quantity;
                    }
                }
                if (Object.keys(itemsMap).length > 0) {
                    orderConfig.vendorSelections.push({
                        vendorId: null,
                        items: itemsMap
                    });
                }
            }
        }
    }

    console.log('\n=== FINAL ORDER CONFIG ===');
    console.log(JSON.stringify(orderConfig, null, 2));
    console.log('\n=== ANALYSIS ===');
    console.log(`Has caseId: ${!!orderConfig.caseId}`);
    console.log(`Has vendorSelections: ${!!orderConfig.vendorSelections}`);
    console.log(`vendorSelections.length: ${orderConfig.vendorSelections?.length || 0}`);
    console.log(`serviceType: ${orderConfig.serviceType}`);
    console.log(`Should display in UI: ${!!orderConfig.caseId && orderConfig.serviceType === 'Food'}`);
    
} else {
    console.log('❌ Would use grouped by delivery day format');
    console.log(`  Orders: ${upcomingOrders.length}`);
    console.log(`  delivery_day: ${order.delivery_day}`);
}
