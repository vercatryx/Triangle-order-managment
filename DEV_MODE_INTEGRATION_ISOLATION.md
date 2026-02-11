# Development Mode: Integration & Data Isolation Analysis

This document outlines all third-party integrations and data operations in the application, so you can isolate dev environments from live data during development.

---

## Executive Summary

| Integration | Data Operations | Risk Level | Isolation Strategy |
|-------------|-----------------|------------|-------------------|
| **MySQL** | Read/Write (primary) | High | Use separate dev database |
| **Cloudflare R2** | Read/Write (files) | High | Use separate dev bucket |
| **Email (SMTP/Gmail)** | Outbound (sends) | Medium | Disable or use dev email |
| **Chrome Extension** | Writes order status | Medium | Point dev extension to localhost |
| **GitHub Actions** | Triggers order creation | High | Production only; disable on dev branch |
| **Public APIs** | Read + emails | Medium | Require dev guards |
| **Uniteus** | Reference only (no API) | Low | N/A |

---

## 1. MySQL Database

**Location:** `lib/db.ts` (via `lib/supabase.ts`)

**Environment variables:**
```env
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=...
MYSQL_DATABASE=triangle_orders
```

**Alternative:** `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`

**Data operations:** All CRUD (clients, orders, vendors, upcoming_orders, etc.)

### Isolation for dev

1. **Create a dev database:**
   ```sql
   CREATE DATABASE triangle_orders_dev;
   ```

2. **Use `.env.local` for dev:**
   ```env
   MYSQL_DATABASE=triangle_orders_dev
   ```

3. **Seed with test data:** `sql/mysql_test_data.sql` for safe dev data.

---

## 2. Cloudflare R2 (S3-compatible storage)

**Location:** `lib/storage.ts` — `uploadFile()`, `deleteFile()`

**Environment variables:**
```env
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=...           # default bucket
R2_DELIVERY_BUCKET_NAME=...  # delivery proof images
NEXT_PUBLIC_R2_DOMAIN=...     # public URL for assets
```

**Data operations:**
- PDF uploads (verify-order, form submissions)
- Delivery proof images
- Client signatures

**Usage:** `lib/actions.ts`, `lib/actions-write.ts`, `lib/form-actions.ts`, `app/delivery/actions.ts`, `app/api/verify-order/upload/route.ts`

### Isolation for dev

1. **Create a separate dev bucket** in Cloudflare R2 (e.g. `triangle-orders-dev`).
2. **Set dev env vars:**
   ```env
   R2_BUCKET_NAME=triangle-orders-dev
   R2_DELIVERY_BUCKET_NAME=triangle-orders-dev-delivery
   NEXT_PUBLIC_R2_DOMAIN=https://your-dev-bucket.r2.dev
   ```
3. **Optional:** Disable uploads in dev by checking `NODE_ENV` and returning early or throwing a clear error.

---

## 3. Email (SMTP + Gmail fallback)

**Location:** `lib/email.ts`, `lib/email-report.ts`

**Environment variables:**
```env
SMTP_HOST=...
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
# Fallback
GMAIL_BACKUP_USER=...
GMAIL_BACKUP_PASS=...
```

**Data operations:** All outbound (sends emails to real users/vendors)

**Usage:**
- `lib/auth-actions.ts` — login verification links
- `lib/form-actions.ts` — form submissions
- `lib/email-report.ts` — scheduling reports, vendor emails
- `app/api/create-orders-next-week/route.ts` — vendor next-week summaries
- `app/api/create-orders-next-week/send-batched-report/route.ts` — admin report
- `app/api/public/vendors-today/route.ts` — daily vendor emails
- `app/api/send-skipped-orders-report/route.ts`
- `app/api/debug-email/route.ts`

### Isolation for dev

1. **Don’t set SMTP/Gmail vars in dev** — sendEmail will fail; handle gracefully in dev.
2. **Use a dev-only email:** Configure SMTP for a test mailbox (e.g. `dev@example.com`).
3. **Environment-based guard:** Add `if (process.env.NODE_ENV === 'development') { return { success: true }; }` to skip sending in dev.
4. **Log instead of send:** Log email content to console instead of sending.

---

## 4. Chrome Extension

**Location:** `chrome-extension/` — calls APIs on `baseUrl` (default: `https://www.trianglesquareservices.com`)

**API routes used:**
- `GET /api/extension/statuses` — read order statuses
- `POST /api/extension/update-status` — **writes** order status
- `GET /api/extension/billing-requests` — read billing requests
- `POST /api/extension/create-client` — create client
- `GET /api/extension/navigators` — read navigators

**Auth:** `Authorization: Bearer <EXTENSION_API_KEY>`

**Environment variables:**
```env
EXTENSION_API_KEY=...
```

**Data operations:** `update-status` updates `orders.status` by `order_number`.

### Isolation for dev

