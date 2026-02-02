# Order Types Database Report

## Overview

This document provides a comprehensive overview of all order types in the Triangle Order Management system and how they are stored in the database. The system supports five order types: **Food**, **Meals**, **Boxes**, **Custom**, and **Equipment**.

---

## Database Architecture Overview

The system uses a two-stage order storage approach:

1. **Client Order Tables** (Configuration/Active Orders):
   - `client_food_orders` - Food order configurations
   - `client_meal_orders` - Meal order configurations
   - `client_box_orders` - Box order configurations

2. **Orders Table** (Actual Orders):
   - `orders` - Final orders ready for processing/delivery
   - `order_vendor_selections` - Links orders to vendors
   - `order_items` - Individual items in orders
   - `order_box_selections` - Box-specific order details

3. **Upcoming Orders Table** (Scheduled Orders):
   - `upcoming_orders` - Orders scheduled for future creation
   - `upcoming_order_vendor_selections` - Vendor selections for upcoming orders
   - `upcoming_order_items` - Items for upcoming orders
   - `upcoming_order_box_selections` - Box selections for upcoming orders

---

## Order Type 1: FOOD Orders

### Source Configuration Table: `client_food_orders`

**Schema:**
```sql
CREATE TABLE client_food_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id),
  case_id TEXT,
  delivery_day_orders JSONB,  -- Main data structure
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);
```

### Data Structure: `delivery_day_orders` (JSONB)

The `delivery_day_orders` field stores a JSON object organized by delivery day:

```json
{
  "Monday": {
    "vendorSelections": [
      {
        "vendorId": "vendor-uuid",
        "items": {
          "menu-item-id-1": 2,
          "menu-item-id-2": 1
        },
        "itemNotes": {
          "menu-item-id-1": "No onions please"
        }
      },
      {
        "vendorId": "another-vendor-uuid",
        "items": {
          "menu-item-id-3": 3
        }
      }
    ]
  },
  "Wednesday": {
    "vendorSelections": [
      {
        "vendorId": "vendor-uuid",
        "items": {
          "menu-item-id-1": 1
        }
      }
    ]
  }
}
```

**Key Features:**
- Supports multiple delivery days per client
- Supports multiple vendors per delivery day
- Each vendor can have multiple menu items
- Item notes can be attached to specific items
- Structure: `{ dayName: { vendorSelections: [{ vendorId, items, itemNotes }] } }`

### How Food Orders Are Saved

**Step 1: Save to `client_food_orders`**
- Location: `lib/actions.ts` → `saveClientFoodOrder()`
- Process:
  1. Check if order exists for client (one order per client)
  2. If exists: UPDATE `client_food_orders` WHERE `client_id = ?`
  3. If not: INSERT into `client_food_orders`
  4. Fields saved:
     - `client_id` - Client UUID
     - `case_id` - Optional case identifier
     - `delivery_day_orders` - Full JSONB structure
     - `notes` - General notes
     - `updated_by` - User who made the change
     - `updated_at` - Timestamp

**Step 2: Sync to `upcoming_orders`**
- Location: `lib/actions.ts` → `syncCurrentOrderToUpcoming()`
- Process:
  1. Reads `client_food_orders.delivery_day_orders`
  2. For each day in the JSON:
     - Creates/updates record in `upcoming_orders` table
     - Creates records in `upcoming_order_vendor_selections`
     - Creates records in `upcoming_order_items`
  3. Calculates `total_value` and `total_items`
  4. Sets `take_effect_date` based on vendor cutoff days

**Step 3: Convert to Actual Orders**
- Location: `app/api/simulate-delivery-cycle/route.ts` or `app/api/process-weekly-orders/route.ts`
- Process:
  1. Reads from `upcoming_orders` (or directly from `client_food_orders`)
  2. Checks vendor cutoff days to determine if order should be created today
  3. Creates record in `orders` table
  4. Creates records in `order_vendor_selections`
  5. Creates records in `order_items` for each menu item

### Final Storage in `orders` Table

**Order Record:**
```sql
INSERT INTO orders (
  client_id,
  service_type,        -- 'Food'
  case_id,
  status,              -- 'pending', 'confirmed', 'completed', etc.
  scheduled_delivery_date,
  total_value,
  total_items,
  order_number,        -- 6-digit unique number (100000+)
  creation_id,        -- Groups orders created in same batch
  notes,
  updated_by,
  last_updated
) VALUES (...);
```

**Vendor Selections:**
```sql
INSERT INTO order_vendor_selections (
  order_id,
  vendor_id
) VALUES (...);
```

**Order Items:**
```sql
INSERT INTO order_items (
  order_id,
  vendor_selection_id,  -- Links to order_vendor_selections
  menu_item_id,         -- References menu_items table
  quantity,
  unit_value,           -- Price per unit
  total_value,          -- unit_value * quantity
  notes                 -- Item-specific notes
) VALUES (...);
```

### Key Characteristics

- **Multi-vendor support**: One order can have items from multiple vendors
- **Multi-day support**: Client can have different orders for different days
- **Cutoff-based creation**: Orders are created based on vendor cutoff days
- **Strict timing**: Orders created only on exact cutoff day for that delivery day

---

