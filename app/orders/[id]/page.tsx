import { getOrderById } from '@/lib/actions';
import { notFound } from 'next/navigation';
import { OrderDetailView } from '@/components/orders/OrderDetailView';

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;

    console.log(`[OrderDetailPage] Requesting order details for ID: ${id}`);

    try {
        const order = await getOrderById(id);

        if (!order) {
            console.error(`[OrderDetailPage] Order NOT FOUND for ID: ${id}`);
            notFound();
        }

        console.log(`[OrderDetailPage] Successfully found order: ${id}, Status: ${order.status}, Service: ${order.serviceType}`);
        return <OrderDetailView order={order} />;
    } catch (error) {
        console.error(`[OrderDetailPage] Unexpected error loading order ${id}:`, error);
        throw error;
    }
}






