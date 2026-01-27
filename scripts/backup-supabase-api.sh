#!/bin/bash

# Supabase Database Backup Script using Management API
# This script uses the Supabase Management API to interact with backups

set -e

# Configuration
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-sbp_e1f11c756e43c6afe00a7541d9516709a1c46fee}"
PROJECT_REF="${PROJECT_REF:-mjqsmbrkdzumusiqweac}"

echo "📦 Supabase Database Backup via Management API"
echo "=============================================="
echo "Project Reference: $PROJECT_REF"
echo ""

# Create backups directory
BACKUPS_DIR="$(pwd)/backups"
mkdir -p "$BACKUPS_DIR"

# List all available backups
echo "📋 Listing available backups..."
echo ""

BACKUP_RESPONSE=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$PROJECT_REF/database/backups")

HTTP_CODE=$(echo "$BACKUP_RESPONSE" | tail -n1)
BACKUP_BODY=$(echo "$BACKUP_RESPONSE" | sed '$d')

if [ "$HTTP_CODE" -eq 200 ]; then
    echo "✅ Successfully retrieved backups list"
    echo "$BACKUP_BODY" | python3 -m json.tool 2>/dev/null || echo "$BACKUP_BODY"
    echo ""
    
    # Count backups
    BACKUP_COUNT=$(echo "$BACKUP_BODY" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data) if isinstance(data, list) else 0)" 2>/dev/null || echo "0")
    echo "Found $BACKUP_COUNT backup(s)"
else
    echo "❌ Error listing backups (HTTP $HTTP_CODE):"
    echo "$BACKUP_BODY"
    echo ""
fi

# Note about creating backups
echo ""
echo "ℹ️  Note: Supabase creates automatic daily backups."
echo "   To create a manual backup, you can:"
echo "   1. Use Supabase Dashboard to trigger a backup"
echo "   2. Use Supabase CLI: npx supabase db dump"
echo "   3. Use pg_dump directly (if IP is whitelisted)"
echo ""

# Get project info
echo "📊 Getting project information..."
PROJECT_INFO=$(curl -s -w "\n%{http_code}" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$PROJECT_REF")

PROJECT_HTTP_CODE=$(echo "$PROJECT_INFO" | tail -n1)
PROJECT_BODY=$(echo "$PROJECT_INFO" | sed '$d')

if [ "$PROJECT_HTTP_CODE" -eq 200 ]; then
    echo "✅ Project Information:"
    echo "$PROJECT_BODY" | python3 -m json.tool 2>/dev/null || echo "$PROJECT_BODY"
else
    echo "⚠️  Could not retrieve project info (HTTP $PROJECT_HTTP_CODE)"
fi

echo ""
echo "💡 To create a full database backup:"
echo "   Option 1: Use Supabase CLI"
echo "   npx supabase db dump --project-ref $PROJECT_REF --db-url \"\$DATABASE_URL\" -f backups/backup.sql"
echo ""
echo "   Option 2: Use pg_dump (requires IP whitelisting)"
echo "   pg_dump \"\$DATABASE_URL\" -F c -f backups/backup.dump"
echo ""
