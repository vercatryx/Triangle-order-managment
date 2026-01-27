# Create Orders - Detailed Technical Report

## Overview

The "Create Orders" functionality is triggered when an admin clicks the "Create Orders" button in the sidebar. This button calls the `/api/simulate-delivery-cycle` endpoint, which processes all scheduled upcoming orders and creates actual orders in the `orders` table based on vendor cutoff times, delivery days, and order type-specific rules.

---

## Entry Point: User Interaction

**Location:** `components/Sidebar.tsx` (lines 111-179)

**Button Handler:** `handleSimulateRun()`

**Flow:**
1. User clicks "Create Orders" button
2. Confirmation dialog: "This will create orders for all scheduled upcoming orders. The original Upcoming Orders will be preserved. Proceed?"
3. If confirmed, makes POST request to `/api/simulate-delivery-cycle`
4. Displays results including:
   - Total orders found
   - Orders created
   - Orders skipped (with reasons)
   - Errors (if any)

---

## API Endpoint: `/api/simulate-delivery-cycle`

**Location:** `app/api/simulate-delivery-cycle/route.ts`

**Method:** POST

**Access:** Public (no authentication required per user request)

---

## Step-by-Step Execution Flow

### Phase 1: Initialization and Data Loading

**Timing:** Immediate (0ms)

1. **Get Current Time**
   - Uses `getCurrentTime()` from `lib/time.ts`
   - Supports fake time override for testing
   - Sets `today` to midnight (00:00:00)

2. **Load Reference Data (Parallel Fetch)**
   - **Vendors:** `id, name, email, service_type, delivery_days, delivery_frequency, is_active, minimum_meals, cutoff_hours`
   - **Client Statuses:** `id, name, is_system_default, deliveries_allowed`
   - **Menu Items:** `id, vendor_id, name, value, price_each, is_active, category_id, minimum_order, image_url, sort_order`
   - **Breakfast Items:** `id, category_id, name, quota_value, price_each, is_active, vendor_id, image_url, sort_order`
   - **App Settings:** Full settings including `report_email`
   - **Box Types:** `id, name`

3. **Load Clients**
   - Fetches all clients where `parent_client_id IS NULL` (excludes dependents)
   - Fields: `id, full_name, status_id, service_type, parent_client_id`

4. **Initialize Client Status Map**
   - Creates tracking map for Excel report generation
   - Pre-populates with initial status messages for each client

---

### Phase 2: Order Type Processing

The system processes orders in the following sequence:

1. **Food Orders** (Parallel batch processing)
2. **Meal Orders** (Parallel batch processing)
3. **Box Orders** (Parallel batch processing)
4. **Custom Orders** (Parallel batch processing)

Each order type has **distinct timing and cutoff logic**.

---

## Order Type 1: FOOD Orders

**Source Table:** `client_food_orders`

**Data Structure:** `delivery_day_orders` JSON field containing:
```json
{
  "Monday": {
    "vendorSelections": [
      {
        "vendorId": "vendor-id",
        "items": { "item-id": quantity },
        "itemNotes": { "item-id": "note text" }
      }
    ]
  },
  "Wednesday": { ... }
}
```

### Timing Logic for Food Orders

**Key Rule:** **STRICT SINGLE-DAY WINDOW** - Orders are created ONLY on the exact cutoff day.

**Calculation Steps:**

1. **Get Vendor Cutoff Days**
   - Reads `vendor.cutoffDays` (stored as `cutoff_hours` in DB, but treated as days)
   - Default: `0` if not set

2. **Calculate Target Date**
   ```javascript
   const cutoff = vendor.cutoffDays || 0;
   const targetDate = new Date(today);
   targetDate.setDate(today.getDate() + cutoff);
   const targetDayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });
   ```

3. **Match Delivery Day**
   - Compares `targetDayName` with the day name in `delivery_day_orders`
   - **Example:**
     - Today = Monday
     - Vendor cutoff = 2 days
     - Target date = Wednesday
     - Target day name = "Wednesday"
     - Only processes orders scheduled for "Wednesday"

4. **Skip Logic**
   - If `targetDayName !== dayName` → Skip with message: "Not today's target (Next delivery: {dayName})"

### Example Scenarios

**Scenario A: Same-Day Delivery (Cutoff = 0)**
- Today: Monday
- Cutoff: 0 days
- Target Date: Monday
- Target Day: "Monday"
- **Result:** Creates orders for Monday delivery

