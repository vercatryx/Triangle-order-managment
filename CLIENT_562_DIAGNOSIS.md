# CLIENT-562 Order Loading Issue - Diagnosis

## Summary
CLIENT-562's upcoming order exists in the database but is not displaying in the client profile. Other clients' orders work correctly.

## Diagnostic APIs Created

Three diagnostic API endpoints have been created:

1. **`/api/debug/client-order?clientId=CLIENT-562`**
   - Shows raw database data for the client's order
   - Shows what `getUpcomingOrderForClientLocal` returns
   - Includes analysis of the data structure

2. **`/api/debug/client-profile-data?clientId=CLIENT-562`**
   - Shows what `getClientProfileData` returns
   - Shows direct calls to `getUpcomingOrderForClientLocal` and `getActiveOrderForClientLocal`
   - Compares the results

3. **`/api/debug/compare-clients?client1=CLIENT-562&client2=SFF Food Test`**
   - Compares CLIENT-562's order structure with a working client
   - Highlights differences in data structure

## Findings from Local Database Analysis

### CLIENT-562's Order Structure
```json
{
  "id": "cfb3bb2f-f4ed-4e12-add5-1a620edc7869",
  "client_id": "CLIENT-562",
  "service_type": "Food",
  "case_id": "https://app.uniteus.io/dashboard/cases/open/f9fb35e1-df0c-436b-aed9-312fe82d44da/contact/b2918f3e-b082-4280-b902-eb217e5df722",
  "status": "scheduled",
  "delivery_day": null,
  "meal_type": "Lunch",
  "total_value": 0,
  "total_items": 0,
  "vendor_selections": 0,
  "items": 0
}
```

### Key Characteristics
- ✅ Order exists in `upcoming_orders` table
- ✅ Has `case_id` (required for display)
- ✅ `service_type: "Food"`
- ✅ `status: "scheduled"`
- ❌ **No vendor selections** (0 vendor selections)
- ❌ **No items** (0 items)
- ⚠️ `delivery_day: null` (uses single order format)
- ⚠️ `meal_type: "Lunch"` (unusual for Food order, but also present in working orders)

### What `getUpcomingOrderForClientLocal` Should Return
```json
{
  "id": "cfb3bb2f-f4ed-4e12-add5-1a620edc7869",
  "serviceType": "Food",
  "caseId": "https://app.uniteus.io/dashboard/cases/open/f9fb35e1-df0c-436b-aed9-312fe82d44da/contact/b2918f3e-b082-4280-b902-eb217e5df722",
  "status": "scheduled",
  "vendorSelections": []
}
```

### Comparison with Working Client (CLIENT-189)
- Working client has `delivery_day: "Thursday"` (CLIENT-562 has `null`)
- Working client has vendor selections and items (CLIENT-562 has neither)
- Both have `meal_type: "Lunch"` (so this is not the issue)

## Code Path Analysis

### Expected Flow
1. `getUpcomingOrderForClientLocal` is called
2. Finds 1 order with `delivery_day: null` → uses single order format (line 711)
3. Sets `vendorSelections = []` (empty array, line 730)
4. Returns order config with empty `vendorSelections` array
5. `getClientProfileData` returns this in `upcomingOrder` field
6. `ClientProfile` component processes it in `hydrateFromInitialData`
7. Goes into migration path (line 880) because `vendorSelections.length === 0`
8. Sets `vendorSelections = [{ vendorId: '', items: {} }]`
9. Calls `setOrderConfig(upcomingOrderData)`
10. Order should display

### Potential Issues
1. **Migration logic might not be preserving all fields** - Fixed in latest code
2. **Order config might be cleared after being set** - Added debug logging
3. **UI might be filtering out orders with empty vendor selections** - Need to check

## Next Steps

1. **Test the diagnostic APIs** by visiting:
   - `http://localhost:3000/api/debug/client-order?clientId=CLIENT-562`
   - `http://localhost:3000/api/debug/client-profile-data?clientId=CLIENT-562`
   - `http://localhost:3000/api/debug/compare-clients?client1=CLIENT-562&client2=CLIENT-189`

2. **Check browser console logs** when opening CLIENT-562's profile:
   - Look for `[getUpcomingOrderForClientLocal] Returning order config...`
   - Look for `[ClientProfile] Processing upcoming order...`
   - Look for `[ClientProfile] orderConfig changed...`

3. **Compare the API responses** with a working client to identify structural differences

## Files Modified
- `lib/local-db.ts` - Fixed schema mismatch, added fallback for empty vendor selections
- `components/clients/ClientProfile.tsx` - Updated migration logic, added debug logging
- `app/api/debug/client-order/route.ts` - New diagnostic API
- `app/api/debug/client-profile-data/route.ts` - New diagnostic API
- `app/api/debug/compare-clients/route.ts` - New diagnostic API
- `scripts/diagnose-client-562.js` - Diagnostic script
