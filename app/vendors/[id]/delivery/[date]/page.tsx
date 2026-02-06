import { VendorDeliveryOrders } from '@/components/vendors/VendorDeliveryOrders';
import { getVendor } from '@/lib/actions-read';
import type { Metadata } from 'next';

function formatDeliveryTitle(dateStr: string, vendorName?: string | null): string {
  try {
    const d = new Date(dateStr);
    const formatted = isNaN(d.getTime()) ? dateStr : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    return vendorName ? `Delivery ${formatted} — ${vendorName}` : `Delivery ${formatted}`;
  } catch {
    return `Delivery ${dateStr}`;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string; date: string }> }): Promise<Metadata> {
  const { id, date } = await params;
  const vendor = await getVendor(id);
  return { title: formatDeliveryTitle(date, vendor?.name) };
}

export default async function VendorDeliveryOrdersPage({ 
    params 
}: { 
    params: Promise<{ id: string; date: string }> 
}) {
    const { id, date } = await params;
    return <VendorDeliveryOrders vendorId={id} deliveryDate={date} />;
}

