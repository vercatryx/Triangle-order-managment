'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Vendor, ClientProfile, MenuItem, BoxType } from '@/lib/types';
import { getVendors, getClients, getMenuItems, getBoxTypes } from '@/lib/cached-data';
import { getOrdersByVendor, updateOrderDeliveryProof } from '@/lib/actions';
import { ArrowLeft, Calendar, Package, Clock, ShoppingCart, Upload, ChevronDown, ChevronUp } from 'lucide-react';
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
            
            setOrders(filteredOrders);
            setClients(clientsData);
            setMenuItems(menuItemsData);
            setBoxTypes(boxTypesData);
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

    function getBoxTypeName(boxTypeId: string) {
        const boxType = boxTypes.find(bt => bt.id === boxTypeId);
        return boxType?.name || 'Unknown Box Type';
    }

    function renderOrderItems(order: any) {
        if (order.service_type === 'Food') {
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
                    {items.map((item: any, index: number) => {
                        const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                        const unitPrice = parseFloat(item.unit_value || item.unitValue || 0) || (menuItem?.priceEach || menuItem?.value || 0);
                        const quantity = parseInt(item.quantity || 0);
                        const totalPrice = parseFloat(item.total_value || item.totalValue || 0) || (unitPrice * quantity);
                        const itemKey = item.id || `${order.id}-item-${index}`;

                        return (
                            <div key={itemKey} className={styles.itemRow}>
                                <span style={{ minWidth: '300px', flex: 3 }}>
                                    {menuItem?.name || item.menuItemName || 'Unknown Item'}
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
                        const unitPrice = menuItem?.priceEach || menuItem?.value || 0;
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
    );
}

