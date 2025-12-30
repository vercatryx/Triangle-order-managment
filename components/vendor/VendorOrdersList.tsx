'use client';

import { useState, useEffect } from 'react';
import { Vendor, ClientProfile, MenuItem, BoxType } from '@/lib/types';
import { getClients, getMenuItems, getBoxTypes } from '@/lib/cached-data';
import { Calendar, Package, CheckCircle, Clock } from 'lucide-react';

interface Props {
    vendor: Vendor;
    orders: any[];
}

export function VendorOrdersList({ vendor, orders: initialOrders }: Props) {
    const [orders] = useState(initialOrders);
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [activeTab, setActiveTab] = useState<'all' | 'upcoming' | 'completed'>('upcoming');
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        const [clientsData, menuItemsData, boxTypesData] = await Promise.all([
            getClients(),
            getMenuItems(),
            getBoxTypes()
        ]);
        setClients(clientsData);
        setMenuItems(menuItemsData);
        setBoxTypes(boxTypesData);
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

    function toggleOrder(orderId: string) {
        const newExpanded = new Set(expandedOrders);
        if (newExpanded.has(orderId)) {
            newExpanded.delete(orderId);
        } else {
            newExpanded.add(orderId);
        }
        setExpandedOrders(newExpanded);
    }

    const filteredOrders = orders.filter(order => {
        if (activeTab === 'upcoming') return order.orderType === 'upcoming';
        if (activeTab === 'completed') return order.orderType === 'completed';
        return true;
    });

    return (
        <div style={{ padding: '2rem' }}>
            <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '1rem' }}>
                Orders
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                View and manage orders for {vendor.name}
            </p>

            <div style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '2rem',
                borderBottom: '1px solid var(--border-color)'
            }}>
                <button
                    onClick={() => setActiveTab('all')}
                    style={{
                        padding: '0.75rem 1.5rem',
                        border: 'none',
                        background: activeTab === 'all' ? 'var(--color-primary)' : 'transparent',
                        color: activeTab === 'all' ? 'white' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        borderBottom: activeTab === 'all' ? '2px solid var(--color-primary)' : '2px solid transparent',
                        marginBottom: '-1px'
                    }}
                >
                    All ({orders.length})
                </button>
                <button
                    onClick={() => setActiveTab('upcoming')}
                    style={{
                        padding: '0.75rem 1.5rem',
                        border: 'none',
                        background: activeTab === 'upcoming' ? 'var(--color-primary)' : 'transparent',
                        color: activeTab === 'upcoming' ? 'white' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        borderBottom: activeTab === 'upcoming' ? '2px solid var(--color-primary)' : '2px solid transparent',
                        marginBottom: '-1px'
                    }}
                >
                    Upcoming ({orders.filter(o => o.orderType === 'upcoming').length})
                </button>
                <button
                    onClick={() => setActiveTab('completed')}
                    style={{
                        padding: '0.75rem 1.5rem',
                        border: 'none',
                        background: activeTab === 'completed' ? 'var(--color-primary)' : 'transparent',
                        color: activeTab === 'completed' ? 'white' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        borderBottom: activeTab === 'completed' ? '2px solid var(--color-primary)' : '2px solid transparent',
                        marginBottom: '-1px'
                    }}
                >
                    Completed ({orders.filter(o => o.orderType === 'completed').length})
                </button>
            </div>

            {filteredOrders.length === 0 ? (
                <div style={{
                    padding: '3rem',
                    textAlign: 'center',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)'
                }}>
                    <p style={{ color: 'var(--text-secondary)' }}>No orders found</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {filteredOrders.map((order) => (
                        <div
                            key={order.id}
                            style={{
                                backgroundColor: 'var(--bg-surface)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)',
                                padding: '1.5rem'
                            }}
                        >
                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '1rem'
                            }}>
                                <div>
                                    <h3 style={{ fontWeight: 600, marginBottom: '0.25rem' }}>
                                        {getClientName(order.client_id)}
                                    </h3>
                                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                        <span>
                                            <Calendar size={14} style={{ display: 'inline', marginRight: '0.25rem' }} />
                                            {formatDate(order.scheduled_delivery_date)}
                                        </span>
                                        <span>
                                            <Package size={14} style={{ display: 'inline', marginRight: '0.25rem' }} />
                                            {order.total_items || 0} items
                                        </span>
                                        <span>
                                            ${(order.total_value || 0).toFixed(2)}
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    {order.orderType === 'upcoming' ? (
                                        <span style={{
                                            padding: '0.25rem 0.75rem',
                                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                                            color: 'var(--color-primary)',
                                            borderRadius: 'var(--radius-sm)',
                                            fontSize: '0.875rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.25rem'
                                        }}>
                                            <Clock size={14} />
                                            Upcoming
                                        </span>
                                    ) : (
                                        <span style={{
                                            padding: '0.25rem 0.75rem',
                                            backgroundColor: 'rgba(34, 197, 94, 0.1)',
                                            color: 'var(--color-success)',
                                            borderRadius: 'var(--radius-sm)',
                                            fontSize: '0.875rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.25rem'
                                        }}>
                                            <CheckCircle size={14} />
                                            Completed
                                        </span>
                                    )}
                                    <button
                                        onClick={() => toggleOrder(order.id)}
                                        style={{
                                            padding: '0.5rem',
                                            border: '1px solid var(--border-color)',
                                            background: 'transparent',
                                            borderRadius: 'var(--radius-sm)',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        {expandedOrders.has(order.id) ? '▼' : '▶'}
                                    </button>
                                </div>
                            </div>

                            {expandedOrders.has(order.id) && (
                                <div style={{
                                    marginTop: '1rem',
                                    padding: '1rem',
                                    backgroundColor: 'var(--bg-app)',
                                    borderRadius: 'var(--radius-sm)',
                                    border: '1px solid var(--border-color)'
                                }}>
                                    <h4 style={{ marginBottom: '0.75rem', fontWeight: 600 }}>Order Details</h4>
                                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                        <p><strong>Order ID:</strong> {order.id}</p>
                                        <p><strong>Service Type:</strong> {order.service_type}</p>
                                        <p><strong>Status:</strong> {order.status}</p>
                                        {order.delivery_proof_url && (
                                            <p><strong>Delivery Proof:</strong> <a href={order.delivery_proof_url} target="_blank" rel="noopener noreferrer">View</a></p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

