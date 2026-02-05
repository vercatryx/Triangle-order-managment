# Service Type: When to Use Client vs Order

## Rule

- **Client record** (`client.serviceType` / `clients.service_type`): The client’s assigned/contract service type. Use for:
  - Admin client list filtering/sorting
  - Client profile “assigned type” display
  - Default when the client has no order yet

- **Order / upcoming order** (`orderConfig.serviceType` or `upcomingOrder.serviceType`): The type of the **current order**. Use for:
  - **Client portal** (all UI: header, sidebar, which widget to show, Add Vendor / Add Meal visibility)
  - Validation and save payload when editing the current order
  - Any UI that displays or edits the “current order” for a client

## Why

A client’s row may say `service_type = 'Food'` while their `clients.upcoming_order` JSON has `serviceType: 'Boxes'` and `boxOrders`. The portal must show **Boxes** UI (no “Add Vendor”, box selection, etc.) based on the **order**, not the client row.

## Pattern in code

- In **client portal** components, derive effective service type once and pass it down:
  - `const serviceType = orderConfig?.serviceType ?? client.serviceType;`
  - Pass `serviceType` into `ClientPortalHeader`, `ClientPortalSidebar`, and `FoodServiceWidget` so they don’t use `client.serviceType` for display or actions.
- In **ClientPortalInterface**, use this `serviceType` for:
  - Which section to render (Food/Meal widget vs Boxes)
  - Validation and `handleSave` (payload and branching)
  - Box quota loading when effective type is Boxes

## Files that must use order service type (when editing/displaying current order)

- `components/clients/ClientPortalInterface.tsx` – defines and passes `serviceType`
- `components/clients/ClientPortalHeader.tsx` – accepts `serviceType` prop, uses for Add Vendor / Add Meal and meal count
- `components/clients/ClientPortalSidebar.tsx` – accepts `serviceType` prop for “Service Plan” label and icon
- `components/clients/FoodServiceWidget.tsx` – accepts optional `serviceType` prop for internal Food/Meal-only UI (e.g. Add Vendor inside widget)

## Files that correctly use client service type

- **ClientList.tsx** – list filters/sorting by client’s assigned type; row display can use `conf.serviceType || client.serviceType` for per-order column.
- **ClientProfile.tsx** – admin profile; initializing empty order from `formData.serviceType` / client is correct.
- **ClientInfoShelf.tsx** – displays client record info (assigned type, approved meals/boxes).
