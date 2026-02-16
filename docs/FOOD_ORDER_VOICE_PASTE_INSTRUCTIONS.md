# Food Order Voice — Paste Instructions & Function Config

Use the two sections below: **Section A** goes into your Retell agent prompt/instructions; **Section B** is the full custom function config for `save_food_order` (edit the existing function and paste/replace with this).

---

## A. Full new instructions to paste (Retell agent prompt)

Replace your existing **Step 3C: Food Client Flow** and the **save_food_order** line in Tool Usage with the following. You can paste this whole block into your agent instructions where the Food flow is defined.

---

### Step 3C: Food Client Flow

After calling `get_food_vendors_and_menu`, you have vendor and menu information. The response may include `current_selections_by_day` (orders per delivery day) and each vendor has `delivery_days` (e.g. ["Monday", "Wednesday"]).

**0. Establish the delivery day (required before collecting items).**
- If the response has `current_selections_by_day` with existing days, you can say: "You already have orders for [list the days]. Which delivery day would you like to update or add to — [list available days from vendor delivery_days]?"
- If the client has no existing order, ask: "Which delivery day would you like this order for? [Vendor A] delivers on [their delivery_days], and [Vendor B] delivers on [their delivery_days]. For example, Monday or Wednesday?"
- If only one delivery day is available across the vendors they use, confirm it: "I'll put this down for [day]. Is that right?"
- Do not proceed to item selection until you have a confirmed delivery day. Remember this day — you must pass it as `delivery_day` when you call `save_food_order`.

1. Present the overview (no prices):
   "You can order from [list vendors]. Your total approved meals per week is [approved_meals_per_week]. Keep in mind, [Vendor A] requires a minimum of [min_A] meals, and [Vendor B] requires a minimum of [min_B] meals. Which vendor would you like to start with?"

2. When the caller picks a vendor, read the available items (4–5 at a time):
   "From [Vendor], we have: [Item 1], [Item 2], [Item 3], [Item 4]. Would you like to hear more, or would you like to start selecting?"

3. As the caller selects items, track quantities:
   "Got it, [quantity] of [item]. That brings your [Vendor] total to [count] meals."

4. Constraint checking (do this continuously):
   - Per-vendor minimum: If they try to finish with a vendor but are under the minimum:
     "Just a heads up, [Vendor] requires at least [min] meals and you currently have [count]. Would you like to add more from [Vendor]?"
   - Total approved limit: If adding an item would exceed the total:
     "Adding [quantity] of [item] would bring your total to [new_total], which is over your approved [approved_meals_per_week] meals per week. You have [remaining] meals left to work with. Would you like to adjust?"

5. After completing selections for all vendors, summarize and include the delivery day:
   "Here's a summary of your order for [delivery day]: From [Vendor A]: [list items and quantities]. From [Vendor B]: [list items and quantities]. That's [total] of your [approved_meals_per_week] approved meals per week for [delivery day]. Would you like to confirm this order?"

6. On confirmation, call `save_food_order` with **client_id**, **delivery_day** (the day you established in step 0), and **vendor_selections**. You must pass the same delivery day you confirmed with the caller (e.g. "Monday", "Wednesday"). Never call save_food_order without a delivery_day.

7. On success: "Your food order has been saved for [delivery day]. [Echo back the summary]." Then immediately apply the **Order Processing Cutoff Rule**: calculate the current time in EST, determine if it's before or after Tuesday 11:59 PM, and tell the caller the exact Sunday date their changes will take effect. For example: "Just so you know, orders are processed every Tuesday night at eleven fifty-nine PM Eastern. Your changes will take effect the week starting Sunday, [specific date]." If it's after the cutoff: "Since we're past this week's Tuesday cutoff, your changes will take effect the week starting Sunday, [specific date] — that's about [X] days from now."

8. On validation failure from the API: Relay the specific error and help them correct it.

**Critical for Food flow:**
- You must establish which **delivery day** the order is for (e.g. Monday, Wednesday) using the vendor's `delivery_days` from get_food_vendors_and_menu. Ask the caller which day they want if there are multiple options, or confirm the only available day.
- Do not call save_food_order until you have both (a) a **delivery day** and (b) the caller's confirmed **selections** for that day.
- When calling save_food_order, **always** pass the **delivery_day** parameter with the exact day name (e.g. "Monday", "Wednesday") that the caller chose.

---

**Tool Usage line to use for save_food_order (replace the old one):**

- **save_food_order**: Call ONLY after the caller has confirmed their complete food order **and** you have confirmed the **delivery day** with them. Always pass **delivery_day** (e.g. "Monday", "Wednesday") in addition to client_id and vendor_selections. NEVER call without explicit confirmation of both day and selections.

---

## B. Full custom function config for `save_food_order` (paste in Retell Dashboard)

Edit the existing **save_food_order** custom function. Replace its **Description** and **Parameters (JSON Schema)** with the values below. Leave HTTP Method (POST), Endpoint URL, and Headers as they are unless you need to change the URL.

---

**Name:** `save_food_order`

**Description (paste this):**

```
Save the food order for a client for a specific delivery day. Requires delivery_day (e.g. Monday, Wednesday), which you must ask the caller for before saving. Validates per-vendor minimums and total meals vs approved_meals_per_week on the server. Call ONLY after the caller has confirmed both the delivery day and their complete selections for that day. Never call without confirmation. When calling, always pass client_id, delivery_day, and vendor_selections.
```

**Parameters — JSON Schema (paste this entire block):**

```json
{
  "type": "object",
  "required": ["client_id", "delivery_day", "vendor_selections"],
  "properties": {
    "client_id": {
      "type": "string",
      "const": "{{client_id}}",
      "description": "The client's ID"
    },
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

**Speak During Execution:** Enabled  
- Prompt: `Saving your food order now.`

**Speak After Execution:** Enabled  

**Endpoint URL:** `https://trianglesquareservices.com/api/retell/save-food-order` (or your production URL)  
**HTTP Method:** `POST`  
**Request Headers:** `Content-Type: application/json`

---

## Summary

| Where | What to paste |
|-------|----------------|
| Retell agent instructions | **Section A** — replace Step 3C (Food Client Flow) and the save_food_order tool line |
| Retell Dashboard → save_food_order custom function | **Section B** — replace Description and Parameters (JSON Schema); keep URL, method, headers, speak during/after |

After pasting, save in both places and test a Food order for a specific day (e.g. Monday).
