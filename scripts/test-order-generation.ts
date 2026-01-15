import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function testOrderGeneration() {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
        console.error('❌ CRON_SECRET is missing from environment');
        return;
    }

    console.log('🚀 Triggering Unified Scheduling API...');
    try {
        const response = await fetch('http://localhost:3000/api/simulate-delivery-cycle', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${secret}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`Status Code: ${response.status} ${response.statusText}`);

        const text = await response.text();
        try {
            const data = JSON.parse(text);
            console.log('Response Body:', JSON.stringify(data, null, 2));
        } catch (e) {
            console.log('Response Body (Text):', text);
        }

    } catch (error) {
        console.error('❌ Network Error:', error);
    }
}

testOrderGeneration();
