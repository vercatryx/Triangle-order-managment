import { redirect } from 'next/navigation';
import { getVendorSession, getVendorMenuItems, getVendorDetails } from '@/lib/actions';
import { VendorItemsManagement } from '@/components/vendor/VendorItemsManagement';

export default async function VendorItemsPage() {
    const session = await getVendorSession();
    if (!session) {
        redirect('/vendor-login');
    }

    const [vendor, menuItems] = await Promise.all([
        getVendorDetails(),
        getVendorMenuItems()
    ]);

    if (!vendor) {
        redirect('/vendor-login');
    }

    return <VendorItemsManagement vendor={vendor} menuItems={menuItems} />;
}

