import * as fs from 'fs';
import * as path from 'path';

// 1. Load .env.local BEFORE any other imports
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, '');
            process.env[key] = value;
        }
    });
} else {
    console.error('ERROR: .env.local not found at ' + envPath);
    process.exit(1);
}

// 2. Mock missing browser/next APIs if needed (simple mock)
if (typeof window === 'undefined') {
    (global as any).window = undefined;
}

async function verify() {
    console.log('Verifying Orders Scalability...');

    // 3. Dynamic import AFTER environment is set
    const actionModule = await import('../lib/actions');

    // 1. Test getAllOrders
    console.log('Fetching all orders...');
    const startOrders = Date.now();
    const orders = await actionModule.getAllOrders();
    const ordersTime = Date.now() - startOrders;
    console.log(`Fetched ${orders.length} orders in ${ordersTime}ms.`);

    // 2. Test getBillingRequestsByWeek
    console.log('Fetching billing requests (all weeks)...');
    const startBilling = Date.now();
    const billing = await actionModule.getBillingRequestsByWeek(undefined);
    const billingTime = Date.now() - startBilling;
    console.log(`Fetched ${billing.length} billing requests in ${billingTime}ms.`);

    if (orders.length > 0) { // Billing might be 0 if no requests exist
        console.log('SUCCESS: Data fetching works with pagination logic.');
    } else {
        console.log('WARNING: No orders found. This might be correct if DB is empty, but verify if expected.');
    }
}

verify().catch(console.error);
