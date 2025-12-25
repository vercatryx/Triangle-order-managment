import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getMenuItems, getVendors, getBoxTypes, getSettings, getClient } from '@/lib/actions';

/**
 * API Route: Process all current active orders from orders table
 * 
 * GET /api/process-weekly-orders
 * 
 * This endpoint:
 * 1. Checks if the orders table is completely empty
 * 2. If orders table is empty:
 *    - Fetches ALL upcoming orders for each client from upcoming_orders table
 *    - Excludes orders with status 'processed' (already processed)
 *    - Groups orders by client_id to get all orders for each client
 * 3. If orders table has records:
 *    - Fetches active orders (status: 'pending' or 'confirmed') from orders table
 * 4. Processes each order with full details (vendor selections, items, box selections)
 * 5. Creates a billing record for each processed order
 * 
 * Returns a comprehensive summary of processed orders and created billing records
 */
/**
 * Precheck function: Transfer upcoming orders for clients who have no orders yet
 * This checks each client in upcoming_orders and transfers their orders if they don't exist in orders table
 */
async function precheckAndTransferUpcomingOrders() {
    const transferResults = {
        transferred: 0,
        skipped: 0,
        errors: [] as string[]
    };

    try {
        // Fetch all upcoming orders (excluding 'processed' status)
        const { data: upcomingOrders, error: upcomingError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .neq('status', 'processed')
            .order('created_at', { ascending: true });

        if (upcomingError) {
            transferResults.errors.push(`Failed to fetch upcoming orders: ${upcomingError.message}`);
            return transferResults;
        }

        if (!upcomingOrders || upcomingOrders.length === 0) {
            return transferResults;
        }

        // Get all unique client IDs from upcoming_orders
        const clientIds = [...new Set(upcomingOrders.map(o => o.client_id))];

        // Check which clients have no orders in orders table
        for (const clientId of clientIds) {
            const { count: clientOrdersCount, error: clientCountError } = await supabase
                .from('orders')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', clientId);

            if (clientCountError) {
                transferResults.errors.push(`Failed to check orders for client ${clientId}: ${clientCountError.message}`);
                continue;
            }

            // Get all upcoming orders for this client
            const clientUpcomingOrders = upcomingOrders.filter(o => o.client_id === clientId);

            // If client has no orders, transfer their upcoming orders
            if (clientOrdersCount === 0) {
                for (const upcomingOrder of clientUpcomingOrders) {
                    try {
                        // Create order in orders table
                        const orderData: any = {
                            client_id: upcomingOrder.client_id,
                            service_type: upcomingOrder.service_type,
                            case_id: upcomingOrder.case_id,
                            status: 'pending',
                            last_updated: new Date().toISOString(),
                            updated_by: upcomingOrder.updated_by,
                            scheduled_delivery_date: upcomingOrder.scheduled_delivery_date,
                            delivery_distribution: upcomingOrder.delivery_distribution,
                            total_value: upcomingOrder.total_value,
                            total_items: upcomingOrder.total_items,
                            notes: upcomingOrder.notes || null
                        };

                        const { data: newOrder, error: orderError } = await supabase
                            .from('orders')
                            .insert(orderData)
                            .select()
                            .single();

                        if (orderError || !newOrder) {
                            transferResults.errors.push(`Failed to create order for client ${clientId}: ${orderError?.message}`);
                            continue;
                        }

                        // Copy vendor selections and items (for Food orders)
                        if (upcomingOrder.service_type === 'Food') {
                            const { data: vendorSelections } = await supabase
                                .from('upcoming_order_vendor_selections')
                                .select('*')
                                .eq('upcoming_order_id', upcomingOrder.id);

                            if (vendorSelections) {
                                for (const vs of vendorSelections) {
                                    const { data: newVs, error: vsError } = await supabase
                                        .from('order_vendor_selections')
                                        .insert({
                                            order_id: newOrder.id,
                                            vendor_id: vs.vendor_id
                                        })
                                        .select()
                                        .single();

                                    if (vsError || !newVs) continue;

                                    // Copy items
                                    const { data: items } = await supabase
                                        .from('upcoming_order_items')
                                        .select('*')
                                        .eq('vendor_selection_id', vs.id);

                                    if (items) {
                                        for (const item of items) {
                                            await supabase.from('order_items').insert({
                                                order_id: newOrder.id,
                                                vendor_selection_id: newVs.id,
                                                menu_item_id: item.menu_item_id,
                                                quantity: item.quantity,
                                                unit_value: item.unit_value,
                                                total_value: item.total_value
                                            });
                                        }
                                    }
                                }
                            }
                        }

                        // Copy box selections (for Box orders)
                        if (upcomingOrder.service_type === 'Boxes') {
                            const { data: boxSelections } = await supabase
                                .from('upcoming_order_box_selections')
                                .select('*')
                                .eq('upcoming_order_id', upcomingOrder.id);

                            if (boxSelections) {
                                for (const bs of boxSelections) {
                                    await supabase.from('order_box_selections').insert({
                                        order_id: newOrder.id,
                                        box_type_id: bs.box_type_id,
                                        vendor_id: bs.vendor_id,
                                        quantity: bs.quantity
                                    });
                                }
                            }
                        }

                        // Update upcoming order status to 'processed'
                        await supabase
                            .from('upcoming_orders')
                            .update({
                                status: 'processed',
                                processed_order_id: newOrder.id,
                                processed_at: new Date().toISOString()
                            })
                            .eq('id', upcomingOrder.id);

                        transferResults.transferred++;
                    } catch (error: any) {
                        transferResults.errors.push(`Error transferring upcoming order ${upcomingOrder.id} for client ${clientId}: ${error.message}`);
                    }
                }
            } else {
                transferResults.skipped += clientUpcomingOrders.length;
            }
        }
    } catch (error: any) {
        transferResults.errors.push(`Precheck error: ${error.message}`);
    }

    return transferResults;
}

export async function GET(request: NextRequest) {
    try {
        // Precheck: Transfer upcoming orders for clients with no existing orders
        const precheckResults = await precheckAndTransferUpcomingOrders();
        
        // First, check if orders table is completely empty
        const { count: ordersCount, error: countError } = await supabase
            .from('orders')
            .select('*', { count: 'exact', head: true });

        if (countError) {
            throw new Error(`Failed to check orders table: ${countError.message}`);
        }

        let ordersToProcess: any[] = [];
        let isFromUpcomingOrders = false;

        // If orders table is empty, fetch all upcoming orders for each client
        if (ordersCount === 0) {
            // Fetch ALL upcoming orders (excluding 'processed' status as those are already processed)
            const { data: upcomingOrders, error: upcomingError } = await supabase
                .from('upcoming_orders')
                .select('*')
                .neq('status', 'processed') // Exclude already processed orders
                .order('created_at', { ascending: true });

            if (upcomingError) {
                throw new Error(`Failed to fetch upcoming orders: ${upcomingError.message}`);
            }

            if (!upcomingOrders || upcomingOrders.length === 0) {
                return NextResponse.json({
                    success: true,
                    message: 'No orders found to process. Orders table is empty and no upcoming orders available.',
                    statistics: {
                        totalOrders: 0,
                        totalBillingRecords: 0,
                        totalValue: 0,
                        totalItems: 0
                    },
                    orders: [],
                    billingRecords: [],
                    processedAt: new Date().toISOString()
                }, { status: 200 });
            }

            // Group upcoming orders by client_id to get all orders for each client
            const ordersByClient = new Map<string, any[]>();
            for (const order of upcomingOrders) {
                if (!ordersByClient.has(order.client_id)) {
                    ordersByClient.set(order.client_id, []);
                }
                ordersByClient.get(order.client_id)!.push(order);
            }

            // Flatten the map to get all orders (all orders for each client)
            ordersToProcess = Array.from(ordersByClient.values()).flat();
            isFromUpcomingOrders = true;
        } else {
            // Orders table has records, fetch active orders
            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select('*')
                .in('status', ['pending', 'confirmed'])
                .order('created_at', { ascending: true });

            if (ordersError) {
                throw new Error(`Failed to fetch orders: ${ordersError.message}`);
            }

            if (!orders || orders.length === 0) {
                return NextResponse.json({
                    success: true,
                    message: 'No active orders found to process',
                    statistics: {
                        totalOrders: 0,
                        totalBillingRecords: 0,
                        totalValue: 0,
                        totalItems: 0
                    },
                    orders: [],
                    billingRecords: [],
                    processedAt: new Date().toISOString()
                }, { status: 200 });
            }

            ordersToProcess = orders;
        }

        // Fetch all required reference data
        const [menuItems, vendors, boxTypes, settings] = await Promise.all([
            getMenuItems(),
            getVendors(),
            getBoxTypes(),
            getSettings()
        ]);

        const processedOrders: any[] = [];
        const billingRecords: any[] = [];
        const errors: string[] = [];

        // Process each order
        for (const order of ordersToProcess) {
            try {
                // Fetch client information
                const client = await getClient(order.client_id);
                if (!client) {
                    errors.push(`Client not found for order ${order.id}`);
                    continue;
                }

                // Get navigator name
                let navigatorName = 'Unassigned';
                if (client.navigatorId) {
                    const { data: navigator } = await supabase
                        .from('navigators')
                        .select('name')
                        .eq('id', client.navigatorId)
                        .single();
                    if (navigator) {
                        navigatorName = navigator.name;
                    }
                }

                // Fetch order details based on service type
                let orderSummary: any = {
                    orderId: order.id,
                    clientId: order.client_id,
                    clientName: client.fullName,
                    serviceType: order.service_type,
                    status: order.status,
                    caseId: order.case_id || null,
                    scheduledDeliveryDate: order.scheduled_delivery_date,
                    actualDeliveryDate: order.actual_delivery_date || null, // May not exist in upcoming_orders
                    deliveryDistribution: order.delivery_distribution || {},
                    totalValue: parseFloat(order.total_value?.toString() || '0'),
                    totalItems: parseInt(order.total_items?.toString() || '0'),
                    notes: order.notes || null,
                    createdAt: order.created_at,
                    lastUpdated: order.last_updated,
                    updatedBy: order.updated_by,
                    vendorDetails: [],
                    orderSource: isFromUpcomingOrders ? 'upcoming_orders' : 'orders'
                };

                if (order.service_type === 'Food') {
                    // Fetch vendor selections for Food orders (from orders or upcoming_orders)
                    const vendorSelectionsTable = isFromUpcomingOrders ? 'upcoming_order_vendor_selections' : 'order_vendor_selections';
                    const orderIdField = isFromUpcomingOrders ? 'upcoming_order_id' : 'order_id';
                    const itemsTable = isFromUpcomingOrders ? 'upcoming_order_items' : 'order_items';
                    const vendorSelectionIdField = isFromUpcomingOrders ? 'vendor_selection_id' : 'vendor_selection_id';

                    const { data: vendorSelections } = await supabase
                        .from(vendorSelectionsTable)
                        .select('*')
                        .eq(orderIdField, order.id);

                    if (vendorSelections) {
                        for (const vs of vendorSelections) {
                            const vendor = vendors.find(v => v.id === vs.vendor_id);
                            
                            // Fetch items for this vendor selection
                            const { data: items } = await supabase
                                .from(itemsTable)
                                .select('*')
                                .eq(vendorSelectionIdField, vs.id);

                            const vendorSummary: any = {
                                vendorId: vs.vendor_id,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                items: []
                            };

                            let vendorTotalValue = 0;
                            let vendorTotalQuantity = 0;

                            if (items) {
                                for (const item of items) {
                                    const menuItem = menuItems.find(m => m.id === item.menu_item_id);
                                    vendorSummary.items.push({
                                        itemId: item.menu_item_id,
                                        itemName: menuItem?.name || 'Unknown Item',
                                        quantity: item.quantity,
                                        unitValue: parseFloat(item.unit_value?.toString() || '0'),
                                        totalValue: parseFloat(item.total_value?.toString() || '0')
                                    });
                                    vendorTotalValue += parseFloat(item.total_value?.toString() || '0');
                                    vendorTotalQuantity += item.quantity;
                                }
                            }

                            vendorSummary.totalValue = vendorTotalValue;
                            vendorSummary.totalQuantity = vendorTotalQuantity;
                            orderSummary.vendorDetails.push(vendorSummary);
                        }
                    }
                } else if (order.service_type === 'Boxes') {
                    // Fetch box selections for Box orders (from orders or upcoming_orders)
                    const boxSelectionsTable = isFromUpcomingOrders ? 'upcoming_order_box_selections' : 'order_box_selections';
                    const orderIdField = isFromUpcomingOrders ? 'upcoming_order_id' : 'order_id';

                    const { data: boxSelections } = await supabase
                        .from(boxSelectionsTable)
                        .select('*')
                        .eq(orderIdField, order.id);

                    if (boxSelections && boxSelections.length > 0) {
                        for (const bs of boxSelections) {
                            const boxType = boxTypes.find(b => b.id === bs.box_type_id);
                            const vendor = vendors.find(v => v.id === bs.vendor_id);
                            
                            orderSummary.vendorDetails.push({
                                vendorId: bs.vendor_id || null,
                                vendorName: vendor?.name || 'Unknown Vendor',
                                boxTypeId: bs.box_type_id,
                                boxTypeName: boxType?.name || 'Unknown Box Type',
                                quantity: bs.quantity
                            });
                        }
                    }
                }

                processedOrders.push(orderSummary);

                // If processing from upcoming_orders, transfer to orders table
                if (isFromUpcomingOrders) {
                    try {
                        // Create order in orders table
                        const orderData: any = {
                            client_id: order.client_id,
                            service_type: order.service_type,
                            case_id: order.case_id,
                            status: 'pending',
                            last_updated: new Date().toISOString(),
                            updated_by: order.updated_by,
                            scheduled_delivery_date: order.scheduled_delivery_date,
                            delivery_distribution: order.delivery_distribution,
                            total_value: order.total_value,
                            total_items: order.total_items,
                            notes: order.notes || null
                        };

                        const { data: newOrder, error: orderError } = await supabase
                            .from('orders')
                            .insert(orderData)
                            .select()
                            .single();

                        if (orderError || !newOrder) {
                            errors.push(`Failed to transfer upcoming order ${order.id} to orders table: ${orderError?.message}`);
                        } else {
                            let transferErrors: string[] = [];
                            let itemsCopied = 0;
                            let vendorSelectionsCopied = 0;
                            let boxSelectionsCopied = 0;

                            // Transfer all related records:
                            // 1. order_vendor_selections (from upcoming_order_vendor_selections)
                            // 2. order_items (from upcoming_order_items)
                            // 3. order_box_selections (from upcoming_order_box_selections)

                            // Copy vendor selections and items (for Food orders)
                            if (order.service_type === 'Food') {
                                const { data: vendorSelections, error: vsFetchError } = await supabase
                                    .from('upcoming_order_vendor_selections')
                                    .select('*')
                                    .eq('upcoming_order_id', order.id);

                                if (vsFetchError) {
                                    transferErrors.push(`Failed to fetch vendor selections: ${vsFetchError.message}`);
                                } else if (vendorSelections && vendorSelections.length > 0) {
                                    for (const vs of vendorSelections) {
                                        const { data: newVs, error: vsError } = await supabase
                                            .from('order_vendor_selections')
                                            .insert({
                                                order_id: newOrder.id,
                                                vendor_id: vs.vendor_id
                                            })
                                            .select()
                                            .single();

                                        if (vsError || !newVs) {
                                            transferErrors.push(`Failed to copy vendor selection ${vs.id}: ${vsError?.message}`);
                                            continue;
                                        }

                                        vendorSelectionsCopied++;

                                        // Copy ALL items for this vendor selection from upcoming_order_items to order_items
                                        const { data: items, error: itemsFetchError } = await supabase
                                            .from('upcoming_order_items')
                                            .select('*')
                                            .eq('vendor_selection_id', vs.id);

                                        if (itemsFetchError) {
                                            transferErrors.push(`Failed to fetch items for vendor selection ${vs.id}: ${itemsFetchError.message}`);
                                        } else if (items && items.length > 0) {
                                            for (const item of items) {
                                                const { error: itemError } = await supabase.from('order_items').insert({
                                                    order_id: newOrder.id,
                                                    vendor_selection_id: newVs.id,
                                                    menu_item_id: item.menu_item_id,
                                                    quantity: item.quantity,
                                                    unit_value: item.unit_value,
                                                    total_value: item.total_value
                                                });

                                                if (itemError) {
                                                    transferErrors.push(`Failed to copy item ${item.id}: ${itemError.message}`);
                                                } else {
                                                    itemsCopied++;
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            // Copy box selections (for Box orders)
                            if (order.service_type === 'Boxes') {
                                const { data: boxSelections, error: bsFetchError } = await supabase
                                    .from('upcoming_order_box_selections')
                                    .select('*')
                                    .eq('upcoming_order_id', order.id);

                                if (bsFetchError) {
                                    transferErrors.push(`Failed to fetch box selections: ${bsFetchError.message}`);
                                } else if (boxSelections && boxSelections.length > 0) {
                                    for (const bs of boxSelections) {
                                        const { error: bsError } = await supabase.from('order_box_selections').insert({
                                            order_id: newOrder.id,
                                            box_type_id: bs.box_type_id,
                                            vendor_id: bs.vendor_id,
                                            quantity: bs.quantity
                                        });

                                        if (bsError) {
                                            transferErrors.push(`Failed to copy box selection ${bs.id}: ${bsError.message}`);
                                        } else {
                                            boxSelectionsCopied++;
                                        }
                                    }
                                }
                            }

                            // Log transfer summary and any errors
                            if (transferErrors.length > 0) {
                                errors.push(`Transfer errors for order ${order.id}: ${transferErrors.join('; ')}`);
                            }

                            // Log successful transfer summary
                            const transferSummary = [];
                            if (vendorSelectionsCopied > 0) transferSummary.push(`${vendorSelectionsCopied} vendor selection(s)`);
                            if (itemsCopied > 0) transferSummary.push(`${itemsCopied} item(s)`);
                            if (boxSelectionsCopied > 0) transferSummary.push(`${boxSelectionsCopied} box selection(s)`);
                            
                            if (transferSummary.length > 0) {
                                console.log(`Successfully transferred order ${order.id}: ${transferSummary.join(', ')}`);
                            }

                            // Update upcoming order status to 'processed'
                            await supabase
                                .from('upcoming_orders')
                                .update({
                                    status: 'processed',
                                    processed_order_id: newOrder.id,
                                    processed_at: new Date().toISOString()
                                })
                                .eq('id', order.id);

                            // Update orderSummary with the new order ID
                            orderSummary.orderId = newOrder.id;
                            orderSummary.transferredFromUpcoming = true;
                        }
                    } catch (transferError: any) {
                        errors.push(`Error transferring upcoming order ${order.id} to orders table: ${transferError.message}`);
                    }
                }

                // Create billing record for this order
                const billingAmount = orderSummary.totalValue;
                const orderSource = isFromUpcomingOrders ? 'Upcoming Order' : 'Order';
                // Use the new order ID if it was transferred, otherwise use the original ID
                const orderIdForBilling = (orderSummary.transferredFromUpcoming && orderSummary.orderId) ? orderSummary.orderId : order.id;
                const billingRemarks = `${orderSource} #${orderIdForBilling.substring(0, 8)} - ${order.service_type} service${order.case_id ? ` (Case: ${order.case_id})` : ''}`;

                const { data: billingRecord, error: billingError } = await supabase
                    .from('billing_records')
                    .insert({
                        client_id: order.client_id,
                        client_name: client.fullName,
                        status: 'request sent',
                        remarks: billingRemarks,
                        navigator: navigatorName,
                        amount: billingAmount
                    })
                    .select()
                    .single();

                if (billingError) {
                    errors.push(`Failed to create billing record for ${isFromUpcomingOrders ? 'upcoming order' : 'order'} ${order.id}: ${billingError.message}`);
                } else if (billingRecord) {
                    billingRecords.push({
                        id: billingRecord.id,
                        clientId: billingRecord.client_id,
                        clientName: billingRecord.client_name,
                        status: billingRecord.status,
                        remarks: billingRecord.remarks,
                        navigator: billingRecord.navigator,
                        amount: parseFloat(billingRecord.amount?.toString() || '0'),
                        createdAt: billingRecord.created_at,
                        orderId: orderIdForBilling,
                        orderSource: isFromUpcomingOrders ? 'upcoming_orders' : 'orders',
                        transferredFromUpcoming: orderSummary.transferredFromUpcoming || false
                    });
                }

            } catch (error: any) {
                errors.push(`Error processing ${isFromUpcomingOrders ? 'upcoming order' : 'order'} ${order.id}: ${error.message}`);
            }
        }

        // Calculate aggregate statistics
        const stats = {
            totalOrders: processedOrders.length,
            totalBillingRecords: billingRecords.length,
            totalClients: new Set(processedOrders.map(o => o.clientId)).size,
            totalValue: processedOrders.reduce((sum, o) => sum + o.totalValue, 0),
            totalItems: processedOrders.reduce((sum, o) => sum + o.totalItems, 0),
            byServiceType: {
                Food: processedOrders.filter(o => o.serviceType === 'Food').length,
                Boxes: processedOrders.filter(o => o.serviceType === 'Boxes').length,
                'Cooking supplies': processedOrders.filter(o => o.serviceType === 'Cooking supplies').length,
                'Care plan': processedOrders.filter(o => o.serviceType === 'Care plan').length
            },
            byStatus: {
                pending: processedOrders.filter(o => o.status === 'pending').length,
                confirmed: processedOrders.filter(o => o.status === 'confirmed').length
            },
            byVendor: {} as Record<string, number>
        };

        // Count orders by vendor
        processedOrders.forEach(order => {
            order.vendorDetails.forEach((vendor: any) => {
                const vendorName = vendor.vendorName || 'Unknown';
                stats.byVendor[vendorName] = (stats.byVendor[vendorName] || 0) + 1;
            });
        });

        const transferredCount = processedOrders.filter(o => o.transferredFromUpcoming).length;

        // Combine precheck errors with processing errors
        const allErrors = [...precheckResults.errors, ...errors];

        return NextResponse.json({
            success: true,
            message: `Successfully processed ${processedOrders.length} order(s)${transferredCount > 0 ? `, transferred ${transferredCount} order(s) from upcoming_orders to orders table` : ''} and created ${billingRecords.length} billing record(s)`,
            precheck: {
                transferred: precheckResults.transferred,
                skipped: precheckResults.skipped,
                errors: precheckResults.errors.length > 0 ? precheckResults.errors : undefined
            },
            orderSource: isFromUpcomingOrders ? 'upcoming_orders' : 'orders',
            transferredFromUpcoming: transferredCount,
            settings: {
                weeklyCutoffDay: settings.weeklyCutoffDay,
                weeklyCutoffTime: settings.weeklyCutoffTime
            },
            statistics: stats,
            orders: processedOrders,
            billingRecords: billingRecords,
            errors: allErrors.length > 0 ? allErrors : undefined,
            processedAt: new Date().toISOString()
        }, { status: 200 });

    } catch (error: any) {
        console.error('Error processing weekly orders:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to process weekly orders',
            processedAt: new Date().toISOString()
        }, { status: 500 });
    }
}
