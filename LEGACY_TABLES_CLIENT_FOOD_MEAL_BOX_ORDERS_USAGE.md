# Legacy Tables Usage: `client_food_orders`, `client_meal_orders`, `client_box_orders`

**Context:** The source of truth for upcoming orders is **`clients.upcoming_order`** (JSONB on the `clients` table).

**Status (post-migration):** All application read/write paths have been switched to use `clients.upcoming_order`. The legacy tables are **no longer read from or written to** by:
- `app/api/create-orders-next-week/route.ts`
- `app/api/simulate-delivery-cycle/route.ts`
- `lib/actions.ts` (get/save Food/Meal/Box orders)
- `lib/actions-write.ts` (save Food/Meal/Box orders)
- `lib/actions-read.ts` (get Food/Meal/Box orders; client list uses `upcoming_order`)
- `lib/client-mappers.ts` (mealOrder from `upcoming_order`)
- `lib/local-db.ts` (sync derives from `clients.upcoming_order`)

The tables may still be referenced in migration scripts, cleanup APIs, SQL schema, or docs. This document lists **every location** where these three tables are referenced.

**Schema reference:** See `UPCOMING_ORDER_SCHEMA.md` for the shape of `clients.upcoming_order` (Food/Meal: `deliveryDayOrders`, `mealSelections`; Boxes: `boxOrders`; Custom: top-level fields).

---

## Application code (read/write)

### `app/api/create-orders-next-week/route.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 65–67 | all three | Fetches all rows from `client_food_orders`, `client_meal_orders`, `client_box_orders` to create orders for next week. **Should be switched to `clients.upcoming_order`.** |

---

### `app/api/simulate-delivery-cycle/route.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 241–244 | all three | Fetches all rows for a summary. |
| 797 | client_food_orders | Fetches food orders for simulation. |
| 1290 | client_meal_orders | Fetches meal orders for simulation. |
| 1295 | client_box_orders | Fetches box orders for simulation. |

**Should be switched to reading from `clients.upcoming_order` (and `orders` as needed).**

---

### `app/api/cleanup-invalid-meal-types/route.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 50 (comment) | client_meal_orders | Doc: list invalid meal type issues from `client_meal_orders`. |
| 60 | client_meal_orders | Select from `client_meal_orders`. |
| 149, 167, 170 | client_meal_orders | Update/fix invalid keys in `meal_selections` JSONB. |

Utility for cleaning legacy data; can be deprecated or adapted to `clients.upcoming_order.mealSelections` when migration is complete.

---

### `lib/actions.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 2185–2187 | client_box_orders | Delete `client_box_orders` for dependents (FK constraint) when deleting a client. |
| 2216–2218 | client_box_orders | Delete `client_box_orders` for this client (FK constraint). |
| 5311, 5336 | client_meal_orders | Select with `client_meal_orders(*)` (embed). |
| 7082, 7128, 7136, 7141 | client_food_orders | Upsert/delete `client_food_orders` (saveClientFoodOrder flow). |
| 7217, 7257, 7265, 7270 | client_meal_orders | Upsert/delete `client_meal_orders` (saveClientMealOrder flow). |
| 7344, 7383, 7417, 7427 | client_box_orders | Upsert/delete `client_box_orders` (saveClientBoxOrder flow). |

Core write path: saving Food/Meal/Box orders still targets these tables. Migration would switch these to updating `clients.upcoming_order` only.

---

### `lib/actions-write.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 1846, 1854, 1859 | client_food_orders | Insert/update/delete `client_food_orders`. |
| 1896, 1904, 1909 | client_meal_orders | Insert/update/delete `client_meal_orders`. |
| 1929, 1969, 1979 | client_box_orders | Insert/update/delete `client_box_orders`. |

Same idea as `lib/actions.ts`: legacy write path for order config.

---

### `lib/actions-read.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 1833, 1858 | client_meal_orders | Select with `client_meal_orders(*)` embed. |
| 2621 | client_food_orders | Select from `client_food_orders`. |
| 2648 | client_meal_orders | Select from `client_meal_orders`. |
| 2673 | client_box_orders | Select from `client_box_orders`. |

Read path for order config; to be replaced by reading from `clients.upcoming_order`.

---

### `lib/local-db.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 305, 309, 313 | all three | Delete from all three (e.g. reset/local sync). |
| 417–419 | all three | Select by `client_id` for a given client. |

Local/sync layer; align with single source `clients.upcoming_order` when migrating.

---

