'use client';

import { useState, useEffect } from 'react';
import { getAllOrders } from '@/lib/actions';
import { getClients, getNavigators } from '@/lib/cached-data';
import { generateLabelsPDFByDriver } from '@/lib/label-utils';
import { FileText, Download, Calendar, Truck, Loader2 } from 'lucide-react';
import styles from './RoutesPage.module.css';

export function RoutesPage() {
    const [orders, setOrders] = useState<any[]>([]);
    const [clients, setClients] = useState<any[]>([]);
    const [navigators, setNavigators] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState<string>('');

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setIsLoading(true);
        try {
            const [ordersData, clientsData, navigatorsData] = await Promise.all([
                getAllOrders(),
                getClients(),
                getNavigators()
            ]);

            setOrders(ordersData);
            setClients(clientsData);
            setNavigators(navigatorsData);

            // Set default date to today if available
            if (ordersData.length > 0) {
                const today = new Date().toISOString().split('T')[0];
                const hasTodayOrders = ordersData.some((o: any) => {
                    if (!o.scheduled_delivery_date) return false;
                    const orderDate = new Date(o.scheduled_delivery_date).toISOString().split('T')[0];
                    return orderDate === today;
                });
                if (hasTodayOrders) {
                    setSelectedDate(today);
                }
            }
        } catch (error) {
            console.error('Error loading routes data:', error);
        } finally {
            setIsLoading(false);
        }
    }

    function getClientName(clientId: string) {
        const client = clients.find(c => c.id === clientId);
        return client?.fullName || 'Unknown Client';
    }

    function getClientAddress(clientId: string) {
        const client = clients.find(c => c.id === clientId);
        return client?.address || '-';
    }

    function getClientDriver(clientId: string) {
        const client = clients.find(c => c.id === clientId);
        return client?.navigatorId || null;
    }

    function getDriverName(driverId: string) {
        const navigator = navigators.find(n => n.id === driverId);
        return navigator?.name || `Driver_${driverId.slice(0, 8)}`;
    }

    function formatDate(dateString: string | null | undefined) {
        if (!dateString) return '-';
        try {
            return new Date(dateString).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC'
            });
        } catch {
            return dateString;
        }
    }

    function formatOrderedItemsForCSV(order: any): string {
        // Get parsed order items
        const items = getParsedOrderItems(order);
        if (items.length === 0) {
            return 'No items';
        }
        return items.map(item => {
            let itemStr = `${item.name} (${item.quantity})`;
            if (item.notes) {
                itemStr += ` - ${item.notes}`;
            }
            return itemStr;
        }).join('; ');
    }

    function getParsedOrderItems(order: any): { name: string; quantity: number; category?: string; notes?: string }[] {
        if (order.service_type === 'Food' || order.service_type === 'Meal' || order.service_type === 'Custom') {
            const items = order.items || [];
            return items.map((item: any) => ({
                name: item.menuItemName || item.name || 'Unknown Item',
                quantity: item.quantity || 1,
                notes: item.notes || item.itemNotes || undefined
            }));
        } else if (order.service_type === 'Boxes') {
            // For boxes, we might need to parse box selections
            if (order.boxSelection) {
                return [{
                    name: order.boxSelection.boxTypeName || 'Box',
                    quantity: order.boxSelection.quantity || 1,
                    notes: undefined
                }];
            }
            return [{ name: 'Box Order', quantity: 1 }];
        }
        return [];
    }

    async function handleDownloadLabels() {
        if (!selectedDate) {
            alert('Please select a delivery date');
            return;
        }

        // Filter orders by selected date
        const dateKey = new Date(selectedDate).toISOString().split('T')[0];
        const filteredOrders = orders.filter((order: any) => {
            if (!order.scheduled_delivery_date) return false;
            const orderDate = new Date(order.scheduled_delivery_date).toISOString().split('T')[0];
            return orderDate === dateKey;
        });

        if (filteredOrders.length === 0) {
            alert('No orders found for the selected date');
            return;
        }

        // Map orders to the format expected by label generation
        const mappedOrders = filteredOrders.map((order: any) => ({
            id: order.id,
            orderNumber: order.order_number || order.orderNumber,
            client_id: order.client_id,
            service_type: order.service_type,
            items: order.items || [],
            boxSelection: order.boxSelection,
            equipmentSelection: order.equipmentSelection,
            notes: order.notes
        }));

        await generateLabelsPDFByDriver({
            orders: mappedOrders,
            getClientName,
            getClientAddress,
            getClientDriver,
            getDriverName,
            formatOrderedItemsForCSV,
            formatDate,
            deliveryDate: selectedDate
        });
    }

    // Get unique delivery dates from orders
    const deliveryDates = Array.from(
        new Set(
            orders
                .filter((o: any) => o.scheduled_delivery_date)
                .map((o: any) => {
                    const date = new Date(o.scheduled_delivery_date);
                    return date.toISOString().split('T')[0];
                })
        )
    ).sort();

    // Group orders by driver for the selected date
    const ordersByDriver = new Map<string, any[]>();
    if (selectedDate) {
        const dateKey = new Date(selectedDate).toISOString().split('T')[0];
        const filteredOrders = orders.filter((order: any) => {
            if (!order.scheduled_delivery_date) return false;
            const orderDate = new Date(order.scheduled_delivery_date).toISOString().split('T')[0];
            return orderDate === dateKey;
        });

        filteredOrders.forEach((order: any) => {
            const driverId = getClientDriver(order.client_id);
            const key = driverId || 'unassigned';
            if (!ordersByDriver.has(key)) {
                ordersByDriver.set(key, []);
            }
            ordersByDriver.get(key)!.push(order);
        });
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <Loader2 className="animate-spin" size={32} />
                    <p>Loading routes...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>
                    <Truck size={24} style={{ marginRight: '12px', verticalAlign: 'middle' }} />
                    Routes
                </h1>
                <div className={styles.headerActions}>
                    <div className={styles.dateSelector}>
                        <label htmlFor="delivery-date" style={{ marginRight: '0.5rem', fontSize: '0.9rem' }}>
                            Delivery Date:
                        </label>
                        <select
                            id="delivery-date"
                            className="input"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            style={{ minWidth: '200px' }}
                        >
                            <option value="">Select a date</option>
                            {deliveryDates.map((date) => (
                                <option key={date} value={date}>
                                    {formatDate(date)}
                                </option>
                            ))}
                        </select>
                    </div>
                    {selectedDate && (
                        <button
                            className="btn btn-primary"
                            onClick={handleDownloadLabels}
                            style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            <FileText size={20} /> Download Labels
                        </button>
                    )}
                </div>
            </div>

            {selectedDate ? (
                <div className={styles.routesList}>
                    {Array.from(ordersByDriver.entries()).map(([driverId, driverOrders]) => {
                        const driverName = driverId === 'unassigned' 
                            ? 'Unassigned' 
                            : getDriverName(driverId);
                        
                        return (
                            <div key={driverId} className={styles.driverGroup}>
                                <div className={styles.driverHeader}>
                                    <h2 className={styles.driverName}>
                                        <Truck size={18} style={{ marginRight: '8px' }} />
                                        {driverName}
                                    </h2>
                                    <span className={styles.orderCount}>
                                        {driverOrders.length} order{driverOrders.length !== 1 ? 's' : ''}
                                    </span>
                                </div>
                                <div className={styles.clientsList}>
                                    {driverOrders.map((order: any) => (
                                        <div key={order.id} className={styles.clientItem}>
                                            <div className={styles.clientName}>
                                                {getClientName(order.client_id)}
                                            </div>
                                            <div className={styles.clientAddress}>
                                                {getClientAddress(order.client_id)}
                                            </div>
                                            <div className={styles.orderNumber}>
                                                Order #{order.order_number || order.id.slice(0, 6)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                    {ordersByDriver.size === 0 && (
                        <div className={styles.emptyState}>
                            <Calendar size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                            <p>No orders found for the selected date</p>
                        </div>
                    )}
                </div>
            ) : (
                <div className={styles.emptyState}>
                    <Calendar size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
                    <p>Please select a delivery date to view routes</p>
                </div>
            )}
        </div>
    );
}
