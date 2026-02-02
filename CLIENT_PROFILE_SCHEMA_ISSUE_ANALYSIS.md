# Client Profile Schema Issue Analysis

## Problem Summary

Upcoming orders show in the sidebar but disappear when clicking into the client detail page. This affects some clients (like CLIENT-562 - Dovid Grunbaum) but not others.

## Root Cause Analysis

### Issue 1: Schema Mismatch in Code (Line 616)

**Location:** `lib/local-db.ts` line 616 in `getActiveOrderForClientLocal()`

**Problem:**
```typescript
// Line 616 - WRONG FIELD NAME
? db.upcomingOrderItems.filter(item => item.upcoming_vendor_selection_id === vs.id)
```

**Should be:**
```typescript
// CORRECT FIELD NAME
? db.upcomingOrderItems.filter(item => item.vendor_selection_id === vs.id)
```

**Impact:** This bug would cause ALL upcoming orders accessed through `getActiveOrderForClientLocal()` to fail to load items, making orders appear empty.

**Evidence:**
- All 51 items in local database use `vendor_selection_id` (not `upcoming_vendor_selection_id`)
- Database sync code (line 288) uses `vendor_selection_id`
- Other functions (lines 733, 774, 791, 862, 903, 921) correctly use `vendor_selection_id`

### Issue 2: Missing Vendor Selections (CLIENT-562 Specific)

**Client:** CLIENT-562 (Dovid Grunbaum)

**Upcoming Order Details:**
- Order ID: `cfb3bb2f-f4ed-4e12-add5-1a620edc7869`
- Service Type: `Food`
- Status: `scheduled`
- Created: `2026-01-21T15:01:26.782068+00:00`
- **Vendor Selections: 0** ⚠️
- **Total Value: 0**
- **Total Items: 0**
- **Delivery Day: null**

**Problem:** This order has NO vendor selections, which means:
1. No items can be linked to it
2. The order appears empty
3. It might show in sidebar (order exists) but disappears in detail view (no data to display)

**Why This Happens:**
- Order was created in `upcoming_orders` table
- But vendor selections were never created in `upcoming_order_vendor_selections`
- This could happen if:
  - Sync was interrupted
  - Error occurred during `syncCurrentOrderToUpcoming()`
  - Order was created manually or through a different path

## Data Structure Analysis

### Local Database Field Names

**All items use:**
- `vendor_selection_id` ✅ (correct)
- `upcoming_order_id` ✅ (correct)

**No items use:**
- `upcoming_vendor_selection_id` ❌ (doesn't exist)

### Sample Item Structure

```json
{
  "id": "5674adea-5d58-4011-b390-425541eaebdd",
  "upcoming_order_id": "fadfcacc-e7cd-4435-bec6-31595218a965",
  "vendor_selection_id": "09e41705-1fa9-468b-a979-2653165d315e",
  "menu_item_id": null,
  "meal_item_id": null,
  "quantity": 1,
  "unit_value": 0,
  "total_value": 0,
  "custom_name": "test 1\ntest 2",
  "custom_price": 1345,
  "notes": null,
  "created_at": "2026-01-28T17:39:15.001465+00:00"
}
```

## Why Some Clients Work and Others Don't

### Working Clients
- Have vendor selections in `upcoming_order_vendor_selections`
- Have items linked via `vendor_selection_id`
- Orders have `total_value > 0` and `total_items > 0`

### Non-Working Clients (like CLIENT-562)
- Missing vendor selections (0 vendor selections)
- No items to display
- `total_value = 0` and `total_items = 0`
- May have `delivery_day = null`

## Code Locations to Fix

### 1. Fix Schema Mismatch

**File:** `lib/local-db.ts`
**Line:** 616
**Function:** `getActiveOrderForClientLocal()`

**Change:**
```typescript
// BEFORE (WRONG):
const items = order.is_upcoming
    ? db.upcomingOrderItems.filter(item => item.upcoming_vendor_selection_id === vs.id)
    : db.orderItems.filter(item => item.vendor_selection_id === vs.id);

// AFTER (CORRECT):
const items = order.is_upcoming
    ? db.upcomingOrderItems.filter(item => item.vendor_selection_id === vs.id)
    : db.orderItems.filter(item => item.vendor_selection_id === vs.id);
```

### 2. Data Integrity Check

**Recommendation:** Add validation to detect and fix orphaned upcoming orders:

```typescript
// Check for upcoming orders without vendor selections
const orphanedOrders = db.upcomingOrders.filter(order => {
    const hasVendorSelections = db.upcomingOrderVendorSelections.some(
        vs => vs.upcoming_order_id === order.id
    );
    return order.status === 'scheduled' && !hasVendorSelections;
});
```

## Recommendations

1. **Fix the schema mismatch** on line 616 immediately
2. **Add data validation** to detect orphaned orders
3. **Investigate why CLIENT-562's order has no vendor selections:**
   - Check if there was an error during sync
   - Verify if the order was created through a different path
   - Check logs around `2026-01-21T15:01:26` for errors
4. **Add error handling** in `syncCurrentOrderToUpcoming()` to ensure vendor selections are always created
5. **Consider data cleanup script** to remove or fix orphaned upcoming orders

## Testing Checklist

After fixing:
- [ ] Verify CLIENT-562's order loads correctly (if vendor selections are added)
- [ ] Test other clients with upcoming orders
- [ ] Verify sidebar and detail view show same data
- [ ] Check that orders with `delivery_day = null` still work
- [ ] Test orders with multiple vendor selections

## Related Files

- `lib/local-db.ts` - Local database access (line 616 bug)
- `lib/actions.ts` - `syncCurrentOrderToUpcoming()` (line 3948)
- `lib/actions.ts` - `syncSingleOrderForDeliveryDay()` (line 2965)
- `components/clients/ClientProfile.tsx` - Client detail view
- `components/clients/ClientList.tsx` - Sidebar list view
