import { BillingDetail } from '@/components/clients/BillingDetail';
import { getClient } from '@/lib/actions-read';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const client = await getClient(id);
  return { title: client?.fullName ? `Billing — ${client.fullName}` : 'Client Billing' };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BillingDetail clientId={id} />;
}
