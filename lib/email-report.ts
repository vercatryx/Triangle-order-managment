import { sendEmail, EmailOptions } from './email';

export interface VendorBreakdownItem {
    vendorId: string;
    vendorName: string;
    byDay: Record<string, number>; // date string (YYYY-MM-DD) -> order count
    total: number;
}

/** Debug info for Create Orders Next Week: work-to-do and skipped counts (included in email body + JSON attachment). */
export interface CreateOrdersDebugInfo {
    clientCount: number;
    workToDo: { foodOrders: number; mealOrders: number; boxOrders: number; customOrders: number };
    skipped: { foodBlocking: number; foodNoData: number; mealBlocking: number };
}

/** Per-batch debug (for batched runs); array index = batchIndex. */
export interface CreateOrdersDebugBatchItem {
    batchIndex: number;
    debug: CreateOrdersDebugInfo;
}

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
    creationId?: number; // Optional creation_id for this batch
    orderCreationDate?: string; // Date used for order creation (from fake time)
    orderCreationDay?: string; // Day name used for order creation
    /** Orders per vendor per day (for admin report and vendor emails) */
    vendorBreakdown?: VendorBreakdownItem[];
    /** Debug: workToDo and skipped counts (shown in email + attached as JSON). */
    debug?: CreateOrdersDebugInfo;
    /** Per-batch debug (batched run); included in JSON attachment. */
    debugBatches?: CreateOrdersDebugBatchItem[];
}

