/**
 * Bidirectional sync between clients.active_order and upcoming_orders
 * Run with: npx tsx scripts/sync-orders-bidirectional.ts
 */

import { syncAllOrdersBidirectional } from '../lib/sync-orders-bidirectional';
import * as fs from 'fs';

async function main() {
    console.log('='.repeat(80));
    console.log('BIDIRECTIONAL ORDER SYNC');
    console.log('='.repeat(80));
    console.log();

    try {
        const results = await syncAllOrdersBidirectional();

        const summary = {
            total: results.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            active_order_to_upcoming: results.filter(r => r.direction === 'active_order_to_upcoming').length,
            upcoming_to_active_order: results.filter(r => r.direction === 'upcoming_to_active_order').length,
            already_synced: results.filter(r => r.direction === 'both').length
        };

        console.log();
        console.log('='.repeat(80));
        console.log('SYNC SUMMARY');
        console.log('='.repeat(80));
        console.log(`Total clients checked: ${summary.total}`);
        console.log(`Successful syncs: ${summary.successful}`);
        console.log(`Failed syncs: ${summary.failed}`);
        console.log(`Active Order → Upcoming Orders: ${summary.active_order_to_upcoming}`);
        console.log(`Upcoming Orders → Active Order: ${summary.upcoming_to_active_order}`);
        console.log(`Already synced (both exist): ${summary.already_synced}`);
        console.log();

        if (summary.failed > 0) {
            console.log('FAILED SYNCs:');
            results.filter(r => !r.success).forEach(r => {
                console.log(`  - ${r.clientName} (${r.clientId}): ${r.error}`);
            });
            console.log();
        }

        // Save results to file
        const output = {
            generated_at: new Date().toISOString(),
            summary,
            results: results.filter(r => !r.success || r.direction !== 'both')
        };

        const filename = `sync-orders-bidirectional-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(output, null, 2));
        console.log(`✅ Results saved to: ${filename}`);
    } catch (error: any) {
        console.error('Error during sync:', error);
        process.exit(1);
    }
}

main();
