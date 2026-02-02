# RIVKA MULLER - Order Loading Issue Diagnosis

## Issue Description
RIVKA MULLER's upcoming order shows correctly in the sidebar but disappears when clicking into the client profile.

## Diagnostic Steps

### 1. Check Client Data
Run this query in Supabase or use the API endpoint:
```
GET /api/debug/rivka-muller
```

This will show:
- Client ID and name
- Active order data (from `clients.active_order` JSONB)
- All upcoming orders
- Vendor selections for each order
- Items for each vendor selection
- Orphaned items (items without vendor_selection_id)

### 2. Check What the Sidebar Sees
The sidebar uses `getClientFullDetails` which calls `getActiveOrderForClientLocal`. This function:
1. First checks `orders` table for active orders
2. Falls back to `upcoming_orders` if no orders found
3. Processes the order and builds `orderConfig` with vendor selections

### 3. Check What the Client Profile Sees
The client profile uses `getClientProfileData` which:
1. Calls `getUpcomingOrderForClientLocal` directly
2. This function only looks at `upcoming_orders` table
3. Does NOT fall back to `orders` table

### 4. Potential Issues to Check

#### Issue A: Missing Vendor Selections
- Check if `upcoming_order_vendor_selections` has entries for RIVKA MULLER's order
- If `vendor_id` is NULL or empty, the filter in `syncSingleOrderForDeliveryDay` might have rejected it
- **Fix Applied**: Updated filter to allow NULL vendor_id if items exist

#### Issue B: Items Not Linked to Vendor Selections
- Check if `upcoming_order_items` have `vendor_selection_id` set
- If items exist but `vendor_selection_id` is NULL, they're orphaned
- **Fix Applied**: Added fallback in `getUpcomingOrderForClientLocal` to find items by `upcoming_order_id` if no vendor selections

#### Issue C: Empty Vendor Selections Array
- Check if `orderConfig.vendorSelections` is `[]` (empty array)
- Empty arrays are truthy in JavaScript, so `!vendorSelections` won't catch it
- **Fix Applied**: Updated condition to check `vendorSelections.length === 0`

#### Issue D: Data Structure Mismatch
- Check if the order was saved with a different structure
- Compare `clients.active_order` (what sidebar sees) vs `upcoming_orders` (what profile sees)
- **Fix Applied**: Added fallback in `getClientProfileData` to use `activeOrder` as `upcomingOrder` if `upcomingOrder` is null

## Code Paths

### Sidebar (Works)
```
getClientFullDetails
  → getActiveOrderForClientLocal
    → Checks orders table first
    → Falls back to upcoming_orders
    → processOrder() builds orderConfig
    → Returns orderConfig with vendorSelections
```

### Client Profile (Doesn't Work)
```
getClientProfileData
  → getUpcomingOrderForClientLocal
    → Only checks upcoming_orders table
    → No fallback to orders table
    → processOrder() builds orderConfig
    → Returns orderConfig (might be empty if vendor selections missing)
```

## How to Diagnose

1. **Start the dev server** and navigate to:
   ```
   http://localhost:3000/api/debug/rivka-muller
   ```

2. **Check the output** for:
   - Number of upcoming orders
   - Number of vendor selections per order
   - Number of items per vendor selection
   - Any orphaned items

3. **Compare with working client** (like "SFF Food Test"):
   ```
   http://localhost:3000/api/debug/client-order?clientId=CLIENT-XXX
   ```

4. **Check console logs** when opening RIVKA MULLER's profile:
   - Look for `[getUpcomingOrderForClientLocal]` logs
   - Look for `[ClientProfile]` logs
   - Check if `orderConfig` is being set correctly

## Expected Fixes Applied

1. **lib/actions.ts line 3360**: Updated filter to allow NULL vendor_id if items exist
2. **lib/local-db.ts line 616**: Fixed `upcoming_vendor_selection_id` → `vendor_selection_id`
3. **lib/local-db.ts lines 768-797**: Added fallback for Meal orders without vendor
4. **lib/local-db.ts lines 728-763**: Added fallback for Food orders without vendor selections
5. **components/clients/ClientProfile.tsx line 880**: Fixed empty array check
6. **lib/actions.ts lines 5444-5451**: Added fallback to use activeOrder as upcomingOrder

## Next Steps

1. Run the diagnostic API endpoint
2. Compare RIVKA MULLER's data structure with a working client
3. Check if the order needs to be resaved (delete and recreate)
4. Verify all fixes are applied correctly
