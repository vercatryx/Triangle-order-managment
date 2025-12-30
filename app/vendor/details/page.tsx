import { redirect } from 'next/navigation';
import { getVendorSession, getVendorDetails } from '@/lib/actions';
import { VendorDetailsEdit } from '@/components/vendor/VendorDetailsEdit';

export default async function VendorDetailsPage() {
    const session = await getVendorSession();
    if (!session) {
        redirect('/vendor-login');
    }

    const vendor = await getVendorDetails();
    if (!vendor) {
        redirect('/vendor-login');
    }

    return <VendorDetailsEdit vendor={vendor} />;
}

