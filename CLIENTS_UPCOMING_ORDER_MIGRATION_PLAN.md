# Migration Plan: Use `clients.upcoming_order` as Single Source of Truth

**Goal:** Fully adopt `clients.upcoming_order` (JSONB column) as the only source for upcoming/current order configuration. Eliminate `clients.active_order`, the `upcoming_orders` table (and related tables), and the independent order tables (`client_food_orders`, `client_meal_orders`, `client_box_orders`).

**Schema Reference:** See `UPCOMING_ORDER_SCHEMA.md` for the exact structure of `clients.upcoming_order`.

---

## 1. Summary of Changes


| Remove                                   | Replace With                                           |
| ---------------------------------------- | ------------------------------------------------------ |
| `clients.active_order`                   | `clients.upcoming_order`                               |
| `upcoming_orders` table + related tables | `clients.upcoming_order`                               |
| `client_food_orders` table               | `clients.upcoming_order` (Food: `deliveryDayOrders`)   |
| `client_meal_orders` table               | `clients.upcoming_order` (Food/Meal: `mealSelections`) |
| `client_box_orders` table                | `clients.upcoming_order` (Boxes: `boxOrders`)          |


---

## 2. Schema Notes: Old Fields & Process-Time Handling

Per `UPCOMING_ORDER_SCHEMA.md`, the column supports:

- **Boxes:** `serviceType`, `caseId`, `boxOrders`, `notes`
- **Custom:** `serviceType`, `caseId`, `custom_name`, `custom_price`, `vendorId`, `deliveryDay`, `notes`
- **Food/Meal:** `serviceType`, `caseId`, `vendorSelections`, `deliveryDayOrders`, `mealSelections`, `notes`

### Not Needed (Artifacts of Old Architecture)

These existed in the `upcoming_orders` table but are **not required** for `clients.upcoming_order`:

| Field            | Why Not Needed                                                                 |
| ---------------- | ------------------------------------------------------------------------------ |
| **Order IDs**    | IDs are only for actual orders once placed. Upcoming orders are just config attached to a client; `client_id` is the identifier. No need to add IDs to the JSONB. |
| **Order numbers**| Same—only relevant for placed orders. Prefer to stop using order numbers for upcoming/draft orders. Generate at process time when creating real orders if needed. |
| **Status**       | Not used for upcoming config. Draft vs scheduled was a table artifact; the JSONB doesn't need a status field. |

### Things to Handle at Process Time

| Field                         | Notes                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------- |
| **delivery_day**              | Covered by `deliveryDayOrders` keys (Monday, Tuesday, etc.). No gap.            |
| **meal_type**                 | Covered by `mealSelections` keys (Breakfast, Lunch, Dinner). No gap.            |
| **scheduled_delivery_date**   | Compute when creating real orders from `deliveryDayOrders` keys + vendor delivery days. |
| **total_value / total_items** | Derive when needed; no need to store in JSONB.                                  |

### Equipment Orders (Unchanged)

Equipment orders **never** used any upcoming/active/client_* sources. They go straight from creation (`saveEquipmentOrder`) to the `orders` table. No change to Equipment flow in this migration.


---

## 3. File-by-File Change Plan

### 3.1 Core Actions (`lib/actions.ts`)