**Scenario B: 2-Day Advance (Cutoff = 2)**
- Today: Monday
- Cutoff: 2 days
- Target Date: Wednesday
- Target Day: "Wednesday"
- **Result:** Creates orders for Wednesday delivery
- **Note:** If client has orders for Monday, Tuesday, or Thursday, they are **skipped**

**Scenario C: Weekend Cutoff**
- Today: Friday
- Cutoff: 2 days
- Target Date: Sunday
- Target Day: "Sunday"
- **Result:** Creates orders for Sunday delivery

### Duplicate Prevention

Before creating an order, the system checks for duplicates:

1. **Check Existing Orders**
   ```javascript
   const { count } = await supabase
     .from('orders')
     .select('*', { count: 'exact', head: true })
     .eq('client_id', clientId)
     .eq('scheduled_delivery_date', deliveryDate.toISOString().split('T')[0])
     .eq('service_type', 'Food');
   ```

2. **Check Vendor Selection**
   - If order exists, checks if same vendor is already selected
   - Prevents duplicate orders for same client + date + vendor

### Order Creation Process

1. **Calculate Totals**
   - Iterates through `sel.items` (itemId → quantity map)
   - Looks up item prices from `menuItemMap` or `mealItemMap`
   - Calculates: `itemsTotal` (sum of quantities), `valueTotal` (sum of price × quantity)

2. **Assign Order Number**
   - Atomic increment: `nextOrderNumber++`
   - Starts at `Math.max(100000, (maxOrderData?.order_number || 0) + 1)`

3. **Create Order Record**
   ```javascript
   {
     client_id: clientId,
     service_type: 'Food',
     status: 'scheduled',
     scheduled_delivery_date: deliveryDate.toISOString().split('T')[0],
     total_value: valueTotal,
     total_items: itemsTotal,
     order_number: assignedId,
     created_at: currentTime.toISOString(),
     last_updated: currentTime.toISOString(),
     notes: notes,
     case_id: caseId || `CASE-${Date.now()}`
   }
   ```

4. **Create Vendor Selection**
   - Inserts into `order_vendor_selections`
   - Links order to vendor

5. **Create Order Items**
   - Inserts into `order_items` for each item in selection
   - Includes: `menu_item_id`, `quantity`, `unit_value`, `total_value`, `notes`

---

## Order Type 2: MEAL Orders

**Source Table:** `client_meal_orders`

**Data Structure:** `meal_selections` JSON field:
```json
{
  "Breakfast": {
    "vendorId": "vendor-id",
    "items": { "item-id": quantity },
    "itemNotes": { "item-id": "note text" }
  },
  "Lunch": { ... }
}
```

### Timing Logic for Meal Orders

**Key Rule:** **Evaluated EVERY time. At most ONE per week.**

**Calculation Steps:**

1. **Extract Vendor**
   - Finds first vendor in `meal_selections` structure
   - Uses that vendor's cutoff for date calculation

2. **Calculate Minimum Date (After Cutoff)**
   ```javascript
   const cutoff = vendor.cutoffDays || 0;
   const minDate = new Date(today);
   minDate.setDate(today.getDate() + cutoff);
   ```

3. **Find Earliest Valid Delivery Day**
   - Gets vendor's `deliveryDays` array (e.g., `["Monday", "Wednesday"]`)
   - Scans next 7 days from `minDate` to find first matching day
   ```javascript
   for (let i = 0; i < 7; i++) {
     const d = new Date(minDate);
     d.setDate(minDate.getDate() + i);
     const dName = d.toLocaleDateString('en-US', { weekday: 'long' });
     if (validDays.includes(dName)) {
       candidateDate = d;
       break;
     }
   }
   ```

4. **Weekly Limit Check**
   - Calculates week boundaries (Sunday to Saturday) for `candidateDate`
   - Checks if any Meal order exists for this client in that week:
   ```javascript
   const { count } = await supabase
     .from('orders')
     .select('*', { count: 'exact', head: true })
     .eq('client_id', clientId)
     .eq('service_type', 'Meal')
     .gte('scheduled_delivery_date', weekStart.toISOString().split('T')[0])
     .lte('scheduled_delivery_date', weekEnd.toISOString().split('T')[0]);
   ```
   - If count > 0 → Skip with message: "Weekly limit reached - order already exists for this week"

### Example Scenarios

**Scenario A: Cutoff = 2, Delivery Days = ["Monday", "Wednesday"]**
- Today: Friday
- Cutoff: 2 days
- Min Date: Sunday
- Scan: Sunday (not in list) → Monday (match!)
- **Result:** Creates order for Monday delivery

