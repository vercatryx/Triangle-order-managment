# Migration to `clients.upcoming_order` Only — Audit & Fix Log

**Goal:** One source of truth for the "current/upcoming" order = **`clients.upcoming_order`** (JSONB). Do not use (except in migration/helper tools below):
- **`upcoming_orders`** table for draft/current order
- **`clients.active_order`** for the same concept

**Allowed to reference `upcoming_orders` / `active_order` only in:** Migration helper (Manage global configurations), **Order sync**, **Vendor day mismatches**, **Cleanup (invalid meal types)**.

**Fixes applied:** Removed all use of `upcoming_orders` and `active_order` from main app flows. Restore from history now invalidates cache and sets order from server. Only the tools listed above still read/write those sources.

**Known bug (user-reported, addressed):** Clicking **Restore** in Order History — fix: invalidate cache after `updateClientUpcomingOrder`, refetch client, set orderConfig from `updated.upcomingOrder`. Restore currently: sets `orderConfig`, `activeOrder` state, and calls `updateClientUpcomingOrder(clientId, restored)`. Possible causes: cache not invalidated for upcoming order after restore, or other code still reading from `active_order` / `upcoming_orders` table and overwriting or displaying stale data.

---

## 1. Components (UI)

| File | What still references old sources | Notes |
|------|-----------------------------------|--------|
| **`components/clients/ClientProfile.tsx`** | `activeOrder` state; `setActiveOrder(restored)` in restore; `hasActiveOrder: !!data.activeOrder`; fallback "activeOrder from client profile" when upcoming not found; "Recent Orders" section uses `activeOrder`; comment "from upcoming_orders"; `getActiveOrderForClient` fetched in parallel with upcoming | Restore sets both `orderConfig` and `activeOrder` then `updateClientUpcomingOrder`. If UI or sidebar still prefers `activeOrder`, restored data may not show. Consider: after restore, only set `orderConfig` and ensure all reads come from `client.upcomingOrder`; invalidate `upcomingOrderCache` for this client. |
| **`components/clients/ClientList.tsx`** | "Check both activeOrder and detailsCache for box orders"; "Fallback to activeOrder if mealOrder not present"; "Combine both sources, prioritizing activeOrder" | List may show data from `active_order` instead of only `upcoming_order`. |
| **`components/clients/ClientPortalInterface.tsx`** | Props: `activeOrder`, `upcomingOrder`; `[upcomingOrder, activeOrder, client]` in effect | Portal still receives and uses both; ensure portal reads only from `upcomingOrder` for "current order" and uses `activeOrder` only for "Recent Orders" (orders table) if intended. |

---

## 2. Lib – actions.ts

| Location / symbol | What still uses old sources | Notes |
|-------------------|-----------------------------|--------|
| **`mapClientFromDB`** | `upcomingOrder: c.upcoming_order ?? c.active_order` | OK as migration fallback; can remove `active_order` once migration complete. |
| **`updateClient` (addClient path)** | `payload.upcoming_order = data.upcomingOrder ?? (data as any).activeOrder` | Same fallback; ensure callers only send `upcomingOrder`. |
| **`updateClientUpcomingOrder`** | Only updates `clients.upcoming_order` | ✅ Correct. |
| **`deleteClient`** | Deletes from `upcoming_orders` table for client + dependents; also "Delete active orders" from `orders` table | If we no longer use `upcoming_orders` for drafts, consider only clearing `clients.upcoming_order` (and optionally keep table delete for legacy cleanup). |
| **`getUpcomingOrderForClient`** | Reads `clients.upcoming_order` (and fallback `active_order`) | ✅ Correct. |
| **`getActiveOrderForClient`** | Reads from `orders` (and possibly fallback) | Confirm it does not read from `upcoming_orders` for "active"; keep for "Recent Orders" only. |
| **`syncCurrentOrderToUpcoming`** | Writes `clients.active_order` and `clients.upcoming_order`, then syncs to **`upcoming_orders`** table (insert/update/delete rows) | **Critical:** Still the main writer to the old table. Should be replaced by "only call `updateClientUpcomingOrder`" and remove all `upcoming_orders` table writes. |
| **Rest of file** | Many `.from('upcoming_orders')` usages: fetch, insert, update, delete (e.g. lines 2155, 2185, 3613, 3641, 3655, 3790, 3877, 3970, 4363, 4382, 4791, 5014, 6250, 6480, 6842, 7980, 8001, 8010) | All call sites of these need to be audited: either switch to read/write `clients.upcoming_order` only or remove if obsolete. |