| Location                                                           | Current Behavior                                                     | Required Change                                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `mapClientFromDB` (~1521)                                          | Maps `active_order`, `upcoming_order` from `clients`                 | Remove `active_order` from payload. Expose only `upcomingOrder` from `upcoming_order`.            |
| `addClient` (~1659-1665)                                           | Sets `active_order` on insert                                        | Remove. Set `upcoming_order` only (from `data.upcomingOrder`).                                    |
| `addDependent` (~1735)                                             | Sets `active_order: {}`                                              | Change to `upcoming_order: null` or `{}`.                                                         |
| `updateClient` (~1858-1883)                                        | Accepts `activeOrder`, `upcomingOrder`                               | Remove `activeOrder`. Only accept `upcomingOrder`; persist to `upcoming_order`.                   |
| `updateClientUpcomingOrder` (~2127)                                | Updates `upcoming_order` only                                        | Keep; ensure it is the single write path for order config.                                        |
| `generateDeliveriesForDate` (~2267-2284)                           | Reads `c.active_order` for vendor/summary                            | Read from `c.upcoming_order` instead. Map `vendorId`, `boxTypeId`, etc. from JSON.                |
| `deleteClient` (~2182-2215)                                        | Deletes from `upcoming_orders`                                       | Remove. Only clear `upcoming_order` on client row (or leave to cascade).                          |
| `syncCurrentOrderToUpcoming` (~4286-4370)                          | Writes `active_order` + `upcoming_order`; syncs to `upcoming_orders` | **Remove or repurpose.** Replace with a function that only calls `updateClientUpcomingOrder`.     |
| `syncCurrentOrderToUpcoming` rest                                  | Deletes/inserts in `upcoming_orders`, `upcoming_order_*`             | Remove all `upcoming_orders` table logic.                                                         |
| `processUpcomingOrders` (~4759+)                                   | Reads from `upcoming_orders`, moves to `orders`                      | Rewrite to read from `clients.upcoming_order` and create `orders` from parsed JSON.               |
| `getActiveOrderForClient` (~5218)                                  | Reads from `orders` (and fallback to `upcoming_orders`)              | Keep `orders` read. Remove `upcoming_orders` fallback (already commented).                        |
| `getUpcomingOrderForClient` (~5519)                                | Uses `getUpcomingOrderForClientLocal`                                | Rewrite to read from `clients.upcoming_order` (or a helper that returns parsed config).           |
| Box items fallback (~6019-6035)                                    | Fallback to `clients.active_order` for box items                     | Change to `clients.upcoming_order`.                                                               |
| `getClientFullDetails` / `getClientProfileData`                    | Fetches `active_order`, `upcoming_order`, food/meal/box              | Remove food/meal/box fetches. Return only `upcoming_order` as order config.                       |
| `getClientFoodOrder`, `getClientMealOrder`, `getClientBoxOrder`    | Read from `client_*_orders` tables                                   | **Remove or deprecate.** Replace callers with reads from `clients.upcoming_order`.                |
| `saveClientFoodOrder`, `saveClientMealOrder`, `saveClientBoxOrder` | Write to `client_*_orders` tables                                    | **Remove or deprecate.** Replace with `updateClientUpcomingOrder` using correct shape per schema. |
| `getBatchClientDetails` (~7495-7535)                               | Fetches `upcoming_orders`, `client_food_orders`, etc.                | Remove those fetches. Derive order config from `clients.upcoming_order`.                          |


### 3.2 Local DB (`lib/local-db.ts`)


| Location                                                                       | Current Behavior                                               | Required Change                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `LocalOrdersDB` interface                                                      | Has `upcomingOrders`, `upcomingOrderVendorSelections`, etc.    | Remove upcoming-related fields, or keep only for cache of `orders` table if still used. |
| `syncLocalDBFromSupabase`                                                      | Syncs `upcoming_orders`, `upcoming_order_*`, `client_*_orders` | Remove. Only sync `orders` + `order_*` if needed for active/recent orders.              |
| `updateClientInLocalDB`                                                        | Fetches `upcoming_orders`, `client_*_orders`                   | Remove. Sync only `orders` for that client.                                             |
| `getActiveOrderForClientLocal`                                                 | Fallback to `upcomingOrders` when no `orders`                  | Remove fallback. Active = from `orders` only.                                           |
| `getUpcomingOrderForClientLocal`                                               | Reads from `upcomingOrders` in local DB                        | **Replace.** Read from Supabase `clients.upcoming_order` (or cache it from `clients`).  |
| `getClientFoodOrderLocal`, `getClientMealOrderLocal`, `getClientBoxOrderLocal` | Read from local `client_*_orders`                              | Remove. Callers should use `clients.upcoming_order`.                                    |


### 3.3 Client Profile (`components/clients/ClientProfile.tsx`)


