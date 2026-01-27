# Supabase Database Backup Guide

This guide explains how to create full backups of your Supabase database using the API key.

## Current Status

✅ **Automatic Backups**: Supabase creates daily automatic backups (confirmed via API)
- Region: us-west-2
- Latest backup: 2026-01-26T08:30:58
- Status: COMPLETED

## Backup Methods

### Method 1: Using Supabase Management API (Recommended for Checking Backups)

The API script lists all available backups and project information:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_e1f11c756e43c6afe00a7541d9516709a1c46fee
export PROJECT_REF=mjqsmbrkdzumusiqweac
./scripts/backup-supabase-api.sh
```

**List all backups:**
```bash
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/database/backups"
```

**Get project information:**
```bash
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$PROJECT_REF"
```

### Method 2: Using Supabase CLI (Requires Docker)

If Docker is running, you can use the Supabase CLI:

```bash
# Install Supabase CLI (if not already installed)
npm install -g supabase

# Create backup
npx supabase db dump \
  --db-url "postgresql://postgres:triOrdering36\$@mjqsmbrkdzumusiqweac.supabase.co:5432/postgres?sslmode=require" \
  -f backups/backup.sql
```

**Note**: The Supabase CLI requires Docker Desktop to be running.

### Method 3: Using pg_dump Directly (Requires IP Whitelisting)

If your IP is whitelisted in Supabase Dashboard, you can use pg_dump directly:

```bash
# Set password as environment variable
export PGPASSWORD='triOrdering36$'

# Create custom format backup
pg_dump -h mjqsmbrkdzumusiqweac.supabase.co \
  -p 5432 \
  -U postgres \
  -d postgres \
  --no-password \
  -F c \
  -f backups/backup.dump

# Create SQL format backup
pg_dump -h mjqsmbrkdzumusiqweac.supabase.co \
  -p 5432 \
  -U postgres \
  -d postgres \
  --no-password \
  -F p \
  -f backups/backup.sql
```

**To whitelist your IP:**
1. Go to Supabase Dashboard
2. Navigate to Settings > Database
3. Add your IP address to the allowed IPs list

### Method 4: Using TypeScript Script

The TypeScript script tries multiple methods automatically:

```bash
export SUPABASE_ACCESS_TOKEN=sbp_e1f11c756e43c6afe00a7541d9516709a1c46fee
npx tsx scripts/backup-supabase-db.ts
```

## Restore from Backup

### Restore from PITR (Point-in-Time Recovery)

If PITR is enabled, you can restore to a specific point in time:

```bash
curl -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/backups/restore-pitr" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "recovery_time_target_unix": "1735689600"
  }'
```

Replace `1735689600` with your desired Unix timestamp.

### Restore from pg_dump backup

```bash
# Restore from custom format
pg_restore -h mjqsmbrkdzumusiqweac.supabase.co \
  -p 5432 \
  -U postgres \
  -d postgres \
  --no-password \
  -F c \
  backups/backup.dump

# Restore from SQL format
psql -h mjqsmbrkdzumusiqweac.supabase.co \
  -p 5432 \
  -U postgres \
  -d postgres \
  -f backups/backup.sql
```

## Current Limitations

⚠️ **Direct Connection Blocked**: Direct connections to port 5432 are currently blocked, likely for security reasons. This affects:
- Direct pg_dump connections
- Direct psql connections

**Solutions:**
1. Whitelist your IP in Supabase Dashboard
2. Use Supabase CLI (requires Docker)
3. Download backups from Supabase Dashboard
4. Use the Management API to access automatic backups

## Backup Storage

Backups are saved to: `./backups/`

File naming format: `supabase-backup-{PROJECT_REF}-{TIMESTAMP}.sql`

## Project Information

- **Project Reference**: `mjqsmbrkdzumusiqweac`
- **Region**: us-west-2
- **Database Host**: `db.mjqsmbrkdzumusiqweac.supabase.co`
- **PostgreSQL Version**: 17.6.1.063
- **Status**: ACTIVE_HEALTHY

## Quick Reference

```bash
# Set environment variables
export SUPABASE_ACCESS_TOKEN=sbp_e1f11c756e43c6afe00a7541d9516709a1c46fee
export PROJECT_REF=mjqsmbrkdzumusiqweac

# List backups
curl -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/database/backups"

# Run API script
./scripts/backup-supabase-api.sh

# Run TypeScript script
npx tsx scripts/backup-supabase-db.ts
```
