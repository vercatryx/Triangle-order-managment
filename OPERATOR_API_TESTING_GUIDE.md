# Operator API Testing Guide

Instructions for testing each operator endpoint, including test parameters, expected outputs, and integration with the Retell AI agent.

---

## Prerequisites

- **Base URL:** `http://localhost:3000` (or your deployed app URL)
- **Start the dev server:** `npm run dev`
- **Database:** Ensure MySQL/Supabase is configured with test data (clients, vendors, menu items, orders)

---

## 1. Lookup Client

**Endpoint:** `GET /api/operator/lookup-client`

### Functionality

Identifies the caller by phone number or client ID. Returns client info and eligibility for deliveries. The agent should call this **first** to know who is on the line before performing any order operations.

### How to Test

**Option A: By phone number**

```bash
curl "http://localhost:3000/api/operator/lookup-client?phone=+15551234567"
```

**Option B: By client ID**

```bash
curl "http://localhost:3000/api/operator/lookup-client?clientId=YOUR_CLIENT_ID"
```

### Test Parameters

| Parameter   | Value                    | Notes                                      |
|------------|--------------------------|--------------------------------------------|
| `phone`    | `+15551234567` or `555-123-4567` | Use a phone from an existing client        |
| `clientId` | Valid UUID from DB       | Use an existing client ID from your DB     |

### Expected Output (Success)

```json
{
  "clientId": "abc-123-uuid",
  "fullName": "John Doe",
  "serviceType": "Food",
  "eligibility": true,
  "eligibilityReason": null
}
```

### Expected Output (Error)

- **404:** `{ "error": "No client found for this phone number" }` or `{ "error": "No client found for this client ID" }`
- **500:** `{ "error": "Internal server error" }`

### Retell Integration

- **Tool name:** `lookup_client`
- **When to call:** At the start of the call, or when the caller provides their phone/ID
- **Retell tool config:** Point the tool's `url` to `https://your-domain.com/api/operator/lookup-client` with GET and query params `phone_number` or `client_id` (Retell maps snake_case to camelCase)
- **Agent prompt:** Instruct the agent to call `lookup_client` (with `from_number` or spoken client ID) before announcing who is on the line and before any order operations

---

## 2. Inquire Current Orders

**Endpoint:** `GET /api/operator/inquire-current-orders`

### Functionality

Returns the client's current week orders and their upcoming order. Use when the caller asks "What are my orders?" or "What am I scheduled for?" or "Do I have an upcoming order?"

### How to Test

```bash
curl "http://localhost:3000/api/operator/inquire-current-orders?clientId=YOUR_CLIENT_ID"
```

### Test Parameters

| Parameter   | Value              | Notes                          |
|------------|--------------------|--------------------------------|
| `clientId` | Valid client UUID  | Must be from `lookup_client`   |

### Expected Output (Success)

```json
{
  "currentOrders": [
    {
      "orderId": "order-uuid",
      "orderNumber": "ORD-001",
      "serviceType": "Food",
      "status": "Delivered",
      "scheduledDeliveryDate": "2025-02-10",
      "totalItems": 5,
      "totalValue": 45.00,
      "notes": null
    }
  ],
  "upcomingOrder": {
    "serviceType": "Food",
    "vendorSelections": [...],
    "notes": null
  }
}
```

- `upcomingOrder` may be `null` if no upcoming order is set.

### Expected Output (Error)

- **400:** `{ "error": "Client not found" }` or `{ "error": "Client is not eligible" }`
- **500:** `{ "error": "Internal server error" }`

### Retell Integration

- **Tool name:** `inquire_current_orders`
- **When to call:** After `lookup_client` when the caller asks about their orders
- **Retell tool config:** Point to `https://your-domain.com/api/operator/inquire-current-orders?clientId={client_id}` (client_id from prior lookup)
- **Agent prompt:** "If the caller asks what they have ordered, what they're scheduled for, or if they have an upcoming order, call inquire_current_orders with the client_id."

---

## 3. Request Menu

**Endpoint:** `GET /api/operator/request-menu`

### Functionality

Returns menu items for ordering. With `vendorId` → items for that vendor. Without `vendorId` → all menu items plus meal items. Use when the caller asks "What can I order?" or "What's on the menu?"

### How to Test

**Option A: All menu items (no vendor)**

```bash
curl "http://localhost:3000/api/operator/request-menu"
```

**Option B: Menu for a specific vendor**

