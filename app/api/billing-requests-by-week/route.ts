import { NextRequest, NextResponse } from 'next/server';
import { getBillingRequestsByWeek } from '@/lib/actions';
import { getDependentsByParentId } from '@/lib/actions';

/** Format dependents for API response */
function formatDependents(dependents: { fullName?: string | null; dob?: string | null; cin?: string | null }[]) {
    return dependents.map((dep) => {
        let birthday = '';
        if (dep.dob) {
            try {
                const dobDate = new Date(dep.dob);
                const month = String(dobDate.getMonth() + 1).padStart(2, '0');
                const day = String(dobDate.getDate()).padStart(2, '0');
                const year = dobDate.getFullYear();
                birthday = `${month}/${day}/${year}`;
            } catch {
                birthday = dep.dob;
            }
        }
        return {
            name: dep.fullName || '',
            Birthday: birthday,
            CIN: dep.cin || ''
        };
    });
}

export async function GET(request: NextRequest) {
    try {
        // Get all billing requests (no date filter)
        const { requests: allBillingRequests } = await getBillingRequestsByWeek();

        // --- Standard (food/meal/boxes) requests: combined per client+week ---
        // Only include requests that have standard orders, are ready for billing, and not yet completed
        const standardRequests = allBillingRequests.filter(req => {
            const hasStandard = (req.orders?.length ?? 0) > 0;
            return hasStandard &&
                   req.readyForBilling &&
                   req.billingStatus !== 'success' &&
                   req.billingStatus !== 'failed';
        });

        const billingRequests = await Promise.all(
            standardRequests.map(async (req) => {
                const dependents = await getDependentsByParentId(req.clientId);
                const formattedDependents = formatDependents(dependents);

                const proofURLs: string[] = [];
                const orderIds: string[] = [];
                let caseId: string | null = null;

                // Only standard orders (no equipment)
                for (const order of req.orders ?? []) {
                    orderIds.push(order.id);
                    if (!caseId && order.case_id) caseId = order.case_id;
                    if (order.proof_of_delivery_image && !proofURLs.includes(order.proof_of_delivery_image)) {
                        proofURLs.push(order.proof_of_delivery_image);
                    }
                    if (order.delivery_proof_url && !proofURLs.includes(order.delivery_proof_url)) {
                        proofURLs.push(order.delivery_proof_url);
                    }
                }

                const weekStartDateStr = req.weekStart ? req.weekStart.split('T')[0] : '';
                // Amount is only from standard orders (exclude equipment)
                const standardAmount = (req.orders ?? []).reduce((sum: number, o: any) => sum + (o.amount ?? o.total_value ?? 0), 0);

                return {
                    name: req.clientName || 'Unknown',
                    url: caseId || '',
                    date: weekStartDateStr,
                    amount: standardAmount,
                    proofURL: proofURLs,
                    dependants: formattedDependents,
                    orderIds
                };
            })
        );

        // --- Equipment requests: one entry per equipment order (each billed for itself, separate tab) ---
        const equipmentBillingRequests: any[] = [];
        for (const req of allBillingRequests) {
            const equipmentOrders = req.equipmentOrders ?? [];
            if (equipmentOrders.length === 0) continue;
            // Only include equipment that is ready for billing and not yet completed
            if (!req.equipmentReadyForBilling || req.equipmentBillingStatus === 'success' || req.equipmentBillingStatus === 'failed') {
                continue;
            }

            const dependents = await getDependentsByParentId(req.clientId);
            const formattedDependents = formatDependents(dependents);

            // One API entry per equipment order (do not combine)
            for (const order of equipmentOrders) {
                const proofURLs: string[] = [];
                if (order.proof_of_delivery_image) proofURLs.push(order.proof_of_delivery_image);
                if (order.delivery_proof_url && !proofURLs.includes(order.delivery_proof_url)) {
                    proofURLs.push(order.delivery_proof_url);
                }
                const weekStartDateStr = req.weekStart ? req.weekStart.split('T')[0] : '';
                const amount = order.amount ?? order.total_value ?? 0;

                equipmentBillingRequests.push({
                    name: req.clientName || 'Unknown',
                    url: order.case_id || '',
                    date: weekStartDateStr,
                    amount: Number(amount),
                    proofURL: proofURLs,
                    dependants: formattedDependents,
                    orderIds: [order.id]
                });
            }
        }

        return NextResponse.json({
            billingRequests,
            equipmentBillingRequests
        });

    } catch (error: any) {
        console.error('Error in billing-requests-by-week API:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal Server Error'
        }, { status: 500 });
    }
}