---

## 3. Lib – actions-write.ts

| Location / symbol | What still uses old sources | Notes |
|-------------------|-----------------------------|--------|
| **`updateClient`** | Writes `payload.active_order`; "If activeOrder was updated, sync to upcoming_orders"; calls `syncCurrentOrderToUpcoming` | Should stop writing `active_order` for "upcoming" and stop syncing to `upcoming_orders`; only persist `upcoming_order`. |
| **`syncCurrentOrderToUpcoming`** | Full sync to `upcoming_orders` table + `clients.active_order` / `upcoming_order` | Same as actions.ts: replace with `updateClientUpcomingOrder` only. |
| **`saveClientFoodOrder` / `saveClientMealOrder` / `saveClientBoxOrder`** | Write to `client_food_orders`, `client_meal_orders`, `client_box_orders` | Legacy tables. If all order state is now in `clients.upcoming_order`, these may be redundant; ensure no code path relies on them for "current order" display. |
| **`.from('upcoming_orders')`** | Multiple (1117, 1147, 1331, 1349, 1618, 1796, 2366, 2377, 2393) | Same as above: remove or refactor to `clients.upcoming_order`. |

---

## 4. Lib – actions-read.ts

| Location / symbol | What still uses old sources | Notes |
|-------------------|-----------------------------|--------|
| **`getUpcomingOrderForClient`** | **Calls `getUpcomingOrderForClientLocal(clientId)`** which reads from **local DB `upcomingOrders`** (populated from `upcoming_orders` table) | **Critical:** This is the OLD implementation. App uses `cached-data` → `lib/actions` (correct). But any import from `actions-read` (e.g. `app/clients/[id]/history/page.tsx`, `lib/actions-write.ts` via getClient) gets different behavior. Unify: either remove this export or make it call the same logic as `lib/actions.ts` (read `clients.upcoming_order`). |
| **`getClientFullDetails`** (and similar) | If they call `getUpcomingOrderForClient` from this file, they get old source | Ensure getClientFullDetails and any "full details" fetches use the same getUpcomingOrder that reads `clients.upcoming_order`. |
| **`.from('upcoming_orders')`** | e.g. 2136 | Replace with reads from `clients.upcoming_order` where appropriate. |

---

## 5. Lib – actions-migration.ts

| Location / symbol | What still uses old sources | Notes |
|-------------------|-----------------------------|--------|
| **`buildOrderConfigFromUpcomingTable`** | Builds from `upcoming_orders` table rows | Used for migration only; keep until migration is done, then remove or archive. |
| **`buildMergedOrderConfigFromAllSources`** | Sources: `upcoming_orders` table, `active_order`, `client_food_orders`, `client_meal_orders`, `client_box_orders` | Same: migration-only. |
| **`fetchUpcomingOrdersForClientIds`** | `.from('upcoming_orders')` | Migration only. |
| **`syncCurrentOrderToUpcoming`** | Called after migration | When migration is complete, remove this call and any remaining sync to `upcoming_orders`. |

---

## 6. Lib – local-db.ts

| Location / symbol | What still uses old sources | Notes |
|-------------------|-----------------------------|--------|
| **`getUpcomingOrderForClientLocal`** | Reads **`db.upcomingOrders`** (local DB), which is synced from **`upcoming_orders`** table | **Critical:** Still the old source. Used by `actions-read.getUpcomingOrderForClient`. Either deprecate and have callers use server `getUpcomingOrderForClient` from `actions.ts`, or add a path that reads from `clients.upcoming_order` (e.g. from local cache of clients). |
| **`getActiveOrderForClientLocal`** | May fall back to upcoming orders from local DB | Ensure "active" means only from `orders` table; remove fallback to upcoming_orders for "current" display. |
| **Local DB schema** | `upcomingOrders: any[]` | If we stop using `upcoming_orders` table, local sync of that table can be removed. |
| **Other `.from('upcoming_orders')` / client_food_orders / client_meal_orders / client_box_orders** | 223, 305–313, 416–419 | Used for local sync; align with single source `clients.upcoming_order` when possible. |

---

## 7. Lib – cached-data.ts

| Location / symbol | What still uses old sources | Notes |
|-------------------|-----------------------------|--------|
| **Imports** | `getUpcomingOrderForClient` from `./actions` | ✅ Uses actions.ts (correct implementation). |
| **Caches** | `activeOrderCache`, `upcomingOrderCache` | After Restore, call `invalidateClientData(clientId)` (or invalidate at least `upcomingOrderCache` for client) so next read gets fresh `clients.upcoming_order`. |
| **`invalidateClientData`** | Clears both activeOrder and upcomingOrder caches | Ensure Restore flow calls this after `updateClientUpcomingOrder`. |