**Scenario B: Weekly Limit**
- Today: Monday
- Candidate Date: Wednesday
- Week: Sunday to Saturday
- Check: Order already exists for this week
- **Result:** Skipped

**Scenario C: Multiple Vendors in Selections**
- Meal selections contain Breakfast (Vendor A) and Lunch (Vendor B)
- Uses **first vendor found** for cutoff calculation
- Creates single order with multiple vendor selections

### Order Creation Process

1. **Create Order Shell**
   - Initial order with `total_value: 0`, `total_items: 0`
   - Gets order ID for linking items

2. **Group by Vendor**
   - Processes all meal types (Breakfast, Lunch, etc.)
   - Groups items by `vendorId`
   - Merges quantities for same items across meal types

3. **Create Vendor Selections**
   - One `order_vendor_selections` record per vendor

4. **Create Order Items**
   - Inserts items for each vendor selection
   - Updates order totals after all items inserted

5. **Update Order Totals**
   ```javascript
   await supabase.from('orders').update({
     total_value: orderTotalValue,
     total_items: orderTotalItems
   }).eq('id', newOrder.id);
   ```

---

## Order Type 3: BOX Orders

**Source Table:** `client_box_orders`

**Data Structure:**
- `vendor_id`: Direct vendor reference
- `box_type_id`: Box type reference
- `quantity`: Number of boxes
- `items`: JSON object `{ "item-id": quantity }`

### Timing Logic for Box Orders

**Key Rule:** **Evaluated EVERY time. At most ONE per week.**

**Calculation Steps:**

1. **Get Vendor**
   - Directly from `template.vendor_id`

2. **Calculate Minimum Date (After Cutoff)**
   ```javascript
   const cutoff = vendor.cutoffDays || 0;
   const minDate = new Date(today);
   minDate.setDate(today.getDate() + cutoff);
   ```

3. **Find Earliest Valid Delivery Day**
   - Same logic as Meal orders
   - Scans next 7 days from `minDate` for vendor's delivery days

4. **Weekly Limit Check**
   - Same as Meal orders
   - Checks for existing Box order in the week of `candidateDate`

### Example Scenarios

**Scenario A: Standard Box Order**
- Today: Tuesday
- Cutoff: 3 days
- Min Date: Friday
- Vendor delivers: Monday, Friday
- Scan: Friday (match!)
- **Result:** Creates order for Friday delivery

**Scenario B: Weekend Delivery**
- Today: Thursday
- Cutoff: 1 day
- Min Date: Friday
- Vendor delivers: Saturday
- Scan: Saturday (match!)
- **Result:** Creates order for Saturday delivery

### Order Creation Process

1. **Calculate Box Value**
   - Iterates through `items` object
   - Looks up menu item prices
   - Calculates: `boxValue = sum(price × quantity)` for all items in box
   - `totalBoxValue = boxValue × boxQuantity`

2. **Create Order**
   - Includes `total_value: totalBoxValue`, `total_items: boxQuantity`

3. **Create Box Selection**
   ```javascript
   {
     order_id: newOrder.id,
     vendor_id: vendorId,
     box_type_id: boxTypeId,
     quantity: boxQuantity,
     unit_value: boxValue,
     total_value: totalBoxValue,
     items: template.items
   }
   ```

---

## Order Type 4: CUSTOM Orders

**Source Table:** `upcoming_orders` (filtered by `service_type = 'Custom'`)

**Data Structure:**
- `delivery_day`: Day name string (e.g., "Monday")
- `total_value`: Custom price
- `notes`: Custom description
- Related: `upcoming_order_vendor_selections`, `upcoming_order_items`

### Timing Logic for Custom Orders

**Key Rule:** **STRICT SINGLE-DAY WINDOW** (same as Food orders)

**Calculation Steps:**

1. **Get Vendor**
   - Fetches from `upcoming_order_vendor_selections` table

2. **Calculate Target Date**
   ```javascript
   const cutoff = vendor.cutoffDays || 0;
   const targetDate = new Date(today);
   targetDate.setDate(today.getDate() + cutoff);
   const targetDayName = targetDate.toLocaleDateString('en-US', { weekday: 'long' });
   ```

3. **Match Delivery Day**
   - Compares `targetDayName` with `upcoming_order.delivery_day`
   - If not equal → Skip

4. **Weekly Limit Check**
   - Same as Meal/Box orders
   - Prevents multiple Custom orders per week