## Order Type 2: MEAL Orders

### Source Configuration Table: `client_meal_orders`

**Schema:**
```sql
CREATE TABLE client_meal_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id),
  case_id TEXT,
  meal_selections JSONB,  -- Main data structure
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);
```

### Data Structure: `meal_selections` (JSONB)

The `meal_selections` field stores meal types (Breakfast, Lunch, Dinner):

```json
{
  "Breakfast": {
    "vendorId": "vendor-uuid",
    "items": {
      "meal-item-id-1": 2,
      "meal-item-id-2": 1
    },
    "itemNotes": {
      "meal-item-id-1": "Extra syrup"
    }
  },
  "Lunch": {
    "vendorId": "another-vendor-uuid",
    "items": {
      "meal-item-id-3": 1
    }
  },
  "Dinner": {
    "vendorId": "vendor-uuid",
    "items": {
      "meal-item-id-4": 2
    }
  }
}
```

**Key Features:**
- Organized by meal type (Breakfast, Lunch, Dinner)
- Each meal type can have a different vendor
- Each meal type has its own items
- Item notes supported per item
- Structure: `{ mealType: { vendorId, items, itemNotes } }`

### How Meal Orders Are Saved

**Step 1: Save to `client_meal_orders`**
- Location: `lib/actions.ts` → `saveClientMealOrder()`
- Process:
  1. Check if order exists for client (one order per client)
  2. If exists: UPDATE `client_meal_orders` WHERE `client_id = ?`
  3. If not: INSERT into `client_meal_orders`
  4. Fields saved:
     - `client_id` - Client UUID
     - `case_id` - Optional case identifier
     - `meal_selections` - Full JSONB structure
     - `notes` - General notes
     - `updated_by` - User who made the change
     - `updated_at` - Timestamp

**Step 2: Sync to `upcoming_orders`**
- Location: `lib/actions.ts` → `syncCurrentOrderToUpcoming()`
- Process:
  1. Reads `client_meal_orders.meal_selections`
  2. For each meal type:
     - Creates/updates record in `upcoming_orders` table
     - Creates records in `upcoming_order_vendor_selections`
     - Creates records in `upcoming_order_items` (using `meal_item_id`)
  3. Calculates `total_value` and `total_items`
  4. Sets `take_effect_date` based on vendor cutoff days

**Step 3: Convert to Actual Orders**
- Location: `app/api/simulate-delivery-cycle/route.ts` or `app/api/process-weekly-orders/route.ts`
- Process:
  1. Reads from `upcoming_orders` (or directly from `client_meal_orders`)
  2. Checks vendor cutoff days
  3. Creates record in `orders` table with `service_type = 'Meal'`
  4. Creates records in `order_vendor_selections`
  5. Creates records in `order_items` (using `meal_item_id` instead of `menu_item_id`)

### Final Storage in `orders` Table

**Order Record:**
```sql
INSERT INTO orders (
  client_id,
  service_type,        -- 'Meal'
  case_id,
  status,
  scheduled_delivery_date,
  total_value,
  total_items,
  order_number,
  creation_id,
  notes,
  updated_by,
  last_updated
) VALUES (...);
```

**Vendor Selections:**
```sql
INSERT INTO order_vendor_selections (
  order_id,
  vendor_id
) VALUES (...);
```

**Order Items:**
```sql
INSERT INTO order_items (
  order_id,
  vendor_selection_id,
  meal_item_id,        -- References meal_items table (not menu_items)
  quantity,
  unit_value,
  total_value,
  notes
) VALUES (...);
```

### Key Characteristics

- **Meal-type organization**: Orders organized by Breakfast/Lunch/Dinner
- **Vendor per meal**: Each meal type can have different vendor
- **Meal items**: Uses `meal_items` table instead of `menu_items`
- **Weekly processing**: Typically processed weekly based on cutoff days

---

## Order Type 3: BOX Orders

### Source Configuration Table: `client_box_orders`

**Schema:**
```sql
CREATE TABLE client_box_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id),
  case_id TEXT,
  box_type_id UUID REFERENCES box_types(id),
  vendor_id UUID REFERENCES vendors(id),
  quantity INTEGER DEFAULT 1,
  items JSONB DEFAULT '{}'::jsonb,  -- Custom items if allowed
  item_notes JSONB,                  -- Notes per item
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);
```

**Important:** A client can have **multiple box orders** (one row per box type/vendor combination).

### Data Structure: `items` (JSONB)

The `items` field stores custom items for the box:

```json
{
  "menu-item-id-1": {
    "quantity": 2,
    "price": 5.50,
    "note": "Extra fresh"
  },
  "menu-item-id-2": 1  // Simple quantity format also supported
}
```

**Key Features:**
- Multiple box orders per client (array of boxes)
- Each box has: `box_type_id`, `vendor_id`, `quantity`, `items`
- Items can be custom selections or follow box type quotas
- Item notes supported per item
- Full replacement strategy: Delete all existing, insert new ones

### How Box Orders Are Saved