```bash
curl "http://localhost:3000/api/operator/request-menu?vendorId=YOUR_VENDOR_ID"
```

### Test Parameters

| Parameter   | Value             | Notes                                      |
|------------|-------------------|--------------------------------------------|
| `vendorId` | Valid vendor UUID | Optional; omit for all items               |

### Expected Output (Success)

```json
{
  "menuItems": [
    {
      "id": "item-uuid",
      "vendorId": "vendor-uuid",
      "name": "Chicken Salad",
      "value": 12.50,
      "priceEach": 12.50,
      "minimumOrder": 1,
      "deliveryDays": ["Monday", "Wednesday"],
      "itemType": "menu"
    }
  ],
  "mealItems": [
    {
      "id": "meal-item-uuid",
      "name": "Breakfast Bagel",
      "value": 5.00,
      "itemType": "meal"
    }
  ]
}
```

- `mealItems` may be empty when `vendorId` is provided (vendor-specific query returns only `menuItems`).

### Expected Output (Error)

- **400:** `{ "error": "Vendor not found or inactive" }` (when invalid vendorId)
- **500:** `{ "error": "Internal server error" }`

### Retell Integration

- **Tool name:** `request_menu`
- **When to call:** When the caller asks what is available to order
- **Retell tool config:** Point to `https://your-domain.com/api/operator/request-menu` (optional `vendor_id` query param)
- **Agent prompt:** "If the caller asks what they can order or what's on the menu, call request_menu (optionally with vendor_id if they ask about a specific vendor). Use the returned items to help them choose."

---

## 4. Create Upcoming Order

**Endpoint:** `POST /api/operator/create-upcoming-order`

### Functionality

Creates a new upcoming order for a client. Supports three service types:
- **Custom:** Single item with name, price, vendor, delivery day
- **Food:** Vendor selections with items and quantities
- **Meal:** Meal-type selections (Breakfast/Lunch/Dinner) with items and quantities

The client's `service_type` must match the order type (e.g. Custom client → Custom order only).

### How to Test

**Custom order**

```bash
curl -X POST "http://localhost:3000/api/operator/create-upcoming-order" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "YOUR_CLIENT_ID",
    "serviceType": "Custom",
    "custom_name": "Special delivery",
    "custom_price": "45.00",
    "vendorId": "YOUR_VENDOR_ID",
    "deliveryDay": "Wednesday",
    "notes": "Leave at door"
  }'
```

**Food order**

```bash
curl -X POST "http://localhost:3000/api/operator/create-upcoming-order" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "YOUR_CLIENT_ID",
    "serviceType": "Food",
    "vendorSelections": [
      {
        "vendorId": "YOUR_VENDOR_ID",
        "items": { "MENU_ITEM_ID_1": 2, "MENU_ITEM_ID_2": 1 }
      }
    ],
    "notes": "Dietary restrictions noted"
  }'
```

**Meal order**

```bash
curl -X POST "http://localhost:3000/api/operator/create-upcoming-order" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "YOUR_CLIENT_ID",
    "serviceType": "Meal",
    "mealSelections": {
      "Breakfast": { "vendorId": "VENDOR_ID", "items": { "MEAL_ITEM_ID": 1 } },
      "Lunch": { "items": { "MEAL_ITEM_ID_2": 2 } }
    }
  }'
```

### Test Parameters

| Parameter       | Custom | Food | Meal | Notes                                  |
|----------------|--------|------|------|----------------------------------------|
| `clientId`     | ✓      | ✓    | ✓    | Required                               |
| `serviceType`  | ✓      | ✓    | ✓    | `"Custom"`, `"Food"`, or `"Meal"`     |
| `custom_name`  | ✓      | -    | -    | Description for Custom                 |
| `custom_price` | ✓      | -    | -    | Price string or number                 |
| `vendorId`     | ○      | -    | -    | For Custom                             |
| `deliveryDay`  | ○      | -    | -    | Mon–Sun                                |
| `vendorSelections` | - | ✓  | -    | `[{ vendorId, items: { itemId: qty } }]` |
| `deliveryDayOrders` | - | ○ | -    | Per-day Food orders                    |
| `mealSelections`   | - | - | ✓    | `{ "Breakfast"|"Lunch"|"Dinner": { vendorId?, items } }` |
| `notes`        | ○      | ○    | ○    | Optional                               |
| `caseId`       | ○      | ○    | ○    | Optional                               |

### Expected Output (Success)

```json
{ "success": true }
```

