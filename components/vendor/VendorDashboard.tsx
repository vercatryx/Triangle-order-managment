'use client';

import { Vendor } from '@/lib/types';
import { ShoppingCart, Package, DollarSign, Calendar } from 'lucide-react';

interface Props {
    vendor: Vendor;
    orders: any[];
}

export function VendorDashboard({ vendor, orders }: Props) {
    const upcomingOrders = orders.filter(o => o.orderType === 'upcoming');
    const completedOrders = orders.filter(o => o.orderType === 'completed');
    const totalValue = orders.reduce((sum, o) => sum + (o.total_value || 0), 0);
    const totalItems = orders.reduce((sum, o) => sum + (o.total_items || 0), 0);

    return (
        <div style={{ padding: '2rem' }}>
            <h1 style={{ fontSize: '2rem', fontWeight: 700, marginBottom: '1rem' }}>
                Welcome, {vendor.name}
            </h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
                Manage your orders, menu items, and vendor details from this dashboard.
            </p>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: '1.5rem',
                marginBottom: '2rem'
            }}>
                <div style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.5rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <ShoppingCart size={24} color="var(--color-primary)" />
                        <h3 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                            Total Orders
                        </h3>
                    </div>
                    <p style={{ fontSize: '2rem', fontWeight: 700 }}>{orders.length}</p>
                </div>

                <div style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.5rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <Calendar size={24} color="var(--color-primary)" />
                        <h3 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                            Upcoming Orders
                        </h3>
                    </div>
                    <p style={{ fontSize: '2rem', fontWeight: 700 }}>{upcomingOrders.length}</p>
                </div>

                <div style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.5rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <Package size={24} color="var(--color-primary)" />
                        <h3 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                            Total Items
                        </h3>
                    </div>
                    <p style={{ fontSize: '2rem', fontWeight: 700 }}>{totalItems}</p>
                </div>

                <div style={{
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    padding: '1.5rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                        <DollarSign size={24} color="var(--color-primary)" />
                        <h3 style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                            Total Value
                        </h3>
                    </div>
                    <p style={{ fontSize: '2rem', fontWeight: 700 }}>${totalValue.toFixed(2)}</p>
                </div>
            </div>

            <div style={{
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '1.5rem'
            }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>
                    Recent Orders
                </h2>
                {orders.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                        No orders yet
                    </p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {orders.slice(0, 5).map((order) => (
                            <div
                                key={order.id}
                                style={{
                                    padding: '1rem',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-sm)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}
                            >
                                <div>
                                    <p style={{ fontWeight: 500 }}>Order #{order.id?.slice(0, 8)}</p>
                                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                        {order.scheduled_delivery_date
                                            ? new Date(order.scheduled_delivery_date).toLocaleDateString()
                                            : 'No date'}
                                    </p>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <p style={{ fontWeight: 600 }}>${(order.total_value || 0).toFixed(2)}</p>
                                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                        {order.total_items || 0} items
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

