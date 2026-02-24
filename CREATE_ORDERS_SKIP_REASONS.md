# When Order Creation Stops — All Reasons

This document lists **every** condition in the **Create orders next week** flow (including batched) that causes an order **not** to be created. Same logic runs for the single-request and batched modes.

---

## 1. Who is even considered?

- Only **primary clients** are loaded: `parent_client_id IS NULL`. Dependants are never in the list.
- With **batch mode**: only clients in the current batch (by `id` order, range `batchIndex * batchSize` to `batchIndex * batchSize + batchSize - 1`) are processed.
- With **clientIdsFilter** (Create by Name / single client): only those client IDs are loaded.

If a client is not in the loaded list, they never get any orders created.

---

## 2. Client eligibility (applies to every order type)

Before creating **any** order for a client, `isClientEligible(clientId)` is checked. Orders are **skipped** when:

| # | Reason | Condition |
|---|--------|-----------|
| 1 | **Client not found** | Client ID not in the loaded client map (e.g. wrong batch). |
| 2 | **Status does not allow deliveries** | `client_statuses.deliveries_allowed` is false for the client’s status. |
| 3 | **Expiration date has passed** | `clients.expiration_date` is before today (date only, no time). |

If any of these is true, **no** Food, Meal, Boxes, or Custom order is created for that client in this run.

---

## 3. Food orders — when a Food order is NOT created

A client is added to the **food work list** only if:

- `upcoming_order` exists and is an object.
- `serviceType` (or `service_type`) is `'Food'` or missing/undefined.
- There is at least one of: **deliveryDayOrders** (with at least one day) or **vendorSelections** (converting to deliveryDayOrders with at least one day).

Then, **per (client, day, vendor selection)**:

| # | Reason | Condition |
|---|--------|-----------|
| 4 | **No delivery day data** | Client has Food type but no `deliveryDayOrders` and no (or empty) `vendorSelections` → not added to food list (counted as `foodSkippedNoData`). |
| 5 | **No day orders** | Parsed `delivery_day_orders` is null/empty. |
| 6 | **Invalid or out-of-range day name** | `getDateForDayInWeek(weekStart, dayName)` returns null (e.g. typo like `"Wensday"`). |
| 7 | **Delivery date outside target week** | Computed date is &lt; `weekStartStr` or &gt; `weekEndStr`. |
| 8 | **No vendor on selection** | `sel.vendorId` is missing. |
| 9 | **Vendor not found** | `vendorId` not in the loaded vendors (e.g. deleted vendor). |
| 10 | **Vendor inactive** | `vendors.is_active` is false for that vendor. |
| 11 | **Order already exists** | An order already exists for this client + delivery date + service type **Food** + this vendor (same `order_vendor_selections.vendor_id`). |
| 12 | **No valid items in selection** | Every item in the selection has `qty <= 0`, or the item ID is not in `menu_items`/`breakfast_items`, so `itemsList.length === 0`. |
| 13 | **Order insert failed** | `createOrder()` threw (e.g. DB error) → order not created, logged in `unexpectedFailures`. |
| 14 | **order_vendor_selections insert failed** | Order row was created but inserting into `order_vendor_selections` failed → order exists but is incomplete (diagnostics show failed). |

---

## 4. Meal orders — when a Meal order is NOT created

A client is added to the **meal work list** only if:

- `upcoming_order` exists and is an object.
- `mealSelections` (or `meal_selections`) exists, is an object, and has at least one key.
- `serviceType` (or `service_type`) is `'Food'` or `'Meal'`.

Then, **per meal selection (e.g. Breakfast, Lunch, Dinner)**:

| # | Reason | Condition |
|---|--------|-----------|
| 15 | **No mealSelections** | Client has Food/Meal type but no or empty `mealSelections` → not in meal list. |
| 16 | **No raw meal selections** | Parsed `meal_selections` is null. |
| 17 | **No vendor on meal selection** | `vendorId` / `vendor_id` missing for that meal type. |
| 18 | **Vendor not found** | Vendor ID not in loaded vendors. |
| 19 | **Vendor inactive** | `vendors.is_active` is false. |
| 20 | **No delivery day in week for vendor** | `getFirstDeliveryDateInWeek(nextWeekStart, vendor.deliveryDays)` returns null (e.g. vendor has no `delivery_days` or none in the week). |
| 21 | **Meal delivery date outside target week** | Computed delivery date &lt; weekStartStr or &gt; weekEndStr. |
| 22 | **Order already exists (Meal)** | An order already exists for this client + delivery date + service type **Meal** + this vendor. |
| 23 | **No valid items in meal selection** | All items have `qty <= 0` or item ID not in meal/menu items → `itemsList.length === 0`. |
| 24 | **Meal order insert failed** | `createOrder()` threw. |
| 25 | **Meal order_vendor_selections insert failed** | Order row created but `order_vendor_selections` insert failed. |

---

## 5. Boxes orders — when a Boxes order is NOT created

A client is in the **box work list** only if:

- `upcoming_order.serviceType` is `'Boxes'`.
- `boxOrders` (or `box_orders`) is a non-empty array.

Then, **per client** (one Boxes order per client per week):

| # | Reason | Condition |
|---|--------|-----------|
| 26 | **Wrong service type** | Not `serviceType === 'Boxes'` or no `boxOrders`. |
| 27 | **No vendor set for box order** | At least one box line has no `vendor_id` / `vendorId`. |
| 28 | **No vendor in map** | A box line’s `vendor_id` not in loaded vendors. |
| 29 | **No delivery date in week** | No box vendor has a delivery day in the target week → `earliestDelivery` is null. |
| 30 | **Box delivery date outside target week** | `earliestDelivery` is &lt; weekStartStr or &gt; weekEndStr. |
| 31 | **Boxes order already exists this week** | Client already has at least one order with `service_type = 'Boxes'` and `scheduled_delivery_date` in [weekStartStr, weekEndStr]. |
| 32 | **Vendor inactive (box)** | Vendor for a box line has `is_active` false → that line skipped; if all lines skipped, `selectionsToInsert.length === 0`. |
| 33 | **No box selections to insert** | After filtering invalid/inactive vendors, nothing left to insert. |
| 34 | **Box order insert failed** | `createOrder()` threw. |

---

## 6. Custom orders — when a Custom order is NOT created

A client is in the **custom work list** only if:

- `upcoming_order.serviceType` is `'Custom'`.
- After mapping, `delivery_day` is truthy (filtered out if missing).

Then, **per custom order**:

| # | Reason | Condition |
|---|--------|-----------|
| 35 | **Not Custom type** | `serviceType !== 'Custom'`. |
| 36 | **No delivery day** | `deliveryDay` / `delivery_day` missing → filtered out of custom list. |
| 37 | **No vendor** | `vendorId` / `vendor_id` missing. |
| 38 | **Vendor inactive (Custom)** | Vendor has `is_active` false. |
| 39 | **Invalid delivery day name** | `getDateForDayInWeek(nextWeekStart, co.delivery_day)` returns null. |
| 40 | **Custom delivery date outside target week** | Computed date outside [weekStartStr, weekEndStr]. |
| 41 | **Custom order already exists** | Order already exists for this client + date + service type **Custom** + this vendor. |
| 42 | **Custom order insert failed** | `createOrder()` threw. |
| 43 | **Custom order_vendor_selections insert failed** | Order row created but `order_vendor_selections` insert failed. |

---

## 7. Report “reason” when client gets no orders

For clients that had **zero** orders created and no specific eligibility reason set, the report sets a generic reason from `upcoming_order.serviceType`:

- **Food** → “No upcoming food orders”
- **Meal** → “No upcoming meal orders”
- **Boxes** → “No upcoming box orders”
- **Custom** → “No upcoming custom orders”
- Otherwise → “No upcoming orders”

These mean: the client was in the run but had no orders created (due to one or more of the skip reasons above, or never made it into any work list).

---

## 8. Batched mode only

- **Wrong batch**: Client is in a different batch (by `id` order). Only the batch that contains that client will create their orders.
- **hasMore false**: Once the API returns `batch.hasMore === false`, no further batches are run by the UI; later clients are never processed in that run.

---

## 9. Summary table (quick reference)