---

## 8. App – client-portal

| File | What still uses old sources | Notes |
|------|-----------------------------|--------|
| **`app/client-portal/[id]/page.tsx`** | Fetches `getUpcomingOrderForClient(id)`, `getActiveOrderForClient(id)` from `@/lib/actions` | actions.ts getUpcomingOrder is correct. Confirm portal only uses `upcomingOrder` for "current order" and `activeOrder` only for "Recent Orders". |

---

## 9. API routes

| File | What still uses old sources | Notes |
|------|-----------------------------|--------|
| **`app/api/vendor-day-mismatches/route.ts`** | Reads `upcoming_orders` table and `clients.active_order`; returns `source: 'active_order' \| 'upcoming_orders'` | Should also read from `clients.upcoming_order` and report/fix issues there. |
| **`app/api/vendor-day-mismatches/reassign/route.ts`** | Updates `clients.active_order`; deletes/updates `upcoming_orders` rows | Should update only `clients.upcoming_order` and stop touching `upcoming_orders` table. |
| **`app/api/process-weekly-orders/route.ts`** | Reads from `upcoming_orders` table to process orders; many `.from('upcoming_orders')` | **Critical:** If current drafts live only in `clients.upcoming_order`, this flow must be changed to read from `clients.upcoming_order` (and optionally create rows in `orders` without using `upcoming_orders`). |
| **`app/api/create-orders-next-week/route.ts`** | `upcoming_orders` (Custom), `client_food_orders`, `client_meal_orders`, `client_box_orders` | Same: switch to `clients.upcoming_order` (and orders table) as needed. |
| **`app/api/cleanup-invalid-meal-types/route.ts`** | `upcoming_orders` table (GET/POST) | Add cleanup for invalid meal types inside `clients.upcoming_order` JSONB (or rely on cleanup-clients-upcoming). |
| **`app/api/cleanup-invalid-vendors/route.ts`** | `upcoming_orders`, `upcoming_order_vendor_selections`, `upcoming_order_items` | If we drop use of `upcoming_orders` table, this may only need to operate on `clients.upcoming_order`. |
| **`app/api/cleanup-clients-upcoming/route.ts`** | Reads/writes **only** `clients.upcoming_order` | ✅ Correct. |
| **`app/api/order-sync-discrepancies/route.ts`** | `.from('upcoming_orders')` | Align with single source; discrepancies may be redefined as "orders vs clients.upcoming_order". |
| **`app/api/order-sync-discrepancies/resolve/route.ts`** | Uses `upcoming_orders` and calls `syncCurrentOrderToUpcoming` | Resolve should update `clients.upcoming_order` only, not sync to `upcoming_orders`. |
| **`app/delivery/[id]/page.tsx`** | `.from('upcoming_orders')` | Switch to reading from `clients.upcoming_order` or orders table as appropriate. |
| **`app/api/simulate-delivery-cycle/route.ts`** | `upcoming_orders`, `client_food_orders`, `client_meal_orders`, `client_box_orders` | Align with single source. |
| **`app/api/debug/*`** | Various use `getUpcomingOrderForClientLocal` or `upcoming_orders` | Update to use `clients.upcoming_order` for consistency. |

---

## 10. Scripts (audit / one-off / dev)

These still reference `upcoming_orders` or `active_order`; update or retire when migration is final:

- **`scripts/remove-invalid-meal-types.ts`** – upcoming_orders
- **`scripts/cleanup_duplicate_upcoming_orders.ts`** – upcoming_orders
- **`scripts/investigate-shloimy.ts`** – active_order, upcoming_orders
- **`scripts/find-clients-with-active-order-but-no-upcoming.ts`** – upcoming_orders
- **`scripts/diagnose-rivka-muller.ts`** – upcoming_orders
- **`scripts/compare-rivka-vs-working-client.ts` / `.js`** – upcoming_orders
- **`scripts/reassign_invalid_vendors.ts`** – upcoming_orders
- **`scripts/test_null_insert.ts`** – upcoming_orders
- **`scripts/reproduce-lookup.ts`** – upcoming_orders
- **`scripts/debug-order-100002.ts`** – upcoming_orders
- **`scripts/check-upcoming.ts`** – upcoming_orders
- **`scripts/inspect_order.ts`**, **`inspect_orders.ts`**, **`inspect_client_orders.ts`**, **`inspect_client_005.ts`** – upcoming_orders
- **`scripts/inspect_order_types.ts`** – upcoming_orders
- **`scripts/create_test_order.ts`** – inserts into upcoming_orders
- **`scripts/inspect_custom_upcoming.ts`** – upcoming_orders
- **`scripts/recover_notes.ts`** – upcoming_orders
- **`lib/sync-orders-bidirectional.ts`** – upcoming_orders, syncCurrentOrderToUpcoming
- **`app/delivery/actions.ts`** – upcoming_orders
- **`inspect_upcoming_schema.ts`**, **`inspect_upcoming_orders_schema.ts`**, **inspect_order_selections.ts**, **check_schema.ts** – schema/docs only