**Step 1: Save to `client_box_orders`**
- Location: `lib/actions.ts` → `saveClientBoxOrder()`
- Process:
  1. **Full replacement**: DELETE all existing box orders for client
  2. INSERT new array of box orders
  3. Fields saved per box:
     - `client_id` - Client UUID
     - `case_id` - Optional case identifier
     - `box_type_id` - Type of box
     - `vendor_id` - Vendor providing the box
     - `quantity` - Number of boxes
     - `items` - JSONB of custom items
     - `item_notes` - JSONB of item-specific notes
     - `updated_by` - User who made the change
     - `updated_at` - Timestamp

**Step 2: Sync to `upcoming_orders`**
- Location: `lib/actions.ts` → `syncCurrentOrderToUpcoming()`
- Process:
  1. Reads all records from `client_box_orders` for client
  2. For each box order:
     - Creates/updates record in `upcoming_orders` table
     - Creates records in `upcoming_order_box_selections`
  3. Calculates `total_value` and `total_items`
  4. Sets `take_effect_date` based on vendor cutoff days

**Step 3: Convert to Actual Orders**
- Location: `app/api/simulate-delivery-cycle/route.ts` or `app/api/process-weekly-orders/route.ts`
- Process:
  1. Reads from `upcoming_orders` (or directly from `client_box_orders`)
  2. Checks vendor cutoff days
  3. Creates record in `orders` table with `service_type = 'Boxes'`
  4. Creates records in `order_box_selections`

### Final Storage in `orders` Table

**Order Record:**
```sql
INSERT INTO orders (
  client_id,
  service_type,        -- 'Boxes'
  case_id,
  status,
  scheduled_delivery_date,
  total_value,
  total_items,
  order_number,
  creation_id,
  notes,
  updated_by,
  last_updated
) VALUES (...);
```

**Box Selections:**
```sql
INSERT INTO order_box_selections (
  order_id,
  vendor_id,
  box_type_id,
  quantity,
  unit_value,          -- Price per box
  total_value,         -- unit_value * quantity
  items                -- JSONB of custom items
) VALUES (...);
```

### Key Characteristics

- **Multiple boxes**: Client can have multiple different box orders
- **Box types**: Each box has a specific type with quotas
- **Custom items**: Can include custom item selections
- **Full replacement**: Saving deletes all existing, inserts new ones

---

## Order Type 4: CUSTOM Orders

### Storage: Direct to `orders` Table

**No intermediate configuration table** - Custom orders are created directly in the `orders` table.

### How Custom Orders Are Saved

**Location:** `lib/actions.ts` → `saveCustomOrder()`

**Process:**
1. Calculate scheduled delivery date based on requested delivery day
2. Get next `creation_id` for this order
3. Create order directly in `orders` table:
   ```sql
   INSERT INTO orders (
     client_id,
     service_type,        -- 'Custom'
     case_id,
     status,              -- 'pending'
     scheduled_delivery_date,
     total_value,         -- Custom price
     total_items,         -- 1
     notes,               -- "Custom Order: {itemDescription}"
     creation_id,
     updated_by,
     last_updated
   ) VALUES (...);
   ```
4. Create vendor selection:
   ```sql
   INSERT INTO order_vendor_selections (
     order_id,
     vendor_id
   ) VALUES (...);
   ```
5. Create order item with custom fields:
   ```sql
   INSERT INTO order_items (
     order_id,
     vendor_selection_id,
     menu_item_id,        -- NULL (not a standard menu item)
     custom_name,         -- Item description
     custom_price,        -- Custom price
     quantity,            -- 1
     unit_value,          -- 0
     total_value          -- 0
   ) VALUES (...);
   ```

### Final Storage Structure

**Order Record:**
- `service_type` = `'Custom'`
- `notes` = `"Custom Order: {itemDescription}"`
- `total_value` = Custom price
- `total_items` = 1

**Order Item:**
- `menu_item_id` = NULL
- `custom_name` = Item description text
- `custom_price` = Price entered by user
- `quantity` = 1

### Key Characteristics

- **Direct creation**: No configuration table, created immediately
- **Custom fields**: Uses `custom_name` and `custom_price` in `order_items`
- **Single item**: One custom item per order
- **Immediate order**: Goes straight to `orders` table (not `upcoming_orders`)

---

## Order Type 5: EQUIPMENT Orders

### Storage: Direct to `orders` Table

**No intermediate configuration table** - Equipment orders are created directly in the `orders` table.

### How Equipment Orders Are Saved

**Location:** `lib/actions.ts` → `saveEquipmentOrder()`

**Process:**
1. Look up equipment item to get price
2. Calculate scheduled delivery date based on vendor delivery days
3. Create order directly in `orders` table:
   ```sql
   INSERT INTO orders (
     client_id,
     service_type,        -- 'Equipment'
     case_id,
     status,              -- 'pending'
     scheduled_delivery_date,
     total_value,         -- Equipment price
     total_items,         -- 1
     notes,               -- JSON stringified equipment selection
     creation_id,         -- NULL (equipment orders don't get creation_id)
     updated_by,
     last_updated
   ) VALUES (...);
   ```
4. Create vendor selection:
   ```sql
   INSERT INTO order_vendor_selections (
     order_id,
     vendor_id
   ) VALUES (...);
   ```