| Category | Stops creation when… |
|----------|----------------------|
| **Eligibility** | Client not in map; status `deliveries_allowed` false; expiration date in the past. |
| **Food** | No delivery data; bad/out-of-range day; no vendor/vendor missing/inactive; order already exists; no valid items; insert failure. |
| **Meal** | No mealSelections; no vendor/vendor missing/inactive; no delivery day in week; date out of week; order already exists; no valid items; insert failure. |
| **Boxes** | No vendor on a box; vendor missing; no delivery in week; already have Boxes order this week; no selections; insert failure. |
| **Custom** | No delivery day; no vendor; vendor inactive; bad day; date out of week; order already exists; insert failure. |
| **Batch** | Client not in current batch or run ended (`hasMore` false). |

---

## 10. How duplicate checking works (each order type)

### Overview: lazy per-client snapshot, count-based approach

When we first need to check duplicates for a client, `getClientSnapshot(clientId)` loads that client's existing orders for the target week (1-2 DB queries) and **caches** the result. All subsequent checks for the same client (Food, Meal, Boxes, Custom) reuse the cache — no extra queries.

The snapshot is taken **before** creating any orders for that client, so orders created during the current run are **never** visible to the duplicate check:

- Two Food selections for the same vendor + day (different items) → both created.
- Three Meal types all going to the same vendor → all three created.
- Running the job twice → the second run sees the first run's orders and skips them.

The snapshot uses a **count-based** approach: for each `(date, serviceType, vendor)` key it stores how many pre-existing orders match. Each time a candidate order matches a key, it **consumes** one count. So if 1 pre-existing order matches and 3 new candidates match, only 1 is skipped and 2 are created.

### 10.1 How the per-client snapshot is built

1. Query `orders` where `client_id = X` and `scheduled_delivery_date` in `[weekStartStr, weekEndStr]`.
2. If any Boxes order exists: set `hasBoxes = true`.
3. For non-Boxes orders: query `order_vendor_selections` by `order_id` to get vendor IDs.
4. Build `dupCounts` map: key = `"date|serviceType|vendorId"`, value = count of matching orders.
5. Cache the snapshot so Food, Meal, Boxes, Custom phases all share it (no repeated queries).

### 10.2 Food

- **Key:** `clientId|date|Food|vendorId`
- **Check:** `isDuplicateOfPreExisting(clientId, date, 'Food', vendorId)` → returns true and decrements count if pre-existing count &gt; 0.
- **Result:** Only orders that existed **before this run** are skipped. Two vendor selections for the same vendor on the same day (different items) are both created.

### 10.3 Meal

- **Key:** `clientId|date|Meal|vendorId`
- **Check:** Same `isDuplicateOfPreExisting` per meal type. No pre-check loop.
- **Result:** If a client has Breakfast, Lunch, Dinner all going to vendor V on date D:
  - 0 pre-existing → all 3 created.
  - 1 pre-existing → 1 skipped, 2 created.
  - 3 pre-existing → all 3 skipped.

### 10.4 Boxes

- **Check:** `snapshot.hasBoxes` — simple boolean on the cached snapshot, no count needed (at most 1 Boxes order per client per week).
- **Result:** If a Boxes order already exists for this client in the target week, skip. Otherwise create.

### 10.5 Custom

- **Key:** `clientId|date|Custom|vendorId`
- **Check:** Same `isDuplicateOfPreExisting`.
- **Result:** Same as Food — only pre-existing orders count.

### 10.6 Why this is better than live queries

| Old approach (per-order `orderExists()`) | New approach (lazy per-client snapshot) |
|---|---|
| Queries DB for each candidate order | 1-2 queries per client, cached and shared across Food/Meal/Boxes/Custom |
| Sees orders created moments earlier in the same run → false duplicates | Snapshot frozen before processing that client → no false duplicates |
| Meal pre-check marked ALL meal types as duplicate if ANY one existed | Count-based: only skips as many as actually exist |
| N+1 queries (slow for large batches) | Only queries clients that are actually reached (skipped clients = 0 queries) |

---

*Source: `app/api/create-orders-next-week/route.ts` (single and batched flow).*
