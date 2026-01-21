import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Load env
try {
    const envConfig = readFileSync('.env.local', 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const value = values.join('=').trim();
            process.env[key.trim()] = value.replace(/^["']|["']$/g, '');
        }
    });
} catch (e) {
    console.error('Error loading .env.local', e);
}

const API_URL = 'http://localhost:3000/api/public/vendors-today';

async function testApi() {
    console.log(`Testing API: ${API_URL}`);

    try {
        const response = await fetch(API_URL);
        console.log(`Response Status: ${response.status}`);

        if (response.ok) {
            const data = await response.json();
            console.log('API Response Data:', JSON.stringify(data, null, 2));
            console.log(`Found ${data.length} vendors.`);
        } else {
            const error = await response.text();
            console.error('API Error Response:', error);
        }
    } catch (err: any) {
        if (err.code === 'ECONNREFUSED') {
            console.warn('⚠️ Server is not running on localhost:3000. Skipping live request test.');
            console.log('To manually verify, start the server and run: curl http://localhost:3000/api/public/vendors-today');
        } else {
            console.error('Fetch Error:', err.message);
        }
    }
}

testApi();