---

## 11. Types / schema

| Location | What | Notes |
|----------|------|--------|
| **`lib/types.ts`** | `ClientProfile.activeOrder`, `activeOrder?: OrderConfiguration` | Keep if "Recent Orders" still use it (from orders table); clarify that "upcoming" = `upcomingOrder` only. |
| **`extracted_schema.sql`** | `clients.active_order`, `upcoming_orders` table | DB still has both; app should stop writing to them for "current order" once migration is done. |

---

## 12. Restore from order history (bug)

**Flow today:**

1. `handleRestoreFromHistory` in **ClientProfile.tsx**
2. Builds config with `historyEntryToOrderConfiguration(entry)`
3. `setOrderConfig(restored)` and `setActiveOrder(restored)`
4. `updateClientUpcomingOrder(clientId, restored)` ✅ writes to `clients.upcoming_order`
5. `getClient(clientId)` then `setClient(updated)`

**Likely issues:**

- **Cache:** `upcomingOrderCache` (and possibly `activeOrderCache`) for this client are not invalidated before/after restore, so subsequent reads (e.g. in same session or from cached-data) may return old data.
- **Double source:** Any UI that prefers `activeOrder` over `upcomingOrder` (e.g. sidebar, "Recent Orders" vs "Current Order") might still show old data if `activeOrder` is not updated in DB (we no longer want to write `active_order` for this).
- **Invalidation:** After `updateClientUpcomingOrder`, call `invalidateClientData(clientId)` (or at least invalidate the upcoming order cache) so that `getClient` and `getUpcomingOrderForClient` refetch. Optionally refetch `getUpcomingOrderForClient(clientId)` and set `orderConfig` from that instead of only from `restored`, so the form is driven by server state.

**Suggested fixes (for when you implement):**

1. After `updateClientUpcomingOrder(clientId, restored)`, call `invalidateClientData(clientId)`.
2. Refetch client and upcoming order (or use returned `updated`) and set `orderConfig` from `updated.upcomingOrder` so the form reflects server state.
3. Stop setting `setActiveOrder(restored)` for "current order" display; reserve `activeOrder` for "Recent Orders" from the orders table only.

---

## Summary checklist

- [ ] **Restore:** Invalidate caches after restore; optionally refetch and set orderConfig from server; stop using activeOrder for "current" order.
- [ ] **ClientProfile / ClientList / ClientPortalInterface:** Use only `upcomingOrder` (from `clients.upcoming_order`) for "current order"; use `activeOrder` only for "Recent Orders" (orders table).
- [ ] **syncCurrentOrderToUpcoming:** Remove or replace with `updateClientUpcomingOrder` only; remove all writes to `upcoming_orders` table and `clients.active_order` for upcoming.
- [ ] **actions-write updateClient:** Stop writing `active_order` for upcoming and stop calling sync to `upcoming_orders`.
- [ ] **actions-read getUpcomingOrderForClient:** Make it use same logic as actions.ts (read `clients.upcoming_order`), or remove and use actions.ts only.
- [ ] **local-db getUpcomingOrderForClientLocal:** Deprecate or add path from `clients.upcoming_order`; stop relying on `upcoming_orders` table for current order.
- [ ] **API routes:** process-weekly-orders, create-orders-next-week, vendor-day-mismatches, order-sync-discrepancies, delivery, simulate-delivery-cycle, cleanup-invalid-* — switch to read/write `clients.upcoming_order` where applicable and stop using `upcoming_orders` table for drafts.
- [ ] **Scripts:** Update or retire scripts that assume `upcoming_orders` table or `active_order` for current order.

This document is a snapshot of the project; update it as you fix each location.
