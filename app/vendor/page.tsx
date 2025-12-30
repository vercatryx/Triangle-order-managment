import { redirect } from 'next/navigation';
import { getVendorSession, getVendorDetails, getVendorOrders } from '@/lib/actions';
import { VendorDashboard } from '@/components/vendor/VendorDashboard';

export default async function VendorPage() {
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

    return <VendorDashboard vendor={vendor} orders={orders} />;
}

