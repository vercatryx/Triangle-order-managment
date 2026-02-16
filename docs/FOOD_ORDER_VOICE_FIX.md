# Food Order Voice (Retell) Fix — Day Not Asked & Wrong Save Format

This document describes **exactly** how to fix the two main food-order issues when saving via the Retell voice AI: (1) the system does not ask which **day** the caller wants the order saved for, and (2) the order is not saved in the **deliveryDayOrders** format the rest of the app expects.

**Scope:** All fixes are done by **editing the existing API routes only** — do not create new APIs. The only endpoints involved are the existing `get_food_vendors_and_menu` (GET) and `save_food_order` (POST) under `app/api/retell/`.

---

## 1. Problem Summary

| Issue | What happens now | What should happen |
|-------|------------------|--------------------|
| **Day not asked** | The AI never asks which delivery day (e.g. Monday, Wednesday) the caller wants. It only collects vendors and items. | The AI must ask (or confirm) the delivery day and pass it when saving. |
| **Wrong save format** | `save_food_order` writes to `clients.upcoming_order` as `{ serviceType: 'Food', vendorSelections: [...] }` — a **flat** list with no day. | Orders must be stored as **deliveryDayOrders** by day: `{ serviceType: 'Food', deliveryDayOrders: { "Monday": { vendorSelections: [...] }, "Wednesday": { ... } } }`. |

**Why it matters:** The rest of the app (portal, admin, create-orders-next-week, simulate-delivery-cycle, cleanup) all expect Food orders in **deliveryDayOrders** format. Saving only `vendorSelections` means the order does not show correctly by day and may not be used correctly when creating weekly orders.

---

## 2. API Control and Validation (Critical)

**The API must be the single source of control for the save and for validation.** Otherwise one bad or malicious request can do tremendous damage (e.g. wipe `serviceType`, `caseId`, or other stored data).

### 2.1 Save API — existing `save_food_order` route (edit only)

**Existing route:** `app/api/retell/save-food-order/route.ts`. Edit this file; do not add a new route.

- **The save API alone** decides what gets written to `clients.upcoming_order`. It must:
  - **Validate all input** before writing (see validation list below). Reject invalid payloads with clear errors.
  - **Never remove or overwrite** existing fields that are not being updated by this call. Specifically it must **preserve**:
    - `serviceType` (e.g. `"Food"` or `"Meal"`) — do not strip or change it.
    - `caseId` — case is stored here; never clear it unless the product explicitly supports that.
    - `notes` — general order notes; preserve.
    - `mealSelections` — Food and Meal data can coexist in the same `upcoming_order`; if present, preserve.
  - **Merge, don’t replace:** Read existing `upcoming_order`, update only `deliveryDayOrders[delivery_day]`, and write back the full object with all allowed Food/Meal fields (see UPCOMING_ORDER_SCHEMA.md).

**Validations the save API must perform (all of them):**

| What | Rule |
|------|------|
| `client_id` | Required, non-empty, must exist in `clients` table. |
| Client | `service_type` must be `"Food"` (reject non-Food clients). |
| `delivery_day` | Required, must be one of: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday. |
| `vendor_selections` | Array; each entry must have `vendor_id` and `items`. |
| Each `vendor_id` | Must exist in `vendors`, have `service_type = 'Food'`, and `is_active = true`. |
| Each `item_id` | Must exist in `menu_items` and belong to the vendor in that selection. |
| Quantities | Non-negative; items with quantity 0 can be skipped. |
| Per-vendor minimum | If vendor has `minimum_meals`, total meal value for that vendor must be ≥ minimum. |
| Total meals | Sum of (item meal value × quantity) across all selections must be ≤ client’s `approved_meals_per_week`. |

If any validation fails, the API must return an error and **not** write to the database.

### 2.2 Get API — existing `get_food_vendors_and_menu` route (edit only)

**Existing route:** `app/api/retell/get-food-vendors-and-menu/route.ts`. Edit this file; do not add a new route.

- This API **does not modify** any data. It only reads client, vendors, menu items, and `upcoming_order`.
- It must still **validate**: require `client_id`, ensure client exists, and ensure `service_type === 'Food'` before returning menu/order data. Return clear errors for invalid or non-Food clients.

### 2.3 Summary

- **Save:** API controls the save; validate everything; preserve `serviceType`, `caseId`, `notes`, `mealSelections`; merge into `deliveryDayOrders` only.
- **Get:** Read-only; validate client and service type so we never leak or imply data for wrong client type.

