
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Import storage AFTER loading env vars
import { uploadFile } from '../lib/storage';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const r2Domain = process.env.NEXT_PUBLIC_R2_DOMAIN;
const r2Bucket = process.env.R2_BUCKET_NAME;

if (!supabaseServiceKey || !r2Domain || !r2Bucket) {
    console.error('Missing env vars:');
    console.log(`SUPABASE_KEY: ${!!supabaseServiceKey}`);
    console.log(`R2_DOMAIN: ${!!r2Domain}`);
    console.log(`R2_BUCKET: ${!!r2Bucket}`);
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function runTest() {
    console.log('--- STARTING UPLOAD SIMULATION ---');

    // 1. Create a dummy PDF buffer
    const pdfContent = 'Dummy PDF Content for Verification';
    const buffer = Buffer.from(pdfContent);
    const timestamp = new Date().getTime();
    const filename = `test-upload-${timestamp}.pdf`;

    // 2. Upload to R2 (using lib/storage)
    console.log(`\nUploading ${filename} to R2...`);
    try {
        const { success, key } = await uploadFile(filename, buffer, 'text/plain'); // using text/plain for simple test
        if (!success) throw new Error('Upload failed');
        console.log(`Upload success. Key: ${key}`);

        // 3. Construct URL
        const baseUrl = r2Domain!.replace(/\/$/, '');
        const fileUrl = baseUrl.startsWith('http')
            ? `${baseUrl}/${key}`
            : `https://${baseUrl}/${key}`;

        console.log(`\nGenerated URL: ${fileUrl}`);

        // 4. Verify URL Access
        console.log('Testing URL access...');
        const response = await fetch(fileUrl, { method: 'HEAD' });
        console.log(`Response Status: ${response.status}`);

        if (response.ok) {
            console.log('✅ URL is ACCESSIBLE');
        } else {
            console.error('❌ URL is NOT ACCESSIBLE');
        }

    } catch (error) {
        console.error('Test failed:', error);
    }
}

runTest();