### Example Scenarios

**Scenario A: Custom Order on Cutoff Day**
- Today: Monday
- Cutoff: 2 days
- Target Date: Wednesday
- Upcoming order `delivery_day`: "Wednesday"
- **Result:** Creates order for Wednesday

**Scenario B: Wrong Day**
- Today: Monday
- Cutoff: 2 days
- Target Date: Wednesday
- Upcoming order `delivery_day`: "Friday"
- **Result:** Skipped (not today's target)

### Order Creation Process

1. **Create Order**
   - Uses `total_value` from upcoming order
   - `total_items: 1`

2. **Create Vendor Selection**
   - Links to vendor from upcoming order

3. **Copy Items**
   - Fetches items from `upcoming_order_items`
   - Creates `order_items` with:
     - `menu_item_id: null` (custom items)
     - `custom_name`: From upcoming item
     - `custom_price`: From upcoming item
     - `quantity`, `unit_value`, `total_value`

4. **Fallback Item Creation**
   - If no items in upcoming order, creates single item from `notes` or `custom_name`
   - Splits comma-separated names into multiple items if needed

---

## Client Eligibility Checks

**Applied to ALL order types before processing:**

1. **Client Exists**
   - Must be in `clientMap`

2. **Status Allows Deliveries**
   ```javascript
   function isClientEligible(clientId: string): boolean {
     const client = clientMap.get(clientId);
     if (!client) return false;
     const status = statusMap.get(client.status_id);
     return status?.deliveriesAllowed ?? false;
   }
   ```

3. **Service Type Match**
   - Food orders: `client.service_type === 'Food'`
   - Meal orders: `client.service_type === 'Food' OR 'Meal'`
   - Box orders: `client.service_type === 'Boxes'`
   - Custom orders: No service type restriction (any client can have custom)

---

## Cutoff Time Calculation Details

### Vendor Cutoff Storage

- **Database Field:** `vendors.cutoff_hours` (stored as integer)
- **Code Interpretation:** Treated as **days** (not hours) in the codebase
- **Default:** `0` if not set

### Cutoff Logic

**Formula:**
```
Target Date = Today + Cutoff Days
Target Day Name = Day of week for Target Date
```

**Example:**
- Today: Monday, January 20, 2025
- Cutoff: 2 days
- Target Date: Wednesday, January 22, 2025
- Target Day Name: "Wednesday"

### Cutoff Comparison

**For Food & Custom Orders:**
- **Exact Match Required:** `targetDayName === deliveryDay`
- If not exact match → Order is skipped

**For Meal & Box Orders:**
- **Earliest Valid Day:** Finds first delivery day >= (Today + Cutoff)
- No exact match requirement, but must respect cutoff

---

## Parallel Processing

**Batch Size:** 15 orders per batch

**Implementation:**
```javascript
async function processBatch<T>(items: T[], fn: (item: T) => Promise<void>, batchSize = 15) {
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await Promise.all(chunk.map(fn));
  }
}
```

**Benefits:**
- Faster execution for large datasets
- Reduces total processing time
- Maintains order number atomicity (sequential increment)

---

## Order Number Assignment

**Location:** Lines 507-514 in `simulate-delivery-cycle/route.ts`

**Process:**
1. **Get Max Order Number**
   ```javascript
   const { data: maxOrderData } = await supabase
     .from('orders')
     .select('order_number')
     .order('order_number', { ascending: false })
     .limit(1)
     .maybeSingle();
   ```

2. **Calculate Starting Number**
   ```javascript
   let nextOrderNumber = Math.max(100000, (maxOrderData?.order_number || 0) + 1);
   ```

3. **Atomic Increment**
   - Each order gets: `assignedId = nextOrderNumber++`
   - Ensures unique, sequential order numbers

**Range:** Starts at 100,000 minimum

---

## Duplicate Prevention Mechanisms

### 1. Food Orders
- Checks: `client_id` + `scheduled_delivery_date` + `service_type` + `vendor_id`
- Prevents same client ordering from same vendor on same day

### 2. Meal Orders
- Checks: `client_id` + `service_type` + week range
- Prevents multiple Meal orders per week

### 3. Box Orders
- Checks: `client_id` + `service_type` + week range
- Prevents multiple Box orders per week

### 4. Custom Orders
- Checks: `client_id` + `service_type` + week range
- Prevents multiple Custom orders per week

---

## Error Handling

### Client-Level Errors
- **Client Not Found:** Logged, skipped
- **Status Doesn't Allow Deliveries:** Skipped with reason
- **Service Type Mismatch:** Skipped with reason

### Order Creation Errors
- **Database Insert Failures:** Logged to `report.unexpectedFailures`
- **Vendor Selection Failures:** Logged, order creation continues
- **Item Insert Failures:** Logged, partial order may be created

### Error Reporting
- All errors collected in `errors` array
- Included in response JSON
- Logged to console with `[Unified Scheduling]` prefix

---

## Reporting and Email

### Excel Report Generation

**Location:** Lines 1199-1239

**Data Included:**
- Customer Name
- Order Created (Yes/No)
- Scheduled Delivery Date
- Vendor
- Summary (order details)
- Food Orders Status
- Meal Orders Status
- Box Orders Status
- Custom Orders Status

**File Format:** `.xlsx` (Excel)

**Filename:** `Order_Scheduling_Report_{YYYY-MM-DD}.xlsx`

### Email Sending

**Function:** `sendSchedulingReport()` from `lib/email-report.ts`

**Recipient:** `settings.report_email`

**Attachments:**
- Excel report file

**Content:**
- Summary statistics
- Breakdown by order type
- Unexpected failures list

---

## Response Format

```json
{
  "success": true,
  "reportEmail": "admin@example.com",
  "emailProvider": "provider-name",
  "report": {
    "totalCreated": 42,
    "breakdown": {
      "Food": 20,
      "Meal": 10,
      "Boxes": 8,
      "Custom": 4
    },
    "unexpectedFailures": [
      {
        "clientName": "Client Name",
        "orderType": "Food",
        "date": "2025-01-22",
        "reason": "Error message"
      }
    ]
  }
}
```

---

## Timing Summary Table

| Order Type | Cutoff Logic | Creation Window | Weekly Limit |
|------------|--------------|-----------------|--------------|
| **Food** | Exact match: `Today + Cutoff = Delivery Day` | Single day only | No (can create multiple per week) |
| **Meal** | Earliest day >= `Today + Cutoff` | Flexible (first valid day) | Yes (max 1 per week) |
| **Boxes** | Earliest day >= `Today + Cutoff` | Flexible (first valid day) | Yes (max 1 per week) |
| **Custom** | Exact match: `Today + Cutoff = Delivery Day` | Single day only | Yes (max 1 per week) |

---

## Key Code Locations

1. **Button Handler:** `components/Sidebar.tsx:111-179`
2. **API Endpoint:** `app/api/simulate-delivery-cycle/route.ts`
3. **Date Utilities:** `lib/order-dates.ts`
4. **Time Context:** `lib/time-context.tsx`
5. **Time Helper:** `lib/time.ts`

---

## Important Notes

1. **Cutoff Interpretation:** Despite field name `cutoff_hours`, the code treats it as **days**
2. **Time Override:** System supports fake time for testing via `TimeWidget` in sidebar
3. **Dependents Excluded:** Only processes clients where `parent_client_id IS NULL`
4. **Status Filtering:** Only processes clients whose status allows deliveries
5. **Parallel Safety:** Batch processing prevents race conditions for same client
6. **Order Preservation:** Original upcoming orders are **not deleted**, only copied to `orders` table
7. **Case ID Generation:** Uses `CASE-{timestamp}-{random}` format if not provided

---

## Example Execution Timeline

**Scenario: Monday, 9:00 AM, Processing 100 clients**

1. **0ms:** Button clicked, confirmation shown
2. **100ms:** POST request sent to `/api/simulate-delivery-cycle`
3. **200ms:** Data loading begins (parallel fetches)
4. **500ms:** Data loaded, processing begins
5. **1000ms:** Food orders processed (batch 1-15)
6. **2000ms:** Food orders processed (batch 16-30)
7. **3000ms:** Meal orders processed
8. **4000ms:** Box orders processed
9. **5000ms:** Custom orders processed
10. **6000ms:** Excel report generated
11. **7000ms:** Email sent
12. **8000ms:** Response returned to frontend

**Total Time:** ~8 seconds for 100 clients

---

## Conclusion

The "Create Orders" functionality is a sophisticated system that:
- Respects vendor-specific cutoff times
- Handles four distinct order types with different rules
- Prevents duplicates through multiple checks
- Processes orders in parallel for performance
- Generates comprehensive reports
- Maintains data integrity through atomic operations

The timing logic ensures orders are created at the correct time based on vendor cutoffs, delivery days, and order type-specific rules, providing a reliable automated order creation system.
