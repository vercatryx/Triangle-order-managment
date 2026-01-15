import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email';
import { AppSettings } from '@/lib/types';

/**
 * DEBUG EMAIL ENDPOINT
 * 
 * Usage: Visit /api/debug-email
 * Purpose: diagnose configuration and delivery issues.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const report = {
        timestamp: new Date().toISOString(),
        env: {
            SMTP_HOST: process.env.SMTP_HOST || '(not set)',
            SMTP_PORT: process.env.SMTP_PORT || '(not set)',
            SMTP_SECURE: process.env.SMTP_SECURE || '(not set)',
            SMTP_USER: process.env.SMTP_USER || '(not set)',
            SMTP_PASS_SET: !!process.env.SMTP_PASS,
            GMAIL_BACKUP_USER: process.env.GMAIL_BACKUP_USER || '(not set)',
            GMAIL_BACKUP_PASS_SET: !!process.env.GMAIL_BACKUP_PASS,
            CRON_SECRET_SET_ON_SERVER: !!process.env.CRON_SECRET,
            SUPABASE_SERVICE_ROLE_KEY_SET: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
        },
        databaseSettings: {} as any,
        testSend: {
            attemptedRecipient: '',
            result: {} as any
        }
    };

    try {
        // 1. Fetch DB Settings
        const { data: settingsData, error: settingsError } = await supabase.from('app_settings').select('*').single();
        if (settingsError) {
            report.databaseSettings = { error: settingsError.message };
        } else {
            report.databaseSettings = settingsData;
        }

        const settings = settingsData as any; // Cast to any to access snake_case properties
        const recipient = settings?.report_email || 'admin@example.com';
        report.testSend.attemptedRecipient = recipient;

        // 2. Attempt Send
        console.log(`[Debug Email] Attempting to send to ${recipient}...`);
        const result = await sendEmail({
            to: recipient,
            subject: `Debug Email Test - ${new Date().toISOString()}`,
            html: `
                <h1>Debug Verification Email</h1>
                <p>This is a test email triggered from <code>/api/debug-email</code>.</p>
                <h3>Configuration Snapshot:</h3>
                <ul>
                    <li><strong>Report Email (DB):</strong> ${recipient}</li>
                    <li><strong>Main SMTP Host:</strong> ${report.env.SMTP_HOST}</li>
                    <li><strong>Gmail Backup User:</strong> ${report.env.GMAIL_BACKUP_USER}</li>
                </ul>
            `
        });

        report.testSend.result = result;

        return NextResponse.json(report, { status: 200 });

    } catch (error: any) {
        return NextResponse.json({
            ...report,
            criticalError: error.message,
            stack: error.stack
        }, { status: 500 });
    }
}
