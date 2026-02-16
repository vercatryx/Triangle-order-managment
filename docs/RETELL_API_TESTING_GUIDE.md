# Retell APIs — Testing Guide (All Endpoints, All Client Types)

Use this file to test every Retell API one by one, with a test client for each client type. No new code — just run the requests in order and check responses.

---

## Prerequisites

1. **Local testing:** In `.env.local` set:
   ```bash
   RETELL_SKIP_VERIFY=true
   ```
   Then you can call the APIs without the `x-retell-signature` header (curl, Postman, etc.).

2. **Base URL:** Pick one:
   - Local: `http://localhost:3000`
   - Production: `https://trianglesquareservices.com` (or your deployed URL)

3. **Test clients:** You need at least one client ID per type from your database. Run this in Supabase SQL or your admin to find real UUIDs:

   ```sql
   SELECT id, full_name, service_type
   FROM clients
   WHERE service_type IN ('Food', 'Boxes', 'Custom')
   LIMIT 5;
   ```

   Fill these in once (use real UUIDs from your DB):

   | Client type | Use for APIs | Your test client_id |
   |-------------|---------------|----------------------|
   | **Food**    | get_food_vendors_and_menu, save_food_order | `________________` |
   | **Boxes**   | get_box_client_info, save_box_order        | `________________` |
   | **Custom** | get_custom_order_details                   | `________________` |
   | **Any**    | look_up_client, select_client, get_order_history | (same as above or any client) |

   For **look_up_client** you need a phone number that exists in `clients.phone_number` (or use name). For **select_client** use the `client_id` returned from look_up_client when there are multiple matches.

---

## 1. API Reference (All Endpoints)

### 1.1 look_up_client (POST)

**Purpose:** Find client(s) by phone or name. Use first in the flow when the “caller” is identified.

| Item | Value |
|------|--------|
| **Method** | POST |
| **URL** | `{BASE_URL}/api/retell/look-up-client` |
| **Body** | JSON (see below) |
| **Headers** | `Content-Type: application/json` |

**Body (Retell wrapper):**
```json
{
  "name": "look_up_client",
  "args": {
    "phone_number": "+15551234567"
  },
  "call": {}
}
```
Or by name: `"args": { "full_name": "John Smith" }`

**Example curl:**
```bash
curl -s -X POST "http://localhost:3000/api/retell/look-up-client" \
  -H "Content-Type: application/json" \
  -d '{"name":"look_up_client","args":{"phone_number":"+15551234567"},"call":{}}'
```

**Success (single match):** `"success": true`, `"multiple_matches": false`, `"client_id": "...", "full_name": "...", "service_type": "Food"` (or Boxes/Custom).  
**Success (multiple):** `"multiple_matches": true`, `"clients": [...]` → then call **select_client** with chosen `client_id`.

---

### 1.2 select_client (POST)

**Purpose:** After look_up_client returns multiple matches, set the active client by ID.

| Item | Value |
|------|--------|
| **Method** | POST |
| **URL** | `{BASE_URL}/api/retell/select-client` |
| **Body** | JSON below |

**Body:**
```json
{
  "name": "select_client",
  "args": { "client_id": "YOUR_CLIENT_UUID" },
  "call": {}
}
```

**Example curl:**
```bash
curl -s -X POST "http://localhost:3000/api/retell/select-client" \
  -H "Content-Type: application/json" \
  -d '{"name":"select_client","args":{"client_id":"YOUR_CLIENT_UUID"},"call":{}}'
```

**Success:** `"success": true`, `"client_id": "...", "full_name": "...", "service_type": "..."`.

---

### 1.3 get_food_vendors_and_menu (GET)

**Purpose:** Get vendors, menu items, and constraints for a **Food** client. Call after you have a Food `client_id`.

| Item | Value |
|------|--------|
| **Method** | GET |
| **URL** | `{BASE_URL}/api/retell/get-food-vendors-and-menu?client_id={FOOD_CLIENT_ID}` |

**Example curl:**
```bash
curl -s "http://localhost:3000/api/retell/get-food-vendors-and-menu?client_id=YOUR_FOOD_CLIENT_UUID"
```

**Success:** `"success": true`, `"approved_meals_per_week": N`, `"vendors": [...]`, `"current_selections"` or `"current_selections_by_day"`.  
**Wrong type:** `"error": "not_food_client"`.

---

### 1.4 save_food_order (POST)

**Purpose:** Save a Food order for a **specific delivery day**. Requires `delivery_day` + `vendor_selections`.

| Item | Value |
|------|--------|
| **Method** | POST |
| **URL** | `{BASE_URL}/api/retell/save-food-order` |
| **Body** | JSON below |