1. **Dev extension:** Point baseUrl to `http://localhost:3000` in extension settings.
2. **Use a dev API key:** Set `EXTENSION_API_KEY` in dev `.env.local` to a key different from production.
3. **Ensure dev app uses dev DB:** Extension will then hit only dev data.

---

## 5. GitHub Actions

**Location:** `.github/workflows/weekly-order-creation.yml`

**Schedule:** `cron: '2 5 * * 3'` (Wed 12:02 AM EST)

**Target:** `https://trianglesquareservices.com` (Production)

**Endpoints:**
- `POST /api/create-orders-next-week` — creates orders
- `POST /api/create-orders-next-week/send-batched-report` — sends report email

**Data operations:** Creates orders in DB, sends emails to vendors and admins.

**`environment: Production`** — uses GitHub Actions environment for production deployment.

### Isolation for dev

1. **Avoid running on dev branch:** Only trigger on `main`/`production` (or the branch you deploy).
2. **Use branch protection:** Require production branch to deploy.
3. **Optional:** Add `CRON_SECRET` or similar auth to the API and require it in the workflow.
4. **Manual workflow:** Use `workflow_dispatch` for manual runs, and ensure they are only triggered against production.

---

## 6. Public APIs

**`GET /api/public/vendors-today`**

- **Auth:** None
- **Reads:** Orders, vendors
- **Writes:** Sends emails to vendors

**Data operations:** Reads DB + sends emails.

### Isolation for dev

1. **Guard in dev:** Add `if (process.env.NODE_ENV === 'development') return NextResponse.json({ error: 'Disabled in dev' }, 403)`.
2. **Or use a dev-only URL:** Public API is not expected to be hit from dev URLs if deployed separately.

---

## 7. Uniteus (Case management)

**Location:** Uniteus URLs stored in `orders.notes` (case links)

**Data operations:** None. The app reads these URLs; no API calls to Uniteus.

**Risk:** Low — no data operations from the app.

---

## 8. Retell AI (planned)

**Location:** `RETELL_OPERATOR_APP_PLAN.md` — not yet implemented.

**Planned env vars:** `RETELL_API_KEY`, `RETELL_WEBHOOK_SECRET`

**Data operations:** Will create upcoming orders via webhooks.

**Isolation:** When implemented, use a separate Retell agent or dev webhook URL for dev.

---

## 9. Scripts using Supabase directly

**Location:** Several scripts in `scripts/` still use `@supabase/supabase-js`:

- `verify_schema_column.ts`
- `verify-client-count.ts`
- `undo_fix_and_report.ts`
- `test_supabase_connection.ts`
- … and others

**Note:** These connect to Supabase if that package is installed and env vars are set. The app migrated to MySQL; `createClient` in `lib/supabase.ts` returns the MySQL client.

**Risk:** If `@supabase/supabase-js` is installed and env vars exist, scripts may hit live Supabase.

### Isolation for dev

1. **Avoid running these scripts against production:** Use `../lib/supabase` or update scripts to use MySQL.
2. **Clear Supabase env vars in dev:** Use only MySQL env vars.

---

## 10. Local file storage

**Location:** `lib/local-db.ts`, `data/local-orders-db.json`

**Data operations:** Local JSON cache; syncs from DB.

**Risk:** Low — file-based; no external services.

---

## Recommended Dev Environment Setup

### `.env.local` (dev)

```env
# MySQL — dev database
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=...
MYSQL_DATABASE=triangle_orders_dev

# R2 — dev bucket (or omit to fail fast)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=triangle-orders-dev
R2_DELIVERY_BUCKET_NAME=triangle-orders-dev-delivery
NEXT_PUBLIC_R2_DOMAIN=https://dev-bucket.r2.dev

# Email — disable or use dev-only
# SMTP_HOST=... (leave unset to skip)
# Or use a dev-only SMTP

# Extension (if testing extension)
EXTENSION_API_KEY=dev-key-for-local-only

# App URL (for login links)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Optional: Dev guard

Add a shared helper in `lib/`:

```ts
// lib/env-guard.ts
export function isDev(): boolean {
  return process.env.NODE_ENV === 'development';
}

export function requireProd(): void {
  if (isDev()) {
    throw new Error('This operation is disabled in development mode');
  }
}
```

Use `requireProd()` in routes that write to live data or send emails (e.g. `create-orders-next-week`, `send-batched-report`, `public/vendors-today`) if you want to hard-block them in dev.

---

## Checklist for Dev Isolation

- [ ] Dev MySQL database: `triangle_orders_dev` with test data
- [ ] Dev R2 bucket (or no R2 in dev)
- [ ] Dev email config (or no email sending)
- [ ] Chrome extension baseUrl set to `http://localhost:3000` for dev
- [ ] GitHub workflow only runs on production branch
- [ ] Dev `.env.local` does not contain production credentials
