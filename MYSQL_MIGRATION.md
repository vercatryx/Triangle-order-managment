# MySQL Migration Guide

This application has been migrated from **Supabase (PostgreSQL)** to **MySQL**.

## Summary of Changes

### 1. Database Layer
- **Added** `lib/db.ts` - MySQL client with Supabase-compatible API (drop-in replacement)
- **Modified** `lib/supabase.ts` - Now exports the MySQL client instead of Supabase
- **Removed** `@supabase/supabase-js` package
- **Added** `mysql2` package

### 2. Schema
- **Added** `sql/mysql_schema.sql` - Full MySQL schema converted from PostgreSQL
- Run this script to create all tables after creating your database:
  ```sql
  CREATE DATABASE triangle_orders;
  USE triangle_orders;
  SOURCE sql/mysql_schema.sql;
  ```

### 3. Environment Variables
Replace Supabase env vars with MySQL in `.env.local`:

```env
# MySQL (replaces NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, etc.)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=triangle_orders
```

See `.env.example` for the full list.

### 4. Data Migration
To migrate existing data from Supabase/PostgreSQL to MySQL:
1. Export your Supabase data (pg_dump or Supabase dashboard)
2. Convert PostgreSQL types to MySQL (UUID → CHAR(36), JSONB → JSON, etc.)
3. Import into MySQL

**Test data:** Use `sql/mysql_test_data.sql` for a ready-to-use seed with clients, vendors, orders, and related entities:
```bash
mysql -u root -p triangle_orders < sql/mysql_test_data.sql
```

### 5. Unchanged
- **File storage** - Still uses R2/S3 (config unchanged)
- **Authentication** - Uses custom `passwordless_codes` table (unchanged)
- **API routes** - All `lib` and `app` imports updated to use the new MySQL client

## Key Differences

| Feature | Supabase (PostgreSQL) | MySQL |
|---------|----------------------|-------|
| UUID | `gen_random_uuid()` | `UUID()` / CHAR(36) |
| JSON | `jsonb` | `JSON` |
| Arrays | `text[]` | `JSON` |
| Row Level Security | Built-in | N/A (app-level auth) |

## Scripts
Utility scripts in `scripts/` still use Supabase imports. Update them to use `import { createClient } from '../lib/supabase'` or run them against your MySQL instance after updating the imports.

## Build
Run `npm install` to remove Supabase and ensure mysql2 is installed. Some TypeScript strict mode errors may need to be fixed in API routes - add explicit `(x: any)` types where needed.