| Location                                        | Current Behavior                                                                                                                    | Required Change                                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Order config source priority                    | `active_order` first, then `upcomingOrder`                                                                                          | Use only `upcomingOrder` (from `clients.upcoming_order`).                                                      |
| `hasValidActiveOrder` / `hasValidUpcomingOrder` | Dual validation                                                                                                                     | Consolidate to single `hasValidUpcomingOrder`.                                                                 |
| `prepareNewColumnOrder` / `prepareActiveOrder`  | Builds payload for both columns                                                                                                     | Simplify to one payload builder per `UPCOMING_ORDER_SCHEMA.md`.                                                |
| Save flow                                       | Calls `saveClientFoodOrder`, `saveClientMealOrder`, `saveClientBoxOrder`, `syncCurrentOrderToUpcoming`, `updateClientUpcomingOrder` | Call only `updateClientUpcomingOrder` with correctly shaped payload.                                           |
| `updateClient` with `activeOrder`               | Used on create/update                                                                                                               | Remove `activeOrder`. Use `upcomingOrder` only.                                                                |
| Restore from history                            | Restores to `activeOrder` via `updateClient`                                                                                        | Restore to `upcomingOrder` via `updateClientUpcomingOrder`.                                                    |
| "Using fallback order source" UI                | Shown when using `upcomingOrder` because `active_order` empty                                                                       | Remove; no more fallback concept.                                                                              |
| New client creation                             | Sets `activeOrder`                                                                                                                  | Set `upcomingOrder` only.                                                                                      |
| Data fetches                                    | `getClientFoodOrder`, `getClientMealOrder`, `getClientBoxOrder`, `getUpcomingOrderForClient`                                        | Use `getUpcomingOrderForClient` (rewritten to read `clients.upcoming_order`) and remove food/meal/box fetches. |


### 3.4 Client Portal (`components/clients/ClientPortalInterface.tsx`, `app/client-portal/[id]/page.tsx`)


| Location                          | Current Behavior                                                                                                                | Required Change                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Props                             | `activeOrder`, `upcomingOrder`, `foodOrder`, `mealOrder`, `boxOrders`                                                           | Provide single `upcomingOrder` from `clients.upcoming_order`. Remove others.                                                                   |
| Config resolution                 | Uses `client.activeOrder` as fallback for `caseId`                                                                              | Use only `upcomingOrder`.                                                                                                                      |
| Save                              | Calls `syncCurrentOrderToUpcoming`, `saveClientFoodOrder`, etc.                                                                 | Call only `updateClientUpcomingOrder`.                                                                                                         |
| `app/client-portal/[id]/page.tsx` | Fetches `getClientFoodOrder`, `getClientMealOrder`, `getClientBoxOrder`, `getUpcomingOrderForClient`, `getActiveOrderForClient` | Fetch `getUpcomingOrderForClient` (from `clients.upcoming_order`) and `getActiveOrderForClient` (from `orders`). Remove food/meal/box fetches. |


### 3.5 Cached Data (`lib/cached-data.ts`)


| Location                    | Current Behavior                         | Required Change                                                                                              |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `getActiveOrderForClient`   | Server call to get active orders         | Keep; reads from `orders` table.                                                                             |
| `getUpcomingOrderForClient` | Server call                              | Update to use new implementation reading `clients.upcoming_order`.                                           |
| Cache keys                  | `activeOrderCache`, `upcomingOrderCache` | Remove `activeOrderCache` if it caches order config. Keep `upcomingOrderCache` for `clients.upcoming_order`. |


### 3.6 API Routes