### `lib/actions-migration.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 234 (comment), 239–241 | all three | Build merged config from `client_food_orders`, `client_meal_orders`, `client_box_orders`. |
| 285, 295, 306 | all three | Overlay food/meal/box from these tables when building `upcoming_order`. |
| 371, 379 | client_box_orders | Fetch all `client_box_orders` for given client IDs. |
| 435–437, 443 (comment), 485–493, 500–502, 568–570 | all three | Fetch/embed and use in migration; sourcesRead labels. |
| 719–721, 734 | all three | Select with embeds `client_food_orders(*)`, `client_meal_orders(*)`, `client_box_orders(*)`. |

Used to **populate** `clients.upcoming_order` from legacy tables. Once migration is complete and all writers use `clients.upcoming_order`, this can be retired or kept for one-off backfills.

---

### `components/clients/ClientList.tsx`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 359, 463, 1282 | client_box_orders | Comments only: “Check actual box orders from client_box_orders table”. Logic may still rely on data that lives in `clients.upcoming_order` elsewhere. |

Comments/documentation; ensure any actual box-order checks use `clients.upcoming_order.boxOrders`.

---

## Scripts

### `scripts/debug_needs_attention_client_1485.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 101, 103, 107, 201 | client_box_orders | Fetches and logs `client_box_orders`; doc explains UI uses `clients.upcoming_order`, so this table can be out of sync. |

Debug script; documents that box data may be in `clients.upcoming_order` only.

---

### `scripts/remove-invalid-meal-types.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 6 (comment), 62 (comment), 90, 92, 95, 111, 114, 120 | client_meal_orders | Reads and updates `client_meal_orders` to remove invalid keys from `meal_selections`. |

One-off cleanup for legacy table; can be adapted to `clients.upcoming_order.mealSelections` if needed.

---

### `scripts/test-migrate-fetch.ts`
| Line(s) | Table(s) | Usage |
|--------|----------|--------|
| 30–32 | all three | Selects specific columns from all three tables for migration fetch test. |

Test for migration fetch; uses legacy tables as input.

---

## SQL / schema

### `sql/check_client_box_orders_client_id_type.sql`
| Usage |
|------|
| References `client_box_orders` to check column type (e.g. `client_id` as text). |

---

### `sql/alter_client_box_orders_client_id_to_text.sql`
| Usage |
|------|
| Migration script altering `client_box_orders` (e.g. `client_id` to text). |

---

### `extracted_schema.sql`
| Usage |
|------|
| Defines tables `client_food_orders`, `client_meal_orders`, `client_box_orders` (CREATE, indexes, FKs, etc.). Schema dump only. |

---

## Documentation (references only)

- **`CREATE_ORDERS_NEXT_WEEK.md`** — Describes current behavior: create-orders-next-week reads from these three tables.
- **`UPCOMING_ORDER_MIGRATION_REMAINING_LOCATIONS.md`** — Lists create-orders-next-week, simulate-delivery-cycle, buildMergedOrderConfigFromAllSources, etc., as using these tables.
- **`CLIENTS_UPCOMING_ORDER_MIGRATION_PLAN.md`** — Goal: use only `clients.upcoming_order`; retire these tables.
- **`ORDER_SAVING_DOCUMENTATION.md`** — Documents saving to `client_food_orders`, `client_meal_orders`, `client_box_orders`.

---

## Summary

| Area | Files | Action |
|------|--------|--------|
| **Create orders (next week)** | `app/api/create-orders-next-week/route.ts` | Switch to `clients.upcoming_order` (and `orders` if needed). |
| **Simulate delivery cycle** | `app/api/simulate-delivery-cycle/route.ts` | Switch to `clients.upcoming_order`. |
| **Save order config** | `lib/actions.ts`, `lib/actions-write.ts` | Switch to writing only `clients.upcoming_order`. |
| **Read order config** | `lib/actions-read.ts` | Switch to reading from `clients.upcoming_order`. |
| **Delete client** | `lib/actions.ts` | Keep deletes for legacy tables until tables are dropped, or remove once tables are gone. |
| **Local / sync** | `lib/local-db.ts` | Align with `clients.upcoming_order` when migrating. |
| **Migration** | `lib/actions-migration.ts` | Keep for backfill; retire when no longer needed. |
| **Cleanup / debug** | `app/api/cleanup-invalid-meal-types/route.ts`, `scripts/remove-invalid-meal-types.ts`, `scripts/debug_needs_attention_client_1485.ts`, `scripts/test-migrate-fetch.ts` | Adapt to `clients.upcoming_order` or remove once legacy tables are unused. |
| **UI** | `components/clients/ClientList.tsx` | Comments only; ensure any logic uses `clients.upcoming_order`. |
| **SQL / schema** | `sql/*.sql`, `extracted_schema.sql` | Schema/migrations only. |

All **runtime** reads and writes for “current upcoming order” should eventually use **`clients.upcoming_order`** only; the three legacy tables can then be dropped or archived.
