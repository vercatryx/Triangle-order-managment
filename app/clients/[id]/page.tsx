import { ClientProfileDetail } from '@/components/clients/ClientProfile';

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <ClientProfileDetail clientId={id} />;
}
