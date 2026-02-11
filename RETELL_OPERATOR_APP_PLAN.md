# Retell AI Operator Application — Plan

> **Agent types:** See [RETELL_AGENT_TYPES.md](./RETELL_AGENT_TYPES.md) for a comparison of Single Prompt, Multi-Prompt, Conversation Flow, and Custom LLM agents and what each enables for this operator app.

## Overview

Operator application where clients call the landline, and Retell AI handles the call. The operator identifies the caller (by client ID or phone number) and announces who is on the line. For now, the only supported operation is **creating an upcoming order**.

---

## Code Independence (Critical)

The operator feature is **fully self-contained**. It does **not** reuse any existing app code. This ensures:

- **Smoother integration** — No coupling to `lib/actions`, `lib/actions-read`, `lib/actions-write`, `lib/types`, etc.
- **Isolated changes** — Updates to the main app do not break the operator; operator changes do not affect the main app.
- **Clear boundaries** — Operator code lives in its own directories; integration is only via shared database and environment variables.

### What the Operator Does NOT Import

| Do not import from | Reason |
|--------------------|--------|
| `lib/actions.ts`, `lib/actions-read.ts`, `lib/actions-write.ts` | No reuse of existing CRUD, `updateClientUpcomingOrder`, etc. |
| `lib/types.ts` | No `ClientProfile`, `OrderConfiguration`, etc. Use operator-specific types. |
| `lib/client-mappers.ts`, `lib/supabase.ts` | No shared Supabase/DB client. Operator has its own DB layer. |
| `lib/order-dates.ts`, `lib/upcoming-order-converter.ts` | No shared order logic. Operator implements its own. |
| `lib/session.ts`, `lib/auth-actions.ts` | Operator does not use app auth; uses Retell API key for tool calls. |

### Integration Boundary

| Shared with main app | Operator-specific |
|----------------------|-------------------|
| **Database** — Same tables (`clients`, `vendors`, `client_statuses`, etc.) | All code in `lib/operator/`, `app/api/operator/`, `app/api/retell/` |
| **Environment variables** — DB config (MYSQL_* or SUPABASE_*), Retell keys | Own types, schemas, validation, DB queries |
| **Schema reference** — `UPCOMING_ORDER_SCHEMA.md` (docs only, no code import) | Own DB client |

---

## 1. Architecture Overview

### High-Level Flow

```
Client calls landline → Retell answers → Agent identifies caller (phone/ID)
  → Agent announces: "Client [ID/name] is on the line"
  → Agent handles: create upcoming order
```

### Components

| Component | Role |
|-----------|------|
| **Retell AI** | Voice agent, telephony, ASR, TTS, LLM |
| **Next.js API routes** | Webhooks, tools, DB access |
| **Supabase** | Clients, vendors, `clients.upcoming_order`, etc. |
| **Retell webhooks** | `call_started`, `call_ended`, `call_analyzed` |

---

## 2. Client Identification

### Option A: Automatic (Phone Number)

- Use `from_number` from Retell webhooks.
- Look up client by `phone_number` or `secondary_phone_number`.
- Normalize phones (E.164) before matching.

### Option B: Spoken Client ID

- Client says their ID (e.g. “I’m client 12345”).
- Agent uses a tool to validate and fetch client info.

### Option C: Hybrid

- Try lookup by `from_number` first.
- If no match or ambiguous, ask for client ID.
- Use tool to validate and load client.

**Implementation:** Centralize lookup in one API:

- `GET /api/operator/lookup-client?phone=...` or `?clientId=...`
- Returns: `{ clientId, fullName, serviceType, eligibility }` or error.

---

## 3. Operator Behavior (Agent Prompt)

### Behavior

1. Greet caller.
2. Identify caller:
   - Use `from_number` when available.
   - Or ask for client ID.
3. Announce: “This is [client name], client ID [id]” (for logging/monitoring).
4. Listen for intent:
   - If “create order” / “place order” / “upcoming order” → use create-upcoming-order tool.
5. Confirm and close.

### Prompt Variables

- `{{client_id}}` — from lookup.
- `{{client_name}}` — from lookup.
- `{{caller_phone}}` — from Retell.

---

## 4. Injecting Context into the Agent

### Retell Managed Telephony (Simpler)

- Inbound call → Retell assigns agent.
- Webhook `call_started` gets `from_number`.
- We cannot inject `retell_llm_dynamic_variables` before the call starts.

So:

