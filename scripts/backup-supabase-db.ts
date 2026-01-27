#!/usr/bin/env tsx

/**
 * Full Supabase Database Backup Script
 * 
 * This script creates a full backup of the Supabase database using:
 * 1. Supabase Management API to list existing backups
 * 2. pg_dump to create a complete database backup
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
function loadEnv() {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (fs.existsSync(envPath)) {
        const envConfig = readFileSync(envPath, 'utf-8');
        envConfig.split('\n').forEach(line => {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                const value = match[2].trim().replace(/^['"]|['"]$/g, '');
                process.env[key] = value;
            }
        });
    }
}

loadEnv();

// Configuration
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || 'sbp_e1f11c756e43c6afe00a7541d9516709a1c46fee';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mjqsmbrkdzumusiqweac.supabase.co';
const DATABASE_URL = process.env.DATABASE_URL || process.env.DATABASE_URL_REMOTE;

// Extract project reference from URL
const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || 'mjqsmbrkdzumusiqweac';

if (!PROJECT_REF) {
    console.error('❌ Could not extract project reference from Supabase URL');
    process.exit(1);
}

console.log('📦 Supabase Database Backup Script');
console.log('====================================');
console.log(`Project Reference: ${PROJECT_REF}`);
console.log(`Supabase URL: ${SUPABASE_URL}`);
console.log('');

// Create backups directory if it doesn't exist
const backupsDir = path.resolve(process.cwd(), 'backups');
if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
    console.log(`✅ Created backups directory: ${backupsDir}`);
}

/**
 * List existing backups via Supabase Management API
 */
