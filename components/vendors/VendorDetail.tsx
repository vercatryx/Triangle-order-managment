'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Vendor, ClientProfile, MenuItem, BoxType } from '@/lib/types';
import { getVendors, getClients, getMenuItems, getBoxTypes } from '@/lib/cached-data';
import { getOrdersByVendor, isOrderUnderVendor, updateOrderDeliveryProof, orderHasDeliveryProof } from '@/lib/actions';
import { ArrowLeft, Truck, Calendar, Package, CheckCircle, XCircle, Clock, User, DollarSign, ShoppingCart, Download, ChevronDown, ChevronUp, FileText, Upload } from 'lucide-react';
import styles from './VendorDetail.module.css';

interface Props {
    vendorId: string;
}

export function VendorDetail({ vendorId }: Props) {
    const router = useRouter();
    const [vendor, setVendor] = useState<Vendor | null>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

    useEffect(() => {
        loadData();
    }, [vendorId]);

    async function loadData() {
        setIsLoading(true);
        try {
            const [vendorsData, ordersData, clientsData, menuItemsData, boxTypesData] = await Promise.all([
                getVendors(),
                getOrdersByVendor(vendorId),
                getClients(),
                getMenuItems(),
                getBoxTypes()
            ]);

            const foundVendor = vendorsData.find(v => v.id === vendorId);
            setVendor(foundVendor || null);
            setOrders(ordersData);
            setClients(clientsData);
            setMenuItems(menuItemsData);
            setBoxTypes(boxTypesData);
        } catch (error) {
            console.error('Error loading vendor data:', error);
        } finally {
            setIsLoading(false);
        }
    }

    function getClientName(clientId: string) {
        const client = clients.find(c => c.id === clientId);
        return client?.fullName || 'Unknown Client';
    }

    function formatDate(dateString: string | null | undefined) {
        if (!dateString) return '-';
        try {
            return new Date(dateString).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        } catch {
            return dateString;
        }
    }

    function formatDateTime(dateString: string | null | undefined) {
        if (!dateString) return '-';
        try {
            return new Date(dateString).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch {
            return dateString;
        }
    }

    function toggleOrderExpansion(orderId: string) {
        const newExpanded = new Set(expandedOrders);
        if (newExpanded.has(orderId)) {
            newExpanded.delete(orderId);
        } else {
            newExpanded.add(orderId);
        }
        setExpandedOrders(newExpanded);
    }

    function getMenuItemName(itemId: string) {
        const item = menuItems.find(mi => mi.id === itemId);
        return item?.name || 'Unknown Item';
    }

    function getBoxTypeName(boxTypeId: string) {
        const boxType = boxTypes.find(bt => bt.id === boxTypeId);
        return boxType?.name || 'Unknown Box Type';
    }

    function renderOrderItems(order: any) {
        if (order.service_type === 'Food') {
            // Food orders - items from order_items or upcoming_order_items
            const items = order.items || [];
            if (items.length === 0) {
                return <div className={styles.noItems}>No items found</div>;
            }

            return (
                <div className={styles.itemsList}>
                    <div className={styles.itemsHeader}>
                        <span style={{ minWidth: '300px', flex: 3 }}>Item Name</span>
                        <span style={{ minWidth: '100px', flex: 1 }}>Quantity</span>
                        <span style={{ minWidth: '120px', flex: 1.2 }}>Unit Price</span>
                        <span style={{ minWidth: '120px', flex: 1.2 }}>Total Price</span>
                    </div>
                    {items.map((item: any) => {
                        const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                        const unitPrice = parseFloat(item.unit_value || 0);
                        const quantity = item.quantity || 0;
                        const totalPrice = parseFloat(item.total_value || 0) || (unitPrice * quantity);

                        return (
                            <div key={item.id} className={styles.itemRow}>
                                <span style={{ minWidth: '300px', flex: 3 }}>
                                    {menuItem?.name || 'Unknown Item'}
                                </span>
                                <span style={{ minWidth: '100px', flex: 1 }}>{quantity}</span>
                                <span style={{ minWidth: '120px', flex: 1.2 }}>${unitPrice.toFixed(2)}</span>
                                <span style={{ minWidth: '120px', flex: 1.2, fontWeight: 600 }}>
                                    ${totalPrice.toFixed(2)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            );
        } else if (order.service_type === 'Boxes') {
            // Box orders - items from box_selections.items JSONB
            const boxSelection = order.boxSelection;
            if (!boxSelection) {
                return <div className={styles.noItems}>No box selection found</div>;
            }

            const items = boxSelection.items || {};
            const itemEntries = Object.entries(items);
            
            if (itemEntries.length === 0) {
                return (
                    <div className={styles.noItems}>
                        Box Type: {getBoxTypeName(boxSelection.box_type_id)} (Quantity: {boxSelection.quantity || 1})
                    </div>
                );
            }

            return (
                <div className={styles.itemsList}>
                    <div style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'var(--bg-app)', borderRadius: 'var(--radius-sm)' }}>
                        <strong>Box Type:</strong> {getBoxTypeName(boxSelection.box_type_id)} | 
                        <strong style={{ marginLeft: '1rem' }}>Quantity:</strong> {boxSelection.quantity || 1}
                    </div>
                    <div className={styles.itemsHeader}>
                        <span style={{ minWidth: '300px', flex: 3 }}>Item Name</span>
                        <span style={{ minWidth: '100px', flex: 1 }}>Quantity</span>
                        <span style={{ minWidth: '120px', flex: 1.2 }}>Unit Price</span>
                        <span style={{ minWidth: '120px', flex: 1.2 }}>Total Price</span>
                    </div>
                    {itemEntries.map(([itemId, quantity]: [string, any]) => {
                        const menuItem = menuItems.find(mi => mi.id === itemId);
                        const qty = typeof quantity === 'number' ? quantity : parseInt(quantity) || 0;
                        const unitPrice = menuItem?.priceEach || 0;
                        const totalPrice = unitPrice * qty;

                        return (
                            <div key={itemId} className={styles.itemRow}>
                                <span style={{ minWidth: '300px', flex: 3 }}>
                                    {menuItem?.name || 'Unknown Item'}
                                </span>
                                <span style={{ minWidth: '100px', flex: 1 }}>{qty}</span>
                                <span style={{ minWidth: '120px', flex: 1.2 }}>${unitPrice.toFixed(2)}</span>
                                <span style={{ minWidth: '120px', flex: 1.2, fontWeight: 600 }}>
                                    ${totalPrice.toFixed(2)}
                                </span>
                            </div>
                        );
                    })}
                </div>
            );
        }

        return <div className={styles.noItems}>No items available</div>;
    }

    function escapeCSV(value: any): string {
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        // If value contains comma, newline, or quote, wrap in quotes and escape quotes
        if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
    }

    function exportOrdersToCSV() {
        if (orders.length === 0) {
            alert('No orders to export');
            return;
        }

        // Define CSV headers
        const headers = [
            'Order ID',
            'Order Type',
            'Client ID',
            'Client Name',
            'Service Type',
            'Case ID',
            'Status',
            'Scheduled Delivery Date',
            'Actual Delivery Date',
            'Total Items',
            'Total Value',
            'Created At',
            'Last Updated',
            'Updated By',
            'Notes',
            'Delivery Distribution',
            'delivery_proof_url'
        ];

        // Convert orders to CSV rows
        const rows = orders.map(order => [
            order.id || '',
            order.orderType || '',
            order.client_id || '',
            getClientName(order.client_id),
            order.service_type || '',
            order.case_id || '',
            order.status || '',
            order.scheduled_delivery_date || '',
            order.actual_delivery_date || '',
            order.total_items || 0,
            order.total_value || 0,
            order.created_at || '',
            order.last_updated || '',
            order.updated_by || '',
            order.notes || '',
            order.delivery_distribution ? JSON.stringify(order.delivery_distribution) : '',
            order.delivery_proof_url || '' // Include delivery_proof_url if available
        ]);

        // Combine headers and rows
        const csvContent = [
            headers.map(escapeCSV).join(','),
            ...rows.map(row => row.map(escapeCSV).join(','))
        ].join('\n');

        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${vendor?.name || 'vendor'}_orders_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function parseCSVRow(row: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < row.length; i++) {
            const char = row[i];
            const nextChar = row[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    current += '"';
                    i++; // Skip next quote
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current); // Push last field
        return result;
    }

    async function handleCSVImport(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;

        // Reset input
        event.target.value = '';

        if (!file.name.endsWith('.csv')) {
            alert('Please select a CSV file');
            return;
        }

        try {
            const text = await file.text();
            const lines = text.split(/\r?\n/).filter(line => line.trim());
            
            if (lines.length < 2) {
                alert('CSV file must have at least a header row and one data row');
                return;
            }

            // Parse header row
            const headers = parseCSVRow(lines[0]);
            const orderIdIndex = headers.findIndex(h => h.toLowerCase() === 'order id');
            const deliveryProofUrlIndex = headers.findIndex(h => h.toLowerCase() === 'delivery_proof_url');

            if (orderIdIndex === -1) {
                alert('CSV file must contain an "Order ID" column');
                return;
            }

            if (deliveryProofUrlIndex === -1) {
                alert('CSV file must contain a "delivery_proof_url" column');
                return;
            }

            // Process each data row
            let successCount = 0;
            let errorCount = 0;
            let skippedCount = 0;
            const errors: string[] = [];
            const skipped: string[] = [];

            for (let i = 1; i < lines.length; i++) {
                const row = parseCSVRow(lines[i]);
                const orderId = row[orderIdIndex]?.trim();
                const deliveryProofUrl = row[deliveryProofUrlIndex]?.trim();

                if (!orderId) {
                    errorCount++;
                    errors.push(`Row ${i + 1}: Missing Order ID`);
                    continue;
                }

                if (!deliveryProofUrl) {
                    errorCount++;
                    errors.push(`Row ${i + 1} (Order ${orderId}): Missing delivery_proof_url`);
                    continue;
                }

                // Check if order belongs to this vendor
                const belongsToVendor = await isOrderUnderVendor(orderId, vendorId);
                if (!belongsToVendor) {
                    errorCount++;
                    errors.push(`Row ${i + 1} (Order ${orderId}): Order does not belong to this vendor`);
                    continue;
                }

                // Check if order already has a delivery proof URL (skip if it does)
                const alreadyHasProof = await orderHasDeliveryProof(orderId);
                if (alreadyHasProof) {
                    skippedCount++;
                    skipped.push(`Row ${i + 1} (Order ${orderId}): Already has delivery proof URL, skipping`);
                    continue;
                }

                // Update order with delivery proof URL and set status to completed (delivered)
                const result = await updateOrderDeliveryProof(orderId, deliveryProofUrl);
                if (result.success) {
                    successCount++;
                } else {
                    errorCount++;
                    errors.push(`Row ${i + 1} (Order ${orderId}): ${result.error || 'Failed to update order'}`);
                }
            }

            // Show results
            let message = `Import completed!\n\nSuccessfully processed: ${successCount} order(s)`;
            if (skippedCount > 0) {
                message += `\nSkipped (already processed): ${skippedCount} order(s)`;
            }
            if (errorCount > 0) {
                message += `\nErrors: ${errorCount} order(s)`;
                if (errors.length > 0) {
                    message += `\n\nErrors:\n${errors.slice(0, 10).join('\n')}`;
                    if (errors.length > 10) {
                        message += `\n... and ${errors.length - 10} more error(s)`;
                    }
                }
            }
            if (skippedCount > 0 && skipped.length > 0) {
                message += `\n\nSkipped:\n${skipped.slice(0, 10).join('\n')}`;
                if (skipped.length > 10) {
                    message += `\n... and ${skipped.length - 10} more skipped order(s)`;
                }
            }
            alert(message);

            // Reload orders to reflect changes
            if (successCount > 0) {
                await loadData();
            }
        } catch (error: any) {
            console.error('Error importing CSV:', error);
            alert(`Error importing CSV: ${error.message || 'Unknown error'}`);
        }
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading vendor details...</p>
                </div>
            </div>
        );
    }

    if (!vendor) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <button className={styles.backButton} onClick={() => router.push('/vendors')}>
                        <ArrowLeft size={16} /> Back to Vendors
                    </button>
                </div>
                <div className={styles.errorMessage}>
                    <p>Vendor not found</p>
                </div>
            </div>
        );
    }

    const completedOrders = orders.filter(o => o.orderType === 'completed');
    const upcomingOrders = orders.filter(o => o.orderType === 'upcoming');

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push('/vendors')}>
                    <ArrowLeft size={16} /> Back to Vendors
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                    <h1 className={styles.title}>
                        <Truck size={24} style={{ marginRight: '12px', verticalAlign: 'middle' }} />
                        {vendor.name}
                    </h1>
                    {orders.length > 0 && (
                        <div style={{ display: 'flex', gap: '0.5rem', marginLeft: '1rem' }}>
                            <button className="btn btn-secondary" onClick={exportOrdersToCSV}>
                                <Download size={16} /> Export CSV
                            </button>
                            <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
                                <Upload size={16} /> Import CSV
                                <input
                                    type="file"
                                    accept=".csv"
                                    onChange={handleCSVImport}
                                    style={{ display: 'none' }}
                                />
                            </label>
                        </div>
                    )}
                </div>
            </div>

            {/* Vendor Summary */}
            <div className={styles.summarySection}>
                <h2 className={styles.sectionTitle}>Vendor Details</h2>
                <div className={styles.summaryGrid}>
                    <div className={styles.summaryCard}>
                        <div className={styles.summaryLabel}>Service Type</div>
                        <div className={styles.summaryValue}>
                            <span className="badge badge-info">{vendor.serviceType}</span>
                        </div>
                    </div>
                    <div className={styles.summaryCard}>
                        <div className={styles.summaryLabel}>Status</div>
                        <div className={styles.summaryValue}>
                            {vendor.isActive ? (
                                <span className="badge badge-success">Active</span>
                            ) : (
                                <span className="badge">Inactive</span>
                            )}
                        </div>
                    </div>
                    <div className={styles.summaryCard}>
                        <div className={styles.summaryLabel}>Delivery Days</div>
                        <div className={styles.summaryValue}>
                            {vendor.deliveryDays.length > 0 ? (
                                <div className={styles.deliveryDays}>
                                    {vendor.deliveryDays.map((day, idx) => (
                                        <span key={idx} className={styles.dayBadge}>{day}</span>
                                    ))}
                                </div>
                            ) : (
                                <span style={{ color: 'var(--text-tertiary)' }}>No delivery days set</span>
                            )}
                        </div>
                    </div>
                    <div className={styles.summaryCard}>
                        <div className={styles.summaryLabel}>Multiple Deliveries</div>
                        <div className={styles.summaryValue}>
                            {vendor.allowsMultipleDeliveries ? (
                                <span style={{ color: 'var(--color-success)' }}>
                                    <CheckCircle size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                    Allowed
                                </span>
                            ) : (
                                <span style={{ color: 'var(--text-tertiary)' }}>
                                    <XCircle size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                    Not Allowed
                                </span>
                            )}
                        </div>
                    </div>
                    <div className={styles.summaryCard}>
                        <div className={styles.summaryLabel}>Minimum Order</div>
                        <div className={styles.summaryValue}>
                            {vendor.minimumOrder || 0}
                        </div>
                    </div>
                    <div className={styles.summaryCard}>
                        <div className={styles.summaryLabel}>Total Orders</div>
                        <div className={styles.summaryValue}>
                            <strong>{orders.length}</strong>
                            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                                ({completedOrders.length} completed, {upcomingOrders.length} upcoming)
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Orders Section */}
            <div className={styles.ordersSection}>
                <h2 className={styles.sectionTitle}>Orders</h2>
                
                {orders.length === 0 ? (
                    <div className={styles.emptyState}>
                        <Package size={48} style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }} />
                        <p>No orders found for this vendor</p>
                    </div>
                ) : (
                    <div className={styles.ordersList}>
                        <div className={styles.ordersHeader}>
                            <span style={{ width: '40px', flex: 'none' }}></span>
                            <span style={{ minWidth: '120px', flex: 0.8 }}>Type</span>
                            <span style={{ minWidth: '200px', flex: 2 }}>Client</span>
                            <span style={{ minWidth: '120px', flex: 1 }}>Case ID</span>
                            <span style={{ minWidth: '120px', flex: 1 }}>Status</span>
                            <span style={{ minWidth: '150px', flex: 1.2 }}>Scheduled Date</span>
                            <span style={{ minWidth: '150px', flex: 1.2 }}>Actual Date</span>
                            <span style={{ minWidth: '100px', flex: 1 }}>Items</span>
                            <span style={{ minWidth: '120px', flex: 1 }}>Total Value</span>
                            <span style={{ minWidth: '150px', flex: 1.2 }}>Updated By</span>
                            <span style={{ minWidth: '150px', flex: 1.2 }}>Created</span>
                        </div>
                        {orders.map((order) => {
                            const orderKey = `${order.orderType}-${order.id}`;
                            const isExpanded = expandedOrders.has(orderKey);

                            return (
                                <div key={orderKey}>
                                    <div 
                                        className={styles.orderRow}
                                        onClick={() => toggleOrderExpansion(orderKey)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <span style={{ width: '40px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                        </span>
                                        <span style={{ minWidth: '120px', flex: 0.8 }}>
                                            <span className="badge badge-info">{order.service_type}</span>
                                            {order.orderType === 'upcoming' && (
                                                <Clock size={14} style={{ marginLeft: '4px', verticalAlign: 'middle', color: 'var(--color-warning)' }} />
                                            )}
                                        </span>
                                        <span 
                                            title={getClientName(order.client_id)} 
                                            style={{ minWidth: '200px', flex: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        >
                                            {getClientName(order.client_id)}
                                        </span>
                                        <span style={{ minWidth: '120px', flex: 1, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            {order.case_id || '-'}
                                        </span>
                                        <span style={{ minWidth: '120px', flex: 1 }}>
                                            <span className={`badge ${order.status === 'completed' ? 'badge-success' : ''}`}>
                                                {order.status}
                                            </span>
                                        </span>
                                        <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            {formatDate(order.scheduled_delivery_date)}
                                        </span>
                                        <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            {formatDate(order.actual_delivery_date)}
                                        </span>
                                        <span style={{ minWidth: '100px', flex: 1, fontSize: '0.9rem' }}>
                                            {order.total_items || 0}
                                        </span>
                                        <span style={{ minWidth: '120px', flex: 1, fontWeight: 600 }}>
                                            ${parseFloat(order.total_value || 0).toFixed(2)}
                                        </span>
                                        <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            {order.updated_by || '-'}
                                        </span>
                                        <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
                                            {formatDateTime(order.created_at)}
                                        </span>
                                    </div>
                                    {isExpanded && (
                                        <div className={styles.orderDetails}>
                                            <div className={styles.orderDetailsGrid}>
                                                <div className={styles.detailItem}>
                                                    <strong>Order ID:</strong> {order.id}
                                                </div>
                                                <div className={styles.detailItem}>
                                                    <strong>Order Type:</strong> {order.orderType}
                                                </div>
                                                {order.case_id && (
                                                    <div className={styles.detailItem}>
                                                        <strong>Case ID:</strong> {order.case_id}
                                                    </div>
                                                )}
                                                <div className={styles.detailItem}>
                                                    <strong>Last Updated:</strong> {formatDateTime(order.last_updated)}
                                                </div>
                                                {order.updated_by && (
                                                    <div className={styles.detailItem}>
                                                        <strong>Updated By:</strong> {order.updated_by}
                                                    </div>
                                                )}
                                                {order.take_effect_date && (
                                                    <div className={styles.detailItem}>
                                                        <strong>Take Effect Date:</strong> {formatDate(order.take_effect_date)}
                                                    </div>
                                                )}
                                                {order.delivery_distribution && (
                                                    <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}>
                                                        <strong>Delivery Distribution:</strong> {JSON.stringify(order.delivery_distribution)}
                                                    </div>
                                                )}
                                                {order.notes && (
                                                    <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}>
                                                        <strong>Notes:</strong> {order.notes}
                                                    </div>
                                                )}
                                            </div>
                                            <div className={styles.itemsSection}>
                                                <h4 className={styles.itemsTitle}>
                                                    <ShoppingCart size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                                                    Order Items
                                                </h4>
                                                {renderOrderItems(order)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

