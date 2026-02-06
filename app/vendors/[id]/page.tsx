import { VendorDetail } from '@/components/vendors/VendorDetail';
import { getVendor } from '@/lib/actions-read';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const vendor = await getVendor(id);
  return { title: vendor?.name ? `${vendor.name} — Vendor` : 'Vendor' };
}

export default async function VendorDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <VendorDetail vendorId={id} />;
}

