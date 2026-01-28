import { getClient, getOrderHistory } from '@/lib/actions-read';
import ClientOrderHistoryTable from '@/components/clients/ClientOrderHistoryTable';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default async function ClientHistoryPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const [client, orderHistory] = await Promise.all([
        getClient(id),
        getOrderHistory(id)
    ]);

    if (!client) {
        return (
            <div className="p-8 text-center text-gray-500">
                <h1 className="text-xl font-bold mb-2">Client Not Found</h1>
                <p>The client with ID {id} could not be found.</p>
                <Link href="/clients" className="text-blue-600 hover:underline mt-4 inline-block">
                    Return to Clients
                </Link>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto p-6">
            <div className="mb-6 flex items-center gap-4">
                <Link
                    href={`/clients/${id}`}
                    className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
                >
                    <ArrowLeft size={20} />
                    <span>Back to Profile</span>
                </Link>
                <div className="h-6 w-px bg-gray-300"></div>
                <h1 className="text-2xl font-bold text-gray-900">
                    Order History: {client.fullName}
                </h1>
            </div>

            <div className="mb-8">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                    <p className="text-blue-800 text-sm">
                        This page displays the full audit log of order changes and snapshots for this client.
                        Each entry represents a save action on the client's profile that affected order configuration.
                    </p>
                </div>

                <ClientOrderHistoryTable history={orderHistory || []} />
            </div>
        </div>
    );
}