---

## 3. Correct Data Format (Reference)

Food orders in `clients.upcoming_order` must follow this shape:

```json
{
  "serviceType": "Food",
  "caseId": null,
  "deliveryDayOrders": {
    "Monday": {
      "vendorSelections": [
        {
          "vendorId": "vendor-uuid",
          "items": { "menu-item-id-1": 2, "menu-item-id-2": 1 },
          "itemNotes": { "menu-item-id-1": "No onions" }
        }
      ]
    },
    "Wednesday": {
      "vendorSelections": [
        {
          "vendorId": "another-vendor-uuid",
          "items": { "menu-item-id-3": 3 }
        }
      ]
    }
  }
}
```

- **Day names** must be exact: `"Monday"`, `"Tuesday"`, `"Wednesday"`, `"Thursday"`, `"Friday"`, `"Saturday"`, `"Sunday"`.
- Each day has **vendorSelections**: array of `{ vendorId, items: { itemId: quantity }, itemNotes?: { itemId: note } }`.
- The web app and order-processing pipelines read **deliveryDayOrders**; they do not treat top-level **vendorSelections** as the primary Food structure.

See: `ORDER_TYPES_DATABASE_REPORT.md`, `lib/types.ts` (`OrderConfiguration.deliveryDayOrders`), `lib/actions.ts` `saveClientFoodOrder()`.

---

## 4. Fix 1: Voice Flow — Ask for Delivery Day and Pass It

**Where:** Retell agent prompt / instructions (and, if needed, custom function parameter descriptions).

**What to change:**

1. **After identifying a Food client and calling `get_food_vendors_and_menu`:**
   - Use each vendor’s `delivery_days` from the response (e.g. `["Monday", "Wednesday"]`).
   - If the client has **no** existing order: ask which day they want to place the order for (e.g. “Which delivery day would you like this for — Monday or Wednesday?”), or if only one day is available across their vendors, use that day and confirm (“I’ll put this down for Monday. Is that right?”).
   - If the client **has** an existing order (see Fix 3 for API shape): you can say “You already have an order for Monday and Wednesday. Which day do you want to update or add to?” and then collect items for that day.

2. **Before calling `save_food_order`:**
   - The caller must have confirmed both (a) **delivery day** and (b) **vendor/item selections** for that day.
   - In the confirmation summary, include the day: “So that’s [items] for **Monday**. Should I save that?”

3. **When calling `save_food_order`:**
   - Pass the chosen **delivery_day** (e.g. `"Monday"`) in addition to `client_id` and `vendor_selections`, so the API can write under `deliveryDayOrders[delivery_day]`.

**Prompt/instruction text to add (adapt to your exact prompt):**

- “For Food clients, you must establish which **delivery day** the order is for (e.g. Monday, Wednesday). Use the vendor’s delivery_days from get_food_vendors_and_menu. Ask the caller which day they want if there are multiple options, or confirm the only available day. Do not call save_food_order until you have a delivery day and the caller has confirmed the full order for that day.”
- “When calling save_food_order, always pass the delivery_day parameter with the day name (e.g. Monday, Wednesday) that the caller chose.”

---

## 5. Fix 2: Edit existing Save API — Accept `delivery_day` and Write `deliveryDayOrders`

**File (existing):** `app/api/retell/save-food-order/route.ts` — edit this route only; no new API.

**Implemented behavior (must be kept in sync with code):**

The API is the single source of control: it validates all input (see §2.1) and **never** removes `serviceType`, `caseId`, `notes`, or `mealSelections`. It reads existing `upcoming_order`, merges only `deliveryDayOrders[delivery_day]`, and writes back the full Food/Meal object.

1. **Accept and validate delivery day**
   - Parse `body.args.delivery_day` (string). Must be one of: `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday`, `Sunday`. If missing or invalid, return `400` with a clear message (e.g. “delivery_day is required and must be a weekday name (e.g. Monday, Wednesday).”).

2. **Read existing `upcoming_order`**
   - Before updating, `select('upcoming_order')` for this client. If the client has an existing `upcoming_order` (e.g. other service types or existing Food days), you must **merge** and not wipe it.

