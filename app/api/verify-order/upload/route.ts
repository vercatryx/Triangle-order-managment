
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { uploadFile } from '@/lib/storage';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const getAdminClient = () => {
    if (!supabaseServiceKey) {
        console.error("SUPABASE_SERVICE_ROLE_KEY is missing. Falling back to anon key.");
        return createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    }
    return createClient(supabaseUrl, supabaseServiceKey);
};

export async function POST(req: NextRequest) {
    console.log('[API] /api/verify-order/upload called');

    try {
        const formData = await req.formData();
        const token = formData.get('token') as string;
        const file = formData.get('file') as File;

        if (!token || !file) {
            return NextResponse.json({ error: 'Missing token or file' }, { status: 400 });
        }

        console.log(`[API] Uploading PDF for token: ${token}, size: ${file.size} bytes`);

        const buffer = Buffer.from(await file.arrayBuffer());
        const timestamp = new Date().getTime();
        const filename = `signed-order-${timestamp}.pdf`;

        const { success, key } = await uploadFile(filename, buffer, 'application/pdf');

        if (!success) {
            console.error('[API] Upload to R2 failed');
            return NextResponse.json({ error: 'PDF upload failed' }, { status: 500 });
        }

        console.log(`[API] Upload successful, key: ${key}. Updating Supabase...`);

        const supabase = getAdminClient();
        const { error } = await supabase
            .from('form_submissions')
            .update({ pdf_url: key })
            .eq('token', token);

        if (error) {
            console.error('[API] Supabase update failed:', error);
            throw error;
        }

        return NextResponse.json({ success: true, pdfUrl: key });

    } catch (error: any) {
        console.error('[API] Error processing upload:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
