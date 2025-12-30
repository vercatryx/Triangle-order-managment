'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Vendor, ClientProfile, MenuItem, BoxType } from '@/lib/types';
import { getVendors, getClients, getMenuItems, getBoxTypes } from '@/lib/cached-data';
import { getOrdersByVendor, saveDeliveryProofUrlAndProcessOrder } from '@/lib/actions';
import { ArrowLeft, Calendar, Package, Clock, ShoppingCart, Upload, ChevronDown, ChevronUp, Save, X, CheckCircle, AlertCircle } from 'lucide-react';
import styles from './VendorDetail.module.css';

interface Props {
    vendorId: string;
    deliveryDate: string;
}

export function VendorDeliveryOrders({ vendorId, deliveryDate }: Props) {
    const router = useRouter();
    const [vendor, setVendor] = useState<Vendor | null>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
    const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [summaryModal, setSummaryModal] = useState<{
        show: boolean;
        results?: Array<{ success: boolean; orderId: string; error?: string; summary?: any }>;
        error?: string;
    }>({ show: false });

    useEffect(() => {
        loadData();
    }, [vendorId, deliveryDate]);

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
            
            // Filter orders by delivery date
            const dateKey = new Date(deliveryDate).toISOString().split('T')[0];
            const filteredOrders = ordersData.filter(order => {
                if (!order.scheduled_delivery_date) return false;
                const orderDateKey = new Date(order.scheduled_delivery_date).toISOString().split('T')[0];
                return orderDateKey === dateKey;
            });
            
            // Expand all orders by default so items are visible
            const allOrderKeys = new Set(filteredOrders.map(order => `${order.orderType}-${order.id}`));
            setExpandedOrders(allOrderKeys);
            
            setOrders(filteredOrders);
            setClients(clientsData);
            setMenuItems(menuItemsData);
            setBoxTypes(boxTypesData);
            
            // Initialize proof URLs from orders
            const initialProofUrls: Record<string, string> = {};
            filteredOrders.forEach(order => {
                if (order.delivery_proof_url) {
                    initialProofUrls[order.id] = order.delivery_proof_url;
                }
            });
            setProofUrls(initialProofUrls);
        } catch (error) {
            console.error('Error loading vendor delivery orders:', error);
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

    async function handleBulkSave() {
        // Get all orders with URLs entered
        const ordersToSave = orders.filter(order => {
            const url = proofUrls[order.id];
            return url && url.trim() && url.trim() !== (order.delivery_proof_url || '');
        });

        if (ordersToSave.length === 0) {
            alert('No delivery proof URLs to save. Please enter at least one URL.');
            return;
        }

        setIsSaving(true);
        const results: Array<{ success: boolean; orderId: string; orderType: string; error?: string; summary?: any }> = [];

        try {
            // Process all orders sequentially to avoid race conditions
            for (const order of ordersToSave) {
                try {
                    const url = proofUrls[order.id]?.trim() || '';
                    const res = await saveDeliveryProofUrlAndProcessOrder(
                        order.id,
                        order.orderType || 'completed',
                        url
                    );

                    results.push({
                        success: res.success,
                        orderId: order.id,
                        orderType: order.orderType || 'completed',
                        error: res.success ? undefined : (res.error || 'Unknown error'),
                        summary: res.summary
                    });
                } catch (error: any) {
                    results.push({
                        success: false,
                        orderId: order.id,
                        orderType: order.orderType || 'completed',
                        error: error?.message || 'Failed to save delivery proof URL'
                    });
                }
            }

            // Reload data after all saves
            await loadData();

            // Show summary modal with all results
            setSummaryModal({
                show: true,
                results: results
            });
        } catch (error: any) {
            console.error('Error during bulk save:', error);
            setSummaryModal({
                show: true,
                error: error?.message || 'Failed to save delivery proof URLs'
            });
        } finally {
            setIsSaving(false);
        }
    }

    function getBoxTypeName(boxTypeId: string) {
        const boxType = boxTypes.find(bt => bt.id === boxTypeId);
        return boxType?.name || 'Unknown Box Type';
    }

    function renderOrderItems(order: any) {
        if (order.service_type === 'Food') {
            const items = order.items || [];
            
            if (!items || items.length === 0) {
                return (
                    <div className={styles.noItems} style={{ 
                        padding: 'var(--spacing-md)', 
                        textAlign: 'center', 
                        color: 'var(--text-tertiary)', 
                        fontStyle: 'italic',
                        backgroundColor: 'var(--bg-app)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)'
                    }}>
                        No items found for this order. Order ID: {order.id}
                    </div>
                );
            }

            // Group items by vendor (for Food orders, items are already associated with vendor via vendor selection)
            // Since items are from a single vendor selection, display them in a table
            const vendorName = vendor?.name || 'Unknown Vendor';
            
            // Calculate totals
            let totalItems = 0;
            let totalValue = 0;
            items.forEach((item: any) => {
                const qty = parseInt(item.quantity || 0);
                const unitPrice = parseFloat(item.unit_value || item.unitValue || 0);
                const itemTotal = parseFloat(item.total_value || item.totalValue || 0) || (unitPrice * qty);
                totalItems += qty;
                totalValue += itemTotal;
            });

            return (
                <div className={styles.vendorSection}>
                    <div className={styles.vendorName}>
                        <strong>Vendor:</strong> {vendorName}
                    </div>
                    <table className={styles.itemsTable}>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Quantity</th>
                                <th>Unit Value</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item: any, index: number) => {
                                const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                const unitPrice = parseFloat(item.unit_value || item.unitValue || 0) || (menuItem?.priceEach || menuItem?.value || 0);
                                const quantity = parseInt(item.quantity || 0);
                                const totalPrice = parseFloat(item.total_value || item.totalValue || 0) || (unitPrice * quantity);
                                const itemKey = item.id || `${order.id}-item-${index}`;

                                return (
                                    <tr key={itemKey}>
                                        <td>{menuItem?.name || item.menuItemName || 'Unknown Item'}</td>
                                        <td>{quantity}</td>
                                        <td>${unitPrice.toFixed(2)}</td>
                                        <td>${totalPrice.toFixed(2)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className={styles.orderSummary}>
                        <div><strong>Total Items:</strong> {totalItems}</div>
                        <div><strong>Total Value:</strong> ${totalValue.toFixed(2)}</div>
                    </div>
                </div>
            );
        } else if (order.service_type === 'Boxes') {
            const boxSelection = order.boxSelection;
            
            if (!boxSelection) {
                return (
                    <div className={styles.noItems} style={{ 
                        padding: 'var(--spacing-md)', 
                        textAlign: 'center', 
                        color: 'var(--text-tertiary)', 
                        fontStyle: 'italic',
                        backgroundColor: 'var(--bg-app)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)'
                    }}>
                        No box selection found for this order. Order ID: {order.id}
                    </div>
                );
            }

            const items = boxSelection.items || {};
            const itemEntries = Object.entries(items);

            const boxVendorName = vendor?.name || 'Unknown Vendor';
            const boxTypeName = getBoxTypeName(boxSelection.box_type_id);
            const boxQuantity = boxSelection.quantity || 1;

            // Calculate totals
            let totalItems = 0;
            let totalValue = 0;

            if (!items || itemEntries.length === 0) {
                return (
                    <div className={styles.boxDetails}>
                        <div><strong>Vendor:</strong> {boxVendorName}</div>
                        <div><strong>Box Type:</strong> {boxTypeName}</div>
                        <div><strong>Quantity:</strong> {boxQuantity}</div>
                        <div><strong>Total Value:</strong> ${parseFloat(boxSelection.total_value || order.total_value || 0).toFixed(2)}</div>
                    </div>
                );
            }

            return (
                <div className={styles.vendorSection}>
                    <div className={styles.vendorName}>
                        <strong>Vendor:</strong> {boxVendorName} | <strong>Box Type:</strong> {boxTypeName} × {boxQuantity}
                    </div>
                    <table className={styles.itemsTable}>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Quantity</th>
                                <th>Unit Value</th>
                                <th>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {itemEntries.map(([itemId, quantityOrObj]: [string, any]) => {
                                const menuItem = menuItems.find(mi => mi.id === itemId);
                                
                                // Handle both formats: { itemId: quantity } or { itemId: { quantity: X, price: Y } }
                                let qty = 0;
                                let unitPrice = menuItem?.priceEach || menuItem?.value || 0;
                                
                                if (typeof quantityOrObj === 'number') {
                                    // Simple format: just a number
                                    qty = quantityOrObj;
                                } else if (quantityOrObj && typeof quantityOrObj === 'object' && 'quantity' in quantityOrObj) {
                                    // Complex format: { quantity: X, price?: Y }
                                    qty = typeof quantityOrObj.quantity === 'number' ? quantityOrObj.quantity : parseInt(quantityOrObj.quantity) || 0;
                                    if ('price' in quantityOrObj && quantityOrObj.price !== undefined && quantityOrObj.price !== null) {
                                        unitPrice = parseFloat(quantityOrObj.price) || unitPrice;
                                    }
                                } else {
                                    // Try to parse as number string
                                    qty = parseInt(quantityOrObj) || 0;
                                }
                                
                                const totalPrice = unitPrice * qty;
                                totalItems += qty;
                                totalValue += totalPrice;

                                return (
                                    <tr key={itemId}>
                                        <td>{menuItem?.name || 'Unknown Item'}</td>
                                        <td>{qty}</td>
                                        <td>${unitPrice.toFixed(2)}</td>
                                        <td>${totalPrice.toFixed(2)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className={styles.orderSummary}>
                        <div><strong>Total Items:</strong> {totalItems}</div>
                        <div><strong>Total Value:</strong> ${totalValue.toFixed(2)}</div>
                    </div>
                </div>
            );
        }

        return (
            <div className={styles.noItems} style={{ 
                padding: 'var(--spacing-md)', 
                textAlign: 'center', 
                color: 'var(--text-tertiary)', 
                fontStyle: 'italic',
                backgroundColor: 'var(--bg-app)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)'
            }}>
                No items available for service type: {order.service_type || 'Unknown'}
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading orders...</p>
                </div>
            </div>
        );
    }

    if (!vendor) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <button className={styles.backButton} onClick={() => router.push(`/vendors/${vendorId}`)}>
                        <ArrowLeft size={16} /> Back to Vendor
                    </button>
                </div>
                <div className={styles.errorMessage}>
                    <p>Vendor not found</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push(`/vendors/${vendorId}`)}>
                    <ArrowLeft size={16} /> Back to Vendor
                </button>
                <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Calendar size={24} style={{ color: 'var(--color-primary)' }} />
                    Orders for {formatDate(deliveryDate)}
                </h1>
            </div>

            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: 'var(--bg-app)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <strong>Vendor:</strong> {vendor.name}
                    </div>
                    <div>
                        <strong>Delivery Date:</strong> {formatDate(deliveryDate)}
                    </div>
                    <div>
                        <strong>Total Orders:</strong> {orders.length}
                    </div>
                    <div>
                        <strong>Total Items:</strong> {orders.reduce((sum, o) => sum + (o.total_items || 0), 0)}
                    </div>
                    <div>
                        <strong>Total Value:</strong> ${orders.reduce((sum, o) => sum + parseFloat(o.total_value || 0), 0).toFixed(2)}
                    </div>
                </div>
            </div>

            {orders.length === 0 ? (
                <div className={styles.emptyState}>
                    <Package size={48} style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }} />
                    <p>No orders found for this delivery date</p>
                </div>
            ) : (
                <div className={styles.ordersList}>
                    <div className={styles.ordersHeader}>
                        <span style={{ width: '40px', flex: 'none' }}></span>
                        <span style={{ minWidth: '120px', flex: 0.8 }}>Type</span>
                        <span style={{ minWidth: '200px', flex: 2 }}>Client</span>
                        <span style={{ minWidth: '120px', flex: 1 }}>Case ID</span>
                        <span style={{ minWidth: '120px', flex: 1 }}>Status</span>
                        <span style={{ minWidth: '150px', flex: 1.2 }}>Actual Date</span>
                        <span style={{ minWidth: '100px', flex: 1 }}>Items</span>
                        <span style={{ minWidth: '120px', flex: 1 }}>Total Value</span>
                        <span style={{ minWidth: '200px', flex: 1.5 }}>Delivery Proof URL</span>
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
                                    style={{ cursor: 'pointer', backgroundColor: isExpanded ? 'var(--bg-hover)' : undefined }}
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
                                        {formatDate(order.actual_delivery_date)}
                                    </span>
                                    <span style={{ minWidth: '100px', flex: 1, fontSize: '0.9rem' }}>
                                        {order.total_items || 0}
                                    </span>
                                    <span style={{ minWidth: '120px', flex: 1, fontWeight: 600 }}>
                                        ${parseFloat(order.total_value || 0).toFixed(2)}
                                    </span>
                                    <span 
                                        style={{ minWidth: '200px', flex: 1.5, fontSize: '0.85rem' }}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <input
                                            type="text"
                                            placeholder="Enter proof URL"
                                            className="input"
                                            style={{ 
                                                width: '100%',
                                                fontSize: '0.85rem',
                                                padding: '0.375rem 0.5rem'
                                            }}
                                            value={proofUrls[order.id] || ''}
                                            onChange={(e) => {
                                                setProofUrls(prev => ({
                                                    ...prev,
                                                    [order.id]: e.target.value
                                                }));
                                            }}
                                            disabled={isSaving}
                                        />
                                    </span>
                                    <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {order.updated_by || '-'}
                                    </span>
                                    <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
                                        {formatDateTime(order.created_at)}
                                    </span>
                                </div>
                                {/* Order Items - Always Visible */}
                                <div className={styles.orderDetails} style={{ 
                                    borderTop: '1px solid var(--border-color)', 
                                    backgroundColor: 'var(--bg-surface-hover)',
                                    padding: 0,
                                    display: 'block'
                                }}>
                                    <div className={styles.itemsSection} style={{ marginTop: 0, padding: 'var(--spacing-lg)' }}>
                                        <div className={styles.orderDetailsHeader}>
                                            <ShoppingCart size={16} />
                                            <span>Order Items</span>
                                        </div>
                                        {renderOrderItems(order)}
                                    </div>
                                </div>
                                {/* Order Details - Expandable - Hidden for now */}
                                {false && isExpanded && (
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

                                            {/* Proof Upload for Waiting Orders */}
                                            {order.status === 'waiting_for_proof' && (
                                                <div className={styles.detailItem} style={{ gridColumn: '1 / -1', marginTop: '1rem', padding: '1rem', backgroundColor: 'rgba(59, 130, 246, 0.05)', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                                                    <h4 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--color-primary)' }}>
                                                        <Upload size={16} /> Submit Proof of Delivery
                                                    </h4>
                                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                                        Providing a proof URL will move this order to <strong>Billing Pending</strong> status.
                                                    </p>
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <input
                                                            placeholder="Enter Proof URL (e.g. https://image-link.com)"
                                                            className="input"
                                                            style={{ flex: 1 }}
                                                            id={`proof-input-${order.id}`}
                                                        />
                                                        <button
                                                            className="btn btn-primary"
                                                            onClick={async () => {
                                                                const inputInfo = document.getElementById(`proof-input-${order.id}`) as HTMLInputElement;
                                                                if (!inputInfo || !inputInfo.value.trim()) {
                                                                    alert('Please enter a valid URL');
                                                                    return;
                                                                }

                                                                const res = await updateOrderDeliveryProof(order.id, inputInfo.value.trim());
                                                                if (res.success) {
                                                                    await loadData();
                                                                } else {
                                                                    alert('Failed: ' + res.error);
                                                                }
                                                            }}
                                                        >
                                                            Submit
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Bulk Save Button */}
            {orders.length > 0 && (
                <div style={{ 
                    marginTop: '2rem', 
                    padding: '1.5rem', 
                    backgroundColor: 'var(--bg-app)', 
                    borderRadius: 'var(--radius-md)', 
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem'
                }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        {(() => {
                            const ordersWithUrls = orders.filter(order => {
                                const url = proofUrls[order.id];
                                return url && url.trim() && url.trim() !== (order.delivery_proof_url || '');
                            }).length;
                            return ordersWithUrls > 0 
                                ? `${ordersWithUrls} order${ordersWithUrls !== 1 ? 's' : ''} with delivery proof URL${ordersWithUrls !== 1 ? 's' : ''} ready to save`
                                : 'Enter delivery proof URLs in the table above to save';
                        })()}
                    </div>
                    <button
                        className="btn btn-primary"
                        style={{ 
                            padding: '0.75rem 1.5rem',
                            fontSize: '1rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            whiteSpace: 'nowrap'
                        }}
                        onClick={handleBulkSave}
                        disabled={isSaving || orders.filter(order => {
                            const url = proofUrls[order.id];
                            return url && url.trim() && url.trim() !== (order.delivery_proof_url || '');
                        }).length === 0}
                    >
                        {isSaving ? (
                            <>Saving All...</>
                        ) : (
                            <>
                                <Save size={18} />
                                Save All Delivery Proof URLs
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Summary Modal */}
            {summaryModal.show && (
                <div 
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        padding: 'var(--spacing-lg)'
                    }}
                    onClick={() => setSummaryModal({ show: false })}
                >
                    <div 
                        style={{
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-lg)',
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
                            width: '100%',
                            maxWidth: summaryModal.results ? '700px' : '500px',
                            maxHeight: '90vh',
                            overflowY: 'auto',
                            padding: 'var(--spacing-xl)',
                            position: 'relative'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            style={{
                                position: 'absolute',
                                top: 'var(--spacing-md)',
                                right: 'var(--spacing-md)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--text-secondary)',
                                padding: 'var(--spacing-xs)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 'var(--radius-sm)',
                                transition: 'all 0.2s'
                            }}
                            onClick={() => setSummaryModal({ show: false })}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'var(--bg-app)';
                                e.currentTarget.style.color = 'var(--text-primary)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = 'var(--text-secondary)';
                            }}
                        >
                            <X size={20} />
                        </button>

                        {summaryModal.error ? (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 'var(--spacing-lg)' }}>
                                    <AlertCircle size={24} style={{ color: 'var(--color-danger)' }} />
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                                        Error
                                    </h2>
                                </div>
                                <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-xl)' }}>
                                    {summaryModal.error}
                                </p>
                            </>
                        ) : summaryModal.results ? (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 'var(--spacing-lg)' }}>
                                    <CheckCircle size={24} style={{ color: 'var(--color-success)' }} />
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                                        Bulk Save Results
                                    </h2>
                                </div>
                                
                                <div style={{ 
                                    backgroundColor: 'var(--bg-app)', 
                                    borderRadius: 'var(--radius-md)', 
                                    padding: 'var(--spacing-lg)',
                                    marginBottom: 'var(--spacing-lg)',
                                    maxHeight: '400px',
                                    overflowY: 'auto'
                                }}>
                                    {(() => {
                                        const successful = summaryModal.results.filter(r => r.success);
                                        const failed = summaryModal.results.filter(r => !r.success);
                                        
                                        return (
                                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                                <div style={{ 
                                                    padding: 'var(--spacing-sm)', 
                                                    backgroundColor: 'rgba(34, 197, 94, 0.1)', 
                                                    borderRadius: 'var(--radius-sm)',
                                                    border: '1px solid rgba(34, 197, 94, 0.2)',
                                                    color: 'var(--color-success)',
                                                    fontSize: '0.875rem',
                                                    fontWeight: 600
                                                }}>
                                                    ✓ {successful.length} order{successful.length !== 1 ? 's' : ''} saved successfully
                                                </div>
                                                
                                                {failed.length > 0 && (
                                                    <div style={{ 
                                                        padding: 'var(--spacing-sm)', 
                                                        backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                                                        borderRadius: 'var(--radius-sm)',
                                                        border: '1px solid rgba(239, 68, 68, 0.2)',
                                                        color: 'var(--color-danger)',
                                                        fontSize: '0.875rem',
                                                        fontWeight: 600,
                                                        marginBottom: 'var(--spacing-sm)'
                                                    }}>
                                                        ✗ {failed.length} order{failed.length !== 1 ? 's' : ''} failed
                                                    </div>
                                                )}

                                                <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                                    {summaryModal.results.map((result, idx) => (
                                                        <div key={idx} style={{ 
                                                            padding: 'var(--spacing-sm)',
                                                            backgroundColor: result.success ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                                                            borderRadius: 'var(--radius-sm)',
                                                            border: `1px solid ${result.success ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
                                                        }}>
                                                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                                                                Order ID: {result.orderId}
                                                            </div>
                                                            {result.success && result.summary && (
                                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                                                    {result.summary.wasProcessed && '✓ Processed from scheduled → '}
                                                                    Status: {result.summary.status}
                                                                </div>
                                                            )}
                                                            {!result.success && result.error && (
                                                                <div style={{ fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: '0.25rem' }}>
                                                                    Error: {result.error}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </>
                        ) : summaryModal.summary ? (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 'var(--spacing-lg)' }}>
                                    <CheckCircle size={24} style={{ color: 'var(--color-success)' }} />
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                                        Delivery Proof Saved Successfully
                                    </h2>
                                </div>
                                
                                <div style={{ 
                                    backgroundColor: 'var(--bg-app)', 
                                    borderRadius: 'var(--radius-md)', 
                                    padding: 'var(--spacing-lg)',
                                    marginBottom: 'var(--spacing-lg)'
                                }}>
                                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                        <div>
                                            <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Order ID:</strong>
                                            <div style={{ color: 'var(--text-primary)', fontSize: '1rem', marginTop: '0.25rem' }}>
                                                {summaryModal.summary.orderId}
                                            </div>
                                        </div>
                                        <div>
                                            <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Case ID:</strong>
                                            <div style={{ color: 'var(--text-primary)', fontSize: '1rem', marginTop: '0.25rem' }}>
                                                {summaryModal.summary.caseId}
                                            </div>
                                        </div>
                                        <div>
                                            <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Service Type:</strong>
                                            <div style={{ color: 'var(--text-primary)', fontSize: '1rem', marginTop: '0.25rem' }}>
                                                {summaryModal.summary.serviceType}
                                            </div>
                                        </div>
                                        <div>
                                            <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Status:</strong>
                                            <div style={{ color: 'var(--text-primary)', fontSize: '1rem', marginTop: '0.25rem' }}>
                                                <span className="badge badge-success">{summaryModal.summary.status}</span>
                                            </div>
                                        </div>
                                        {summaryModal.summary.wasProcessed && (
                                            <div style={{ 
                                                padding: 'var(--spacing-sm)', 
                                                backgroundColor: 'rgba(59, 130, 246, 0.1)', 
                                                borderRadius: 'var(--radius-sm)',
                                                border: '1px solid rgba(59, 130, 246, 0.2)',
                                                color: 'var(--color-primary)',
                                                fontSize: '0.875rem'
                                            }}>
                                                ✓ Order was processed from scheduled to delivery
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {summaryModal.summary.hasErrors && summaryModal.summary.errors && (
                                    <div style={{ 
                                        padding: 'var(--spacing-md)', 
                                        backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid rgba(239, 68, 68, 0.2)',
                                        marginBottom: 'var(--spacing-lg)'
                                    }}>
                                        <div style={{ 
                                            color: 'var(--color-danger)', 
                                            fontSize: '0.875rem',
                                            fontWeight: 600,
                                            marginBottom: '0.5rem'
                                        }}>
                                            Warnings:
                                        </div>
                                        <ul style={{ 
                                            margin: 0, 
                                            paddingLeft: '1.25rem',
                                            color: 'var(--color-danger)',
                                            fontSize: '0.875rem'
                                        }}>
                                            {summaryModal.summary.errors.map((err: string, idx: number) => (
                                                <li key={idx} style={{ marginBottom: '0.25rem' }}>{err}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </>
                        ) : null}

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                className="btn btn-primary"
                                onClick={() => setSummaryModal({ show: false })}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

