import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase';
import { sendSchedulingReport } from '@/lib/email-report';
import * as XLSX from 'xlsx';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const {
            weekStart,
            weekEnd,
            totalCreated = 0,
            breakdown = { Food: 0, Meal: 0, Boxes: 0, Custom: 0 },
            creationId,
            excelRows = [],
            failures = [],
            vendorBreakdown = [],
            diagnostics: diagnosticsInput = []
        } = body;

        const { data: settings } = await supabase.from('app_settings').select('report_email').single();
        const reportEmail = (settings as any)?.report_email?.trim() || '';
        if (!reportEmail) {
            return NextResponse.json({ success: false, error: 'No report_email configured in settings.' }, { status: 400 });
        }

        const orderCreationDate = weekStart && weekEnd ? `Next week: ${weekStart} to ${weekEnd}` : undefined;
        const unexpectedFailures = Array.isArray(failures)
            ? failures.map((f: any) => ({
                clientName: f.clientName ?? 'Unknown',
                orderType: f.orderType ?? '-',
                date: f.date ?? '-',
                reason: f.reason ?? String(f)
            }))
            : [];

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(
            excelRows.length ? excelRows : [{ 'Client ID': '-', 'Client Name': '-', 'Orders Created': 0, 'Vendor(s)': '-', 'Type(s)': '-', 'Reason (if no orders)': 'No clients in batch' }]
        );
        ws['!cols'] = [{ wch: 15 }, { wch: 30 }, { wch: 15 }, { wch: 35 }, { wch: 25 }, { wch: 45 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Next Week Report');
        const mainBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const attachments: { filename: string; content: Buffer; contentType: string }[] = [
            {
                filename: `Create_Orders_Next_Week_${weekStart || 'week'}_to_${weekEnd || 'week'}.xlsx`,
                content: mainBuffer,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            }
        ];

        if (unexpectedFailures.length > 0) {
            const failureRows = unexpectedFailures.map(f => ({
                'Customer Name': f.clientName,
                'Order Type': f.orderType,
                'Date': f.date,
                'Why Failed': f.reason
            }));
            const wbFailures = XLSX.utils.book_new();
            const wsFailures = XLSX.utils.json_to_sheet(failureRows);
            wsFailures['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 60 }];
            XLSX.utils.book_append_sheet(wbFailures, wsFailures, 'Failed Creations');
            const failBuffer = XLSX.write(wbFailures, { type: 'buffer', bookType: 'xlsx' });
            attachments.push({
                filename: `Create_Orders_Next_Week_Failed_${weekStart || 'week'}_to_${weekEnd || 'week'}.xlsx`,
                content: failBuffer,
                contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            });
        }

        const diagnosticsList = Array.isArray(diagnosticsInput) ? diagnosticsInput : [];
        const createdList = diagnosticsList.filter((d: any) => d.outcome === 'created');
        const diagnosticsPayload = {
            summary: {
                totalDecisions: diagnosticsList.length,
                created: createdList.length,
                skipped: diagnosticsList.filter((d: any) => d.outcome === 'skipped').length,
                failed: diagnosticsList.filter((d: any) => d.outcome === 'failed').length,
                reportTotalCreated: totalCreated,
                note: 'Outcome meaning: "created" = order was successfully saved in the DB (has orderId). "skipped" = not created (e.g. already exists). "failed" = not created (see reason). Only "created" counts as a real order.'
            },
            decisions: diagnosticsList,
            createdOrderIds: createdList.map((d: any) => ({ orderId: d.orderId, clientName: d.clientName, vendorName: d.vendorName, date: d.date, orderType: d.orderType }))
        };
        attachments.push({
            filename: `Create_Orders_Next_Week_Diagnostics_${weekStart || 'week'}_to_${weekEnd || 'week'}.json`,
            content: Buffer.from(JSON.stringify(diagnosticsPayload, null, 2), 'utf-8'),
            contentType: 'application/json'
        });

        const reportPayload = {
            totalCreated,
            breakdown,
            unexpectedFailures,
            creationId,
            orderCreationDate,
            orderCreationDay: '',
            vendorBreakdown: Array.isArray(vendorBreakdown) ? vendorBreakdown : []
        };
        await sendSchedulingReport(reportPayload, reportEmail, attachments);

        return NextResponse.json({
            success: true,
            reportEmail,
            attachmentsSent: attachments.length
        });
    } catch (error: any) {
        console.error('[Send batched report] Error:', error);
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to send report email' },
            { status: 500 }
        );
    }
}
