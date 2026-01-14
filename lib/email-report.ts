import { sendEmail } from './email';

interface SimulationReport {
    totalCreated: number;
    breakdown: {
        Food: number;
        Meal: number;
        Boxes: number; // Changed to match plural convention usually used, but we check specific keys
        Custom: number;
    };
    unexpectedFailures: {
        clientName: string;
        orderType: string;
        date: string;
        reason: string;
    }[];
}

/**
 * Sends the mandatory email report after order scheduling runs.
 * 
 * @param report The collected report data
 * @param recipient The email address to send to
 */
export async function sendSchedulingReport(report: SimulationReport, recipient: string) {
    if (!recipient) {
        console.warn('No report email recipient defined. Skipping email.');
        return;
    }

    const { totalCreated, breakdown, unexpectedFailures } = report;

    const subject = `Order Scheduling Report - ${new Date().toLocaleDateString()}`;

    let html = `
    <h1>Order Scheduling Execution Report</h1>
    <p><strong>Date:</strong> ${new Date().toLocaleString()}</p>
    
    <h2>Summary</h2>
    <ul>
        <li><strong>Total Orders Created:</strong> ${totalCreated}</li>
        <li>Food Orders: ${breakdown.Food}</li>
        <li>Meal Orders: ${breakdown.Meal}</li>
        <li>Box Orders: ${breakdown.Boxes}</li>
        <li>Custom Orders: ${breakdown.Custom}</li>
    </ul>
    `;

    if (unexpectedFailures.length > 0) {
        html += `
        <h2 style="color: red;">Unexpected Failures (Action Required)</h2>
        <table border="1" style="border-collapse: collapse; width: 100%;">
            <thead>
                <tr style="background-color: #f8f9fa;">
                    <th style="padding: 8px;">Client</th>
                    <th style="padding: 8px;">Type</th>
                    <th style="padding: 8px;">Date</th>
                    <th style="padding: 8px;">Error / Reason</th>
                </tr>
            </thead>
            <tbody>
        `;

        for (const failure of unexpectedFailures) {
            html += `
            <tr>
                <td style="padding: 8px;">${failure.clientName}</td>
                <td style="padding: 8px;">${failure.orderType}</td>
                <td style="padding: 8px;">${failure.date}</td>
                <td style="padding: 8px; color: red;">${failure.reason}</td>
            </tr>
            `;
        }

        html += `</tbody></table>`;
    } else {
        html += `<p style="color: green;"><strong>No unexpected failures reported.</strong></p>`;
    }

    html += `
    <p style="font-size: 12px; color: #666; margin-top: 30px;">
        This report is generated automatically by the Unified Order Scheduling API.
    </p>
    `;

    try {
        await sendEmail({
            to: recipient,
            subject,
            html
        });
    } catch (error) {
        console.error('Failed to send scheduling report email:', error);
    }
}