3. **Build or merge `deliveryDayOrders`**
   - Normalize existing: if `upcoming_order` has top-level `vendorSelections` but no `deliveryDayOrders`, treat it as a single day (e.g. use `delivery_day` from the request or a default like `"Monday"`) so one-time migration:  
     `deliveryDayOrders = { [delivery_day]: { vendorSelections: existingVendorSelections } }`.
   - If `upcoming_order` already has `deliveryDayOrders`, keep it and only update the requested day:  
     `deliveryDayOrders[delivery_day] = { vendorSelections: vendorSelectionsPayload }` (same shape as in §2: `vendorId`, `items`, optional `itemNotes`).

4. **Write back (preserve existing fields)**
   - Save to `clients.upcoming_order` **only** the allowed Food/Meal fields (per UPCOMING_ORDER_SCHEMA.md):
     - `serviceType` — **preserved** from existing (or `'Food'` if none).
     - `caseId` — **preserved** from existing (never removed).
     - `notes` — **preserved** from existing.
     - `deliveryDayOrders` — merged object (existing days plus the new/updated day).
     - `mealSelections` — **preserved** from existing if present (Food and Meal can coexist).
   - Do **not** set top-level `vendorSelections`; the app uses `deliveryDayOrders` as the source of truth. Do **not** strip or overwrite `serviceType`, `caseId`, `notes`, or `mealSelections`.

5. **Payload shape**
   - Convert each `body.args.vendor_selections` entry into:
     - `vendorId` (from `vendor_id`)
     - `items`: object `{ [item_id]: quantity }`
     - `itemNotes`: if the Retell payload later supports per-item notes, map them here; otherwise omit or `{}`.

**Pseudocode:**

```text
1. delivery_day = body.args.delivery_day (required, one of Mon..Sun)
2. Fetch client (id, approved_meals_per_week, service_type, upcoming_order)
3. Validate Food client, vendor minimums, total meals vs approved_meals_per_week (as today)
4. existing = client.upcoming_order || {}
5. existingDeliveryDayOrders = existing.deliveryDayOrders || {}
   If existing.vendorSelections && !existing.deliveryDayOrders:
     existingDeliveryDayOrders = { [delivery_day]: { vendorSelections: existing.vendorSelections } }  // one-time migration
6. newDayOrder = { vendorSelections: vendorSelectionsPayload }  // payload in §2 shape
7. deliveryDayOrders = { ...existingDeliveryDayOrders, [delivery_day]: newDayOrder }
8. upcomingOrder = build from existing: preserve serviceType, caseId, notes, mealSelections; set deliveryDayOrders (merged)
9. update clients set upcoming_order = upcomingOrder where id = clientId
10. return success (and optional summary including the day)
```

**Response:** On success, include the day in the message, e.g.:  
“Food order saved successfully for **Monday**. 12 meals from ShopRite, 8 from Walmart. Total: 20 of 30 approved meals per week used.”

---

## 6. Fix 3: Edit existing get_food_vendors_and_menu — Expose Current Selections by Day

**File (existing):** `app/api/retell/get-food-vendors-and-menu/route.ts` — edit this route only; no new API.

**API contract:** This endpoint is **read-only** and does not modify any data. It validates `client_id` and `service_type === 'Food'` before returning (see §2.2).

**Previously:** It set `current_selections` only when `upcoming_order` had top-level `vendorSelections`:

```ts
const currentSelections = (uo && typeof uo === 'object' && Array.isArray((uo as any).vendorSelections)) ? (uo as any).vendorSelections : null;
```

So if the client’s order is stored in **deliveryDayOrders** format, `current_selections` would be null and the AI could not say what they already have.

**Implemented behavior:**

1. **Prefer `deliveryDayOrders`**
   - If `upcoming_order.deliveryDayOrders` exists and has at least one day, return current selections in a shape that includes **day** so the AI can prompt and pass the right day to save:
   - Option A (recommended): Add a field `current_selections_by_day`:  
     `{ "Monday": [ { vendorId, items, itemNotes? }, ... ], "Wednesday": [ ... ] }`  
     so the AI can say “You have X on Monday and Y on Wednesday” and know which day the caller is updating.
   - Option B: Keep a flat `current_selections` for backward compatibility but derive it from the **first** day in `deliveryDayOrders`, and add `current_delivery_days: Object.keys(deliveryDayOrders)` so the AI knows which days exist.

2. **Backward compatibility**
   - If there is no `deliveryDayOrders` but there is top-level `vendorSelections`, keep returning that as `current_selections` (and optionally set `current_selections_by_day` to `{ "Monday": vendorSelections }` or leave it unset so the AI can assume “Monday” when calling save).