async function listBackups() {
    console.log('📋 Listing existing backups via Supabase API...');
    try {
        const response = await fetch(
            `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/backups`,
            {
                headers: {
                    'Authorization': `Bearer ${SUPABASE_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ API Error (${response.status}): ${errorText}`);
            return null;
        }

        const backups = await response.json();
        console.log(`✅ Found ${backups.length || 0} existing backup(s)`);
        
        if (backups.length > 0) {
            console.log('\nRecent backups:');
            backups.slice(0, 5).forEach((backup: any, index: number) => {
                console.log(`  ${index + 1}. ${backup.id || 'Unknown'} - ${backup.status || 'Unknown status'}`);
            });
        }
        
        return backups;
    } catch (error) {
        console.error('❌ Error listing backups:', error);
        return null;
    }
}

/**
 * Create a full database backup using pg_dump
 */
async function createPgDumpBackup() {
    console.log('\n💾 Creating full database backup using pg_dump...');
    
    if (!DATABASE_URL) {
        console.error('❌ DATABASE_URL not found in environment variables');
        return null;
    }

    // Parse database URL to extract connection details
    // Format: postgresql://user:password@host:port/database?params
    const urlMatch = DATABASE_URL.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
    
    if (!urlMatch) {
        console.error('❌ Could not parse DATABASE_URL');
        return null;
    }

    const [, user, password, host, port, database] = urlMatch;
    
    // Create timestamp for backup filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                     new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
    const backupFilename = `supabase-backup-${PROJECT_REF}-${timestamp}.sql`;
    const backupPath = path.join(backupsDir, backupFilename);

    console.log(`📁 Backup file: ${backupPath}`);
    console.log(`🔗 Connecting to: ${host}:${port}/${database}`);

    try {
        // Use pg_dump with SSL required (Supabase requires SSL)
        // Set PGPASSWORD environment variable to avoid password prompt
        const env = { ...process.env, PGPASSWORD: password, PGSSLMODE: 'require' };
        
        console.log('⏳ Running pg_dump with SSL (this may take a while)...');
        console.log('   Note: Using direct database connection (not pooler)');
        
        // Use individual parameters to avoid shell interpretation issues with special characters
        const pgDumpCommand = `pg_dump -h ${host} -p ${port} -U ${user} -d ${database} --no-password -F c -f "${backupPath}.dump"`;
        
        execSync(pgDumpCommand, { 
            env,
            stdio: 'inherit',
            timeout: 3600000, // 1 hour timeout
        });

        // Also create a plain SQL backup
        console.log('⏳ Creating plain SQL backup...');
        const sqlDumpCommand = `pg_dump -h ${host} -p ${port} -U ${user} -d ${database} --no-password -F p -f "${backupPath}"`;
        execSync(sqlDumpCommand, { 
            env,
            stdio: 'inherit',
            timeout: 3600000, // 1 hour timeout
        });

        // Get file sizes
        const dumpStats = fs.statSync(`${backupPath}.dump`);
        const sqlStats = fs.statSync(backupPath);
        
        console.log('\n✅ Backup completed successfully!');
        console.log(`📦 Custom format backup: ${backupPath}.dump (${(dumpStats.size / 1024 / 1024).toFixed(2)} MB)`);
        console.log(`📄 SQL format backup: ${backupPath} (${(sqlStats.size / 1024 / 1024).toFixed(2)} MB)`);
        
        return {
            customFormat: `${backupPath}.dump`,
            sqlFormat: backupPath,
            timestamp: new Date().toISOString(),
        };
    } catch (error: any) {
        console.error('❌ Error creating backup:', error.message);
        
        // Check if it's a connection issue
        if (error.message.includes('timeout') || error.message.includes('refused')) {
            console.error('\n💡 Connection failed. This might be because:');
            console.error('   1. Direct database connections may be restricted by Supabase');
            console.error('   2. Your IP may need to be whitelisted in Supabase dashboard');
            console.error('   3. Try using Supabase CLI instead: supabase db dump');
            console.error('\n📝 Alternative: Use Supabase CLI:');
            console.error('   npx supabase db dump --project-ref ' + PROJECT_REF + ' --db-url "' + DATABASE_URL + '"');
        } else if (error.message.includes('pg_dump: command not found')) {
            console.error('\n💡 Tip: Install PostgreSQL client tools:');
            console.error('   macOS: brew install postgresql');
            console.error('   Ubuntu: sudo apt-get install postgresql-client');
        }
        
        return null;
    }
}

/**
 * Try using Supabase CLI for backup
 */
async function trySupabaseCliBackup() {
    console.log('\n🔄 Trying Supabase CLI method...');
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' + 
                     new Date().toISOString().split('T')[1].split('.')[0].replace(/:/g, '-');
    const backupFilename = `supabase-backup-${PROJECT_REF}-${timestamp}.sql`;
    const backupPath = path.join(backupsDir, backupFilename);
    
    try {
        // Try using Supabase CLI
        console.log('⏳ Attempting backup with Supabase CLI...');
        const cliCommand = `npx supabase db dump --project-ref ${PROJECT_REF} --db-url "${DATABASE_URL}" -f "${backupPath}"`;
        
        execSync(cliCommand, {
            stdio: 'inherit',
            env: { ...process.env, SUPABASE_ACCESS_TOKEN },
            timeout: 3600000,
        });
        
        const stats = fs.statSync(backupPath);
        console.log(`\n✅ CLI backup completed: ${backupPath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
        
        return {
            sqlFormat: backupPath,
            timestamp: new Date().toISOString(),
            method: 'Supabase CLI',
        };
    } catch (error: any) {
        if (error.message.includes('command not found') || error.message.includes('Cannot find module')) {
            console.log('⚠️  Supabase CLI not available');
        } else {
            console.log(`⚠️  Supabase CLI failed: ${error.message.split('\n')[0]}`);
        }
        return null;
    }
}

/**
 * Main backup function
 */
async function main() {
    try {
        // List existing backups
        const backups = await listBackups();
        
        // Try pg_dump first
        let backupResult = await createPgDumpBackup();
        
        // If pg_dump fails, try Supabase CLI
        if (!backupResult) {
            console.log('\n🔄 Direct connection failed. Trying alternative methods...');
            backupResult = await trySupabaseCliBackup();
        }
        
        if (backupResult) {
            console.log('\n🎉 Backup process completed successfully!');
            console.log('\n📝 Backup Summary:');
            console.log(`   Project: ${PROJECT_REF}`);
            console.log(`   Timestamp: ${backupResult.timestamp}`);
            if (backupResult.customFormat) {
                console.log(`   Custom Format: ${backupResult.customFormat}`);
            }
            console.log(`   SQL Format: ${backupResult.sqlFormat}`);
            if ((backupResult as any).method) {
                console.log(`   Method: ${(backupResult as any).method}`);
            }
        } else {
            console.error('\n❌ All backup methods failed');
            console.error('\n💡 Alternative Solutions:');
            console.error('   1. Use Supabase Dashboard to download backups');
            console.error('   2. Install Supabase CLI: npm install -g supabase');
            console.error('   3. Whitelist your IP in Supabase Dashboard > Settings > Database');
            console.error('   4. Use Supabase CLI command:');
            console.error(`      npx supabase db dump --project-ref ${PROJECT_REF} --db-url "${DATABASE_URL}"`);
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    }
}

// Run the backup
main();