### Expected Output (Error)

- **400:** Various validation errors, e.g.:
  - `{ "error": "Client not found" }`
  - `{ "error": "Client is not eligible for deliveries" }`
  - `{ "error": "Client service type is Food; Custom order requires Custom service type" }`
  - `{ "error": "No valid items with quantities provided" }`
  - `{ "error": "Vendor not found or inactive" }`
- **500:** `{ "error": "Internal server error" }`

### Retell Integration

- **Tool name:** `create_upcoming_order`
- **When to call:** After `lookup_client` when the caller wants to place a new order
- **Retell tool config:** POST to `https://your-domain.com/api/operator/create-upcoming-order` with JSON body
- **Agent prompt:** "To create an order, call create_upcoming_order with client_id (from lookup), service_type (Custom/Food/Meal), and the appropriate fields. For Food/Meal, use request_menu first to get valid item IDs."

---

## 5. Create From Previous Order

**Endpoint:** `POST /api/operator/create-from-previous-order`

### Functionality

Repeats the client's last order as their upcoming order. Use when the caller says "Same as last time," "Repeat my order," or "I'll have what I had before." Supports Food, Meal, and Boxes (not Custom, which has no repeatable structure).

### How to Test

```bash
curl -X POST "http://localhost:3000/api/operator/create-from-previous-order" \
  -H "Content-Type: application/json" \
  -d '{ "clientId": "YOUR_CLIENT_ID" }'
```

### Test Parameters

| Parameter   | Value              | Notes                                    |
|------------|--------------------|------------------------------------------|
| `clientId` | Valid client UUID  | Client must have at least one past order |

### Expected Output (Success)

```json
{ "success": true }
```

### Expected Output (Error)

- **400:** Examples:
  - `{ "error": "clientId is required" }`
  - `{ "error": "Client not found" }`
  - `{ "error": "Client is not eligible for deliveries" }`
  - `{ "error": "No previous order found for this client" }`
  - `{ "error": "Previous order type cannot be repeated (Custom orders need custom flow)" }`
  - `{ "error": "Previous order has no items to repeat" }`
- **500:** `{ "error": "Internal server error" }`

### Retell Integration

- **Tool name:** `create_from_previous_order`
- **When to call:** When the caller wants to repeat their last order
- **Retell tool config:** POST to `https://your-domain.com/api/operator/create-from-previous-order` with body `{ "client_id": "..." }`
- **Agent prompt:** "If the caller says 'same as last time,' 'repeat my order,' or wants to duplicate their last order, call create_from_previous_order with the client_id. Do not use this for Custom orders."

---

## Quick Reference: All Endpoints

| Endpoint                        | Method | Key Params                     | Retell Tool                   |
|--------------------------------|--------|--------------------------------|-------------------------------|
| `/api/operator/lookup-client`  | GET    | `phone`, `clientId`            | `lookup_client`               |
| `/api/operator/inquire-current-orders` | GET | `clientId`              | `inquire_current_orders`      |
| `/api/operator/request-menu`   | GET    | `vendorId` (optional)          | `request_menu`                |
| `/api/operator/create-upcoming-order` | POST | `clientId`, `serviceType`, ... | `create_upcoming_order` |
| `/api/operator/create-from-previous-order` | POST | `clientId`            | `create_from_previous_order`   |

---

## Retell Agent Setup Summary

1. **Create a Single Prompt or Multi-Prompt agent** in the Retell dashboard.
2. **Add Custom Tools** for each endpoint above; map each tool to its API URL and HTTP method.
3. **Use `lib/operator/retell-tools.ts`** as the schema reference for tool parameters (Retell uses snake_case; your API accepts both camelCase and snake_case).
4. **Suggested call flow:**
   - `lookup_client` (with `from_number` if available, else `client_id` from spoken input)
   - Based on intent:
     - "What are my orders?" → `inquire_current_orders`
     - "What can I order?" → `request_menu` (optionally with vendor)
     - "Same as last time" → `create_from_previous_order`
     - "Place new order" → `request_menu` (if needed) → `create_upcoming_order`

---

## Getting Test Data

- **Client IDs / phone numbers:** Query your DB or use the admin UI to find existing clients.
- **Vendor IDs:** From `vendors` table.
- **Menu/meal item IDs:** Call `GET /api/operator/request-menu` (with or without `vendorId`) to get `id` values for items.
- **Create test client:** `GET /api/debug/create-test-client` (if available) creates a client with sample order data.
