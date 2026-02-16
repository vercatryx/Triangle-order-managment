# Food Order Voice Fix — What You Still Have To Do

The **code** is done: the existing `save-food-order` and `get-food-vendors-and-menu` API routes are already updated (delivery day, validation, preserve fields, `current_selections_by_day`). No new APIs were added.

What’s left is **configuration, docs, and testing** — all on your side.

---

## 1. Retell agent prompt / flow

**Where:** Retell dashboard (or wherever you edit the AI agent’s system prompt / instructions).

**Do this:**

- Add instructions so the AI **asks or confirms the delivery day** for Food orders (e.g. “Which delivery day — Monday or Wednesday?”) using `delivery_days` from `get_food_vendors_and_menu`.
- Require that the AI **does not call** `save_food_order` until the caller has confirmed both (a) delivery day and (b) full selections for that day.
- Require that when calling `save_food_order`, the AI **always passes** the `delivery_day` parameter (e.g. `"Monday"`, `"Wednesday"`).

**Suggested prompt lines you can paste/adapt:**

- “For Food clients, you must establish which **delivery day** the order is for (e.g. Monday, Wednesday). Use the vendor’s delivery_days from get_food_vendors_and_menu. Ask the caller which day they want if there are multiple options, or confirm the only available day. Do not call save_food_order until you have a delivery day and the caller has confirmed the full order for that day.”
- “When calling save_food_order, always pass the delivery_day parameter with the day name (e.g. Monday, Wednesday) that the caller chose.”

---

## 2. Retell Dashboard — `save_food_order` custom function

**Where:** Retell Dashboard → your agent → Custom Functions → **save_food_order** (edit the existing one).

**Do this:**

1. Add **delivery_day** as a **required** parameter.
2. Set the schema so **delivery_day** is one of:  
   `Monday`, `Tuesday`, `Wednesday`, `Thursday`, `Friday`, `Saturday`, `Sunday`.
3. Update the function description to say the AI must ask the caller for the delivery day and only call after confirmation.

**Parameters (required):** `client_id`, **delivery_day**, `vendor_selections`.

**Example JSON Schema addition for parameters:**

```json
"delivery_day": {
  "type": "string",
  "enum": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  "description": "The delivery day for this order. Must be collected from the caller before saving."
}
```

---

## 3. Docs (optional but recommended)

**Files:**

- `docs/retell-ai-voice-system-plan.md`
- `docs/retell-ai-dashboard-setup-guide.md`

**Do this:** In any section that describes `save_food_order` or `get_food_vendors_and_menu`, add or update:

- `save_food_order` **requires** `delivery_day` (one of the seven day names).
- Food orders are stored in **deliveryDayOrders** by day (not a flat vendorSelections).
- `get_food_vendors_and_menu` can return **current_selections_by_day** when the client has orders in that format.

---

## 4. Test

**Do this:**

1. Place a Food order **via the Retell voice flow** for a specific day (e.g. “Monday”).
2. Check in the DB that `clients.upcoming_order.deliveryDayOrders.Monday` (or the day you used) exists and has the right `vendorSelections`.
3. Check in the **portal/admin** that the order shows correctly for that day.
4. Optionally place or update an order for **another day** (e.g. Wednesday) and confirm both days are present in `deliveryDayOrders` and in the UI.

---

## Quick checklist

| # | Task | Where |
|---|------|--------|
| 1 | Add prompt: ask/confirm delivery day; pass `delivery_day` when calling save | Retell agent instructions |
| 2 | Add required `delivery_day` param to `save_food_order` custom function | Retell Dashboard |
| 3 | (Optional) Update voice plan + dashboard setup docs | `docs/retell-ai-voice-system-plan.md`, `docs/retell-ai-dashboard-setup-guide.md` |
| 4 | Test: voice order for Monday → verify DB + portal | Manual |

Full detail and rationale are in **`docs/FOOD_ORDER_VOICE_FIX.md`**.
