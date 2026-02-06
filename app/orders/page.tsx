import { OrdersList } from '@/components/orders/OrdersList';

export const metadata = { title: 'Orders' };

export default function OrdersPage() {
    return (
        <main style={{ padding: '2rem' }}>
            <OrdersList />
        </main>
    );
}
