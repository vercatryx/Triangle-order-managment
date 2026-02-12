import { ClientProfileDetail } from '@/components/clients/ClientProfile';
import { getSession } from '@/lib/session';
import { getClient } from '@/lib/actions-read';
import { getVendors, getStatuses, getNavigators, getMenuItems, getBoxTypes, getSettings, getCategories, getMealCategories, getMealItems, getEquipment } from '@/lib/actions';
import { getRegularClients, getClientsLight } from '@/lib/actions';
import type { Metadata } from 'next';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const client = await getClient(id);
  return { title: client?.fullName ? `${client.fullName} — Profile` : 'Client Profile' };
}

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getSession();

    // Pre-fetch all lookup data on the server so vendors (and other dropdowns) are available
    // immediately when the client profile opens — fixes "no vendor showing" when creating orders
    const [statuses, navigators, vendors, menuItems, boxTypes, settings, categories, mealCategories, mealItems, equipment, allClients, regularClients] = await Promise.all([
        getStatuses(),
        getNavigators(),
        getVendors(),
        getMenuItems(),
        getBoxTypes(),
        getSettings(),
        getCategories(),
        getMealCategories(),
        getMealItems(),
        getEquipment(),
        getClientsLight(),
        getRegularClients()
    ]);

    return (
        <ClientProfileDetail
            clientId={id}
            statuses={statuses}
            navigators={navigators}
            vendors={vendors}
            menuItems={menuItems}
            boxTypes={boxTypes}
            settings={settings}
            categories={categories}
            mealCategories={mealCategories}
            mealItems={mealItems}
            equipment={equipment}
            allClients={allClients}
            regularClients={regularClients}
            currentUser={session ? { role: session.role, id: session.userId } : null}
        />
    );
}