**Notes Field Structure:**
The `notes` field contains JSON stringified equipment data:
```json
{
  "vendorId": "vendor-uuid",
  "equipmentId": "equipment-uuid",
  "equipmentName": "Equipment Name",
  "price": 99.99
}
```

### Final Storage Structure

**Order Record:**
- `service_type` = `'Equipment'`
- `notes` = JSON stringified equipment selection
- `total_value` = Equipment price from `equipment` table
- `total_items` = 1
- `creation_id` = NULL (equipment orders don't get batch creation IDs)

**No Order Items:**
- Equipment orders do NOT create records in `order_items` table
- All information is stored in the `orders.notes` field as JSON

### Key Characteristics

- **Direct creation**: No configuration table, created immediately
- **No order items**: Information stored in `notes` field only
- **No creation_id**: Equipment orders are standalone, not batched
- **Equipment table**: References `equipment` table for item details

---

## Common Tables and Relationships

### `orders` Table (Main Orders Table)

**Key Columns:**
- `id` - UUID primary key
- `client_id` - References `clients(id)`
- `service_type` - Enum: `'Food' | 'Meal' | 'Boxes' | 'Equipment' | 'Custom'`
- `case_id` - Optional case identifier
- `status` - Order status: `'pending' | 'confirmed' | 'completed' | 'waiting_for_proof' | 'billing_pending' | 'billing_successful' | 'billing_failed' | 'cancelled'`
- `scheduled_delivery_date` - Date order should be delivered
- `actual_delivery_date` - Actual delivery date (set when delivered)
- `total_value` - Total order value
- `total_items` - Total number of items
- `order_number` - 6-digit unique number (100000+)
- `creation_id` - Groups orders created in same batch
- `notes` - General notes or JSON data
- `updated_by` - User who last updated
- `last_updated` - Timestamp
- `created_at` - Creation timestamp

### `order_vendor_selections` Table

**Purpose:** Links orders to vendors (supports multi-vendor orders)

**Schema:**
```sql
CREATE TABLE order_vendor_selections (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders(id),
  vendor_id UUID REFERENCES vendors(id)
);
```

**Usage:**
- Food orders: Multiple vendor selections per order
- Meal orders: One vendor selection per order (per meal type)
- Box orders: One vendor selection per order
- Custom orders: One vendor selection per order
- Equipment orders: One vendor selection per order

### `order_items` Table

**Purpose:** Stores individual items in orders

**Schema:**
```sql
CREATE TABLE order_items (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders(id),
  vendor_selection_id UUID REFERENCES order_vendor_selections(id),
  menu_item_id UUID REFERENCES menu_items(id),      -- For Food orders
  meal_item_id UUID REFERENCES meal_items(id),       -- For Meal orders
  custom_name TEXT,                                   -- For Custom orders
  custom_price DECIMAL,                               -- For Custom orders
  quantity INTEGER,
  unit_value DECIMAL,
  total_value DECIMAL,
  notes TEXT
);
```

**Usage by Order Type:**
- **Food**: Uses `menu_item_id`, `quantity`, `unit_value`, `total_value`, `notes`
- **Meal**: Uses `meal_item_id`, `quantity`, `unit_value`, `total_value`, `notes`
- **Custom**: Uses `custom_name`, `custom_price`, `quantity = 1`
- **Box**: Not used (uses `order_box_selections` instead)
- **Equipment**: Not used (info in `orders.notes` only)

### `order_box_selections` Table

**Purpose:** Stores box-specific order details

**Schema:**
```sql
CREATE TABLE order_box_selections (
  id UUID PRIMARY KEY,
  order_id UUID REFERENCES orders(id),
  vendor_id UUID REFERENCES vendors(id),
  box_type_id UUID REFERENCES box_types(id),
  quantity INTEGER,
  unit_value DECIMAL,
  total_value DECIMAL,
  items JSONB  -- Custom items for the box
);
```

**Usage:**
- Only used for Box orders
- Stores box type, vendor, quantity, and custom items

---

## Upcoming Orders Tables Structure

The `upcoming_orders` system serves as an intermediate staging area between client order configurations and actual orders. Orders are stored here before being processed and moved to the `orders` table.

### `upcoming_orders` Table (Main Staging Table)

**Schema:**
```sql
CREATE TABLE upcoming_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID NOT NULL REFERENCES clients(id),
  case_id TEXT,
  service_type TEXT NOT NULL CHECK (service_type IN ('Food', 'Boxes', 'Equipment', 'Meal', 'Custom')),
  status TEXT DEFAULT 'scheduled',  -- 'scheduled', 'processed', 'cancelled'
  delivery_day TEXT,                -- Day name: 'Monday', 'Tuesday', etc.
  meal_type TEXT DEFAULT 'Lunch',   -- 'Breakfast', 'Lunch', 'Dinner' (for Meal orders)
  take_effect_date DATE,            -- Date when order should be processed (always Sunday)
  total_value DECIMAL(10, 2) DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  notes TEXT,
  order_number INTEGER,             -- 6-digit unique number (assigned when created)
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_order_id UUID REFERENCES orders(id),  -- Links to final order when processed
  processed_at TIMESTAMP WITH TIME ZONE
);
```

**Key Columns:**
- `id` - UUID primary key
- `client_id` - References `clients(id)`
- `case_id` - Optional case identifier
- `service_type` - Enum: `'Food' | 'Meal' | 'Boxes' | 'Equipment' | 'Custom'`
- `status` - Order status: `'scheduled'` (default), `'processed'`, `'cancelled'`
- `delivery_day` - Day name string (e.g., "Monday", "Wednesday") - NULL for Boxes or legacy orders
- `meal_type` - Meal type for Meal orders: `'Breakfast'`, `'Lunch'`, `'Dinner'` (default: `'Lunch'`)
- `take_effect_date` - Date when order should be processed (always a Sunday, calculated using weekly locking logic)
- `total_value` - Total order value (calculated from items)
- `total_items` - Total number of items
- `notes` - General notes or description
- `order_number` - 6-digit unique number (100000+) - assigned when order is created
- `updated_by` - User who last updated
- `last_updated` - Timestamp
- `created_at` - Creation timestamp
- `processed_order_id` - Links to final order in `orders` table when processed
- `processed_at` - Timestamp when order was processed

**Unique Constraint:**
- `(client_id, delivery_day, meal_type)` - Ensures one upcoming order per client per delivery day per meal type
- Only applies when `delivery_day IS NOT NULL`

### `upcoming_order_vendor_selections` Table

**Purpose:** Links upcoming orders to vendors (supports multi-vendor orders)

**Schema:**
```sql
CREATE TABLE upcoming_order_vendor_selections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  upcoming_order_id UUID NOT NULL REFERENCES upcoming_orders(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id)
);
```

**Usage:**
- Food orders: Multiple vendor selections per upcoming order
- Meal orders: One vendor selection per upcoming order (per meal type)
- Box orders: One vendor selection per upcoming order
- Custom orders: One vendor selection per upcoming order

**Key Features:**
- Cascade delete: When upcoming order is deleted, vendor selections are automatically deleted
- Links to `vendors` table for vendor information

### `upcoming_order_items` Table

**Purpose:** Stores individual items in upcoming orders

**Schema:**
```sql
CREATE TABLE upcoming_order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  upcoming_order_id UUID NOT NULL REFERENCES upcoming_orders(id) ON DELETE CASCADE,
  vendor_selection_id UUID NOT NULL REFERENCES upcoming_order_vendor_selections(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id),      -- For Food orders
  meal_item_id UUID REFERENCES meal_items(id),       -- For Meal orders
  custom_name TEXT,                                   -- For Custom orders
  custom_price DECIMAL(10, 2),                       -- For Custom orders
  quantity INTEGER NOT NULL,
  unit_value DECIMAL(10, 2),
  total_value DECIMAL(10, 2),
  notes TEXT                                          -- Item-specific notes
);
```

**Usage by Order Type:**
- **Food**: Uses `menu_item_id`, `quantity`, `unit_value`, `total_value`, `notes`
- **Meal**: Uses `meal_item_id`, `quantity`, `unit_value`, `total_value`, `notes`
- **Custom**: Uses `custom_name`, `custom_price`, `quantity = 1`, `notes`
- **Box**: Not used (uses `upcoming_order_box_selections` instead)
- **Equipment**: Not used (equipment orders go directly to `orders` table)

**Key Features:**
- Cascade delete: When upcoming order or vendor selection is deleted, items are automatically deleted
- At least one of `menu_item_id`, `meal_item_id`, or `custom_name` must be set
- `menu_item_id` and `meal_item_id` are nullable to support custom items
- Total items (with `menu_item_id = NULL`) can be stored as separate rows for calculation purposes

### `upcoming_order_box_selections` Table

**Purpose:** Stores box-specific order details for upcoming orders

**Schema:**
```sql
CREATE TABLE upcoming_order_box_selections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  upcoming_order_id UUID NOT NULL REFERENCES upcoming_orders(id) ON DELETE CASCADE,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  box_type_id UUID REFERENCES box_types(id),
  quantity INTEGER DEFAULT 1,
  unit_value DECIMAL(10, 2) DEFAULT 0,
  total_value DECIMAL(10, 2) DEFAULT 0,
  items JSONB DEFAULT '{}'::jsonb  -- Custom items for the box
);
```

**Usage:**
- Only used for Box orders
- Stores box type, vendor, quantity, and custom items
- Multiple box selections can exist per upcoming order (one per box type/vendor combination)

**Key Features:**
- Cascade delete: When upcoming order is deleted, box selections are automatically deleted
- `items` JSONB field stores custom item selections with structure:
  ```json
  {
    "menu-item-id-1": {
      "quantity": 2,
      "price": 5.50,
      "note": "Extra fresh"
    },
    "menu-item-id-2": 1  // Simple quantity format also supported
  }
  ```

---

## How Data Flows to Upcoming Orders

### Step 1: Save to Client Order Tables

When a user saves an order configuration, it's first saved to the appropriate client order table:
- Food → `client_food_orders`
- Meal → `client_meal_orders`
- Box → `client_box_orders`

### Step 2: Sync to Upcoming Orders

**Location:** `lib/actions.ts` → `syncCurrentOrderToUpcoming()`

**Process:**

1. **Delete Existing Upcoming Orders**
   - Deletes ALL existing upcoming orders for the client
   - Cascade deletes related records:
     - `upcoming_order_vendor_selections`
     - `upcoming_order_items`
     - `upcoming_order_box_selections`
   - This ensures a clean slate and removes any deleted items/days

2. **Create New Upcoming Orders**
   - For each delivery day (Food) or meal type (Meal) or box (Boxes):
     - Creates record in `upcoming_orders` table
     - Calculates `take_effect_date` (always a Sunday using weekly locking)
     - Calculates `total_value` and `total_items` from items
     - Sets `delivery_day` (for Food orders) or `meal_type` (for Meal orders)

3. **Create Vendor Selections**
   - For Food/Meal/Custom: Creates records in `upcoming_order_vendor_selections`
   - For Boxes: Vendor stored in `upcoming_order_box_selections`

4. **Create Items**
   - For Food: Creates records in `upcoming_order_items` with `menu_item_id`
   - For Meal: Creates records in `upcoming_order_items` with `meal_item_id`
   - For Custom: Creates record in `upcoming_order_items` with `custom_name` and `custom_price`
   - For Boxes: Stores items in `upcoming_order_box_selections.items` JSONB field

### Example: Food Order Sync

**Input:** `client_food_orders.delivery_day_orders`
```json
{
  "Monday": {
    "vendorSelections": [
      {
        "vendorId": "vendor-1",
        "items": { "item-1": 2, "item-2": 1 },
        "itemNotes": { "item-1": "No onions" }
      },
      {
        "vendorId": "vendor-2",
        "items": { "item-3": 3 }
      }
    ]
  },
  "Wednesday": {
    "vendorSelections": [
      {
        "vendorId": "vendor-1",
        "items": { "item-1": 1 }
      }
    ]
  }
}
```

**Result:** Creates 2 records in `upcoming_orders`:
1. One for Monday with 2 vendor selections and 3 items
2. One for Wednesday with 1 vendor selection and 1 item

### Example: Meal Order Sync

**Input:** `client_meal_orders.meal_selections`
```json
{
  "Breakfast": {
    "vendorId": "vendor-1",
    "items": { "meal-item-1": 2, "meal-item-2": 1 }
  },
  "Dinner": {
    "vendorId": "vendor-2",
    "items": { "meal-item-3": 1 }
  }
}
```

**Result:** Creates 2 records in `upcoming_orders`:
1. One with `meal_type = 'Breakfast'` with 1 vendor selection and 2 items
2. One with `meal_type = 'Dinner'` with 1 vendor selection and 1 item

### Example: Box Order Sync

**Input:** Multiple records in `client_box_orders`:
```
Box 1: box_type_id = "box-1", vendor_id = "vendor-1", quantity = 2
Box 2: box_type_id = "box-2", vendor_id = "vendor-2", quantity = 1
```

**Result:** Creates 1 record in `upcoming_orders` with 2 records in `upcoming_order_box_selections`:
1. One upcoming order with `service_type = 'Boxes'`
2. Two box selections (one for each box type)

---

## Processing Upcoming Orders to Actual Orders

**Location:** `app/api/process-weekly-orders/route.ts` or `app/api/simulate-delivery-cycle/route.ts`

**Process:**

1. **Find Eligible Orders**
   - Query `upcoming_orders` where:
     - `status = 'scheduled'`
     - `take_effect_date <= today` (or based on vendor cutoff days)
   - Filter by order type and delivery day matching

2. **Create Order in `orders` Table**
   - Copy data from `upcoming_orders` to `orders`
   - Calculate `scheduled_delivery_date` from `delivery_day`
   - Assign `creation_id` to group orders created in same batch
   - Set `status = 'pending'`

3. **Copy Vendor Selections**
   - Copy from `upcoming_order_vendor_selections` to `order_vendor_selections`
   - Maintain vendor selection IDs for linking items

4. **Copy Items**
   - Copy from `upcoming_order_items` to `order_items`
   - Link items to new vendor selection IDs
   - For Food: Copy `menu_item_id`
   - For Meal: Copy `meal_item_id`
   - For Custom: Copy `custom_name` and `custom_price`

5. **Copy Box Selections**
   - Copy from `upcoming_order_box_selections` to `order_box_selections`
   - Copy `items` JSONB field

6. **Update Upcoming Order Status**
   - Set `status = 'processed'`
   - Set `processed_order_id` to link to final order
   - Set `processed_at` timestamp

---

## Querying Upcoming Orders

### Get All Upcoming Orders for a Client

```sql
SELECT uo.*,
       c.full_name as client_name
FROM upcoming_orders uo
JOIN clients c ON uo.client_id = c.id
WHERE uo.client_id = ?
  AND uo.status = 'scheduled'
ORDER BY uo.delivery_day, uo.meal_type;
```

### Get Upcoming Order with Full Details (Food)

```sql
SELECT uo.*,
       c.full_name as client_name,
       vs.vendor_id,
       v.name as vendor_name,
       oi.menu_item_id,
       mi.name as item_name,
       oi.quantity,
       oi.unit_value,
       oi.total_value,
       oi.notes as item_notes
FROM upcoming_orders uo
JOIN clients c ON uo.client_id = c.id
JOIN upcoming_order_vendor_selections vs ON uo.id = vs.upcoming_order_id
JOIN vendors v ON vs.vendor_id = v.id
LEFT JOIN upcoming_order_items oi ON vs.id = oi.vendor_selection_id
LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
WHERE uo.id = ?;
```

### Get Upcoming Order with Full Details (Meal)

```sql
SELECT uo.*,
       c.full_name as client_name,
       vs.vendor_id,
       v.name as vendor_name,
       oi.meal_item_id,
       mi.name as item_name,
       oi.quantity,
       oi.unit_value,
       oi.total_value,
       oi.notes as item_notes
FROM upcoming_orders uo
JOIN clients c ON uo.client_id = c.id
JOIN upcoming_order_vendor_selections vs ON uo.id = vs.upcoming_order_id
JOIN vendors v ON vs.vendor_id = v.id
LEFT JOIN upcoming_order_items oi ON vs.id = oi.vendor_selection_id
LEFT JOIN meal_items mi ON oi.meal_item_id = mi.id
WHERE uo.id = ? AND uo.service_type = 'Meal';
```

### Get Upcoming Order with Full Details (Boxes)

```sql
SELECT uo.*,
       c.full_name as client_name,
       obs.vendor_id,
       v.name as vendor_name,
       obs.box_type_id,
       bt.name as box_type_name,
       obs.quantity,
       obs.unit_value,
       obs.total_value,
       obs.items
FROM upcoming_orders uo
JOIN clients c ON uo.client_id = c.id
JOIN upcoming_order_box_selections obs ON uo.id = obs.upcoming_order_id
JOIN vendors v ON obs.vendor_id = v.id
LEFT JOIN box_types bt ON obs.box_type_id = bt.id
WHERE uo.id = ? AND uo.service_type = 'Boxes';
```

### Get Upcoming Orders Ready for Processing

```sql
SELECT uo.*,
       c.full_name as client_name
FROM upcoming_orders uo
JOIN clients c ON uo.client_id = c.id
WHERE uo.status = 'scheduled'
  AND uo.take_effect_date <= CURRENT_DATE
ORDER BY uo.take_effect_date, uo.delivery_day;
```

---

## Key Differences: Upcoming Orders vs Final Orders

| Feature | Upcoming Orders | Final Orders |
|---------|----------------|--------------|
| **Purpose** | Staging area for scheduled orders | Actual orders ready for delivery |
| **Status** | `'scheduled'`, `'processed'`, `'cancelled'` | `'pending'`, `'confirmed'`, `'completed'`, etc. |
| **Delivery Date** | `delivery_day` (day name) | `scheduled_delivery_date` (actual date) |
| **Take Effect Date** | `take_effect_date` (when to process) | N/A |
| **Order Number** | Assigned when created | Assigned when created |
| **Creation ID** | Not used | Groups batch-created orders |
| **Processing** | Processed weekly/batch | Individual order management |
| **Deletion** | Full replacement on sync | Individual deletion |

---

## Order Creation Flow Summary

### Food, Meal, and Box Orders (Configuration-Based)

```
1. User saves order configuration
   ↓
2. Save to client_*_orders table
   (client_food_orders, client_meal_orders, client_box_orders)
   ↓
3. Sync to upcoming_orders table
   (via syncCurrentOrderToUpcoming)
   ↓
4. Process weekly/batch creation
   (via /api/process-weekly-orders or /api/simulate-delivery-cycle)
   ↓
5. Create actual order in orders table
   + order_vendor_selections
   + order_items (or order_box_selections for boxes)
```

### Custom and Equipment Orders (Direct Creation)

```
1. User creates order
   ↓
2. Create directly in orders table
   + order_vendor_selections
   + order_items (for Custom only)
```

---

## Order Status Lifecycle

All order types follow the same status progression:

1. **pending** - Order created, awaiting confirmation
2. **confirmed** - Order confirmed, ready for delivery
3. **waiting_for_proof** - Order delivered, awaiting proof of delivery
4. **completed** - Order completed with proof
5. **billing_pending** - Awaiting billing
6. **billing_successful** - Billed successfully
7. **billing_failed** - Billing failed
8. **cancelled** - Order cancelled

---

## Key Differences Summary

| Order Type | Config Table | Direct to Orders | Uses order_items | Uses order_box_selections | creation_id |
|------------|--------------|------------------|------------------|----------------------------|-------------|
| **Food** | `client_food_orders` | No | Yes (`menu_item_id`) | No | Yes |
| **Meal** | `client_meal_orders` | No | Yes (`meal_item_id`) | No | Yes |
| **Boxes** | `client_box_orders` | No | No | Yes | Yes |
| **Custom** | None | Yes | Yes (`custom_name`, `custom_price`) | No | Yes |
| **Equipment** | None | Yes | No (uses `notes` JSON) | No | No |

---

## Database Queries for Each Order Type

### Query Food Orders

```sql
-- Get food order configuration
SELECT * FROM client_food_orders WHERE client_id = ?;

-- Get actual food orders
SELECT o.*, 
       c.full_name as client_name
FROM orders o
JOIN clients c ON o.client_id = c.id
WHERE o.service_type = 'Food'
ORDER BY o.created_at DESC;

-- Get food order with items
SELECT o.*,
       vs.vendor_id,
       v.name as vendor_name,
       oi.menu_item_id,
       mi.name as item_name,
       oi.quantity,
       oi.unit_value,
       oi.total_value,
       oi.notes as item_notes
FROM orders o
JOIN order_vendor_selections vs ON o.id = vs.order_id
JOIN vendors v ON vs.vendor_id = v.id
LEFT JOIN order_items oi ON vs.id = oi.vendor_selection_id
LEFT JOIN menu_items mi ON oi.menu_item_id = mi.id
WHERE o.id = ?;
```

### Query Meal Orders

```sql
-- Get meal order configuration
SELECT * FROM client_meal_orders WHERE client_id = ?;

-- Get actual meal orders
SELECT o.*,
       c.full_name as client_name
FROM orders o
JOIN clients c ON o.client_id = c.id
WHERE o.service_type = 'Meal'
ORDER BY o.created_at DESC;

-- Get meal order with items
SELECT o.*,
       vs.vendor_id,
       v.name as vendor_name,
       oi.meal_item_id,
       mi.name as item_name,
       oi.quantity,
       oi.unit_value,
       oi.total_value,
       oi.notes as item_notes
FROM orders o
JOIN order_vendor_selections vs ON o.id = vs.order_id
JOIN vendors v ON vs.vendor_id = v.id
LEFT JOIN order_items oi ON vs.id = oi.vendor_selection_id
LEFT JOIN meal_items mi ON oi.meal_item_id = mi.id
WHERE o.id = ?;
```

### Query Box Orders

```sql
-- Get box order configurations
SELECT * FROM client_box_orders WHERE client_id = ?;

-- Get actual box orders
SELECT o.*,
       c.full_name as client_name
FROM orders o
JOIN clients c ON o.client_id = c.id
WHERE o.service_type = 'Boxes'
ORDER BY o.created_at DESC;

-- Get box order with selections
SELECT o.*,
       obs.vendor_id,
       v.name as vendor_name,
       obs.box_type_id,
       bt.name as box_type_name,
       obs.quantity,
       obs.unit_value,
       obs.total_value,
       obs.items
FROM orders o
JOIN order_box_selections obs ON o.id = obs.order_id
JOIN vendors v ON obs.vendor_id = v.id
LEFT JOIN box_types bt ON obs.box_type_id = bt.id
WHERE o.id = ?;
```

### Query Custom Orders

```sql
-- Get custom orders
SELECT o.*,
       c.full_name as client_name
FROM orders o
JOIN clients c ON o.client_id = c.id
WHERE o.service_type = 'Custom'
ORDER BY o.created_at DESC;

-- Get custom order with item details
SELECT o.*,
       vs.vendor_id,
       v.name as vendor_name,
       oi.custom_name,
       oi.custom_price,
       oi.quantity
FROM orders o
JOIN order_vendor_selections vs ON o.id = vs.order_id
JOIN vendors v ON vs.vendor_id = v.id
LEFT JOIN order_items oi ON vs.id = oi.vendor_selection_id
WHERE o.id = ?;
```

### Query Equipment Orders

```sql
-- Get equipment orders
SELECT o.*,
       c.full_name as client_name,
       o.notes::jsonb as equipment_data
FROM orders o
JOIN clients c ON o.client_id = c.id
WHERE o.service_type = 'Equipment'
ORDER BY o.created_at DESC;

-- Parse equipment data from notes
SELECT o.*,
       c.full_name as client_name,
       (o.notes::jsonb->>'equipmentName') as equipment_name,
       (o.notes::jsonb->>'price')::decimal as equipment_price,
       vs.vendor_id,
       v.name as vendor_name
FROM orders o
JOIN clients c ON o.client_id = c.id
JOIN order_vendor_selections vs ON o.id = vs.order_id
JOIN vendors v ON vs.vendor_id = v.id
WHERE o.id = ? AND o.service_type = 'Equipment';
```

---

## Notes and Best Practices

1. **Always check for existing orders** before creating new ones to prevent duplicates
2. **Use creation_id** to group orders created in the same batch (allows batch undo)
3. **Calculate totals** from `order_items` rather than trusting `orders.total_value` (can recalculate)
4. **Handle JSONB fields** carefully - validate structure before saving
5. **Box orders use full replacement** - deleting all existing before inserting new ones
6. **Equipment orders** store all data in `notes` field as JSON, not in `order_items`
7. **Custom orders** use `custom_name` and `custom_price` instead of referencing menu items
8. **Vendor selections** are required for all order types except Equipment (which still creates one for display)

---

## Related Files

- **Type Definitions**: `lib/types.ts`
- **Save Functions**: `lib/actions.ts` (saveClientFoodOrder, saveClientMealOrder, saveClientBoxOrder, saveCustomOrder, saveEquipmentOrder)
- **Order Processing**: `app/api/process-weekly-orders/route.ts`, `app/api/simulate-delivery-cycle/route.ts`
- **Order Display**: `components/orders/OrdersList.tsx`, `components/orders/OrderDetailView.tsx`
- **Client Interface**: `components/clients/ClientPortalInterface.tsx`

---

*Last Updated: Based on codebase analysis of Triangle Order Management System*