1. Agent starts with a generic prompt.
2. Agent calls a tool **first (or early)** to get caller context:
   - `lookup_client(phone_number)`.
3. Tool returns `client_id`, `client_name`, `service_type`, etc.
4. Agent uses that to announce and to call `create_upcoming_order(client_id, ...)`.

### Custom Telephony (Richer Context)

- Your SIP server receives the inbound call.
- Before handing off to Retell, you:
  - Look up client by `from_number`.
  - Call Retell `POST /v2/register-phone-call` with:
    - `agent_id`
    - `from_number`, `to_number`, `direction: "inbound"`
    - `retell_llm_dynamic_variables: { client_id, client_name, service_type }`
- Agent prompt uses `{{client_id}}`, `{{client_name}}` and already knows who is calling.

---

## 5. Upcoming Order Creation

### Data Model (`clients.upcoming_order`)

- Single source of truth is `clients.upcoming_order` (see `UPCOMING_ORDER_SCHEMA.md` for schema reference).
- Per service type: Food, Meal, Boxes, Custom.
- **Operator implements its own** payload validation and DB write — no reuse of existing functions.

### MVP: Minimal “Create Upcoming Order”

For v1, focus on a narrow scope. Options:

1. **Custom only** — simplest: `custom_name`, `custom_price`, `vendorId`, `deliveryDay`.
2. **Food/Meal** — needs vendor, items, delivery days.
3. **Boxes** — needs `boxOrders` (box type, vendor, quantity, items).

Suggested MVP: **Custom** or a very simple **Food** order (e.g. one vendor, one day, fixed items).

### API

- `POST /api/operator/create-upcoming-order`
- Body: `{ clientId, serviceType, ... }` (shape depends on `serviceType`).
- Validates:
  - Client exists and is eligible.
  - Vendor exists.
  - Delivery day valid.
- **Operator writes directly** to `clients.upcoming_order` via its own DB layer (`lib/operator/db.ts`). No call to `updateClientUpcomingOrder` or any existing lib.

---

## 6. Retell Tools (Function Calling)

Define tools for the agent:

| Tool | Purpose | Inputs |
|------|---------|--------|
| `lookup_client` | Resolve caller | `phone_number` or `client_id` |
| `create_upcoming_order` | Create upcoming order | `client_id`, `service_type`, plus order-specific fields |

Tool schema example:

```json
{
  "name": "lookup_client",
  "description": "Look up client by phone number or client ID. Call this first to identify who is on the line.",
  "parameters": {
    "phone_number": { "type": "string", "description": "Caller phone in E.164" },
    "client_id": { "type": "string", "description": "Client ID if provided by caller" }
  }
}
```

---

## 7. API Routes

| Route | Method | Role |
|-------|--------|------|
| `/api/operator/lookup-client` | GET | Resolve client by phone or ID |
| `/api/operator/create-upcoming-order` | POST | Create upcoming order for client |
| `/api/retell/webhook` | POST | Retell call event webhooks |

Webhook events:

- `call_started` — optional: log, maybe trigger lookup.
- `call_ended` — log, store outcome.
- `call_analyzed` — store transcript, summary, etc.

---

## 8. Phone Number and Security

### Phone Number

- Use Retell “Purchase phone number” or “Import phone number”.
- Configure `inbound_agent_id` as your operator agent.

### Security

- Webhook: verify Retell signature (Retell docs).
- Tools: require Retell API key or HMAC for server-to-server calls.
- Client lookup: return only non-sensitive data needed for the call.

---

## 9. Client Lookup API

### DB Query (Operator's Own Layer)

Uses `lib/operator/db.ts` — operator's own DB client. No import from `lib/supabase` or `lib/actions-read`.

```sql
-- By phone (primary or secondary)
SELECT id, full_name, service_type, status_id, expiration_date
FROM clients
WHERE 
  (phone_number = ? OR secondary_phone_number = ?)
  AND parent_client_id IS NULL;
```

Normalize phone to E.164 before querying (see `lib/operator/phone-normalize.ts`).

### Eligibility

- `status_id` in `client_statuses` with `deliveries_allowed = true`.
- `expiration_date` not in the past (if set).

---

## 10. Implementation Phases

### Phase 1: Operator Module & DB Layer

