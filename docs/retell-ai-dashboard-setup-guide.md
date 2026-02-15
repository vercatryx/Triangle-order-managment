# Retell AI Dashboard Setup Guide — Step by Step

This document walks through every click, field, and configuration needed on the Retell AI website (dashboard.retellai.com) to set up the Triangle Square AI Voice Operator. Follow the steps in order.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Create the Agent](#2-create-the-agent)
3. [Configure Basic Settings](#3-configure-basic-settings)
4. [Paste the System Prompt](#4-paste-the-system-prompt)
5. [Configure Speech Settings](#5-configure-speech-settings)
6. [Configure Call Settings](#6-configure-call-settings)
7. [Add Functions (Tools)](#7-add-functions-tools)
   - 7.1 look_up_client
   - 7.1b select_client
   - 7.2 get_custom_order_details
   - 7.3 get_box_client_info
   - 7.4 save_box_order
   - 7.5 get_food_vendors_and_menu
   - 7.6 save_food_order
   - 7.7 get_order_history
   - 7.8 transfer_to_agent (built-in)
   - 7.9 end_call (built-in)
8. [Purchase & Assign Phone Number](#8-purchase--assign-phone-number)
9. [Test the Agent](#9-test-the-agent)
10. [Post-Call Analysis (Optional)](#10-post-call-analysis-optional)
11. [Retell System Variables Reference](#11-retell-system-variables-reference)

---

## 1. Prerequisites

Before starting on the Retell dashboard, make sure you have:

- [ ] A Retell AI account at [dashboard.retellai.com](https://dashboard.retellai.com)
- [ ] A payment method added under **Billing** tab
- [ ] Your API endpoints deployed and publicly accessible (e.g., `http://trianglesquareservices.com/api/retell/...`)
- [ ] Your `RETELL_API_KEY` saved — find it under **Settings > Keys** in the Retell dashboard
- [ ] The system prompt ready (from `retell-ai-voice-system-plan.md`, Section 5)
- [ ] Your human agent transfer phone number ready (for the transfer call function)

---

## 2. Create the Agent

1. Log in to [dashboard.retellai.com](https://dashboard.retellai.com)
2. Click the **"Agents"** tab in the left sidebar
3. Click **"Create an agent"**
4. Choose **"Blank"** (do NOT use a template — we have our own prompt)
5. Select agent type: **Single Prompt Agent**
6. Name the agent: `Triangle Square Order Operator`
7. Click **Create**

You'll land on the agent detail page. This is where all configuration happens.

---

## 3. Configure Basic Settings

On the agent detail page:

### Language Model

1. In the **Model** section, select **GPT-4.1** (recommended for best balance of quality, latency, and cost)
   - Alternative: If you need maximum reliability for complex constraint tracking (Box/Food flows), select **GPT-4o**
   - Do NOT use GPT-3.5 or mini models — they won't reliably track point totals and vendor minimums

### Voice

1. Click the **Voice** dropdown
2. Listen to available voice samples — pick a clear, professional, warm-sounding voice
3. Recommended: Pick a natural US English voice. Preview several options.
4. Note the voice ID for reference

### Conversation Initiation

1. Set to **"Agent-First"** — the agent speaks first when the call connects
2. For the **Begin Message**, set it to:

```
Hello, thank you for calling Triangle Square Services. I'm an AI secretary. I can help you review or make changes to your upcoming selections, or hear details about previous orders that are scheduled or have already been completed.
```

> **Important:** With the **Inbound Webhook** enabled (Step 8), the client lookup runs as soon as the call arrives — while it is ringing — and injects dynamic variables before the call connects. When a single match is found, the begin message is overridden to greet the caller by name: "Hello {{full_name}}, thank you for calling...". The AI receives client_id, full_name, etc. and skips the lookup. If no match or multiple matches, the default begin message above is used, and the AI proceeds with the usual identification flow.

### Language

1. Set to **English (US)**

---

## 4. Paste the System Prompt

1. In the agent detail page, find the **Prompt** section (also called "Global Prompt" in some views)
2. Copy the **entire system prompt** from `retell-ai-voice-system-plan.md` Section 5 (everything between the ``` markers in that section)
3. Paste it into the prompt field

The prompt is structured with these sections (Retell's recommended format):
- `## Identity`
- `## Style Guardrails`
- `## Response Guidelines`
- `## Order Processing Cutoff Rule`
- `## Operational Flow` (Steps 1-5)
- `## Tool Usage Instructions`
- `## Objection & Edge Case Handling`

> **Important:** The prompt references dynamic variables like `{{full_name}}`, `{{client_id}}`, `{{service_type}}`, `{{address}}`. These will be populated by the `look_up_client` function's response variables (configured in Step 7.1). Additionally, Retell provides built-in system variables like `{{user_number}}` (the caller's phone number) and `{{current_time_America/New_York}}` (current Eastern time) — these work automatically with no setup.

### Add to the top of the prompt

Because Retell provides `{{user_number}}` (the caller's phone number) and `{{current_time_America/New_York}}` automatically, add this to the very top of the prompt, before `## Identity`:

```
## System Context
The caller's phone number (caller ID) is: {{user_number}}
The current date and time in Eastern Time is: {{current_time_America/New_York}}
```

This gives the AI access to the caller ID for the auto-lookup and the real current time for the cutoff date calculation.

---

## 5. Configure Speech Settings

Scroll down to the **Speech Settings** section on the agent detail page:

### Background Sound
- Set to **"Off"** or **"Office"** (subtle) — your choice. "Office" gives a slightly more natural feel.

### Responsiveness
- Set to **0.8 - 1.0** (default is fine)
- If your callers tend to be elderly or slower speakers, reduce to **0.5 - 0.7**

### Interruption Sensitivity
- Set to **0.6 - 0.8** (medium)
- This allows callers to interrupt when needed but prevents the AI from being cut off by background noise

### Backchanneling
- **Enable** — this makes the AI say things like "uh huh", "right", "okay" while the caller is speaking, making it sound more natural
- Set frequency to **medium**

### Boosted Keywords
Add these to help speech recognition:
```
Triangle Square
ShopRite
Walmart
carbs
proteins
```
(Add any vendor names, category names, or commonly used item names that might be hard to recognize)

### Speech Normalization
- **Enable** — this converts numbers and dates to spoken words (e.g., "2/15" becomes "February fifteenth")

### Reminder Frequency
- Set to **15-20 seconds** — if the caller goes silent, the AI will prompt: "Are you still there?"

### Pronunciation Dictionary
- Add any words that the voice gets wrong during testing (you'll fill this in after initial testing)

---

## 6. Configure Call Settings

### End Call on Silence
- **Enable** — set to **60 seconds** of silence before auto-ending the call

### Max Call Duration
- Set to **15 minutes** (900,000 ms) — this prevents runaway calls
- Increase if testing shows legitimate calls are being cut off

### Pause Before Speaking
- Set to **500-800 ms** — gives the caller a moment to settle in after picking up

---

## 7. Add Functions (Tools)

Navigate to the **"Functions"** section on the agent detail page. Click **"+ Add"** to add each function.

Your base URL for all custom function endpoints (paste as-is in the Retell dashboard):
```
http://trianglesquareservices.com/api/retell
```

### Testing each API (Step 7)

Every custom function (7.1–7.7) has a **Test this API** block below it with the exact **query** (for GET) or **body** (for POST) and a **curl** example. Use these to verify each endpoint before or after adding it in the Retell dashboard.

- **Requirement:** Set **`RETELL_SKIP_VERIFY=true`** in `.env.local` so the server accepts requests without the `x-retell-signature` header when testing with curl or Postman.
- **Placeholders:** Replace `CLIENT-001` and other IDs with real values from your database or from a previous response (e.g. after `look_up_client` or `get_box_client_info`).
- **Base URL:** Use your deployed URL (e.g. `http://trianglesquareservices.com`) or `http://localhost:3000` when testing locally.

---

### 7.1 `look_up_client` — Custom Function

1. Click **"+ Add"** > **"Custom Function"**

2. **Name:** `look_up_client`

3. **Description:** `Look up a client account by phone number or full name. Searches both primary and secondary phone numbers. Returns client ID, name, address, service type, and authorization details. Call this immediately using the caller ID ({{user_number}}), and if that fails, call again with whatever the caller provides verbally.`

4. **HTTP Method:** `POST`

5. **Endpoint URL:** `http://trianglesquareservices.com/api/retell/look-up-client`

6. **Request Headers:**
   | Header Name | Value |
   |------------|-------|
   | `Content-Type` | `application/json` |

7. **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "properties": {
    "phone_number": {
      "type": "string",
      "description": "A phone number to search by. Use the caller ID from {{user_number}} for the first automatic attempt. If that fails, use whatever the caller provides verbally. Searches both primary and secondary phone number fields."
    },
    "full_name": {
      "type": "string",
      "description": "The caller's full name. Only use this if phone number lookup returned no results and the caller provided their name instead."
    }
  }
}
```

8. **Response Variables:**
   Click **"+ Add"** for each:

   | Variable Name | JSON Path | Description |
   |--------------|-----------|-------------|
   | `client_id` | `$.client_id` | The matched client's ID |
   | `full_name` | `$.full_name` | The matched client's full name |
   | `phone_number` | `$.phone_number` | The matched client's primary phone number |
   | `secondary_phone_number` | `$.secondary_phone_number` | The matched client's secondary phone number |
   | `address` | `$.address` | The matched client's address |
   | `service_type` | `$.service_type` | The client's service type (Food, Boxes, or Custom) |
   | `approved_meals_per_week` | `$.approved_meals_per_week` | For Food: meal cap per week. For Boxes: number of boxes authorized. Do not use authorized_amount. |
   | `multiple_matches` | `$.multiple_matches` | Whether multiple clients were found (true/false) |

   > **Note:** Response variables are only populated on a single-match response. When the response is multiple matches, the AI must call **`select_client`** with the chosen client_id so these variables get set for the rest of the call.

9. **Speak During Execution:** **Enabled**
   - Prompt: `Let me look that up for you.`

10. **Speak After Execution:** **Enabled**
    - The AI will greet the caller by name or read the multi-match list based on the response.

11. Click **Save**

**Test this API.** (Requires `RETELL_SKIP_VERIFY=true` in `.env.local` for local/manual testing.)

- **Body (Retell wrapper):** Retell sends a wrapper; use this shape. You can use `phone_number` or `full_name`.
- **Example (by phone):** Replace `5551234567` with a real client phone number.

```json
{"name":"look_up_client","args":{"phone_number":"5551234567"},"call":{}}
```

- **Example (by name):** `"args":{"full_name":"Jane Doe"}` if phone lookup returned no results.
- **curl:**

```bash
curl -X POST http://trianglesquareservices.com/api/retell/look-up-client \
  -H "Content-Type: application/json" \
  -d '{"name":"look_up_client","args":{"phone_number":"5551234567"},"call":{}}'
```

Expected: `200` JSON with `client_id`, `full_name`, `service_type`, etc. on single match; or `multiple_matches: true` and a list; or `no_client_found` / `no_match_by_name`.

---

### 7.1b `select_client` — Custom Function (required after multi-match)

1. Click **"+ Add"** > **"Custom Function"**

2. **Name:** `select_client`

3. **Description:** `After look_up_client returns multiple matches, the caller picks one. Call this with the chosen client_id to load that client's profile. Returns the same shape as a single-match look_up_client so response variables (client_id, full_name, service_type, approved_meals_per_week, etc.) get populated for the rest of the call. Only call when the caller has just chosen from a multi-match list.`

4. **HTTP Method:** `POST`

5. **Endpoint URL:** `http://trianglesquareservices.com/api/retell/select-client`

6. **Request Headers:**
   | Header Name | Value |
   |------------|-------|
   | `Content-Type` | `application/json` |

7. **Parameters (JSON Schema):**
```json
{
  "type": "object",
  "required": ["client_id"],
  "properties": {
    "client_id": {
      "type": "string",
      "description": "The client_id of the client the caller selected from the list (e.g. CLIENT-002)."
    }
  }
}
```

8. **Response Variables:** Same as look_up_client — add: `client_id`, `full_name`, `phone_number`, `secondary_phone_number`, `address`, `service_type`, `approved_meals_per_week` (JSON paths `$.client_id`, etc.). This overwrites/sets the session variables.

9. **Speak During Execution:** **Disabled**

10. **Speak After Execution:** **Enabled** — the AI will confirm e.g. "Got it, I've pulled up [name]'s account. How can I help you today?"

11. Click **Save**

**Test this API.** (Requires `RETELL_SKIP_VERIFY=true` in `.env.local` for local/manual testing.)

- **Body (Retell wrapper):** Pass the chosen `client_id` from a multi-match `look_up_client` response.
- **Example:** Replace `CLIENT-001` with a real client ID.

```json
{"name":"select_client","args":{"client_id":"CLIENT-001"},"call":{}}
```

```bash
curl -X POST http://trianglesquareservices.com/api/retell/select-client \
  -H "Content-Type: application/json" \
  -d '{"name":"select_client","args":{"client_id":"CLIENT-001"},"call":{}}'
```

Expected: `200` JSON with same shape as single-match `look_up_client` (client_id, full_name, service_type, etc.).

---

### 7.2 `get_custom_order_details` — Custom Function

1. Click **"+ Add"** > **"Custom Function"**

2. **Name:** `get_custom_order_details`

3. **Description:** `Get the current order details for a Custom service type client. Returns items, quantities, delivery days, and next delivery date. Only call this for clients whose service_type is "Custom".`

4. **HTTP Method:** `GET`

5. **Endpoint URL:** `http://trianglesquareservices.com/api/retell/get-custom-order-details`

6. **Query Parameters:**

   | Parameter Name | Type | Value |
   |---------------|------|-------|
   | `client_id` | Const | `{{client_id}}` |

7. **Response Variables:** None needed — the AI reads the response directly.

8. **Speak During Execution:** **Enabled**
   - Prompt: `Let me pull up your order details.`

9. **Speak After Execution:** **Enabled**

10. Click **Save**

**Test this API.** (Requires `RETELL_SKIP_VERIFY=true` in `.env.local` for local/manual testing.)

- **Query:** `client_id` — use a Custom service client ID (e.g. from a `look_up_client` response).
- **Example:** Replace `CLIENT-001` with a real Custom client ID. Use your deployed base URL or `http://localhost:3000` when testing locally.

```bash
curl "http://trianglesquareservices.com/api/retell/get-custom-order-details?client_id=CLIENT-001"
```

Expected: `200` JSON with `success`, `has_order`, and `order` (items, next_delivery_date, notes) or `client_not_found` / `not_custom_client` if invalid.

---

### 7.3 `get_box_client_info` — Custom Function

1. Click **"+ Add"** > **"Custom Function"**

2. **Name:** `get_box_client_info`

3. **Description:** `Get full box ordering information for a Boxes service type client. Returns the number of boxes, categories per box, items per category with point values, and required point totals. Only call this for clients whose service_type is "Boxes".`

4. **HTTP Method:** `GET`

5. **Endpoint URL:** `http://trianglesquareservices.com/api/retell/get-box-client-info`

6. **Query Parameters:**

   | Parameter Name | Type | Value |
   |---------------|------|-------|
   | `client_id` | Const | `{{client_id}}` |

7. **Response Variables:** None needed — the AI uses the full response to walk through the conversation.

8. **Speak During Execution:** **Enabled**
   - Prompt: `Let me pull up your box options.`

9. **Speak After Execution:** **Enabled**

10. Click **Save**

**Test this API.** (Requires `RETELL_SKIP_VERIFY=true` in `.env.local` for local/manual testing.)

- **Query:** `client_id` — use a Boxes service client ID (e.g. from a `look_up_client` response).
- **Example:** Replace `CLIENT-001` with a real Boxes client ID.

```bash
curl "http://trianglesquareservices.com/api/retell/get-box-client-info?client_id=CLIENT-001"
```

Expected: `200` JSON with box count, categories, items (with point values), and required point totals.

---

### 7.4 `save_box_order` — Custom Function

1. Click **"+ Add"** > **"Custom Function"**

2. **Name:** `save_box_order`

3. **Description:** `Save the complete box order selections for a client. Call this ONLY after the caller has confirmed ALL selections for ALL boxes. Never call without explicit confirmation. Sends the full box selections JSON including items per category per box.`

4. **HTTP Method:** `POST`

5. **Endpoint URL:** `http://trianglesquareservices.com/api/retell/save-box-order`

6. **Request Headers:**
   | Header Name | Value |
   |------------|-------|
   | `Content-Type` | `application/json` |

7. **Parameters (JSON Schema):**
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
      "description": "Array of box selections, one object per box",
      "items": {
        "type": "object",
        "properties": {
          "box_index": {
            "type": "number",
            "description": "Which box this is (1-indexed)"
          },
          "box_type_id": {
            "type": "string",
            "description": "The box type ID from get_box_client_info"
          },
          "category_selections": {
            "type": "array",
            "description": "Array of category selections for this box",
            "items": {
              "type": "object",
              "properties": {
                "category_id": {
                  "type": "string",
                  "description": "The category ID"
                },
                "items": {
                  "type": "array",
                  "description": "Array of selected items",
                  "items": {
                    "type": "object",
                    "properties": {
                      "item_id": {
                        "type": "string",
                        "description": "The menu item ID"
                      },
                      "quantity": {
                        "type": "number",
                        "description": "How many of this item"
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
}
```

8. **Speak During Execution:** **Enabled**
   - Prompt: `Saving your selections now.`

9. **Speak After Execution:** **Enabled**

10. Click **Save**

**Test this API.** (Requires `RETELL_SKIP_VERIFY=true` in `.env.local` for local/manual testing.)

- **Body (Retell wrapper):** `client_id` (Boxes client) and `box_selections` — use real `box_type_id`, `category_id`, and `item_id` from `get_box_client_info` response.
- **Example:** Replace `CLIENT-001` and the placeholder IDs with real values. This is one box, one category, one item; adjust to match your box count and point rules.

```json
{
  "name": "save_box_order",
  "args": {
    "client_id": "CLIENT-001",
    "box_selections": [
      {
        "box_index": 1,
        "box_type_id": "<box_type_id from get_box_client_info>",
        "category_selections": [
          {
            "category_id": "<category_id from get_box_client_info>",
            "items": [
              { "item_id": "<item_id from get_box_client_info>", "quantity": 1 }
            ]
          }
        ]
      }
    ]
  },
  "call": {}
}
```

```bash
curl -X POST http://trianglesquareservices.com/api/retell/save-box-order \
  -H "Content-Type: application/json" \
  -d '{"name":"save_box_order","args":{"client_id":"CLIENT-001","box_selections":[{"box_index":1,"box_type_id":"YOUR_BOX_TYPE_ID","category_selections":[{"category_id":"YOUR_CATEGORY_ID","items":[{"item_id":"YOUR_ITEM_ID","quantity":1}]}]}]},"call":{}}'
```

Expected: `200` JSON with `success: true` when valid; or validation errors if point totals or structure are wrong.

---

### 7.5 `get_food_vendors_and_menu` — Custom Function

1. Click **"+ Add"** > **"Custom Function"**

2. **Name:** `get_food_vendors_and_menu`

3. **Description:** `Get all vendor and menu information for a Food service type client. Returns vendors with their menu items, minimum meals per vendor, and the client's approved_meals_per_week (meal cap). No prices are included. Only call this for clients whose service_type is "Food". Do not use authorized_amount.`

4. **HTTP Method:** `GET`

5. **Endpoint URL:** `http://trianglesquareservices.com/api/retell/get-food-vendors-and-menu`

6. **Query Parameters:**

   | Parameter Name | Type | Value |
   |---------------|------|-------|
   | `client_id` | Const | `{{client_id}}` |

7. **Response Variables:** None needed.

8. **Speak During Execution:** **Enabled**
   - Prompt: `Let me get your menu options.`

9. **Speak After Execution:** **Enabled**

10. Click **Save**

**Test this API.** (Requires `RETELL_SKIP_VERIFY=true` in `.env.local` for local/manual testing.)

- **Query:** `client_id` — use a Food service client ID (e.g. from a `look_up_client` response).
- **Example:** Replace `CLIENT-001` with a real Food client ID.

```bash
curl "http://trianglesquareservices.com/api/retell/get-food-vendors-and-menu?client_id=CLIENT-001"
```

Expected: `200` JSON with vendors, menu items, minimum meals per vendor, and the client's `approved_meals_per_week`.

---

### 7.6 `save_food_order` — Custom Function

1. Click **"+ Add"** > **"Custom Function"**

2. **Name:** `save_food_order`

3. **Description:** `Save the food order for a client. Validates per-vendor minimums and total meals vs approved_meals_per_week on the server before saving. Call ONLY after the caller has explicitly confirmed their complete food order. Never call without confirmation.`

4. **HTTP Method:** `POST`

5. **Endpoint URL:** `http://trianglesquareservices.com/api/retell/save-food-order`

6. **Request Headers:**
   | Header Name | Value |
   |------------|-------|
   | `Content-Type` | `application/json` |

7. **Parameters (JSON Schema):**
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
      "description": "Array of vendor selections with items",
      "items": {
        "type": "object",
        "properties": {
          "vendor_id": {
            "type": "string",
            "description": "The vendor ID"
          },
          "items": {
            "type": "array",
            "description": "Selected items from this vendor",
            "items": {
              "type": "object",
              "properties": {
                "item_id": {
                  "type": "string",
                  "description": "The menu item ID"
                },
                "quantity": {
                  "type": "number",
                  "description": "How many of this item"
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

8. **Speak During Execution:** **Enabled**
   - Prompt: `Saving your food order now.`

9. **Speak After Execution:** **Enabled**

10. Click **Save**

**Test this API.** (Requires `RETELL_SKIP_VERIFY=true` in `.env.local` for local/manual testing.)

- **Body (Retell wrapper):** `client_id` (Food client) and `vendor_selections` — use real `vendor_id` and `item_id` from `get_food_vendors_and_menu` response.
- **Example:** Replace `CLIENT-001`, `YOUR_VENDOR_ID`, and `YOUR_ITEM_ID` with real values.

```json
{
  "name": "save_food_order",
  "args": {
    "client_id": "CLIENT-001",
    "vendor_selections": [
      {
        "vendor_id": "<vendor_id from get_food_vendors_and_menu>",
        "items": [
          { "item_id": "<item_id from menu>", "quantity": 1 }
        ]
      }
    ]
  },
  "call": {}
}
```

```bash
curl -X POST http://trianglesquareservices.com/api/retell/save-food-order \
  -H "Content-Type: application/json" \
  -d '{"name":"save_food_order","args":{"client_id":"CLIENT-001","vendor_selections":[{"vendor_id":"YOUR_VENDOR_ID","items":[{"item_id":"YOUR_ITEM_ID","quantity":1}]}]},"call":{}}'
```

Expected: `200` JSON with `success: true` when valid; or validation errors if vendor minimums or total meals exceed `approved_meals_per_week`.

---

### 7.7 `get_order_history` — Custom Function

1. Click **"+ Add"** > **"Custom Function"**

2. **Name:** `get_order_history`

3. **Description:** `Get previous and upcoming order history for any client type. Returns order numbers, scheduled delivery dates, status, and item summaries. Call this when the caller asks about their previous orders, past orders, delivery history, or order status.`

4. **HTTP Method:** `GET`

5. **Endpoint URL:** `http://trianglesquareservices.com/api/retell/get-order-history`

6. **Query Parameters:**

   | Parameter Name | Type | Value |
   |---------------|------|-------|
   | `client_id` | Const | `{{client_id}}` |

7. **Response Variables:** None needed.

8. **Speak During Execution:** **Enabled**
   - Prompt: `Let me pull up your order history.`

9. **Speak After Execution:** **Enabled**

10. Click **Save**

**Test this API.** (Requires `RETELL_SKIP_VERIFY=true` in `.env.local` for local/manual testing.)

- **Query:** `client_id` — use any client ID (e.g. from a `look_up_client` response).
- **Example:** Replace `CLIENT-001` with a real client ID.

```bash
curl "http://trianglesquareservices.com/api/retell/get-order-history?client_id=CLIENT-001"
```

Expected: `200` JSON with order history (order numbers, scheduled delivery dates, status, item summaries).

---

### 7.8 `transfer_to_agent` — Built-in Transfer Call

1. Click **"+ Add"** > **"Transfer Call"**

2. **Transfer To:** Enter your human support team's phone number in E.164 format (e.g., `+12125551000`)

3. **Transfer Type:** **Warm Transfer** (recommended)

4. **Warm Transfer Settings:**
   - **Whisper Message:** `Incoming transfer from the AI Order Operator. Client name: {{full_name}}. Client ID: {{client_id}}. Service type: {{service_type}}.`
   - **Enable Human Detection:** **Yes**
   - **Auto-Greet:** **Yes**
   - **Agent Detection Timeout:** **30 seconds** (default)
   - **Three-way message (optional):** `{{full_name}}, I've connected you with a team member. They'll be able to help you from here.`

5. **On-hold Music:** Default ringtone (or upload a custom one)

6. Click **Save**

**Test:** No API to call — this is a built-in Retell action. Test by triggering a transfer during a web or phone test call.

> **Prompt instruction to add:** The system prompt already includes instructions for when to use `transfer_to_agent` (Custom client changes, caller requests a human, repeated failures, frustration). No extra prompt changes needed.

---

### 7.9 `end_call` — Built-in End Call

1. Click **"+ Add"** > **"End Call"**

2. **Name:** `end_call` (default)

3. **Description (optional):** `End the call when the caller says goodbye, has no more questions, or the conversation is complete.`

4. Click **Save**

**Test:** No API to call — this is a built-in Retell action. Test by saying goodbye or "I'm done" during a web or phone test call.

> **Prompt instruction to add:** The system prompt already includes end call trigger instructions. No extra changes needed.

---

### Quick reference: test request for each API (7.1–7.7)

| Step | Function | Method | What to send (query or body) |
|------|----------|--------|------------------------------|
| 7.1 | `look_up_client` | POST | Body: `{"name":"look_up_client","args":{"phone_number":"…"},"call":{}}` or `args.full_name` |
| 7.1b | `select_client` | POST | Body: `{"name":"select_client","args":{"client_id":"…"},"call":{}}` |
| 7.2 | `get_custom_order_details` | GET | Query: `?client_id=<Custom client ID>` |
| 7.3 | `get_box_client_info` | GET | Query: `?client_id=<Boxes client ID>` |
| 7.4 | `save_box_order` | POST | Body: `{"name":"save_box_order","args":{"client_id":"…","box_selections":[…]},"call":{}}` |
| 7.5 | `get_food_vendors_and_menu` | GET | Query: `?client_id=<Food client ID>` |
| 7.6 | `save_food_order` | POST | Body: `{"name":"save_food_order","args":{"client_id":"…","vendor_selections":[…]},"call":{}}` |
| 7.7 | `get_order_history` | GET | Query: `?client_id=<any client ID>` |

Use the full **Test this API** block under each step for the exact JSON and curl.

---

## 8. Purchase & Assign Phone Number

1. Go to the **"Phone Numbers"** tab in the left sidebar
2. Click **"Buy New Number"**
3. (Optional) Enter an area code if you want a specific region
4. Purchase the number
5. Once purchased, click on the number to open its settings
6. Under **"Inbound Call Agent"**, select your **"Triangle Square Order Operator"** agent
7. Click **Save**

### (Recommended) Set Up Inbound Webhook — Lookup During Welcome Message

The inbound webhook runs **as soon as an inbound call arrives** (while it is ringing, before the call connects). It performs the client lookup by caller ID and injects `dynamic_variables` so that when the welcome message plays, the AI already has the client data. This enables:

- **Single match:** Personalized greeting: "Hello {{full_name}}, thank you for calling Triangle Square Services..." — no "Let me look that up" delay
- **Multiple matches / No match:** Default greeting plays; the AI proceeds with the usual identification flow

**Set up the inbound webhook:**

1. On the phone number settings page, find **"Inbound Webhook"**
2. Toggle it **On**
3. Set the URL to: `https://trianglesquareservices.com/api/retell/inbound-webhook`
4. The webhook receives a POST with `from_number` and `to_number`, runs the client lookup, and returns `dynamic_variables` (and optionally overrides the begin message for single-match). The call stays ringing until the webhook responds (10 second timeout).

**Note:** Ensure the phone number has an **Inbound Call Agent** assigned. When the webhook is enabled, Retell will still connect the call to that agent after the webhook returns; if the webhook fails after retries, Retell falls back to the configured agent.

---

## 9. Test the Agent

### Web Call Test (Do This First)

1. Go back to the **"Agents"** tab
2. Click on your **"Triangle Square Order Operator"** agent
3. Click the **"Test"** button (top right)
4. This opens a web call test interface
5. Test each flow:

**Test 1: Caller ID / Web call**
- On a **web call**, `{{user_number}}` is typically empty or not a real client number, so the agent should skip auto-lookup and ask for phone number or name. Provide a test client's phone number and verify the lookup works.
- On a **real phone call** from a registered number, the agent should use caller ID and not ask for identification.

**Test 2: Custom Client Flow**
- Use a client with `service_type = "Custom"`
- Verify: AI reads order, offers transfer for changes, properly uses transfer function

**Test 3: Box Client Flow**
- Use a client with `service_type = "Boxes"`
- Verify: AI reads categories, tracks points, prevents over/under, handles multi-box
- Try edge cases: go over points, try to finish under points, ask to go back a category

**Test 4: Food Client Flow**
- Use a client with `service_type = "Food"`
- Verify: AI reads vendors/items, tracks vendor minimums, tracks authorized total
- Try edge cases: try to go over authorized amount, try to finish under vendor minimum

**Test 5: Order History**
- Ask for order history with any client type
- Verify: AI reads dates in spoken form, provides delivery details

**Test 6: Multi-Client Number**
- Use a phone number linked to multiple clients
- Verify: AI lists them with numbers, caller picks one, AI calls **select_client** with that client_id (so variables are set), then continues. Caller can switch mid-call by saying "switch to Jane" or "the other account" — AI uses the already-retrieved list, no re-verification.

**Test 7: Error Handling**
- Give a fake phone number/name — verify graceful failure and retry
- Try asking about pricing — verify the AI refuses

### Phone Call Test (Do This After Web Test Passes)

1. Call your purchased Retell phone number from a phone that IS registered as a client
   - Verify the caller ID auto-lookup works (no need to identify yourself)
2. Call from a phone that is NOT registered
   - Verify the fallback: AI asks for phone number or name
3. Test the full flow with a real phone call for each client type

### LLM Playground Test (Optional but Helpful)

1. Go to **Test > LLM Playground** in the sidebar
2. This lets you test the prompt + function calling logic without voice
3. Type simulated caller messages and verify the AI's responses and tool call decisions

---

## 10. Post-Call Analysis (Optional)

Set this up after the core system is working.

1. On the agent detail page, scroll to **"Post Call Analysis"**
2. Click **Configure**
3. Add analysis fields:

   | Field Name | Type | Description |
   |-----------|------|-------------|
   | `client_id` | Text | The client ID that was identified |
   | `service_type` | Text | Food, Boxes, or Custom |
   | `action_taken` | Enum | Options: "order_saved", "order_reviewed", "transferred_to_agent", "no_action", "failed" |
   | `order_saved` | Boolean | Whether an order was successfully saved |
   | `call_summary` | Text | Brief summary of what happened on the call |

4. Click **Save**

This data will be available in the **Session History** for each call and can be exported for reporting.

---

## 11. Retell System Variables Reference

These variables are **automatically available** in your prompt and function configurations. No setup needed.

### Variables Used in This Agent

| Variable | What It Contains | How We Use It |
|----------|-----------------|---------------|
| `{{user_number}}` | The caller's phone number (E.164 format, e.g., `+12137771234`) | **Caller ID auto-lookup** — the AI passes this to `look_up_client` as the first automatic attempt |
| `{{current_time_America/New_York}}` | Current date/time in Eastern Time (e.g., "Thursday, February 12, 2026 at 3:45:22 PM EST") | **Order cutoff calculation** — the AI uses this to determine if it's before/after Tuesday 11:59 PM EST and calculate the effective week |
| `{{agent_number}}` | The Retell phone number that was called | Reference only |
| `{{direction}}` | `inbound` or `outbound` | Reference only |
| `{{call_id}}` | Unique ID for this call session | Logging reference |
| `{{session_duration}}` | How long the call has been running | Reference only |

### Variables Set by the Inbound Webhook (Pre-Call Lookup)

When the inbound webhook is enabled, these are set **before the call connects** (during the ringing phase):

| Variable | When Set | Description |
|----------|----------|-------------|
| `{{pre_call_lookup_done}}` | Always | `"true"` when the webhook ran |
| `{{pre_call_lookup_result}}` | Always | `"single_match"`, `"multiple_matches"`, or `"no_match"` |
| `{{client_id}}`, `{{full_name}}`, etc. | `single_match` only | Same as look_up_client response variables |
| `{{pre_call_clients}}` | `multiple_matches` only | JSON string of the clients array for the AI to parse |

When `pre_call_lookup_result` is `single_match`, the begin message is overridden to greet by name. The AI skips `look_up_client`.

### Variables Set by Our Functions (Response Variables)

These are populated after `look_up_client` returns a successful single match (or when pre-call lookup did not find a single match):

| Variable | Set By | Used In |
|----------|--------|---------|
| `{{client_id}}` | `look_up_client` or `select_client` response | All subsequent function calls as a `const` parameter |
| `{{full_name}}` | `look_up_client` or `select_client` response | Greeting, wrap-up, transfer whisper message |
| `{{phone_number}}` | `look_up_client` or `select_client` response | Reference |
| `{{secondary_phone_number}}` | `look_up_client` or `select_client` response | Reference |
| `{{address}}` | `look_up_client` or `select_client` response | Greeting (to confirm identity) |
| `{{service_type}}` | `look_up_client` or `select_client` response | Routing logic, transfer whisper message |
| `{{approved_meals_per_week}}` | `look_up_client` or `select_client` response | Food: meal cap. Boxes: number of boxes. Do not use authorized_amount. |
| `{{multiple_matches}}` | `look_up_client` response | When true, AI must call select_client after caller picks. |

---

## Quick Reference: All Functions Summary

| # | Function | Type | Method | Endpoint Path | Speak During | Speak After |
|---|----------|------|--------|---------------|-------------|-------------|
| 1 | `look_up_client` | Custom | POST | `/api/retell/look-up-client` | Yes | Yes |
| 1b | `select_client` | Custom | POST | `/api/retell/select-client` | No | Yes |
| 2 | `get_custom_order_details` | Custom | GET | `/api/retell/get-custom-order-details` | Yes | Yes |
| 3 | `get_box_client_info` | Custom | GET | `/api/retell/get-box-client-info` | Yes | Yes |
| 4 | `save_box_order` | Custom | POST | `/api/retell/save-box-order` | Yes | Yes |
| 5 | `get_food_vendors_and_menu` | Custom | GET | `/api/retell/get-food-vendors-and-menu` | Yes | Yes |
| 6 | `save_food_order` | Custom | POST | `/api/retell/save-food-order` | Yes | Yes |
| 7 | `get_order_history` | Custom | GET | `/api/retell/get-order-history` | Yes | Yes |
| 8 | `transfer_to_agent` | Built-in Transfer | — | — (configured in dashboard) | — | — |
| 9 | `end_call` | Built-in End Call | — | — (configured in dashboard) | — | — |

---

## Checklist Before Going Live

- [ ] Inbound webhook enabled on the phone number with URL `https://trianglesquareservices.com/api/retell/inbound-webhook` (enables lookup during welcome message)
- [ ] All 8 custom function endpoints are deployed (look_up_client, select_client, get_custom_order_details, get_box_client_info, save_box_order, get_food_vendors_and_menu, save_food_order, get_order_history) and returning correct responses
- [ ] `RETELL_API_KEY` is in your production environment variables
- [ ] Agent created with correct model (GPT-4.1 or GPT-4o)
- [ ] System prompt pasted with `## System Context` block at top (includes `{{user_number}}` and `{{current_time_America/New_York}}`)
- [ ] Voice selected and sounds professional
- [ ] Conversation initiation set to **Agent-First** with begin message
- [ ] All 10 functions (8 custom + 2 built-in) added and saved, including select_client for multi-match
- [ ] Response variables configured on `look_up_client`
- [ ] `client_id` is passed as a `const` parameter in all functions that need it
- [ ] Transfer call configured with correct phone number and warm transfer settings
- [ ] Phone number purchased and assigned to the agent
- [ ] Web call testing completed for all 3 client types
- [ ] Phone call testing completed (caller ID auto-lookup works)
- [ ] Multi-client number switching tested
- [ ] Order cutoff date messaging verified with real Eastern time
- [ ] No prices are ever mentioned in any response
- [ ] Speech settings tuned (responsiveness, interruption sensitivity, boosted keywords)
