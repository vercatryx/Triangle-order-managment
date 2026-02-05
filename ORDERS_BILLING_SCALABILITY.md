# Orders & Billing Scalability

## Summary

- **Orders page**: Now uses **server-side pagination, search, and sort**. Only one page (default 50 rows) is loaded at a time. Search and sort run on the full dataset on the server, so you can scale to 100k+ orders without long waits or memory issues.
- **Billing page**: Still loads all orders when "All weeks" is selected; for very large datasets you may want server-side pagination or week-first filtering.

---

## What Was Done (Orders)

1. **API route** `GET /api/orders`
   - Query params: `page`, `pageSize`, `search`, `status`, `creationId`, `sortBy`, `sortDirection`
   - Returns `{ orders, total }` for the current page and total matching count.
   - Search runs on **all orders** (client name + order number). Sort and filters are applied in the database.

2. **Orders list UI**
   - **Pagination**: 50 orders per page (configurable via API). Prev/Next and "Page X of Y" with total count.
   - **Search**: Debounced (350 ms); searches **all orders** by client name or order number. Resets to page 1 on search.
   - **Sort**: Column headers trigger server-side sort over **all matching orders** (not just the current page). Resets to page 1 when sort changes.
   - **Filters**: Status and Creation ID are applied on the server.
   - **Select All**: Applies to the current page only. Bulk delete still works on the selected IDs.

---

## Recommendations

### Orders (done)

- Pagination, server-side search, and server-side sort are in place. No further change required for 100k orders from a UX/performance perspective.
- Optional enhancements:
  - **Partial order number search**: Search uses a generated column `order_number_text` so that e.g. "1022" matches 11022, 10225. Run **`sql/add_order_number_text_for_search.sql`** in the Supabase SQL Editor once. If the migration has not been run, order-number search will error until the column exists.
- **Vendor search**: Search currently supports client name and order number. Adding "search by vendor name" would require joining `order_vendor_selections` and `vendors` in the API (or an RPC) and is straightforward to add later.
- **Sort by client name**: Currently "Client" sort uses `created_at` as a proxy (PostgREST doesn’t reliably order by a related table column). For true client-name sort across all orders, add a Postgres function/RPC that returns paginated orders with `ORDER BY clients.full_name`.

### Billing

- **Current behavior**: `getBillingRequestsByWeek(week)` fetches **all** orders in 1000-row pages, then filters by week in memory. For "All weeks" with 100k orders this is slow and heavy.
- **Recommendations**:
  1. **Prefer selecting a week**: Encourage users to pick a week when possible so the backend can filter by date in the DB and only fetch that week’s orders (would require changing the function to filter by week in the query and paginate only that subset).
  2. **Server-side pagination for billing requests**: Add an API like `GET /api/billing-requests?page=&pageSize=&week=&search=&status=` that returns one page of billing request groups (client+week) with total count, and optionally only loads orders for the selected week in the DB. Then the Billing list would use that API instead of loading everything.
  3. **Keep "All weeks" as a report/export**: For "All weeks", consider a separate report or export that runs in the background or with a clear "This may take a while" message, rather than loading everything on page load.

### Database

- Ensure indexes exist for the columns used in orders list filtering and sorting, e.g.:
  - `orders(status, scheduled_delivery_date, created_at)`
  - `orders(creation_id)` when filtering by creation ID
  - `clients(full_name)` for search (or a trigram index if you use `ilike` heavily)

---

## API Reference (Orders)

**GET /api/orders**

| Param          | Type   | Default   | Description                                      |
|----------------|--------|-----------|--------------------------------------------------|
| page           | number | 1         | Page number (1-based).                           |
| pageSize       | number | 50, max 100 | Page size.                                    |
| search         | string | -         | Search in client name and order number (all orders). |
| status         | string | all       | Filter by order status.                          |
| creationId     | number | -         | Filter by creation_id.                           |
| sortBy         | string | created_at | One of: order_number, clientName, service_type, status, deliveryDate, created_at. |
| sortDirection  | string | desc      | asc \| desc.                                     |

**Response:** `{ orders: Order[], total: number }`

Orders include `clientName`, `vendorNames`, and the same fields as before for the list row.
