import { NextRequest, NextResponse } from 'next/server';
import { getBillingRequestsByWeek } from '@/lib/actions';
import { getDependentsByParentId } from '@/lib/actions';

export async function GET(request: NextRequest) {
    try {
        // Get all billing requests (no date filter)
        const allBillingRequests = await getBillingRequestsByWeek();

        // Filter to only include requests that are ready for billing (all orders have proof)
        const billingRequests = allBillingRequests.filter(req => req.readyForBilling);

        // Format the response
        const formattedRequests = await Promise.all(
            billingRequests.map(async (req) => {
                // Get dependents for this client
                const dependents = await getDependentsByParentId(req.clientId);

                // Format dependents
                const formattedDependents = dependents.map((dep) => {
                    // Format birthday from ISO date (YYYY-MM-DD) to MM/DD/YYYY
                    let birthday = '';
                    if (dep.dob) {
                        try {
                            const dobDate = new Date(dep.dob);
                            const month = String(dobDate.getMonth() + 1).padStart(2, '0');
                            const day = String(dobDate.getDate()).padStart(2, '0');
                            const year = dobDate.getFullYear();
                            birthday = `${month}/${day}/${year}`;
                        } catch (e) {
                            birthday = dep.dob;
                        }
                    }

                    return {
                        name: dep.fullName || '',
                        Birthday: birthday,
                        CIN: dep.cin || ''
                    };
                });

                // Collect all proof URLs from orders (remove duplicates and nulls)
                const proofURLs: string[] = [];
                const orderIds: string[] = [];
                let caseId: string | null = null;

                for (const order of req.orders) {
                    orderIds.push(order.id);
                    
                    // Get case_id from first order that has one
                    if (!caseId && order.case_id) {
                        caseId = order.case_id;
                    }

                    // Collect proof URLs
                    if (order.proof_of_delivery_image) {
                        if (!proofURLs.includes(order.proof_of_delivery_image)) {
                            proofURLs.push(order.proof_of_delivery_image);
                        }
                    }
                    if (order.delivery_proof_url) {
                        if (!proofURLs.includes(order.delivery_proof_url)) {
                            proofURLs.push(order.delivery_proof_url);
                        }
                    }
                }

                // Get the week start date from the request
                const weekStartDateStr = req.weekStart ? req.weekStart.split('T')[0] : ''; // YYYY-MM-DD format

                return {
                    name: req.clientName || 'Unknown',
                    url: caseId || '',
                    date: weekStartDateStr, // First date of the week (Sunday) in YYYY-MM-DD format
                    amount: req.totalAmount,
                    proofURL: proofURLs,
                    dependants: formattedDependents,
                    orderIds: orderIds
                };
            })
        );

        return NextResponse.json(formattedRequests);

    } catch (error: any) {
        console.error('Error in billing-requests-by-week API:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Internal Server Error'
        }, { status: 500 });
    }
}
