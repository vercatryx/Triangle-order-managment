# Create Orders Next Week — Diagnosis Report

## Summary of Debug Script Results

Comparing files in `debug/`:
- **current.xlsx**: 37 orders, all for **2026-02-09 only**, 0 clients with orders on multiple days
- **Rise Wellness Feb 9**: 69 orders
- **Rise Wellness Feb 11**: 11 orders
- **Combined Rise Wellness**: 80 orders (69 + 11)
- **46 clients** appear in Rise Wellness files but NOT in current

### Key Findings

1. **Current is limited to one day** — Only Feb 9; no Feb 11 orders
2. **Current has exactly one order per client** — 37 clients, 37 orders, 0 with multiple days
3. **Current has fewer orders than Rise Wellness Feb 9 alone** — 37 vs 69, so current is not a full "all vendors" export
4. **Rise Wellness has orders on two days** — Feb 9 (69) and Feb 11 (11)

---

## Potential Causes (Diagnosis Only)

### 1. Food Orders Source: `deliveryDayOrders` Only

**Location:** `app/api/create-orders-next-week/route.ts` lines 82–89

```ts
const foodOrders = (clients || [])
    .filter((c: any) => c.service_type === 'Food' && c.upcoming_order?.deliveryDayOrders)
```

- Food orders are derived **only** from `upcoming_order.deliveryDayOrders`
- The audit script (`scripts/audit-upcoming-order-shape.ts`) shows **0 clients** in the old shape (deliveryDayOrders)
- All Food/Meal clients use **vendorSelections** (with itemsByDay)
- **Effect:** If no clients have `deliveryDayOrders`, `foodOrders` is empty and **no Food orders are created**

### 2. Meal Orders: One Delivery Date per Vendor

**Location:** `app/api/create-orders-next-week/route.ts` lines 331–334

```ts
const deliveryDate = getFirstDeliveryDateInWeek(nextWeekStart, vendor.deliveryDays);
```

- Meal orders use `getFirstDeliveryDateInWeek` → **first** delivery day for that vendor
- **Effect:** One Meal order per client per vendor per week, not per day
- A client with Meal on Monday and Wednesday gets **one** order (on the first delivery day only)

### 3. `orderExists` Query: Possible Non-Determinism

**Location:** `app/api/create-orders-next-week/route.ts` lines 223–241

```ts
const { data: existing } = await supabase
    .from('orders')
    .select('id')
    .eq('client_id', clientId)
    .eq('scheduled_delivery_date', deliveryDateStr)
    .eq('service_type', serviceType)
    .limit(1)
    .maybeSingle();
if (!existing) return false;
if (vendorId) {
    const { count } = await supabase
        .from('order_vendor_selections')
        .select('*', { count: 'exact', head: true })
        .eq('order_id', existing.id)
        .eq('vendor_id', vendorId);
    return (count ?? 0) > 0;
}
```

- Query uses `.limit(1)` with no `.order()` → row order is undefined
- A client can have multiple Food orders (e.g. Mon and Wed, same vendor)
- When checking Feb 11, the query could return the Feb 9 order; then the vendor check on that order would fail (different date), so we’d return false and create a new order
- When checking Feb 9, it could return the Feb 11 order; vendor check would fail → we’d create a duplicate Feb 9 order
- **Conclusion:** Logic is correct; non-determinism may affect which row is returned, but should not block creation

### 4. No Explicit “One Order per Client” Limit

- The Food loop iterates: `for (dayName) { for (vendorSelection) { ... createOrder() } }`
- There is no logic that limits to one order per client
- **Conclusion:** No intentional “one per client” cap in the Food flow

### 5. Origin of “current.xlsx”

- Same structure as Rise Wellness files (Order Number, Order ID, Client ID, etc.) → vendor orders export (VendorDetail / VendorDeliveryOrders)
- If “current” is meant to be “all orders for the week”, it’s inconsistent: 37 rows vs 80 for Rise Wellness alone
- Possible explanations:
  - Export filtered by vendor (non–Rise Wellness vendor with 37 orders on Feb 9)
  - Export filtered by date (only Feb 9)
  - Bug in the “all vendors” export
- **Recommendation:** Confirm how “current.xlsx” was generated (which vendor, which date range, which UI action)

---

## Recommendations for Further Debugging

1. **Verify Food order source:** Add a temporary script that:
   - Reads clients with Food service type
   - Checks `upcoming_order.deliveryDayOrders` vs `upcoming_order.vendorSelections`
   - Counts how many would contribute to `foodOrders` with the current filter

2. **Trace expected vs created orders:** Script that:
   - Builds expected Food orders from `vendorSelections` + `itemsByDay` (if we add support)
   - Compares to what Create Orders Next Week actually creates

3. **Clarify “current” export:** Determine:
   - Exact export flow used
   - Vendor and date filters applied
   - Whether it’s intended to include all vendors and all delivery days

---

## Temporary Debug Scripts Created

- `scripts/debug-compare-orders-xlsx.ts` — Compares order counts and structure across current vs Rise Wellness day files
- `scripts/audit-upcoming-order-shape.ts` — Audits how many clients use deliveryDayOrders vs vendorSelections
