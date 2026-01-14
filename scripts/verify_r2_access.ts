
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const r2Domain = process.env.NEXT_PUBLIC_R2_DOMAIN;
const filename = 'signed-order-1768415188917.pdf'; // Use the filename from the previous check

console.log('--- R2 Configuration Verification ---');
console.log(`NEXT_PUBLIC_R2_DOMAIN: ${r2Domain}`);

if (!r2Domain) {
    console.error('ERROR: NEXT_PUBLIC_R2_DOMAIN is not set in .env.local');
    process.exit(1);
}

const url = r2Domain.startsWith('http')
    ? `${r2Domain}/${filename}`
    : `https://${r2Domain}/${filename}`;

console.log(`\nTesting access to: ${url}`);

async function checkUrl() {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        console.log(`Response Status: ${response.status} ${response.statusText}`);

        if (response.ok) {
            console.log('SUCCESS: File is accessible.');
            const contentLength = response.headers.get('content-length');
            console.log(`Content-Length: ${contentLength} bytes`);
        } else {
            console.error('FAILURE: File is not accessible.');
        }
    } catch (error) {
        console.error('ERROR: Network request failed:', error);
    }
}

checkUrl();
