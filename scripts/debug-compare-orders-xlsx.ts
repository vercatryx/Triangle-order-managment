/**
 * Debug script: compare order counts between:
 * - debug/current .xlsx (all orders for next week)
 * - debug/Rise Wellness (only Monsey)_orders_Feb_9,_2026 (1).xlsx
 * - debug/Rise Wellness (only Monsey)_orders_Feb_11,_2026.xlsx
 *
 * Helps diagnose if Create Orders Next Week is limiting Food orders incorrectly.
 */
import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const debugDir = path.resolve(process.cwd(), 'debug');

function readXlsxSheet(filePath: string): { headers: string[]; rows: Record<string, any>[] } | null {
    if (!fs.existsSync(filePath)) {
        console.error('File not found:', filePath);
        return null;
    }
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { header: 1 }) as any[][];
    if (!data || data.length === 0) return { headers: [], rows: [] };
    const headers = data[0] as string[];
    const rows = data.slice(1).map((row) => {
        const obj: Record<string, any> = {};
        headers.forEach((h, i) => { obj[h] = row[i]; });
        return obj;
    });
    return { headers, rows };
}

function main() {
    console.log('='.repeat(70));
    console.log('Compare order counts: current vs Rise Wellness day-specific files');
    console.log('='.repeat(70));

    const currentPath = path.join(debugDir, 'current .xlsx');
    const feb9Path = path.join(debugDir, 'Rise Wellness (only Monsey)_orders_Feb_9,_2026 (1).xlsx');
    const feb11Path = path.join(debugDir, 'Rise Wellness (only Monsey)_orders_Feb_11,_2026.xlsx');

    const current = readXlsxSheet(currentPath);
    const feb9 = readXlsxSheet(feb9Path);
    const feb11 = readXlsxSheet(feb11Path);

    if (!current || !feb9 || !feb11) {
        console.error('Could not read one or more files.');
        process.exit(1);
    }

    console.log('\n--- File structures ---');
    console.log('current.xlsx - Headers:', current.headers);
    console.log('current.xlsx - Row count:', current.rows.length);
    console.log('\nfeb9 - Headers:', feb9.headers);
    console.log('feb9 - Row count:', feb9.rows.length);
    console.log('\nfeb11 - Headers:', feb11.headers);
    console.log('feb11 - Row count:', feb11.rows.length);

    // Extract client identifiers - try common column names
    const getClientId = (row: Record<string, any>) => {
        const key = Object.keys(row || {}).find(k => /^Client ID$/i.test(k));
        return key ? String(row[key] || '').trim() : null;
    };
    const getClientName = (row: Record<string, any>) => {
        const key = Object.keys(row || {}).find(k => /^Client Name$/i.test(k));
        return key ? String(row[key] || '').trim() : null;
    };

    const currentClients = new Set<string>();
    current.rows.forEach(r => {
        const id = getClientId(r);
        const name = getClientName(r);
        if (id) currentClients.add(id);
        else if (name) currentClients.add(name);
    });

    const feb9Clients = new Set<string>();
    feb9.rows.forEach(r => {
        const id = getClientId(r);
        const name = getClientName(r);
        if (id) feb9Clients.add(id);
        else if (name) feb9Clients.add(name);
    });

    const feb11Clients = new Set<string>();
    feb11.rows.forEach(r => {
        const id = getClientId(r);
        const name = getClientName(r);
        if (id) feb11Clients.add(id);
        else if (name) feb11Clients.add(name);
    });

    console.log('\n--- Unique clients per file ---');
    console.log('current: unique clients ~', currentClients.size, '(by ID/name)');
    console.log('feb9 (Rise Wellness): unique clients ~', feb9Clients.size);
    console.log('feb11 (Rise Wellness): unique clients ~', feb11Clients.size);

    const combinedRiseWellness = new Set([...feb9Clients, ...feb11Clients]);
    const inRiseNotInCurrent = [...combinedRiseWellness].filter(c => !currentClients.has(c));
    const inCurrentNotInRise = [...currentClients].filter(c => !combinedRiseWellness.has(c));

    console.log('\n--- Overlap ---');
    console.log('Combined Rise Wellness (Feb9+Feb11) unique clients:', combinedRiseWellness.size);
    console.log('In Rise Wellness files but NOT in current:', inRiseNotInCurrent.length);
    if (inRiseNotInCurrent.length > 0 && inRiseNotInCurrent.length <= 20) {
        console.log('  ', inRiseNotInCurrent.join(', '));
    } else if (inRiseNotInCurrent.length > 20) {
        console.log('  (first 20):', inRiseNotInCurrent.slice(0, 20).join(', '));
    }

    // Total order rows (each row may be an order)
    console.log('\n--- Total rows (order lines) ---');
    console.log('current total rows:', current.rows.length);
    console.log('feb9 total rows:', feb9.rows.length);
    console.log('feb11 total rows:', feb11.rows.length);
    console.log('feb9 + feb11 total rows:', feb9.rows.length + feb11.rows.length);

    // Sample rows to understand structure
    console.log('\n--- Sample row from current ---');
    if (current.rows.length > 0) {
        console.log(JSON.stringify(current.rows[0], null, 2));
    }
    console.log('\n--- Sample row from feb9 ---');
    if (feb9.rows.length > 0) {
        console.log(JSON.stringify(feb9.rows[0], null, 2));
    }

    // Check: does current have one order per client or multiple (per day)?
    const clientToDates = new Map<string, Set<string>>();
    current.rows.forEach((r: Record<string, any>) => {
        const cid = getClientId(r);
        const dateKey = Object.keys(r || {}).find(k => /Scheduled Delivery Date/i.test(k));
        const date = dateKey ? String(r[dateKey] || '').trim() : '';
        if (cid) {
            if (!clientToDates.has(cid)) clientToDates.set(cid, new Set());
            clientToDates.get(cid)!.add(date);
        }
    });
    const clientsWithMultipleDays = [...clientToDates.entries()].filter(([, dates]) => dates.size > 1);
    console.log('\n--- One-per-client check ---');
    console.log('Clients in current with orders on multiple days:', clientsWithMultipleDays.length);
    if (clientsWithMultipleDays.length > 0 && clientsWithMultipleDays.length <= 5) {
        clientsWithMultipleDays.forEach(([cid, dates]) => console.log(`  ${cid}: ${[...dates].join(', ')}`));
    }

    // Delivery dates in current
    const datesInCurrent = new Set<string>();
    current.rows.forEach((r: Record<string, any>) => {
        const dateKey = Object.keys(r || {}).find(k => /Scheduled Delivery Date/i.test(k));
        const date = dateKey ? String(r[dateKey] || '').trim() : '';
        if (date) datesInCurrent.add(date);
    });
    console.log('\n--- Delivery dates in current ---');
    console.log('Dates:', [...datesInCurrent].sort().join(', '));

    console.log('\nDone.');
}

main();
