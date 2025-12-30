import { redirect } from 'next/navigation';
import { getVendorSession, getVendorOrders, getVendorDetails } from '@/lib/actions';
import { VendorOrdersList } from '@/components/vendor/VendorOrdersList';

export default async function VendorOrdersPage() {
    const session = await getVendorSession();
    if (!session) {
        redirect('/vendor-login');
    }

    const [vendor, orders] = await Promise.all([
        getVendorDetails(),
        getVendorOrders()
    ]);

    if (!vendor) {
        redirect('/vendor-login');
    }

    return <VendorOrdersList vendor={vendor} orders={orders} />;
}

