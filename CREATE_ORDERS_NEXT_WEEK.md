# Create Orders for Next Week — Full Documentation

This document explains exactly what happens when you click **“Create orders for the next week”** in Global Settings, including data sources, eligibility, how each order type is created, box-combining behavior, and how the Excel report is built.

---

## 1. Where the button lives

- **Screen:** Admin → Global Settings (`components/admin/GlobalSettings.tsx`).
- **Button label:** “Create orders for the next week”.
- **Confirmation:** “This will create orders for the next week (Sunday–Saturday) based on upcoming orders. Report will be emailed to the addresses in Report Email. Proceed?”

---

## 2. What “next week” means

- **Next week** = the **Sunday–Saturday** period that starts after “today”.
- If today is Sunday, “next week” is the following Sunday through Saturday (7 days from today).
- Week boundaries are **in the server’s local date/time**.

---

## 3. API: `/api/create-orders-next-week` (POST)

All logic runs in `app/api/create-orders-next-week/route.ts`.

### 3.1 Data loaded up front (parallel)


| Data                     | Table(s) / source                                         | Purpose                                                               |
| ------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------- |
| Vendors                  | `vendors`                                                 | delivery_days, vendor ids                                             |
| Client statuses          | `client_statuses`                                         | deliveries_allowed                                                    |
| Menu / meal / box types  | `menu_items`, `breakfast_items`, `box_types`              | Pricing and item lookup                                               |
| Clients                  | `clients` (top-level only, with `upcoming_order`)         | status, service_type, expiration_date, **upcoming_order**             |
| Food / Meal / Box orders | `**clients.upcoming_order**` (derived per client)         | Food: `deliveryDayOrders` or `vendorSelections` (itemsByDay); Meal: `mealSelections`; Boxes: `boxOrders` |
| Custom                   | `clients.upcoming_order` where `serviceType === 'Custom'` | delivery_day, vendorId, custom_price, etc.                            |
| Settings                 | `app_settings`                                            | `report_email` for sending the Excel                                  |


**Single source of truth:** All upcoming order data (Food, Meal, Boxes, Custom) is read from the `**clients.upcoming_order**` JSONB column. The legacy tables `client_food_orders`, `client_meal_orders`, and `client_box_orders` are no longer used by this API.

---

## 4. Client eligibility

For a client to get any orders created, **all** of the following must be true:

- Client exists.
- Client’s **status** has `deliveries_allowed === true`.
- If `expiration_date` is set, it is **not** before today (start of day).

If not eligible, the client is skipped and can get a “reason” in the report (e.g. “Not eligible”, “Status does not allow deliveries”, “Expiration date has passed”).

---

## 5. How orders are created (by type)

### 5.1 Shared for all orders

- **Order number:** Max existing `order_number` + 1 (minimum 100000), incremented for each new order.
- **Creation ID:** One `creation_id` per run from `getNextCreationId()`.
- **Status:** `scheduled`.
- Only dates **inside** the next week (Sunday–Saturday) are used.

---

### 5.2 Food

- **Source:** `clients.upcoming_order.deliveryDayOrders` (legacy) or `clients.upcoming_order.vendorSelections` with `itemsByDay` / `selectedDeliveryDays` (canonical). Only clients with `service_type === 'Food'` and non-empty per-day data are processed.
- For each client, each day in the week, each vendor selection → one **Food** order **only if** there isn’t already an order for that client + date + service type + vendor.
- **DB:** One row in `orders`, one in `order_vendor_selections`, multiple in `order_items` (from menu/meal items).

---

### 5.3 Meal

- **Source:** `clients.upcoming_order.mealSelections` (object keyed by meal selection; each entry can have a different vendor). Only clients with `service_type === 'Food'` or `'Meal'` and non-empty `mealSelections` are processed.
- **Multiple meal orders per client per week:** A client can have **multiple** Meal orders in the same week — one order is created **per entry** in `mealSelections`. Each entry has its own `vendorId` and `items`, so orders to **different vendors** (e.g. Breakfast from Vendor A, Lunch from Vendor B, or two breakfasts from two vendors) are fully supported. We do **not** merge or limit to one Meal order per client per week.
- Delivery date = **first** delivery day of that vendor in the week (per order).
- **DB:** `orders`, `order_vendor_selections`, `order_items`.

---

### 5.4 Boxes (combined into one order per client per week)

- **Source:** `clients.upcoming_order.boxOrders` (array of box configs for the client). Only clients with `service_type === 'Boxes'` and non-empty `boxOrders` are processed.
- **Behavior:** All of a client’s box lines for the week are combined into **one** Boxes **order** per client. There is **no grouping or merging of items** across boxes (see below).
- **Eligibility:** Client must be Boxes, and **every** entry in `boxOrders` must have a `vendorId` (and that vendor must exist).
- **Delivery date:** Earliest delivery date in the week among **all** that client’s box vendors.
- **Skip if:** The client already has **at least one** Boxes order in that week (so we only create one Boxes order per client per week).

**What “combine” means (no grouping of items):**

- We create **one** `orders` row (one order) for that client for the week.
- For **each** entry in `clients.upcoming_order.boxOrders` for that client we create **one** row in `order_box_selections` with:
  - That entry’s `vendorId`, `boxTypeId`, `quantity`, `items` (unchanged), and computed `unit_value` / `total_value`.
