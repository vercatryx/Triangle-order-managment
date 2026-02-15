# Triangle Square AI Voice Operator — Implementation Plan

## Table of Contents
1. [System Overview](#1-system-overview)
2. [Call Flow Architecture](#2-call-flow-architecture)
3. [Retell AI Custom Functions (APIs)](#3-retell-ai-custom-functions-apis)
4. [API Endpoint Specifications](#4-api-endpoint-specifications)
5. [System Prompt / Agent Instructions](#5-system-prompt--agent-instructions)
6. [Error Handling Strategy](#6-error-handling-strategy)
7. [Implementation Order](#7-implementation-order)
8. [Important Considerations](#8-important-considerations)

---

## 1. System Overview

The Triangle Square AI Voice Operator is a Retell AI-powered phone agent that handles inbound calls from three distinct client types: **Custom**, **Box**, and **Food**. The system identifies the caller, determines their client type, and routes them into the appropriate conversational flow.

### Client Types at a Glance

| Client Type | Can Place/Modify Orders | Can Review Orders | Transfer to Agent |
|-------------|------------------------|-------------------|-------------------|
| **Custom**  | No                     | Yes (read-only)   | Yes (for any changes) |
| **Box**     | Yes (select items per category per box) | Yes | Yes (if needed) |
| **Food**    | Yes (select items per vendor within constraints) | Yes | Yes (if needed) |

### Key Constraints
- **No prices are ever mentioned to the caller.** The AI must never reference dollar amounts, costs, or pricing of any kind.
- All data comes from API calls — the AI never guesses or fabricates order data.
- The AI must always confirm selections before saving.
- **Order processing cutoff: Tuesday at 11:59 PM EST.** All order changes are processed weekly on Tuesday night. Any changes made after Tuesday 11:59 PM EST will not take effect until the *following* week's cycle. The AI must calculate and tell the caller the exact week their changes will take effect when confirming a saved order. For example: a change made on Wednesday February 11th won't take effect until the week starting Sunday February 22nd.
- **Food and Box limits use the same DB field:** `approved_meals_per_week`. For **Food** clients it is the maximum total meals per week across all vendors. For **Box** clients it is the number of boxes the client is authorized for. Do not use `authorized_amount` anywhere in this integration.

### Architecture Rule: Isolated API Folder, Zero Existing File Changes

> **CRITICAL: This entire integration must be built without modifying a single existing file in the project.**

All Retell AI API endpoints live in a **self-contained folder**: `app/api/retell/`. This folder is the only thing added to the codebase. The rules are:

1. **No existing files are edited.** Not a single line of existing code, types, components, or utilities is touched.
2. **No new TypeScript interfaces, types, or data structures.** Every endpoint queries the existing Supabase database tables directly (`clients`, `vendors`, `menu_items`, `box_types`, `box_quotas`, `item_categories`, `orders`, `upcoming_orders`, `order_items`, etc.) and shapes the response inline within the route handler. If a helper function is needed, it lives inside the route file itself or in a shared utility file within `app/api/retell/`.
3. **The folder structure is:**

```
app/api/retell/
├── _lib/
│   ├── verify-retell.ts          ← Shared signature verification helper
│   ├── phone-utils.ts            ← Phone normalization and matching
│   └── lookup-by-phone.ts        ← Shared phone lookup (used by look-up-client and inbound-webhook)
├── inbound-webhook/
│   └── route.ts                  ← Runs on call arrival; does lookup, injects dynamic variables
├── look-up-client/
│   └── route.ts
├── select-client/
│   └── route.ts
├── get-custom-order-details/
│   └── route.ts
├── get-box-client-info/
│   └── route.ts
├── save-box-order/
│   └── route.ts
├── get-food-vendors-and-menu/
│   └── route.ts
├── save-food-order/
│   └── route.ts
└── get-order-history/
    └── route.ts
```

4. **Each route file is fully self-contained.** It imports only from:
   - `@supabase/supabase-js` (already a project dependency) for database access
   - `next/server` for `NextRequest` / `NextResponse`
   - The local `_lib/verify-retell.ts` helper for signature verification
   - Nothing else from the existing project (no `lib/types.ts`, no `lib/supabase.ts`, no shared utilities)

5. **Each route constructs its own Supabase client** using `process.env` variables directly — no dependency on any existing Supabase client singleton or wrapper.

6. **Responses are plain JSON objects** shaped inline. No imported interfaces. If the response shape needs to be documented, it's documented in this plan, not in a `.ts` file.

This means the entire Retell AI integration can be **added, removed, or replaced** without any risk to the existing application. It's a completely parallel system that only reads from and writes to the same database.

---

## 2. Call Flow Architecture

### Phase 1: Greeting & Identity Verification

```
Inbound call arrives (phone rings)
    │
    ▼
Inbound Webhook runs (before call connects)
    │
    ├── Lookup by from_number (caller ID)
    │   │
    │   ├── SINGLE MATCH → Inject client_id, full_name, etc.
    │   │   Override begin message to: "Hello {{full_name}}, thank you for calling..."
    │   │
    │   ├── MULTIPLE MATCHES → Inject pre_call_clients (JSON)
    │   │
    │   └── NO MATCH → Inject pre_call_lookup_result: no_match
    │
    ▼
Call connects, AI speaks begin message
    │
    ▼
(If pre-call single match: AI confirms address and asks how to help — no lookup needed)
(If pre-call multiple matches: AI presents list from pre_call_clients, calls select_client when picked)
(If no match or webhook not used: Standard flow below)
    │
    ▼
FIRST (standard flow): Attempt automatic lookup using caller ID
(the phone number the caller is calling from)
    │
    ▼
Call function: look_up_client (with caller_id phone number)
(searches BOTH phone_number AND secondary_phone_number columns)
    │
    ├── MATCH FOUND → Skip asking, go straight to results below
    │
    └── NO MATCH on caller ID →
    │       AI: "I wasn't able to pull up an account from the
    │       number you're calling from. Could I get your phone
    │       number or full name so I can look you up?"
    │           │
    │           ▼
    │       Caller provides phone number OR full name
    │           │
    │           ▼
    │       Call function: look_up_client (with provided info)
    │       (searches BOTH phone_number AND secondary_phone_number)
    │
    ▼
Results from look_up_client (whether from caller ID or manual)
    │
    ├── SUCCESS (1 match) → Greet by name, proceed to Phase 2
    │
    ├── SUCCESS (multiple matches) →
    │       "I found a few accounts linked to that number:
    │        1. John Smith, 2. Jane Smith, 3. Bobby Smith.
    │        Which one would you like to work with?
    │        You can say the number or the name."
    │       │
    │       ▼
    │   Caller picks one → set as active client, proceed to Phase 2
    │   (Caller can switch profiles later by saying
    │    "switch to another account" at any time)
    │
    ├── NAME LOOKUP (unclear/ambiguous match) →
    │       AI lists matches with numbers:
    │        "I found a few people with a similar name:
    │         1. John Smith on Main Street,
    │         2. John Smithson on Oak Avenue.
    │         Could you say the number of the correct one?"
    │
    └── FAILURE (not found) → Ask to try again or offer to transfer
```

### Phase 2: Client Type Routing

```
Client identified (client_id + service_type retrieved)
    │
    ├── service_type = "Custom"  → Custom Client Flow
    ├── service_type = "Boxes"   → Box Client Flow
    └── service_type = "Food"    → Food Client Flow
```

### Phase 3A: Custom Client Flow

```
Custom Client Identified
    │
    ▼
AI: "I can see you're set up with a custom order. Would you like me to
read out your current order details, or is there something else I can
help with?"
    │
    ├── "Read my order" → Call: get_custom_order_details
    │       │
    │       ▼
    │   Read order aloud (items, scheduled delivery date)
    │
    └── Anything else → "For any changes to a custom order, I'll need
                         to connect you with one of our team members.
                         Let me transfer you now."
                            │
                            ▼
                    Call: transfer_to_agent
```

### Phase 3B: Box Client Flow

```
Box Client Identified
    │
    ▼
Call: get_box_client_info
(Returns: list of boxes, categories per box, items per category,
 point values, required totals per category)
    │
    ▼
Multiple boxes?
    │
    ├── YES → "I can see you have [N] boxes to set up. Would you like
    │          to start with Box 1, or is there a specific one?"
    │
    └── NO  → "Let's go through your box selections."
    │
    ▼
For each box, for each category:
    │
    ▼
AI: "For the [Category Name] category, you need to fill [X] points.
Here are your options: [read items with their point values].
Which items would you like?"
    │
    ▼
Caller selects items. AI tracks running total.
    │
    ├── Total < Required → "You still need [Y] more points in
    │                       [Category]. Which items would you like
    │                       to add?"
    │
    ├── Total > Required → "That puts you [Z] points over for
    │                       [Category]. Could you remove an item
    │                       or swap for a smaller one?"
    │
    └── Total = Required → "Great, [Category] is all set."
                            Move to next category.
    │
    ▼
All categories filled for this box → Summarize & confirm
    │
    ▼
More boxes? → Repeat for next box
    │
    ▼
All boxes done → Call: save_box_order (full order JSON)
    │
    ├── SUCCESS → "Your box order has been saved successfully.
    │              Just so you know, orders are processed every
    │              Tuesday at eleven fifty-nine PM Eastern.
    │              [If before cutoff]: Your changes will take
    │                effect the week starting Sunday [date].
    │              [If after cutoff]: Since we're past this
    │                week's cutoff, your changes will take
    │                effect the week starting Sunday [date]."
    │
    └── FAILURE → "I wasn't able to save that. Would you like to
                   try again or speak with a team member?"
```

### Phase 3C: Food Client Flow

```
Food Client Identified
    │
    ▼
Call: get_food_vendors_and_menu
(Returns: vendors with their items, minimum meals per vendor,
 client's total authorized amount, current selections if any)
    │
    ▼
AI: "I can see you can order from [Vendor1] and [Vendor2].
You have a total of [approved_meals_per_week] meals available.
Just so you know, [Vendor1] requires a minimum of [min1] meals,
and [Vendor2] requires a minimum of [min2] meals.
Would you like to start with [Vendor1] or [Vendor2]?"
    │
    ▼
For each vendor the caller wants to order from:
    │
    ▼
AI reads available items (NO PRICES). Caller selects items & quantities.
    │
    ▼
AI tracks:
  - Per-vendor running total (must be >= vendor minimum)
  - Cross-vendor grand total (must be <= approved_meals_per_week)
    │
    ├── Vendor total < minimum → "You need at least [min] meals from
    │                             [Vendor]. You currently have [X].
    │                             Would you like to add more?"
    │
    ├── Grand total > approved limit → "Adding that would put you over your
    │                               total of [approved_meals_per_week] meals.
    │                               You currently have [Y] selected
    │                               across all vendors. Would you like
    │                               to adjust?"
    │
    └── All constraints met → Summarize & confirm
    │
    ▼
Call: save_food_order (vendor selections JSON)
    │
    ├── SUCCESS → "Your food order has been saved successfully.
    │              Just so you know, orders are processed every
    │              Tuesday at eleven fifty-nine PM Eastern.
    │              [If before cutoff]: Your changes will take
    │                effect the week starting Sunday [date].
    │              [If after cutoff]: Since we're past this
    │                week's cutoff, your changes will take
    │                effect the week starting Sunday [date]."
    │
    └── FAILURE → Error handling (see Section 6)
```

### Phase 4: Order History (Available to ALL Client Types)

```
At any point, caller asks about previous orders
    │
    ▼
Call: get_order_history
    │
    ▼
AI reads out:
  - Scheduled delivery date(s)
  - Order details (items, quantities)
  - Order status
    │
    ▼
"Is there anything else I can help you with?"
```

### Phase 5: Call Wrap-up

```
No more requests
    │
    ▼
AI: "Thank you for calling Triangle Square, [Client Name]. Your
selections have been saved. If you need anything else, don't
hesitate to call back. Have a great day!"
    │
    ▼
Call: end_call
```

---

## 3. Retell AI Custom Functions (APIs)

### Function Registry

Below are all functions to register in the Retell AI dashboard. Each **Custom Function** maps to an API endpoint hosted on your Next.js application.

| # | Function Name | Type | Method | Purpose |
|---|--------------|------|--------|---------|
| 1 | `look_up_client` | Custom Function | POST | Identify caller by phone or name |
| 1b | `select_client` | Custom Function | POST | Set active client after multi-match; populates response variables |
| 2 | `get_custom_order_details` | Custom Function | GET | Get current order for Custom clients |
| 3 | `get_box_client_info` | Custom Function | GET | Get boxes, categories, items, quotas for Box clients |
| 4 | `save_box_order` | Custom Function | POST | Save complete box order selections |
| 5 | `get_food_vendors_and_menu` | Custom Function | GET | Get vendors, menu items, constraints for Food clients |
| 6 | `save_food_order` | Custom Function | POST | Save food order selections |
| 7 | `get_order_history` | Custom Function | GET | Get previous orders for any client |
| 8 | `transfer_to_agent` | Built-in (Transfer Call) | — | Transfer to human agent |
| 9 | `end_call` | Built-in (End Call) | — | Gracefully end the call |

(When `look_up_client` returns multiple matches, the AI must call `select_client` with the chosen client_id before proceeding.)

---

## 4. API Endpoint Specifications

All endpoints are hosted at your application's base URL (e.g., `https://your-domain.com/api/retell/`). All custom functions receive the standard Retell request body containing `name`, `args`, and `call` (with full call context). Verify all requests using the `X-Retell-Signature` header.

> **Reminder:** Every route file below is self-contained inside `app/api/retell/`. No existing project files are imported or modified. Each route creates its own Supabase client from environment variables and shapes responses inline — no shared types or data structures.

---

### 4.1 `look_up_client`

**Endpoint:** `POST /api/retell/look-up-client`

**Purpose:** Identify the caller. Accepts either a phone number or full name. Returns the client's identity, service type, and profile data. When searching by phone, the API searches **both** `phone_number` and `secondary_phone_number` columns, so secondary numbers work identically to primary ones.

**Parameters (from Retell `args`):**
```json
{
  "type": "object",
  "properties": {
    "phone_number": {
      "type": "string",
      "description": "A phone number to search by. Can be the caller ID (automatic first attempt) or a number the caller provides verbally. Searches both primary and secondary phone number fields."
    },
    "full_name": {
      "type": "string",
      "description": "The caller's full name, used only if phone number lookup is not available or returned no results."
    }
  }
}
```

**Search Logic:**
- **Phone lookup (used for both caller ID and verbally provided numbers):** Query `clients` WHERE `phone_number = $1 OR secondary_phone_number = $1` (after normalizing the input to digits only). This means a caller's secondary phone number is treated identically to their primary — either one finds their account.
- **Name lookup (fallback):** Query `clients` WHERE `full_name ILIKE $1` (case-insensitive). Use fuzzy/partial matching if no exact match is found (e.g., `full_name ILIKE '%smith%'`).
- **Call order:** The AI calls this function up to 2 times per identification attempt — first automatically with the caller ID, and if that fails, again with whatever the caller provides verbally.

**Response (single match):**
```json
{
  "success": true,
  "multiple_matches": false,
  "client_id": "CLIENT-001",
  "full_name": "John Smith",
  "phone_number": "2125551234",
  "secondary_phone_number": "2125559876",
  "address": "123 Main Street, Apt 4B, New York, NY 10001",
  "service_type": "Food",
  "approved_meals_per_week": 30,
  "expiration_date": "2026-06-15"
}
```

**Response (multiple matches — phone registered to multiple clients):**
```json
{
  "success": true,
  "multiple_matches": true,
  "message": "Multiple clients found for this phone number. Ask the caller which profile they want to work with.",
  "clients": [
    {
      "index": 1,
      "client_id": "CLIENT-001",
      "full_name": "John Smith",
      "address": "123 Main Street, New York, NY",
      "service_type": "Food"
    },
    {
      "index": 2,
      "client_id": "CLIENT-002",
      "full_name": "Jane Smith",
      "address": "123 Main Street, New York, NY",
      "service_type": "Boxes"
    },
    {
      "index": 3,
      "client_id": "CLIENT-003",
      "full_name": "Bobby Smith",
      "address": "123 Main Street, New York, NY",
      "service_type": "Custom"
    }
  ]
}
```

**Response (multiple matches — ambiguous name):**
```json
{
  "success": true,
  "multiple_matches": true,
  "message": "Multiple clients found with a similar name. List them with numbers so the caller can pick.",
  "clients": [
    {
      "index": 1,
      "client_id": "CLIENT-010",
      "full_name": "John Smith",
      "address": "123 Main Street, New York, NY",
      "service_type": "Food"
    },
    {
      "index": 2,
      "client_id": "CLIENT-015",
      "full_name": "John Smithson",
      "address": "456 Oak Avenue, Brooklyn, NY",
      "service_type": "Boxes"
    }
  ]
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "no_client_found",
  "message": "No client was found matching that information. Please try again with a different phone number or name."
}
```

**Retell Dashboard Config:**
- Speak during execution: **Enabled** — "Let me look that up for you."
- Speak after execution: **Enabled** — Agent greets caller by name (single match) or lists options (multiple matches).
- Response variables: Save `client_id`, `full_name`, `phone_number`, `secondary_phone_number`, `address`, `service_type`, `approved_meals_per_week` as dynamic variables (populated only on single-match response). When the response is multiple matches, the AI must call `select_client` with the chosen `client_id` so these variables get set (see 4.1b).

---

### 4.1b `select_client` (required for multi-match)

**Endpoint:** `POST /api/retell/select-client`

**Purpose:** After `look_up_client` returns multiple matches, the caller picks one (by number or name). The AI then calls `select_client` with that client's ID. The API returns the same single-client shape as a single-match `look_up_client` response, so Retell's response variables get populated and `{{client_id}}`, `{{full_name}}`, etc. work for the rest of the call.

**Parameters (from Retell `args`):**
```json
{
  "type": "object",
  "required": ["client_id"],
  "properties": {
    "client_id": {
      "type": "string",
      "description": "The client_id of the client the caller selected from the multi-match list (e.g. CLIENT-002)."
    }
  }
}
```

**Response:** Same as single-match `look_up_client` (success, client_id, full_name, phone_number, secondary_phone_number, address, service_type, approved_meals_per_week, expiration_date). No `clients` array.

**Retell Dashboard Config:**
- Response variables: Same as `look_up_client` — map `client_id`, `full_name`, `phone_number`, `secondary_phone_number`, `address`, `service_type`, `approved_meals_per_week` so they overwrite/update the session variables.
- Speak during execution: **Disabled** (no need to say anything while selecting).
- Speak after execution: **Enabled** — e.g. "Got it, I've pulled up [name]'s account. How can I help you today?"

---

### 4.2 `get_custom_order_details`

**Endpoint:** `GET /api/retell/get-custom-order-details`

**Purpose:** Retrieve the current order details for a Custom client so the AI can read them aloud.

**Query Parameters (from Retell `args`):**
```json
{
  "type": "object",
  "required": ["client_id"],
  "properties": {
    "client_id": {
      "type": "string",
      "const": "{{client_id}}",
      "description": "The client's ID"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "has_order": true,
  "order": {
    "items": [
      { "name": "Custom Item A", "quantity": 2, "delivery_day": "Monday" },
      { "name": "Custom Item B", "quantity": 1, "delivery_day": "Thursday" }
    ],
    "next_delivery_date": "2026-02-16",
    "notes": "Special instructions here"
  }
}
```

**Retell Dashboard Config:**
- Speak during execution: **Enabled** — "Let me pull up your order details."
- Speak after execution: **Enabled** — Agent reads the order.

---

### 4.3 `get_box_client_info`

**Endpoint:** `GET /api/retell/get-box-client-info`

**Purpose:** Get all information needed for the box ordering conversation — how many boxes, what categories exist, what items are available, how many points are needed per category, and how many points each item is worth.

**Query Parameters:**
```json
{
  "type": "object",
  "required": ["client_id"],
  "properties": {
    "client_id": {
      "type": "string",
      "const": "{{client_id}}",
      "description": "The client's ID"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "total_boxes": 2,
  "boxes": [
    {
      "box_index": 1,
      "box_type_id": "bt-001",
      "box_type_name": "Standard Box",
      "categories": [
        {
          "category_id": "cat-001",
          "category_name": "Carbs",
          "required_points": 10,
          "items": [
            { "item_id": "mi-001", "name": "White Rice (2lb bag)", "point_value": 2 },
            { "item_id": "mi-002", "name": "Brown Rice (2lb bag)", "point_value": 2 },
            { "item_id": "mi-003", "name": "Pasta (1lb box)", "point_value": 1 },
            { "item_id": "mi-004", "name": "Bread Loaf", "point_value": 1 }
          ]
        },
        {
          "category_id": "cat-002",
          "category_name": "Proteins",
          "required_points": 8,
          "items": [
            { "item_id": "mi-010", "name": "Chicken Breast (1lb)", "point_value": 2 },
            { "item_id": "mi-011", "name": "Ground Beef (1lb)", "point_value": 3 },
            { "item_id": "mi-012", "name": "Canned Tuna", "point_value": 1 }
          ]
        }
      ],
      "current_selections": null
    },
    {
      "box_index": 2,
      "box_type_id": "bt-001",
      "box_type_name": "Standard Box",
      "categories": [ "...same structure..." ],
      "current_selections": null
    }
  ]
}
```

**Retell Dashboard Config:**
- Speak during execution: **Enabled** — "Let me pull up your box options."
- Speak after execution: **Enabled** — Agent begins the box selection conversation.
- **Note:** This response can be large. The AI should NOT read the entire JSON. It should conversationally walk through categories one at a time.

---

### 4.4 `save_box_order`

**Endpoint:** `POST /api/retell/save-box-order`

**Purpose:** Save the complete box order after the caller has confirmed all selections. Accepts the full selection structure for all boxes.

**Parameters:**
```json
{
  "type": "object",
  "required": ["client_id", "box_selections"],
  "properties": {
    "client_id": {
      "type": "string",
      "const": "{{client_id}}",
      "description": "The client's ID"
    },
    "box_selections": {
      "type": "array",
      "description": "Array of box selections, one per box",
      "items": {
        "type": "object",
        "properties": {
          "box_index": { "type": "number", "description": "Which box (1-indexed)" },
          "box_type_id": { "type": "string", "description": "The box type ID" },
          "category_selections": {
            "type": "array",
            "description": "Selections per category",
            "items": {
              "type": "object",
              "properties": {
                "category_id": { "type": "string" },
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
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Box order saved successfully for all 2 boxes."
}
```

**Retell Dashboard Config:**
- Speak during execution: **Enabled** — "Saving your selections now."
- Speak after execution: **Enabled** — Confirm success.

---

### 4.5 `get_food_vendors_and_menu`

**Endpoint:** `GET /api/retell/get-food-vendors-and-menu`

**Purpose:** Get all vendors the food client can order from, each vendor's menu items, each vendor's minimum meal requirement, and the client's approved meals per week (`approved_meals_per_week`).

**Query Parameters:**
```json
{
  "type": "object",
  "required": ["client_id"],
  "properties": {
    "client_id": {
      "type": "string",
      "const": "{{client_id}}",
      "description": "The client's ID"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "approved_meals_per_week": 30,
  "current_total_used": 0,
  "vendors": [
    {
      "vendor_id": "v-001",
      "vendor_name": "ShopRite",
      "minimum_meals": 4,
      "delivery_days": ["Monday", "Thursday"],
      "items": [
        { "item_id": "mi-100", "name": "Grilled Chicken Meal", "meal_value": 1 },
        { "item_id": "mi-101", "name": "Vegetable Stir Fry", "meal_value": 1 },
        { "item_id": "mi-102", "name": "Family Pasta Pack", "meal_value": 3 }
      ]
    },
    {
      "vendor_id": "v-002",
      "vendor_name": "Walmart",
      "minimum_meals": 5,
      "delivery_days": ["Tuesday", "Friday"],
      "items": [
        { "item_id": "mi-200", "name": "Turkey Dinner", "meal_value": 1 },
        { "item_id": "mi-201", "name": "Salmon Plate", "meal_value": 1 }
      ]
    }
  ],
  "current_selections": null
}
```

**Important:** The response deliberately excludes all pricing fields. The AI must never mention prices.

**Retell Dashboard Config:**
- Speak during execution: **Enabled** — "Let me get your menu options."
- Speak after execution: **Enabled** — Agent begins vendor/item selection.

---

### 4.6 `save_food_order`

**Endpoint:** `POST /api/retell/save-food-order`

**Purpose:** Save the food order after confirmation. The API should perform server-side validation of vendor minimums and total meals vs `approved_meals_per_week` before saving.

**Parameters:**
```json
{
  "type": "object",
  "required": ["client_id", "vendor_selections"],
  "properties": {
    "client_id": {
      "type": "string",
      "const": "{{client_id}}",
      "description": "The client's ID"
    },
    "vendor_selections": {
      "type": "array",
      "description": "Array of vendor selections",
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

**Response (success):**
```json
{
  "success": true,
  "message": "Food order saved successfully. 12 meals from ShopRite and 8 meals from Walmart. Total: 20 of 30 approved meals per week used."
}
```

**Response (validation failure):**
```json
{
  "success": false,
  "error": "validation_failed",
  "message": "ShopRite requires a minimum of 4 meals but only 2 were selected.",
  "details": {
    "vendor_errors": [
      { "vendor_id": "v-001", "vendor_name": "ShopRite", "minimum": 4, "selected": 2 }
    ],
    "total_selected": 22,
    "approved_meals_per_week": 30,
    "over_limit": false
  }
}
```

**Retell Dashboard Config:**
- Speak during execution: **Enabled** — "Saving your food order now."
- Speak after execution: **Enabled** — Confirm success or relay validation error.

---

### 4.7 `get_order_history`

**Endpoint:** `GET /api/retell/get-order-history`

**Purpose:** Retrieve previous/upcoming order information for any client type. Returns scheduled delivery dates and order details.

**Query Parameters:**
```json
{
  "type": "object",
  "required": ["client_id"],
  "properties": {
    "client_id": {
      "type": "string",
      "const": "{{client_id}}",
      "description": "The client's ID"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "orders": [
    {
      "order_number": 100234,
      "status": "confirmed",
      "scheduled_delivery_date": "2026-02-17",
      "service_type": "Food",
      "summary": "12 items from ShopRite, 8 items from Walmart",
      "items": [
        { "name": "Grilled Chicken Meal", "quantity": 4, "vendor": "ShopRite" },
        { "name": "Vegetable Stir Fry", "quantity": 8, "vendor": "ShopRite" },
        { "name": "Turkey Dinner", "quantity": 5, "vendor": "Walmart" },
        { "name": "Salmon Plate", "quantity": 3, "vendor": "Walmart" }
      ]
    },
    {
      "order_number": 100198,
      "status": "completed",
      "scheduled_delivery_date": "2026-02-10",
      "service_type": "Food",
      "summary": "10 items from ShopRite, 10 items from Walmart",
      "items": [ "..." ]
    }
  ]
}
```

**Retell Dashboard Config:**
- Speak during execution: **Enabled** — "Let me pull up your order history."
- Speak after execution: **Enabled** — Agent reads relevant info.
- The AI should present dates in spoken form ("February seventeenth") not "2/17".

---

### 4.8 `transfer_to_agent` (Built-in Retell Function)

**Type:** Built-in Transfer Call

**Configuration:**
- Transfer number: Your support team's phone number (e.g., `+12125551000`)
- Transfer type: **Warm transfer** (recommended — allows AI to brief the human agent)
- Whisper message: "Transferring a call from {{full_name}}, client ID {{client_id}}, service type {{service_type}}."

---

### 4.9 `end_call` (Built-in Retell Function)

**Type:** Built-in End Call

**Configuration:** Default — agent ends the call after a goodbye message.

---

## 5. System Prompt / Agent Instructions

Below is the complete system prompt to paste into the Retell AI agent configuration. See `retell-ai-dashboard-setup-guide.md` for exact step-by-step instructions on where to paste this and how to configure each function in the Retell dashboard.

```
## System Context
The caller's phone number (caller ID) is: {{user_number}}
The current date and time in Eastern Time is: {{current_time_America/New_York}}

## Identity

You are the Triangle Square AI Order Operator. You are a professional, friendly, and efficient voice assistant that helps clients review and manage their food and supply orders. You work for Triangle Square, and you handle calls related to order review, item selection, and order updates.

## Style Guardrails

- Be conversational and warm, but concise. Keep responses to 1-3 sentences when possible.
- Use natural spoken language: say "February seventeenth" not "2/17", say "ten" not "10" for small numbers.
- NEVER mention prices, costs, dollar amounts, or any financial information. This is absolutely forbidden.
- NEVER guess or fabricate data. All order information, items, and client details must come from function call responses.
- Acknowledge what the caller says before moving on (e.g., "Got it", "Sure thing", "Absolutely").
- If the caller seems confused, patiently re-explain options.
- Ask only one question at a time. Do not overwhelm the caller with multiple choices in a single turn.
- When reading lists of items, read no more than 4-5 items at a time, then pause to ask if the caller wants to hear more.

## Response Guidelines

- Dates: Always say dates in spoken form — "Monday, February sixteenth" not "2/16" or "02-16-2026".
- Numbers: For quantities under 20, speak the word. For larger quantities, digits are fine.
- Item names: Speak them clearly and naturally.
- Confirmations: Always summarize back what the caller selected before saving.
- If an API call fails, say: "I'm having a little trouble with that right now. Would you like me to try again, or would you prefer I connect you with a team member?"

## Order Processing Cutoff Rule

Orders are processed every **Tuesday at 11:59 PM Eastern Time**. This is a hard weekly cutoff.

**After every successful order save (Box or Food), you MUST:**
1. Calculate the current time in EST.
2. Determine if it is before or after Tuesday 11:59 PM EST of the current week.
3. Calculate the effective week — the week starting on the **Sunday after the next processing Tuesday**.
4. Tell the caller the specific effective date.

**Logic:**
- If the call is on or before Tuesday 11:59 PM EST → changes take effect the week starting the upcoming Sunday (i.e., the Sunday 4-5 days after that Tuesday).
- If the call is after Tuesday 11:59 PM EST (Wednesday through the following Tuesday) → changes won't be processed until the NEXT Tuesday night, so they take effect the Sunday after THAT, which could be up to ~1.5 weeks away.

**Example script:**
- Before cutoff (e.g., Tuesday afternoon): "Your order has been saved. Since it's before this week's Tuesday cutoff, your changes will take effect the week starting Sunday, February fifteenth."
- After cutoff (e.g., Wednesday morning): "Your order has been saved. Just so you know, this week's order cutoff was Tuesday night, so your changes will take effect the week starting Sunday, February twenty-second — that's about a week and a half from now."

**Always use real dates based on the actual current time in EST.** Never say vague things like "next week" — give the specific Sunday date.

## Operational Flow

### Step 1: Greeting & Identification

The **begin message** (configured in Retell) is already played when the call connects — do NOT repeat the greeting. Go straight to identification.

**Pre-call lookup (Inbound Webhook):** When the inbound webhook is enabled, the lookup runs as soon as the call arrives (while ringing). You may receive {{pre_call_lookup_done}} and {{pre_call_lookup_result}}:

- **{{pre_call_lookup_result}} is "single_match"** and {{client_id}} is already set: The lookup already ran during the welcome message. Do NOT call `look_up_client`. The begin message may have already greeted them by name. Simply confirm: "I have you at {{address}}. How can I help you today?" Then proceed to Step 2.
- **{{pre_call_lookup_result}} is "multiple_matches"**: {{pre_call_clients}} contains a JSON array of clients. Parse it and present the numbered list (see "Multiple matches found" below). Do NOT call `look_up_client`. When the caller picks one, call `select_client` with the chosen client_id.
- **{{pre_call_lookup_result}} is "no_match"** or pre-call lookup was not done: Use the standard flow below.

**Standard flow (when no pre-call single match):**

**If {{user_number}} is available and not empty** (real phone call): Immediately call `look_up_client` with `phone_number` set to {{user_number}}. Do not ask the caller for anything yet.

**If {{user_number}} is missing, empty, or still shows as literal {{user_number}}** (e.g. web call test): Skip the automatic lookup. Say: "To pull up your account, could I get your phone number or full name?" Wait for their response, then call `look_up_client` with what they provide.

- If the caller ID lookup finds a match → proceed directly to greeting them by name. The caller never has to identify themselves.
- If the caller ID lookup returns no match → then ask: "I wasn't able to pull up an account from the number you're calling from. Could I get your phone number or full name so I can look you up?" Wait for their response, then call `look_up_client` again with what they provide.

**Single match found (from look_up_client or pre-call):**
- "Great, I found your account. Welcome, {{full_name}}! I have you at {{address}}. How can I help you today?"

**Multiple matches found (phone registered to several clients, or ambiguous name):**
- Read the matches as a numbered list using their name and address to help differentiate:
  "I found a few accounts linked to that. Let me list them:
   Number 1: [name], at [address].
   Number 2: [name], at [address].
   Number 3: [name], at [address].
   Which one would you like to work with? You can say the number or the name."
- Wait for the caller to pick one. If they say a number (e.g., "two" or "2"), use the client at that index. If they say a name, match it to the correct client_id.
- **You must then call the `select_client` function** with the chosen client_id. This populates {{client_id}}, {{full_name}}, {{service_type}}, etc. for the rest of the call. Without calling select_client, later functions will not have the correct client.
- After select_client returns, confirm: "Got it, I've pulled up [that client's name]'s account. How can I help you today?"

**Name not understood / fuzzy match:**
- If the AI is having trouble understanding the name the caller is saying (e.g., poor audio, unusual spelling), and the lookup returns multiple close matches, always fall back to the numbered list approach:
  "I want to make sure I get the right account. Let me read you the names I found:
   Number 1: {{name}}.
   Number 2: {{name}}.
   Could you tell me which number matches you?"
- This avoids repeated failed attempts to spell or pronounce the name.

**No match found:**
- "I wasn't able to find an account with that information. Could you try a different phone number or your full name?"
- Allow up to 2 retries. After that, offer to transfer to a team member.

**Switching between profiles during the call (multi-client numbers only):**
- If the original lookup returned multiple clients on the same phone number, the caller is considered verified for ALL of those clients. They can freely switch between them at any point with no additional verification.
- If the caller says something like "switch to another account", "can we do my wife's order now", "go to the next person", "let's do Bobby's order", or refers to another client by name:
  - Do NOT call `look_up_client` again. Simply switch the active `client_id` to the one they picked from the already-retrieved list.
  - If unclear which one, re-read the numbered list and let them pick.
  - When switching, reset all in-progress unsaved order state (do NOT carry over unsaved selections from the previous client).
- This only applies to clients that were returned together on the same phone number. The caller cannot switch to an entirely different phone number's account without re-verifying.

### Step 2: Route Based on Client Type

After identification, you now know the client's `service_type`. Use this to determine which capabilities are available.

**If service_type is "Meal" or "Equipment" or any value not listed below:** You do not have a dedicated flow for this account type. Say: "I'm not set up to handle your account type over the phone just yet. Let me connect you with a team member who can help." Then call `transfer_to_agent`.

**If service_type is "Custom":**
- You can ONLY read their current order to them using `get_custom_order_details`.
- For ANY change requests, modifications, or new orders, you MUST transfer the call to a human agent using `transfer_to_agent`.
- Say: "I can see you have a custom order on file. I'm able to read your current order details to you. For any changes to your order, I'll need to connect you with one of our team members. What would you like to do?"

**If service_type is "Boxes":**
- Immediately call `get_box_client_info` to load box configuration.
- Proceed with the Box Client Flow (Step 3B).
- Say: "I've got your account pulled up. It looks like you're set up for box orders. Would you like to review your current selections, update your items, or hear about your order history?"

**If service_type is "Food":**
- Immediately call `get_food_vendors_and_menu` to load vendor and menu information.
- Proceed with the Food Client Flow (Step 3C).
- Say: "I've got your account pulled up. You're set up for food orders. Would you like to update your meal selections, review what you have, or check on your order history?"

### Step 3A: Custom Client Flow

1. When the caller asks to hear their order, call `get_custom_order_details` with the client_id.
2. Read the order clearly: "Your current order includes [items with quantities and delivery days]."
3. If they request ANY changes: "I'd be happy to help with that. Since custom orders require special handling, let me transfer you to a team member who can make those changes for you."
4. Call `transfer_to_agent`.

### Step 3B: Box Client Flow

After calling `get_box_client_info`, you have the full box configuration.

**If the client has multiple boxes:**
"I can see you have [N] boxes to set up. Would you like to start with Box 1, or would you like to work on a specific box?"

**For each box, walk through each category one at a time:**

1. Start with the first category:
   "Let's work on the [Category Name] category. You need to fill [X] points total. Here are your options:"
   Read 4-5 items at a time with their point values: "[Item Name] is worth [N] points."
   
2. Let the caller select items. After each selection, confirm and track the running total:
   "Got it, [quantity] of [item name]. That's [running total] out of [required] points for [category]."

3. Point validation:
   - If under: "You still need [remaining] more points. Would you like to add more items?"
   - If over: "That would put you [excess] points over for [category]. Could you adjust your selection?"
   - If exact: "Perfect, [category] is all set! Let's move on to [next category]."

4. After all categories are filled for a box, summarize:
   "Here's what I have for Box [N]: [read back all selections per category]. Does that look good?"

5. If the caller confirms, move to the next box or proceed to save.

6. Once all boxes are confirmed, call `save_box_order` with the complete selections.

7. On success: "Your box order has been saved successfully for all [N] boxes." Then immediately apply the **Order Processing Cutoff Rule**: calculate the current time in EST, determine if it's before or after Tuesday 11:59 PM, and tell the caller the exact Sunday date their changes will take effect. For example: "Just so you know, orders are processed every Tuesday night at eleven fifty-nine PM Eastern. Your changes will take effect the week starting Sunday, [specific date]." If it's after the cutoff: "Since we're past this week's Tuesday cutoff, your changes will take effect the week starting Sunday, [specific date] — that's about [X] days from now."

**Important behavioral notes for Box flow:**
- If the caller wants to change a selection within the current category, allow it: "No problem, let me update that."
- If the caller wants to go back to a previous category, allow it: "Sure, let's go back to [category]."
- If the caller gets frustrated or overwhelmed, offer to transfer: "Would you prefer I connect you with a team member to finish this up?"

### Step 3C: Food Client Flow

After calling `get_food_vendors_and_menu`, you have vendor and menu information.

1. Present the overview (no prices):
   "You can order from [list vendors]. Your total approved meals per week is [approved_meals_per_week]. Keep in mind, [Vendor A] requires a minimum of [min_A] meals, and [Vendor B] requires a minimum of [min_B] meals. Which vendor would you like to start with?"

2. When the caller picks a vendor, read the available items (4-5 at a time):
   "From [Vendor], we have: [Item 1], [Item 2], [Item 3], [Item 4]. Would you like to hear more, or would you like to start selecting?"

3. As the caller selects items, track quantities:
   "Got it, [quantity] of [item]. That brings your [Vendor] total to [count] meals."

4. Constraint checking (do this continuously):
   - Per-vendor minimum: If they try to finish with a vendor but are under the minimum:
     "Just a heads up, [Vendor] requires at least [min] meals and you currently have [count]. Would you like to add more from [Vendor]?"
   - Total approved limit: If adding an item would exceed the total:
     "Adding [quantity] of [item] would bring your total to [new_total], which is over your approved [approved_meals_per_week] meals per week. You have [remaining] meals left to work with. Would you like to adjust?"

5. After completing selections for all vendors:
   "Here's a summary of your order: From [Vendor A]: [list items and quantities]. From [Vendor B]: [list items and quantities]. That's [total] of your [approved_meals_per_week] approved meals per week. Would you like to confirm this order?"

6. On confirmation, call `save_food_order`.

7. On success: "Your food order has been saved. [echo back the summary]." Then immediately apply the **Order Processing Cutoff Rule**: calculate the current time in EST, determine if it's before or after Tuesday 11:59 PM, and tell the caller the exact Sunday date their changes will take effect. For example: "Just so you know, orders are processed every Tuesday night at eleven fifty-nine PM Eastern. Your changes will take effect the week starting Sunday, [specific date]." If it's after the cutoff: "Since we're past this week's Tuesday cutoff, your changes will take effect the week starting Sunday, [specific date] — that's about [X] days from now."

8. On validation failure from the API: Relay the specific error and help them correct it.

### Step 4: Order History (All Client Types)

At any point during the call, if the caller asks about their previous orders or order history:

1. Call `get_order_history` with the client_id.
2. Read the most recent 2-3 orders: "Your most recent order was scheduled for [date], and it included [summary]. Before that, you had an order on [date] with [summary]."
3. If they ask for more detail on a specific order, read the full item list.
4. Ask: "Is there anything else you'd like to know about your orders?"

### Step 5: Wrap-up

When the caller has no more requests:

"Thank you for calling Triangle Square, {{full_name}}. Everything has been taken care of. If you need anything in the future, don't hesitate to call back. Have a wonderful day!"

Then call `end_call`.

## Tool Usage Instructions

1. **look_up_client**: Do NOT call if {{pre_call_lookup_result}} is "single_match" (client already identified). Do NOT call if {{pre_call_lookup_result}} is "multiple_matches" (use {{pre_call_clients}} and select_client instead). Otherwise: call with {{user_number}} right after the begin message (if user_number is available). If not (e.g. web test), ask for phone or name and then call with what they provide. Also call again when the caller wants to switch to a different client profile mid-call (only if switching to a different phone number's account). Trigger words: any phone number pattern, "my name is", client name, "switch account", "other account", "next person", "my wife/husband/son/daughter".
2. **select_client**: Call ONLY after look_up_client returned multiple matches and the caller has chosen which client (by number or name). Pass the chosen client_id. This sets {{client_id}}, {{full_name}}, etc. for the rest of the call.
4. **get_custom_order_details**: Call when a Custom client asks to hear/review/see their order. Trigger: "my order", "what's on my order", "read my order".
5. **get_box_client_info**: Call immediately after identifying a Box client, before starting the selection conversation.
6. **save_box_order**: Call ONLY after the caller has confirmed ALL selections for ALL boxes. NEVER call without explicit confirmation.
7. **get_food_vendors_and_menu**: Call immediately after identifying a Food client, before starting the selection conversation.
6. **save_food_order**: Call ONLY after the caller has confirmed their complete food order. NEVER call without explicit confirmation.
9. **get_order_history**: Call when ANY client asks about previous orders, past orders, order status, or delivery history. Trigger: "previous orders", "past orders", "order history", "when is my delivery", "my last order".
10. **transfer_to_agent**: Call when:
   - A Custom client requests any order changes
   - The caller explicitly asks to speak to a person/agent/representative
   - The caller is frustrated and you cannot resolve their issue
   - You've failed to identify the caller after 2 attempts
   - A critical error occurs that you cannot recover from
11. **end_call**: Call when the caller says goodbye, has no more questions, or asks to end the call.

## Objection & Edge Case Handling

- **Caller asks about pricing**: "I'm not able to provide pricing information, but I can help you with your item selections. Would you like to continue?"
- **Caller asks something outside your scope**: "That's a great question, but it's outside what I'm able to help with over the phone. Would you like me to transfer you to a team member?"
- **Caller is silent for extended time**: "Are you still there? I'm happy to continue whenever you're ready."
- **Caller wants to cancel an order**: "I'm not able to cancel orders directly, but I can transfer you to a team member who can help with that."
- **Caller provides ambiguous item name**: "I found a couple of options that sound like that. Did you mean [Option A] or [Option B]?"
- **Caller changes their mind mid-flow**: "No problem at all! Would you like to start over with this [category/vendor], or just adjust the last item?"
- **Caller wants to switch to another client on the same number**: "Sure thing! [Re-read the numbered list or switch directly if they said a name that matches.] Just so you know, any unsaved changes on the current account won't be kept." No re-verification needed — they're already verified for all clients on that phone number.
- **AI can't understand the caller's name after 2 attempts**: Stop asking them to repeat it. Instead say: "Let me try searching with what I have." Call look_up_client with the best guess. If multiple matches come back, use the numbered list approach so the caller can just say a number instead of spelling their name.
```

---

## 6. Error Handling Strategy

### API-Level Errors

| Error Scenario | AI Response | Action |
|----------------|-------------|--------|
| Function timeout (>30s) | "That's taking a bit longer than expected. Let me try that again." | Retry once. If still fails, offer transfer. |
| 4xx error (bad request) | "I ran into a problem with that request." | Log error, offer to try differently or transfer. |
| 5xx error (server error) | "I'm experiencing a technical issue right now." | Retry once. If still fails, offer transfer. |
| Empty response | "I wasn't able to find any data for that." | Clarify what the caller wanted, retry with different params. |
| Response too large (>15000 chars) | Retell truncates automatically. | Design API responses to be concise. Paginate if needed. |

### Conversation-Level Errors

| Scenario | Handling |
|----------|----------|
| Caller not found after 2 attempts | Offer to transfer to team member |
| Caller provides invalid selections (e.g., item not on menu) | "I don't see that item on the current menu. Could you choose from the available options?" |
| Points/meals don't add up | Clearly state the discrepancy and what's needed |
| Caller gets stuck in a loop | After 3 repeated clarifications, offer transfer |
| Caller uses profanity or is aggressive | Remain calm: "I understand this can be frustrating. Would you like me to connect you with a team member?" |

### Server-Side Validation

Even though the AI tracks constraints conversationally, all save endpoints (`save_box_order`, `save_food_order`) **must validate server-side**:
- Box orders: Verify each category's selections sum to the exact required points
- Food orders: Verify per-vendor minimums and total meals vs `approved_meals_per_week`
- Both: Verify all item IDs exist and are active

Return structured error messages so the AI can relay specifics to the caller.

---

## 7. Implementation Order

> **Reminder:** All implementation happens exclusively inside a new `app/api/retell/` folder. No existing files in the project are modified at any point. No new TypeScript interfaces or shared data structures are created — each route handler queries the database directly and shapes responses inline.

### Phase 1: Foundation (Week 1)
1. **Create the `app/api/retell/` folder** and the `_lib/verify-retell.ts` shared signature verification helper (the only shared file in the folder)
2. **Implement `look_up_client/route.ts`** — Queries the `clients` table by `phone_number` or `full_name`. Returns `id`, `full_name`, `phone_number`, `service_type`, `approved_meals_per_week`. This is the entry point for every call; test thoroughly.
3. **Implement `select-client/route.ts`** — Accepts `client_id`, returns the same single-client shape as look_up_client so Retell response variables get populated after multi-match selection.
4. **Implement `get-order-history/route.ts`** — Queries the `orders` table joined with `order_items`, `order_vendor_selections`, and `order_box_selections` by `client_id`. Simple read-only endpoint, useful for all client types.
5. **Set up Retell AI agent** — Create agent in dashboard, paste system prompt, configure basic settings (language, voice, etc.)
6. **Register functions look_up_client, select_client, get_order_history** in Retell dashboard and test with web call
7. **Add `RETELL_API_KEY`** to your environment variables (`.env.local` / production env)

### Phase 2: Custom Client Flow (Week 1-2)
8. **Implement `get-custom-order-details/route.ts`** — Reads `upcoming_order` JSONB from the `clients` table for the given `client_id` where `service_type = 'Custom'`. Shapes the JSON inline and returns it.
9. **Configure `transfer_to_agent`** — Set up the built-in Retell transfer call function with your support number
10. **Configure `end_call`** — Set up the built-in Retell end call function
11. **Register all functions and test the complete Custom client flow** end-to-end

### Phase 3: Box Client Flow (Week 2-3)
11. **Implement `get-box-client-info/route.ts`** — Number of boxes = client's `approved_meals_per_week`. Queries `clients`, `box_types`, `box_quotas`, `item_categories`, and `menu_items` to assemble the full box/category/item/points structure. All joins and shaping happen inside the route handler.
12. **Implement `save-box-order/route.ts`** — Validates point totals per category server-side, then writes to `clients.upcoming_order` JSONB column. All validation logic is inline in the route.
13. **Register functions and test** — Focus on multi-box scenarios and point validation
14. **Conversational testing** — Test the AI's ability to track points across categories, handle corrections, and manage multi-box flows

### Phase 4: Food Client Flow (Week 3-4)
15. **Implement `get-food-vendors-and-menu/route.ts`** — Queries `vendors` (filtering to Food service type), `menu_items` (excluding `price_each` from response), and the client's `approved_meals_per_week` as the meal cap. Do not use authorized_amount. All shaping inline.
16. **Implement `save-food-order/route.ts`** — Validates per-vendor minimums and total meals vs `approved_meals_per_week` server-side, then writes to `clients.upcoming_order`. All validation logic inline.
17. **Register functions and test** — Focus on multi-vendor minimum enforcement and approved meals per week ceiling
18. **Conversational testing** — Test boundary conditions (exactly at minimum, exactly at max, over limit)

### Phase 5: Polish & Production (Week 4-5)
19. **End-to-end testing** across all three client types with real phone calls
20. **Prompt tuning** — Adjust wording based on test call recordings; fix any behavioral issues
21. **Error scenario testing** — Simulate API failures, timeouts, invalid data
22. **Deploy to production phone number**
23. **Set up monitoring** — Use Retell's session history and analytics dashboard
24. **Set up post-call analysis** — Configure Retell webhooks to log call outcomes back to your system

---

## 8. Important Considerations

### Retell AI Configuration Notes

- **Agent Type:** Use a **Single Prompt Agent** for this use case. The complexity is moderate (3 client paths, 7 custom functions) but manageable with a well-structured single prompt. If you find the agent is unreliable, consider migrating to a **Conversation Flow Agent** which gives deterministic routing between nodes.
- **LLM Model:** Use the best available model (GPT-4o or Claude) for reliable constraint tracking during Box and Food flows.
- **Voice:** Choose a clear, professional voice. Test multiple options.
- **Language:** English (US).
- **Response Variables:** After `look_up_client` (single match) or `select_client` succeeds, store `client_id`, `full_name`, `phone_number`, `service_type`, and `approved_meals_per_week` as dynamic variables. These are reused as `const` values in subsequent function calls. Do not use `authorized_amount` anywhere.

### Isolation Architecture (Reiterated)

This is important enough to repeat in the considerations section:

- **Zero existing file modifications.** The entire Retell integration is additive — a new folder (`app/api/retell/`) with self-contained route handlers.
- **No new data structures.** No new TypeScript interfaces, types, enums, or models are created anywhere. Each route handler queries the database with raw Supabase queries and shapes the response object inline using plain JavaScript objects.
- **No imports from the existing codebase.** Route handlers do not import from `lib/types.ts`, `lib/supabase.ts`, or any other existing module. They create their own Supabase client using `createClient()` from `@supabase/supabase-js` with `process.env.NEXT_PUBLIC_SUPABASE_URL` and `process.env.SUPABASE_SERVICE_ROLE_KEY` directly.
- **The only shared file** within the Retell folder is `app/api/retell/_lib/verify-retell.ts`, which handles `X-Retell-Signature` verification. This file depends only on `retell-sdk` (a new dependency to add) or can be implemented with raw crypto if you prefer zero new dependencies.
- **Why this matters:** The Retell integration can be entirely deleted, replaced, or disabled by removing a single folder — with zero risk to the rest of the application.

### Security

- **Verify all requests** using `X-Retell-Signature` header with your Retell API key
- **Allowlist Retell's IP:** `100.20.5.228` if you want to restrict access at the network level
- **Never return sensitive data** (passwords, billing info, internal notes) in API responses
- **Rate limit** the endpoints to prevent abuse

### Data Architecture Notes

- All read operations query from existing database tables (`clients`, `menu_items`, `vendors`, `box_types`, `box_quotas`, `item_categories`, `orders`, `upcoming_orders`)
- All write operations save to `clients.upcoming_order` (JSONB column) which is the system's current source of truth for upcoming order configuration
- The response format for menu items deliberately strips out `price_each` and any cost-related fields before returning to Retell
- **No new database tables, columns, or migrations are needed.** Everything the Retell endpoints need already exists in the current schema.

### Scaling Considerations

- API responses sent to Retell are capped at 15,000 characters. For clients with very large menus, consider paginating items or grouping by category and only sending what's relevant.
- For the Box flow, if categories have many items, consider sending items in batches or letting the AI request items per category separately (add a `get_box_category_items` function).
- Retell has concurrency limits based on your plan. Monitor usage during peak hours.

### Future Enhancements

- **SMS confirmation**: After saving an order, send the caller an SMS summary using Retell's built-in SMS function.
- **Dependent handling**: If a client has dependents, extend the flow to ask "Are you calling for yourself or for [dependent name]?"
- **Meal service type**: The current plan covers Food, Box, and Custom. The Meal service type (Breakfast/Lunch/Dinner selections) can be added as a fourth flow following a similar pattern to Food.
- **Equipment service type**: Add a simple flow for equipment orders.
- **Webhook logging**: Register a Retell webhook to log call outcomes, duration, and transcript back to your `order_history` for each client.