/** Format a YYYY-MM-DD string as "Sunday, Feb 10" */
function formatDayLabel(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    const dayName = d.toLocaleDateString('en-US', { weekday: 'long' });
    const shortDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${dayName}, ${shortDate}`;
}

/**
 * Sends an email to a single vendor with their order count for next week, broken down by day.
 */
export async function sendVendorNextWeekSummary(
    vendorName: string,
    vendorEmail: string,
    weekStartStr: string,
    weekEndStr: string,
    byDay: Record<string, number>
) {
    if (!vendorEmail || !vendorEmail.trim()) {
        console.warn(`[Vendor email] No email for vendor "${vendorName}". Skipping.`);
        return;
    }
    const dates = Object.keys(byDay).sort();
    const total = dates.reduce((sum, d) => sum + (byDay[d] || 0), 0);
    if (total === 0) return;

    let rows = dates.map(d => `<tr><td style="padding: 8px;">${formatDayLabel(d)}</td><td style="padding: 8px;">${byDay[d]}</td></tr>`).join('');
    const subject = `Next week orders: ${total} order${total !== 1 ? 's' : ''} (${weekStartStr} – ${weekEndStr})`;
    const html = `
    <h1>Orders for next week</h1>
    <p>Hi${vendorName ? ` ${vendorName}` : ''},</p>
    <p>Here is your order count for the week <strong>${weekStartStr}</strong> to <strong>${weekEndStr}</strong>.</p>
    <table border="1" style="border-collapse: collapse;">
        <thead><tr style="background-color: #f0f0f0;"><th style="padding: 8px;">Day</th><th style="padding: 8px;">Orders</th></tr></thead>
        <tbody>${rows}</tbody>
    </table>
    <p><strong>Total: ${total} order${total !== 1 ? 's' : ''}</strong></p>
    <p style="font-size: 12px; color: #666;">This is an automated message from the Triangle Square ordering system.</p>
    `;
    const result = await sendEmail({ to: vendorEmail.trim(), subject, html });
    if (!result.success) {
        console.warn(`[Vendor email] Failed to send to ${vendorName}: ${result.error}`);
    }
}

/**
 * Sends the mandatory email report after order scheduling runs.
 * 
 * @param report The collected report data
 * @param recipient The email address(es) to send to (comma-separated for multiple addresses)
 */
export async function sendSchedulingReport(report: SimulationReport, recipient: string, attachments?: EmailOptions['attachments']) {
    if (!recipient) {
        console.warn('No report email recipient defined. Skipping email.');
        return;
    }

    // Normalize recipient: trim whitespace and remove empty entries
    const recipients = recipient
        .split(',')
        .map(email => email.trim())
        .filter(email => email.length > 0)
        .join(', ');

    if (!recipients) {
        console.warn('No valid report email recipients found. Skipping email.');
        return;
    }

    const { totalCreated, breakdown, unexpectedFailures, creationId, orderCreationDate, orderCreationDay, vendorBreakdown, debug: reportDebug, debugBatches } = report;

    const subject = `Order Scheduling Report - ${new Date().toLocaleDateString()}${creationId ? ` (Creation ID: ${creationId})` : ''}`;

    let html = `
    <h1>Order Scheduling Execution Report</h1>
    ${orderCreationDate ? `<p><strong>Date Used for Order Creation:</strong> ${orderCreationDate}${orderCreationDay ? ` (${orderCreationDay})` : ''}</p>` : `<p><strong>Report Generated:</strong> ${new Date().toLocaleString()}</p>`}
    ${creationId ? `<p><strong>Creation ID:</strong> ${creationId}</p>` : ''}
    
    <h2>Summary</h2>
    <ul>
        <li><strong>Total Orders Created:</strong> ${totalCreated}</li>
        <li>Food Orders: ${breakdown.Food}</li>
        <li>Meal Orders: ${breakdown.Meal}</li>
        <li>Box Orders: ${breakdown.Boxes}</li>
        <li>Custom Orders: ${breakdown.Custom}</li>
    </ul>
    `;

    if (breakdown.Meal === 0) {
        const mealWorkToDo = reportDebug?.workToDo?.mealOrders ?? '—';
        const mealBlocking = reportDebug?.skipped?.mealBlocking ?? '—';
        html += `
        <div style="border: 2px solid #c00; background: #fff5f5; padding: 12px; margin: 16px 0;">
        <h2 style="color: #c00; margin-top: 0;">⚠️ Meal orders – none created</h2>
        <p><strong>Meal orders created:</strong> 0</p>
        <p><strong>Meal work to do</strong> (from upcoming_order.mealSelections): ${mealWorkToDo}</p>
        <p><strong>Meal skipped (blocking):</strong> ${mealBlocking} — clients skipped by cleanup (inactive vendor or item). Fix on Cleanup page.</p>
        <p>If work to do is 0, clients have no <code>mealSelections</code> or wrong <code>serviceType</code>. If blocking &gt; 0, fix invalid vendors/items then re-run.</p>
        </div>
        `;
    }

    if (vendorBreakdown && vendorBreakdown.length > 0) {
        html += `<h2>Orders by vendor (next week, by day)</h2><table border="1" style="border-collapse: collapse; width: 100%;"><thead><tr style="background-color: #f8f9fa;"><th style="padding: 8px;">Vendor</th><th style="padding: 8px;">By day</th><th style="padding: 8px;">Total</th></tr></thead><tbody>`;
        for (const v of vendorBreakdown) {
            const dates = Object.keys(v.byDay).sort();
            const dayLines = dates.map(d => `${formatDayLabel(d)}: ${v.byDay[d]}`).join('<br/>');
            html += `<tr><td style="padding: 8px;">${v.vendorName || v.vendorId}</td><td style="padding: 8px;">${dayLines || '—'}</td><td style="padding: 8px;"><strong>${v.total}</strong></td></tr>`;
        }
        html += `</tbody></table>`;
    }

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

    if (reportDebug) {
        const d = reportDebug;
        const batchNote = debugBatches && debugBatches.length > 0 ? ` (aggregated from ${debugBatches.length} batch${debugBatches.length !== 1 ? 'es' : ''}; per-batch in attached JSON)` : '';
        html += `
        <h2>Debug (Create Orders Next Week)</h2>
        <p><strong>Clients in run${batchNote}:</strong> ${d.clientCount}</p>
        <p><strong>Work to do</strong> (orders derived from upcoming_order before creating): Food ${d.workToDo.foodOrders}, <strong>Meal ${d.workToDo.mealOrders}</strong>, Boxes ${d.workToDo.boxOrders}, Custom ${d.workToDo.customOrders}</p>
        <p><strong>Skipped:</strong> Food blocking ${d.skipped.foodBlocking}, Food no data ${d.skipped.foodNoData}, <strong>Meal blocking ${d.skipped.mealBlocking}</strong></p>
        <p style="font-size: 11px; color: #666;">Full debug JSON is attached to this email.</p>
        `;
    }

    html += `
    <p style="font-size: 12px; color: #666; margin-top: 30px;">
        This report is generated automatically by the Unified Order Scheduling API.
    </p>
    `;

    const result = await sendEmail({
        to: recipients,
        subject,
        html,
        attachments
    });

    if (!result.success) {
        throw new Error(`Email sending failed: ${result.error}`);
    }

    return { provider: result.provider };
}
