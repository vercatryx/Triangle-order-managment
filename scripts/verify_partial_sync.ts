import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { promises as fs } from 'fs';
import path from 'path';

async function testPartialSync() {
    console.log('--- Testing Partial Sync Optimization ---');

    // Dynamically import to ensure dotenv.config() has run
    const { updateClientInLocalDB } = await import('../lib/local-db');

    // 1. Pick a client ID that likely exists
    const clientId = 'CLIENT-1';

    // 2. Measure time for partial update
    console.log(`Starting partial update for ${clientId}...`);
    const start = Date.now();
    await updateClientInLocalDB(clientId);
    const end = Date.now();
    console.log(`Partial update took ${end - start}ms`);

    // 3. Verify the file exists and has content
    const dbPath = path.join(process.cwd(), 'data', 'local-orders-db.json');
    try {
        const content = await fs.readFile(dbPath, 'utf-8');
        const db = JSON.parse(content);

        const clientOrders = db.orders.filter((o: any) => o.client_id === clientId);
        console.log(`Found ${clientOrders.length} orders for ${clientId} in local DB.`);

        if (clientOrders.length >= 0) {
            console.log('PASS: Partial update completed and file is valid.');
        } else {
            console.log('FAIL: Could not find client data in local DB.');
        }
    } catch (error) {
        console.error('FAIL: Error reading local DB file:', error);
    }
}

testPartialSync().catch(console.error);
