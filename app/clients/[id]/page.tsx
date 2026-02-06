import { ClientProfileDetail } from '@/components/clients/ClientProfile';
import { getSession } from '@/lib/session';
import { getClient } from '@/lib/actions-read';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const client = await getClient(id);
  return { title: client?.fullName ? `${client.fullName} — Profile` : 'Client Profile' };
}

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();

    console.log('Server Page Debug: Session:', session); // Server-side log

    return (
        <ClientProfileDetail
            clientId={id}
            currentUser={session ? { role: session.role, id: session.userId } : null}
        />
    );
}