1. Create `lib/operator/` directory with: `db.ts` (operator's own DB client), `types.ts`, `phone-normalize.ts`, `eligibility.ts`.
2. Implement `lib/operator/client-lookup.ts` and `app/api/operator/lookup-client/route.ts`.
3. Create Retell agent and voice model.
4. Wire `lookup_client` tool to the API; configure agent prompt.
5. Test with phone number lookup.

### Phase 2: Create Upcoming Order (MVP)

1. Choose MVP type (e.g. Custom).
2. Implement `lib/operator/create-upcoming-order.ts` and `app/api/operator/create-upcoming-order/route.ts`.
3. Add `create_upcoming_order` tool to Retell agent.
4. Update agent prompt and tool descriptions.
5. End-to-end test: call → identify → create order → confirm.

### Phase 3: Retell Integration

1. Implement `app/api/retell/webhook/route.ts`.
2. Purchase/import landline in Retell.
3. Assign agent to inbound number.
4. Register webhook URL.
5. Test real inbound calls.

### Phase 4: Polish

1. Announcement: “Client [name], ID [id]” at start of call.
2. Error handling (unknown caller, ineligible, DB errors).
3. Optional: call logging and analytics.

---

## 11. File Structure

All operator code is self-contained. No files outside these directories.

```
app/
  api/
    operator/
      lookup-client/
        route.ts          # GET ?phone=... | ?clientId=...
      create-upcoming-order/
        route.ts          # POST { clientId, serviceType, ... }
    retell/
      webhook/
        route.ts          # POST — Retell call events
lib/
  operator/
    db.ts                 # Operator's own DB client (MySQL or Supabase)
    types.ts              # Operator-specific types (no import from lib/types)
    client-lookup.ts      # Lookup by phone or client ID
    create-upcoming-order.ts  # Validate and write to clients.upcoming_order
    phone-normalize.ts    # E.164 normalization
    eligibility.ts       # Check client eligibility (deliveries_allowed, expiration)
```

### Import Rules

- **API routes** (`app/api/operator/*`, `app/api/retell/*`) import **only** from `lib/operator/*`.
- **lib/operator/** imports **only** from: `lib/operator/*` (internal), `process.env`, and standard Node/Next.js.

### Operator DB Layer (`lib/operator/db.ts`)

- Creates its own connection using the same env vars as the main app (`MYSQL_*` or `SUPABASE_*`).
- Exposes: `query()`, `getClientByPhone()`, `getClientById()`, `updateClientUpcomingOrder()` (operator's own implementation).
- Does **not** import from `lib/supabase` or `lib/db`. Operator may use `mysql2` or `@supabase/supabase-js` directly if needed.

---

## 12. Environment Variables

Operator uses the same DB env vars as the main app (shared database). No separate operator-specific DB config.

**Retell:**
```
RETELL_API_KEY=
RETELL_WEBHOOK_SECRET=
```

**Database** (same as main app — see `lib/db.ts` or `lib/supabase.ts`):
```
# MySQL (current app)
MYSQL_HOST=
MYSQL_PORT=
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=

# Or Supabase (if used)
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## 13. Open Questions

1. **MVP order type** — Custom vs simple Food vs Boxes.
2. **Telephony** — Retell managed (tools-only) vs custom SIP (dynamic variables).
3. **Announcement** — Human listener vs pure logging.
4. **Phone format** — Use E.164 and normalization rules.
5. **Ambiguous clients** — Multiple clients on same phone (e.g. household): how to disambiguate.
6. **Order history** — Should operator append to `order_history` when creating upcoming order? If yes, implement in `lib/operator/create-upcoming-order.ts` (operator's own logic).

---

## 14. Suggested MVP Sequence

1. **Week 1**
   - Build `lib/operator/` module (db, types, client-lookup, create-upcoming-order).
   - Implement API routes.
   - Retell agent + tools for `lookup_client` and `create_upcoming_order`.
   - MVP: Custom upcoming order only.
2. **Week 2**
   - Purchase number, configure inbound agent, register webhook.
   - End-to-end tests.
3. **Week 3**
   - Prompt tuning, error handling, call logging.

---

## 15. Independence Verification Checklist

Before considering the operator feature complete, verify:

- [ ] No `import` from `lib/actions`, `lib/actions-read`, `lib/actions-write`, `lib/types`, `lib/client-mappers`, `lib/order-dates`, `lib/upcoming-order-converter`.
- [ ] No `import` from `lib/supabase` or `lib/db` in operator code — operator uses `lib/operator/db.ts` only.
- [ ] All operator logic lives under `lib/operator/` and `app/api/operator/` / `app/api/retell/`.
- [ ] Operator types are defined in `lib/operator/types.ts` (no re-export from `lib/types`).