- So:
  - **One order** = one record in the client’s order list.
  - **Each box line** = one record in `order_box_selections` with **its own** `items` — we do **not** merge or aggregate item quantities across different boxes. What goes into the DB is exactly what each box line contains; we just attach them all to the same order so it’s one order per client per week.

Order-level totals:

- `orders.total_value` = sum of all `order_box_selections.total_value` for that order.
- `orders.total_items` = sum of all box quantities (total number of boxes).
- Notes/case on the order come from the **first** box row only.

---

### 5.5 Custom

- **Source:** Clients whose `upcoming_order.serviceType === 'Custom'` (with delivery_day, vendor, value, etc.).
- One **Custom** order per (client, delivery day, vendor) if none exists.
- **DB:** `orders`, `order_vendor_selections`, `order_items` (custom line).

---

## 6. Report and Excel — 100% accurate to the run

The report is **not** built by re-running logic or re-querying the DB after the fact. It is built from an **in-memory map that is updated as we process each client**.

- **At the start:** Every client gets one entry in `clientReportMap` with `ordersCreated: 0` and no reason.
- **As we process:**
  - Every time we call `createOrder(clientId, ...)`, we do `clientReportMap.get(clientId).ordersCreated++`.
  - When we skip a client (ineligible, no vendor, already has order, etc.), we set `clientReportMap.get(clientId).reason` to the skip reason.
- **After all processing:** We only fill in a default “reason” for clients who still have 0 orders and no reason (e.g. “No upcoming box orders”). Then we build the Excel from `clientReportMap`:
`excelData = Array.from(clientReportMap.values()).map(row => ({ 'Client ID', 'Client Name', 'Orders Created', 'Reason (if none)' }))`

So the Excel reflects **exactly** what happened during this run: same map that was updated step-by-step, no second pass of creation logic. The data is 100% accurate to what was processed.

### 6.1 Why report count can be higher than DB count (e.g. 243 vs 220)

The **vendor-by-day counts in the email** come from `recordVendorOrder()`, which is only called **after** we successfully insert both the order and its `order_vendor_selections` row. So the report count should match the DB.

If you see a **higher number in the report than in the DB** (e.g. email said 243 for a vendor/date but the vendor delivery page shows 220), possible causes:

1. **Different run:** The email was from a run that created 243; later some orders were deleted or you're counting with a different filter.
2. **Failures:** If `createOrder()` or the `order_vendor_selections` insert fails, we do **not** call `recordVendorOrder` — so that order is neither in the report nor in the DB. So 243 in report with 220 in DB would mean 23 orders were **reported** but never persisted (e.g. a bug or a second run that overwrote data). More commonly, the **reverse** happens: the report shows fewer than the DB if the run was interrupted. To see which orders failed, check **unexpectedFailures** in the API response (and the "Unexpected Failures" section in the email).
3. **Same vendor and date:** Confirm you're comparing the same vendor and delivery date in both the email and the DB/SQL count.

**Bottom line:** The report only counts orders that were successfully created (order + vendor selection). Any shortfall in the DB is from orders that failed to be created; check `errors` / unexpectedFailures for that run.

---

## 7. Batch mode (avoid timeouts)

For large client lists, a single "Create orders for the next week" request can hit server or Vercel time limits. **Batch mode** processes clients in chunks (e.g. 100 per request) so each request finishes in time; you then get **one combined export** at the end.

- **How to use:** In Global Settings, use the button **"Create orders (batched, 100 per batch)"**. No email is sent; when all batches finish, one Excel file is downloaded with all client rows merged.
- **API:** Send `POST /api/create-orders-next-week` with body `{ "batchIndex": 0, "batchSize": 100 }`. Response includes `batch: { creationId, hasMore, excelRows, vendorBreakdown, totalClients }`. For the next batch send `{ "batchIndex": 1, "batchSize": 100, "creationId": <from first response> }`. Repeat until `batch.hasMore` is false.
- **Merging:** Concatenate all `batch.excelRows` for the combined client report. Merge `batch.vendorBreakdown` by `vendorId`: sum `byDay` and `total` so you have one vendor breakdown for the whole run.

---

## 8. Excel and email

- **Sheet name:** “Next Week Report”.
- **Columns:** Client ID, Client Name, Orders Created, Vendor(s), Type(s), Reason (if no orders).
- **Filename:** `Create_Orders_Next_Week_YYYY-MM-DD_to_YYYY-MM-DD.xlsx`.
- **Email:** If `app_settings.report_email` is set, the report (and totals/breakdown) is sent via `sendSchedulingReport()` to that address. If empty, no email is sent (only a console warning).

---

## 9. Response and UI

- **Success:** `{ success: true, totalCreated, breakdown: { Food, Meal, Boxes, Custom }, weekStart, weekEnd }`. UI shows the green message and refreshes creation IDs.
- **Failure:** `{ success: false, error }` with HTTP 500. UI shows the error in red.
- The button is disabled with “Creating Orders...” during the request and re-enabled when the request finishes.

---

## 10. Quick reference


| Topic                           | Answer                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Meal: one order or many?        | **Many.** One Meal order per `mealSelections` entry; multiple orders per client per week and to different vendors are supported.    |
| Boxes: one order or many?       | **One** Boxes order per client per week.                                                                                            |
| Boxes: do we merge/group items? | **No.** Each box line stays as its own `order_box_selections` row with its own `items`. We only “put them together” into one order. |
| Excel: when is it built?        | From the same map we update **while** processing. No re-run of logic.                                                               |
| Excel: accurate?                | **Yes.** The data is 100% accurate to what was processed in that run.                                                               |


