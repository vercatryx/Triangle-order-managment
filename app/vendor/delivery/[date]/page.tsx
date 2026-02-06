import { VendorDeliveryOrders } from '@/components/vendors/VendorDeliveryOrders';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';

function formatDateTitle(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const { date } = await params;
  return { title: `My Delivery • ${formatDateTitle(date)}` };
}

export default async function VendorDeliveryPage({
    params
}: {
    params: Promise<{ date: string }>
}) {
    const session = await getSession();
    if (!session || session.role !== 'vendor') {
        redirect('/login');
    }

    // Vendor can only see their own orders
    const vendorId = session.userId;
    const { date } = await params;

    return (
        <VendorDeliveryOrders
            vendorId={vendorId}
            deliveryDate={date}
            isVendorView={true}
        />
    );
}