3. **Schema in response**
   - Document in the API that when `current_selections_by_day` is present, the AI should use it to (a) read back existing orders by day and (b) pass the correct `delivery_day` to `save_food_order`.

---

## 7. Retell Dashboard — Custom Function Parameters

**Where:** Retell Dashboard → Agent → Custom Function `save_food_order`.

**Changes:**

1. **Parameters (JSON Schema)**  
   Add `delivery_day` as **required**:

   ```json
   {
     "type": "object",
     "required": ["client_id", "delivery_day", "vendor_selections"],
     "properties": {
       "client_id": { "type": "string", "const": "{{client_id}}", "description": "The client's ID" },
       "delivery_day": {
         "type": "string",
         "enum": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
         "description": "The delivery day for this order (e.g. Monday, Wednesday). Must be collected from the caller before saving."
       },
       "vendor_selections": {
         "type": "array",
         "description": "Array of vendor selections with items for this delivery day",
         "items": {
           "type": "object",
           "properties": {
             "vendor_id": { "type": "string" },
             "items": {
               "type": "array",
               "items": {
                 "type": "object",
                 "properties": {
                   "item_id": { "type": "string" },
                   "quantity": { "type": "number" }
                 }
               }
             }
           }
         }
       }
     }
   }
   ```

2. **Description**  
   Update to:  
   “Save the food order for a client for a specific **delivery day**. Requires delivery_day (e.g. Monday, Wednesday), which you must ask the caller for. Validates per-vendor minimums and total meals vs approved_meals_per_week. Call ONLY after the caller has confirmed both the delivery day and their complete selections for that day.”

---

## 8. Implementation Checklist

All work is in **existing** routes and config; do not create new APIs.

- [ ] **Prompt / flow:** Add instructions that the AI must ask (or confirm) delivery day for Food orders and not call save until day + selections are confirmed.
- [ ] **Existing save-food-order route** (`app/api/retell/save-food-order/route.ts`): Require `delivery_day`; validate all input per §2.1; **preserve** `serviceType`, `caseId`, `notes`, `mealSelections`; read existing `upcoming_order`; merge into `deliveryDayOrders[delivery_day]` only; write back full Food/Meal object (no top-level `vendorSelections`).
- [ ] **Existing get-food-vendors-and-menu route** (`app/api/retell/get-food-vendors-and-menu/route.ts`): Read-only; validate `client_id` and `service_type`; derive and return `current_selections_by_day` from `deliveryDayOrders` when present; keep backward compatibility for existing `vendorSelections`.
- [ ] **Retell Dashboard:** Edit the existing `save_food_order` custom function: add `delivery_day` as required parameter for `save_food_order` with enum Mon–Sun; update description.
- [ ] **Docs:** Edit `docs/retell-ai-voice-system-plan.md` and `docs/retell-ai-dashboard-setup-guide.md` so the contract for the existing `save_food_order` and `get_food_vendors_and_menu` includes delivery day and `deliveryDayOrders` format.
- [ ] **Test:** Place a Food order via voice for “Monday”; verify in DB that `clients.upcoming_order.deliveryDayOrders.Monday` exists and portal/admin show the order for Monday. Repeat for another day and confirm both days are preserved.

---

## 9. Quick Reference: Existing APIs Only (Edit, Don’t Create)

| Item | Location (existing — edit only) |
|------|----------------------------------|
| Retell save (Food) | `app/api/retell/save-food-order/route.ts` |
| Retell get menu (Food) | `app/api/retell/get-food-vendors-and-menu/route.ts` |
| Correct Food save format (web) | `lib/actions.ts` → `saveClientFoodOrder()` (uses `deliveryDayOrders`) |
| Order format docs | `ORDER_TYPES_DATABASE_REPORT.md`, `ORDER_SAVING_DOCUMENTATION.md` |
| Type definition | `lib/types.ts` → `OrderConfiguration.deliveryDayOrders` |
| Voice plan / prompt | `docs/retell-ai-voice-system-plan.md` |
| Dashboard setup | `docs/retell-ai-dashboard-setup-guide.md` |

No new API routes are created. Edit the existing save and get menu routes above so the voice flow asks for the delivery day and saves Food orders in the same **deliveryDayOrders** format the rest of the app uses.