| File                                                | Current Behavior                                                                         | Required Change                                                                                                                                                                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/api/process-weekly-orders/route.ts`            | Reads from `upcoming_orders`, transfers to `orders`                                      | Rewrite to: (1) fetch clients with non-null `upcoming_order`, (2) parse JSON per schema, (3) expand `deliveryDayOrders` / `mealSelections` / `boxOrders` into one `orders` row per logical order, (4) create rows in `orders`. |
| `app/delivery/[id]/page.tsx`                        | Fallback lookup in `upcoming_orders` when order not in `orders`                          | Remove or redefine. With only `clients.upcoming_order`, there are no order ids for drafts; delivery should rely on `orders` only.                                                                                              |
| `app/api/vendor-day-mismatches/route.ts`            | Reads `upcoming_orders`                                                                  | Switch to `clients.upcoming_order`; iterate clients and parse JSON.                                                                                                                                                            |
| `app/api/vendor-day-mismatches/reassign/route.ts`   | Updates `upcoming_orders`                                                                | Update `clients.upcoming_order` JSON instead.                                                                                                                                                                                  |
| `app/api/order-sync-discrepancies/route.ts`         | Compares `active_order` vs `upcoming_orders`                                             | **Remove or repurpose.** No more sync; single source.                                                                                                                                                                          |
| `app/api/order-sync-discrepancies/resolve/route.ts` | Resolves sync between `active_order` and `upcoming_orders`                               | **Remove.**                                                                                                                                                                                                                    |
| `app/api/simulate-delivery-cycle/route.ts`          | Reads `client_food_orders`, `client_meal_orders`, `client_box_orders`, `upcoming_orders` | Read from `clients.upcoming_order` and `orders`.                                                                                                                                                                               |


### 3.7 Admin Pages


| File                                       | Current Behavior                                                 | Required Change                                                        |
| ------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `app/admin/order-sync/page.tsx`            | Shows discrepancies between `active_order` and `upcoming_orders` | Remove or repurpose as a validation view for `clients.upcoming_order`. |
| `app/admin/migrate-upcoming/page.tsx`      | Migration from multiple sources to `clients.upcoming_order`      | Keep for one-time migration; then can be retired.                      |
| `app/admin/vendor-day-mismatches/page.tsx` | Uses `active_order` / `upcoming_orders`                          | Update to use `clients.upcoming_order`.                                |


### 3.8 Types (`lib/types.ts`)


| Location                      | Current Behavior              | Required Change                                                 |
| ----------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `ClientProfile.activeOrder`   | Optional `OrderConfiguration` | Remove.                                                         |
| `ClientProfile.upcomingOrder` | Optional any                  | Keep; define a proper type matching `UPCOMING_ORDER_SCHEMA.md`. |
| `ClientProfile.mealOrder`     | Optional `ClientMealOrder`    | Remove if `mealOrder` is no longer fetched from DB.             |


### 3.9 Other Lib Files


| File                       | Current Behavior                                                               | Required Change                                                                                |
| -------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `lib/actions-read.ts`      | Duplicates of `getClientFoodOrder`, etc., `getUpcomingOrderForClient`          | Align with `lib/actions.ts`; remove food/meal/box getters, update `getUpcomingOrderForClient`. |
| `lib/actions-write.ts`     | `saveClientFoodOrder`, `saveClientMealOrder`, `saveClientBoxOrder`             | Remove or redirect to `updateClientUpcomingOrder`.                                             |
| `lib/actions-migration.ts` | Builds merged config from `upcoming_orders`, `active_order`, `client_*_orders` | Used for migration; keep until migration done, then remove.                                    |
| `lib/client-mappers.ts`    | Maps `mealOrder` from `client_meal_orders`                                     | Remove `mealOrder` mapping if deprecated.                                                      |


### 3.10 Client List (`components/clients/ClientList.tsx`)


| Location         | Current Behavior               | Required Change                                         |
| ---------------- | ------------------------------ | ------------------------------------------------------- |
| Box order checks | Reads from `client_box_orders` | Switch to `clients.upcoming_order` (parse `boxOrders`). |


---

## 4. Process-Weekly-Orders Rewrite (Critical)

Current flow reads from `upcoming_orders` and creates `orders`. New flow:

1. **Fetch clients** with non-null `clients.upcoming_order`.
2. **For each client:**
  - Parse `upcoming_order` JSON.
  - Based on `serviceType`:
    - **Food:** For each key in `deliveryDayOrders`, create one `orders` row (and related `order_vendor_selections`, `order_items`). Add `mealSelections`-based rows if needed.
    - **Meal:** For each key in `mealSelections`, create one `orders` row.
    - **Boxes:** For each entry in `boxOrders`, create one `orders` row (and `order_box_selections`).
    - **Custom:** Create one `orders` row from `custom_name`, `custom_price`, `vendorId`, `deliveryDay`.
3. **Compute `scheduled_delivery_date**` from:
  - `deliveryDayOrders` keys (day names) + vendor `delivery_days`
  - `deliveryDay` for Custom
  - Vendor delivery days for Boxes
4. **Create billing records** as today.
5. **Optional:** Add `status` or metadata to `clients.upcoming_order` to mark "processed for week X" if needed to avoid double-processing.

---

## 5. Data Migration (Pre-Cutover)

Before removing old sources:

1. **Run existing migrate-upcoming tool** to populate `clients.upcoming_order` from `upcoming_orders`, `active_order`, `client_food_orders`, `client_meal_orders`, `client_box_orders`.
2. **Validate** that migrated data matches `UPCOMING_ORDER_SCHEMA.md` and that all service types are represented.
3. **Verify** Client Profile and Client Portal display correctly using only `clients.upcoming_order`.

---

## 6. Database Schema Cleanup (Post-Cutover)

After code changes and verification:

- Drop or archive: `upcoming_orders`, `upcoming_order_vendor_selections`, `upcoming_order_items`, `upcoming_order_box_selections`.
- Drop or archive: `client_food_orders`, `client_meal_orders`, `client_box_orders`.
- Remove column: `clients.active_order`.

---

## 7. Order of Implementation (Suggested)

1. **Phase 1 – Read path**
  - Implement `getUpcomingOrderForClient` to read from `clients.upcoming_order`.
  - Update Client Profile and Client Portal to use only `upcomingOrder` (remove `active_order` priority).
  - Keep writing to old sources during transition.
2. **Phase 2 – Write path**
  - Make all saves go through `updateClientUpcomingOrder` only.
  - Remove calls to `saveClientFoodOrder`, `saveClientMealOrder`, `saveClientBoxOrder`, `syncCurrentOrderToUpcoming`.
  - Remove `active_order` from `updateClient` / `addClient`.
3. **Phase 3 – Process-weekly-orders**
  - Rewrite to read from `clients.upcoming_order` and create `orders`.
4. **Phase 4 – Cleanup**
  - Remove local-db upcoming/client_*_orders sync.
  - Remove order-sync-discrepancy APIs and admin UI.
  - Remove deprecated actions and types.
  - Drop old tables and `active_order` column.

---

## 8. Testing Checklist

- Client Profile: load order config from `clients.upcoming_order` only
- Client Profile: save Food/Meal/Box/Custom to `clients.upcoming_order` only
- Client Portal: same behavior for clients
- Process-weekly-orders: creates correct `orders` from `clients.upcoming_order`
- Recent Orders: still reads from `orders` table
- Delivery page: works with `orders` only (no `upcoming_orders` fallback)
- Vendor day mismatches: uses `clients.upcoming_order`
- New client creation: sets `upcoming_order` only
- Restore from history: updates `upcoming_order` only
- Equipment orders: unchanged (separate flow)

---

## 9. Scripts & Debug Tools to Update


| File                                         | Notes                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `scripts/sync-orders-bidirectional.ts`       | Remove or archive; no more bidirectional sync.                                      |
| `scripts/investigate-shloimy.ts`             | Update to read `clients.upcoming_order` instead of `upcoming_orders`.               |
| `scripts/compare-rivka-vs-working-client.ts` | Update to compare `clients.upcoming_order` only.                                    |
| `scripts/diagnose-client-562.js`             | Update `getUpcomingOrderForClientLocal` simulation to use `clients.upcoming_order`. |
| `app/api/debug/compare-clients/route.ts`     | Compare `clients.upcoming_order` between clients.                                   |
| `app/api/debug/client-profile-data/route.ts` | Return `clients.upcoming_order` instead of local-db upcoming.                       |
| `app/api/debug/client-order/route.ts`        | Same as above.                                                                      |