**Body:** Use real `vendor_id` and `item_id` from **get_food_vendors_and_menu** response.
```json
{
  "name": "save_food_order",
  "args": {
    "client_id": "YOUR_FOOD_CLIENT_UUID",
    "delivery_day": "Monday",
    "vendor_selections": [
      {
        "vendor_id": "VENDOR_UUID_FROM_GET_MENU",
        "items": [
          { "item_id": "MENU_ITEM_UUID", "quantity": 2 }
        ]
      }
    ]
  },
  "call": {}
}
```

**Example curl:**
```bash
curl -s -X POST "http://localhost:3000/api/retell/save-food-order" \
  -H "Content-Type: application/json" \
  -d '{"name":"save_food_order","args":{"client_id":"YOUR_FOOD_CLIENT_UUID","delivery_day":"Monday","vendor_selections":[{"vendor_id":"VENDOR_UUID","items":[{"item_id":"ITEM_UUID","quantity":2}]}]},"call":{}}'
```

**Success:** `"success": true`, message includes the day.  
**Validation errors:** `"error": "validation_failed"` (min meals, over limit, invalid vendor/item).

---

### 1.5 get_box_client_info (GET)

**Purpose:** Get box configuration and categories for a **Boxes** client.

| Item | Value |
|------|--------|
| **Method** | GET |
| **URL** | `{BASE_URL}/api/retell/get-box-client-info?client_id={BOX_CLIENT_ID}` |

**Example curl:**
```bash
curl -s "http://localhost:3000/api/retell/get-box-client-info?client_id=YOUR_BOX_CLIENT_UUID"
```

**Success:** `"success": true`, `"total_boxes": N`, `"boxes": [...]` with categories and items.  
**Wrong type:** `"error": "not_box_client"`.

---

### 1.6 save_box_order (POST)

**Purpose:** Save box order. Requires one entry per box with `category_selections` (points per category must match required).

| Item | Value |
|------|--------|
| **Method** | POST |
| **URL** | `{BASE_URL}/api/retell/save-box-order` |
| **Body** | JSON below |

**Body:** Structure must match what **get_box_client_info** returns (box_type_id, category_selections with category_id and items with item_id, quantity). Each category’s points must equal the required points for that box type.
```json
{
  "name": "save_box_order",
  "args": {
    "client_id": "YOUR_BOX_CLIENT_UUID",
    "box_selections": [
      {
        "box_type_id": "BOX_TYPE_UUID",
        "category_selections": [
          {
            "category_id": "CATEGORY_UUID",
            "items": [
              { "item_id": "ITEM_UUID", "quantity": 1 }
            ]
          }
        ]
      }
    ]
  },
  "call": {}
}
```

**Example curl:** (Replace UUIDs and ensure category points match.)
```bash
curl -s -X POST "http://localhost:3000/api/retell/save-box-order" \
  -H "Content-Type: application/json" \
  -d '{"name":"save_box_order","args":{"client_id":"YOUR_BOX_CLIENT_UUID","box_selections":[{"box_type_id":"BT_UUID","category_selections":[{"category_id":"CAT_UUID","items":[{"item_id":"ITEM_UUID","quantity":1}]}]}]},"call":{}}'
```

**Success:** `"success": true`.  
**Validation:** `"error": "validation_failed"` if box count or category points are wrong.

---

### 1.7 get_custom_order_details (GET)

**Purpose:** Get current custom order for a **Custom** client.

| Item | Value |
|------|--------|
| **Method** | GET |
| **URL** | `{BASE_URL}/api/retell/get-custom-order-details?client_id={CUSTOM_CLIENT_ID}` |

**Example curl:**
```bash
curl -s "http://localhost:3000/api/retell/get-custom-order-details?client_id=YOUR_CUSTOM_CLIENT_UUID"
```

**Success:** `"success": true`, `"has_order": true/false`, `"order": { "items": [...], "next_delivery_date": "...", "notes": "..." }`.  
**Wrong type:** `"error": "not_custom_client"`.

---

### 1.8 get_order_history (GET)

**Purpose:** Get order history for **any** client (past/upcoming orders from `orders` table).

| Item | Value |
|------|--------|
| **Method** | GET |
| **URL** | `{BASE_URL}/api/retell/get-order-history?client_id={CLIENT_ID}` |

**Example curl:**
```bash
curl -s "http://localhost:3000/api/retell/get-order-history?client_id=YOUR_CLIENT_UUID"
```

**Success:** `"success": true`, `"orders": [{ "order_number", "status", "scheduled_delivery_date", "summary", "items": [...] }]`.

---

## 2. Short Flow by Client Type

Use one test client per type and run the APIs in this order.

### Flow A: Food client

1. **look_up_client** (POST) with a phone that belongs to a Food client → get `client_id` (or use your known Food test client_id).
2. **get_food_vendors_and_menu** (GET) with that `client_id` → note `vendors[].vendor_id`, `vendors[].items[].item_id`, `approved_meals_per_week`, and vendor `minimum_meals`.
3. **save_food_order** (POST) with same `client_id`, `delivery_day`: `"Monday"` (or another day), and `vendor_selections` using those vendor/item IDs and quantities that respect minimums and total meals.
4. **get_order_history** (GET) with same `client_id` → optional check.

