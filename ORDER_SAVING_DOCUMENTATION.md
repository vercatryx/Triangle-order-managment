# Order Saving Logic Documentation

This document explains exactly how each order type is saved in the Triangle Order Management system.

## Overview of Saving Flows

There are two primary distinct saving flows:
1.  **Scheduled Orders (Profile Configuration)**: Saved to a configuration table (`client_food_orders`, etc.), then synced to `upcoming_orders`. These become actual `orders` later based on delivery cycles.
    *   *Applies to:* Food, Meal, Boxes, Custom (Profile)
2.  **Direct Orders**: Created directly in the `orders` table immediately.
    *   *Applies to:* Equipment

---

## 1. Food Orders (`ServiceType: 'Food'`)

Food orders allow clients to select specific menu items for specific delivery days from various vendors.

### Saving Process: `saveClientFoodOrder`
**Location:** `lib/actions.ts`

1.  **Input:** Client ID, Case ID, Delivery Day Orders (JSON), Notes.
2.  **Database Target:** `client_food_orders` table.
    *   **Logic:** Checks if a record exists for the `client_id`.
    *   **Action:** Performs an `UPDATE` if it exists, or `INSERT` if it's new.
    *   **Data Stored:** The entire `deliveryDayOrders` JSON object is stored in the `delivery_day_orders` column.
3.  **Sync to Upcoming:**
    *   After saving configuration, the system calls `appendOrderHistory` (type: 'upcoming') to log the change.
    *   It triggers a sync (e.g., via background local DB update or explicit sync call) that transforms this configuration into records in the `upcoming_orders` table.
4.  **Result:** The client has a persistent "Food Profile" that generates weekly orders.

---

## 2. Meal Orders (`ServiceType: 'Meal'`)

Meal orders are organized by meal type (Breakfast, Lunch, Dinner) rather than just items.

### Saving Process: `saveClientMealOrder`
**Location:** `lib/actions.ts`

1.  **Input:** Client ID, Case ID, Meal Selections (JSON), Notes.
2.  **Database Target:** `client_meal_orders` table.
    *   **Logic:** One record per client.
    *   **Action:** `UPDATE` if exists, `INSERT` if new.
    *   **Data Stored:** `meal_selections` JSON column stores the structure `{ "Breakfast": { ... }, "Lunch": { ... } }`.
3.  **Sync:** Similar to Food Orders, this updates the configuration table which then drives the `upcoming_orders` generation.
4.  **History:** Updates are logged to `client.order_history`.

---

## 3. Box Orders (`ServiceType: 'Boxes'`)

Box orders allow clients to subscribe to specific box types (e.g., "Veggie Box") from vendors. A client can have multiple box subscriptions.

### Saving Process: `saveClientBoxOrder`
**Location:** `lib/actions.ts`

1.  **Input:** Client ID, List of Box Orders (Array).
2.  **Database Target:** `client_box_orders` table.
3.  **Strategy: Full Replacement**
    *   **Step 1:** `DELETE FROM client_box_orders WHERE client_id = X`. (Removes *all* existing box configs for this client).
    *   **Step 2:** `INSERT` new rows for every box order in the list.
    *   **Why?** Since a client can have N boxes, it's safer to wipe and replace than to diff/patch individual rows.
4.  **Data Stored:** Each row contains `box_type_id`, `vendor_id`, `quantity`, `items` (custom contents), and `item_notes`.
5.  **Sync:** These rows are read to generate the corresponding `upcoming_orders` entries.

---

## 4. Custom Orders (`ServiceType: 'Custom'`)

Custom orders are unique requesting specific items not in the catalog.

### Saving Process: `saveClientCustomOrder`
**Location:** `lib/actions.ts` (Client Profile Context)

1.  **Input:** Client ID, Vendor ID, Description, Price, Delivery Day.
2.  **Database Target:** `upcoming_orders` table (Directly).
    *   *Note:* Unlike Food/Meal/Box, there is no "client_custom_orders" configuration table. Custom orders are scheduled directly as one-off or recurring scheduled items in `upcoming_orders`.
3.  **Exclusive Logic:**
    *   **Step 1:** Fetches **ALL** existing `upcoming_orders` for the client.
    *   **Step 2:** **DELETES** all of them (Food, Box, Meal, etc.) and their related selections/items.
    *   **Reasoning:** Determining that a "Custom" order replaces the standard weekly flow for that period.
4.  **Creation:**
    *   Inserts a new row into `upcoming_orders` with `service_type = 'Custom'`.
    *   Creates linked `upcoming_order_vendor_selections`.
    *   Creates linked `upcoming_order_items` (with `custom_name` and `custom_price`, `menu_item_id` is NULL).

---

## 5. Equipment Orders (`ServiceType: 'Equipment'`)

Equipment orders (e.g., Walkers, Monitors) are one-off purchases, not weekly subscriptions.

### Saving Process: `saveEquipmentOrder`
**Location:** `lib/actions-write.ts` (or imported via actions)

1.  **Input:** Client ID, Vendor ID, Equipment ID.
2.  **Database Target:** `orders` table (Active Orders).
    *   *Note:* Bypasses `upcoming_orders`. Equipment orders are considered immediate/pending upon save.
3.  **Process:**
    *   Calculates `scheduled_delivery_date` based on vendor's next available delivery day.
    *   **Inserts** directly into `orders`.
    *   **Metadata:** Stores equipment details (Name, Price) as a JSON string in the `orders.notes` column.
    *   **No Order Items:** Does *not* create rows in `order_items`. It relies on the `order_vendor_selections` and the JSON notes.

---

## Summary Table

| Order Type | Config Table | Staging Table | Final Table | Logic Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Food** | `client_food_orders` | `upcoming_orders` | `orders` | Update/Insert Single Record |
| **Meal** | `client_meal_orders` | `upcoming_orders` | `orders` | Update/Insert Single Record |
| **Boxes** | `client_box_orders` | `upcoming_orders` | `orders` | **Delete All & Replace** |
| **Custom** | *None* | `upcoming_orders` | `orders` | **Delete All Upcoming & Insert New** |
| **Equipment**| *None* | *Skipped* | `orders` | Direct Insert (Immediate) |
