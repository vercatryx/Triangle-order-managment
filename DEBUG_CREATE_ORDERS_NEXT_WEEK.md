# Debugging Plan: Create Orders Next Week (Batched) — Missing Orders

When the **batched** button runs, the UI shows progress (e.g. "Batch 2, clients 100–200"), so batches are advancing. Orders can still be missing because, **within each batch**, some clients are skipped or their data doesn’t produce orders. This plan helps find why.

---

## 1. Confirm what the API is doing per batch (use the JSON response)

Every API response (batch and non-batch) includes a **`debug`** object so you can rely on the JSON instead of server logs.

**In the response JSON you will see:**

- **`debug.clientCount`** – Number of clients loaded for this run (or this batch).
- **`debug.workToDo`** – Counts of orders derived from `upcoming_order` before creating:
  - `foodOrders`, `mealOrders`, `boxOrders`, `customOrders`
- **`debug.skipped`** – Counts of clients skipped and why (always present; 0 when none):
  - `foodBlocking` – Food clients skipped by cleanup (inactive vendor/item).
  - `foodNoData` – Food clients with no usable delivery day data.
  - `mealBlocking` – Meal clients skipped by cleanup.

**How to inspect it:**

- **Batched run:** In DevTools → Network, select each `create-orders-next-week` request and look at the **Response** JSON. Each batch has its own `debug` (and `batch.debug`).
- **Non-batched run:** The single response has one `debug` object at the top level.

**Action:** Run the batched job and for several batches (e.g. 1, 2, 3) note from the response JSON:
- `debug.workToDo.foodOrders`, `debug.workToDo.mealOrders`
- `debug.skipped.foodBlocking`, `debug.skipped.foodNoData`, `debug.skipped.mealBlocking`

If every batch shows `workToDo.foodOrders === 0` and `workToDo.mealOrders === 0` and/or high `skipped` counts, the issue is **data shape or blocking**, not “only one batch ran.”

---

## 2. Find which batch a missing client is in

Clients are loaded in **ascending `id`** order. So:

- Batch 0 = clients with the 100 smallest `id`s  
- Batch 1 = next 100, etc.

**Action:** In the DB (or an admin screen that lists clients by id), find the **row number** of the missing client (e.g. JOEL SCHLESINGER) when ordered by `id` ascending (and `parent_client_id` is null). Then:

- `batchIndex = Math.floor(rowNumber / 100)` (if batch size is 100).

That batch is the one that “owns” this client. If that batch’s log shows `foodOrders=0 mealOrders=0` or high skipped counts, the next steps are about why **that client** is skipped in that batch.

---

## 3. Inspect one missing client’s `upcoming_order`

For one client who should have orders but didn’t (e.g. JOEL SCHLESINGER):

1. **Get their `upcoming_order`:**
   - Query `clients` for that client and read the `upcoming_order` column (JSON).

2. **Check shape:**
   - **Food:** Is there `deliveryDayOrders` (or `delivery_day_orders`) with day keys and `vendorSelections`? Or `vendorSelections` (or `vendor_selections`) with at least one entry that has `vendorId`/`vendor_id` and either `itemsByDay`/`selectedDeliveryDays` or `items`?  
   - **Meal:** Is there `mealSelections` (or `meal_selections`) with at least one meal type that has `vendorId`/`vendor_id` and `items`?  
   - **Type:** Is `serviceType` or `service_type` one of `'Food'`, `'Meal'`, `'Boxes'`, `'Custom'` as expected?

3. **Blocking:**  
   The create-orders-next-week route skips clients for which `hasBlockingCleanupIssues(uo, blockCtx)` is true (inactive vendor, deleted/inactive menu or breakfast item). So:
   - Check that every vendor id in their config is **active**.
   - Check that every menu/item id in their config exists and is **active** (and category active if applicable).

**Action:** For JOEL (or one other missing client), write down:
- Exact keys present in `upcoming_order` (camelCase vs snake_case).
- Whether Food/Meal data exists and matches the shapes above.
- Whether any referenced vendor or item is inactive or missing.

---

## 4. Optional: script or API to “why was this client skipped?”

A small **debug script or GET endpoint** that takes a **client id** and:

1. Loads that client’s `upcoming_order` and `service_type`.
2. Loads the same reference data the route uses (vendors, menu items, breakfast items, categories).
3. Runs the same logic in order:
   - `hasBlockingCleanupIssues(uo, blockCtx)` → if true, report “Blocked by cleanup (inactive vendor or item).”
   - For Food: build `delivery_day_orders` from `deliveryDayOrders` or from `vendorSelectionsToDeliveryDayOrders(vendorSelections)`. If empty, report “Food: no delivery day data (missing or invalid deliveryDayOrders/vendorSelections shape).”
   - For Meal: check `mealSelections` and serviceType. If missing or empty, report “Meal: no mealSelections or wrong serviceType.”
4. Returns a short report: e.g. “Blocked: …” or “Food: …”, “Meal: …”, “Would create: …”.

This gives a direct “why no orders for this client?” without re-running the full job.

---

## 5. Checklist summary

| Step | What to do |
|------|------------|
| 1 | Run batched job; in **server logs** note per-batch `Work to do` and `Skipped` (foodBlocking, foodNoData, mealBlocking). |
| 2 | For one missing client, compute which **batch index** they’re in (by client order by `id`). |
| 3 | For that client, inspect **`upcoming_order`** in DB: shape (Food/Meal keys), and that vendors/items are **active**. |
| 4 | (Optional) Add a small **debug script or GET** that, for a given client id, reports “blocked”, “no data”, or “would create” with reasons. |

Once you have (1)–(3) for one missing client, you’ll know whether the cause is:
- **Blocking** → fix on cleanup page (activate vendor/item or fix config).
- **No data / wrong shape** → fix in create-orders-next-week (support that shape) or in the UI (save in the shape we expect).
- **Other** (e.g. `orderExists` already true, or filter by status/eligibility) → then inspect those conditions next.

---

## 6. Revert or keep the “count” fallback

The earlier change made **hasMore** fall back to “continue if this batch is full” when **totalClients** is 0. If you’ve confirmed batches are already advancing (e.g. “Batch 2, 100–200”), you can:

- **Keep it:** harmless; helps if the count query ever fails.
- **Revert it:** if you prefer hasMore to depend only on the count.

The important part for “missing orders” is steps 1–4 above, not this fallback.