**Check:** DB `clients.upcoming_order` for that client has `deliveryDayOrders.Monday` (or the day you used) with the saved items.

---

### Flow B: Boxes client

1. **look_up_client** (POST) with a phone that belongs to a Boxes client → get `client_id` (or use your Boxes test client_id).
2. **get_box_client_info** (GET) with that `client_id` → note `total_boxes`, `boxes[].box_type_id`, `boxes[].categories` (category_id, required_points, items with item_id and point_value).
3. **save_box_order** (POST) with same `client_id` and `box_selections`: one object per box, each with `category_selections` where the sum of (item point_value × quantity) per category equals the required points.
4. **get_order_history** (GET) with same `client_id` → optional.

**Check:** `clients.upcoming_order` for that client has `serviceType: "Boxes"` and `boxOrders` with the saved selections.

---

### Flow C: Custom client

1. **look_up_client** (POST) with a phone that belongs to a Custom client → get `client_id` (or use your Custom test client_id).
2. **get_custom_order_details** (GET) with that `client_id` → read current order or empty.

**Check:** Response matches what’s in `clients.upcoming_order` for that client (Custom clients don’t have a Retell save endpoint; changes are typically via transfer/admin).

---

### Flow D: Multiple matches (look_up + select)

1. **look_up_client** (POST) with a phone number that has **multiple** clients in your DB.
2. Response: `"multiple_matches": true`, `"clients": [{ "id", "full_name", ... }, ...]`.
3. **select_client** (POST) with `client_id` set to one of those `id` values.
4. Then run the flow for that client’s type (Food, Boxes, or Custom) as above.

---

## 3. Checklist (Tick as You Go)

**Setup**
- [ ] `RETELL_SKIP_VERIFY=true` in `.env.local`
- [ ] Base URL chosen (localhost or production)
- [ ] Test client IDs filled in: Food ________, Boxes ________, Custom ________

**APIs (one by one)**
- [ ] 1. look_up_client (POST) — phone or name
- [ ] 2. select_client (POST) — after multiple match
- [ ] 3. get_food_vendors_and_menu (GET) — Food client_id
- [ ] 4. save_food_order (POST) — Food client_id + delivery_day + vendor_selections
- [ ] 5. get_box_client_info (GET) — Boxes client_id
- [ ] 6. save_box_order (POST) — Boxes client_id + box_selections
- [ ] 7. get_custom_order_details (GET) — Custom client_id
- [ ] 8. get_order_history (GET) — any client_id

**Flows**
- [ ] Flow A: Food (look_up → get menu → save_food_order → get_order_history)
- [ ] Flow B: Boxes (look_up → get_box_client_info → save_box_order → get_order_history)
- [ ] Flow C: Custom (look_up → get_custom_order_details)
- [ ] Flow D: Multiple matches (look_up → select_client → then type-specific flow)

---

## 4. Quick Copy-Paste (Replace placeholders)

Set these once at the top of your terminal or a script (replace with your values):

```bash
BASE_URL="http://localhost:3000"
# Or: BASE_URL="https://trianglesquareservices.com"

FOOD_CLIENT_ID="paste-your-food-client-uuid"
BOX_CLIENT_ID="paste-your-boxes-client-uuid"
CUSTOM_CLIENT_ID="paste-your-custom-client-uuid"
```

Then you can run:

```bash
# Food: get menu
curl -s "$BASE_URL/api/retell/get-food-vendors-and-menu?client_id=$FOOD_CLIENT_ID" | jq .

# Food: save (replace VENDOR_UUID and ITEM_UUID from get menu response)
# curl -s -X POST "$BASE_URL/api/retell/save-food-order" -H "Content-Type: application/json" \
#   -d "{\"name\":\"save_food_order\",\"args\":{\"client_id\":\"$FOOD_CLIENT_ID\",\"delivery_day\":\"Monday\",\"vendor_selections\":[{\"vendor_id\":\"VENDOR_UUID\",\"items\":[{\"item_id\":\"ITEM_UUID\",\"quantity\":2}]}]},\"call\":{}}" | jq .

# Boxes: get info
curl -s "$BASE_URL/api/retell/get-box-client-info?client_id=$BOX_CLIENT_ID" | jq .

# Custom: get order
curl -s "$BASE_URL/api/retell/get-custom-order-details?client_id=$CUSTOM_CLIENT_ID" | jq .

# Order history (any client)
curl -s "$BASE_URL/api/retell/get-order-history?client_id=$FOOD_CLIENT_ID" | jq .
```

Use this guide to test all Retell APIs one by one and run a short flow for each client type.
