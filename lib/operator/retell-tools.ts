/**
 * Retell AI tool definitions for the operator agent.
 * Use these when configuring the agent in Retell dashboard.
 * Functions are invoked via tool calls — agent calls API routes.
 * All tools are independent; operator uses only lib/operator/*.
 */

export const RETELL_TOOL_LOOKUP_CLIENT = {
  name: 'lookup_client',
  description: 'Look up client by phone number or client ID. Call this first to identify who is on the line.',
  type: 'function' as const,
  function: {
    name: 'lookup_client',
    description: 'Look up client by phone number (E.164 or common format) or client ID. Returns client info and eligibility.',
    parameters: {
      type: 'object',
      properties: {
        phone_number: {
          type: 'string',
          description: 'Caller phone number in E.164 (e.g. +15551234567) or common format',
        },
        client_id: {
          type: 'string',
          description: 'Client ID if provided by caller (e.g. "12345")',
        },
      },
    },
  },
};

export const RETELL_TOOL_INQUIRE_CURRENT_ORDERS = {
  name: 'inquire_current_orders',
  description: 'Inquire about the client\'s current week orders and upcoming order. Call after identifying the client.',
  type: 'function' as const,
  function: {
    name: 'inquire_current_orders',
    description: 'Get current week orders and upcoming order for an identified client.',
    parameters: {
      type: 'object',
      required: ['client_id'],
      properties: {
        client_id: {
          type: 'string',
          description: 'Client ID (from lookup_client)',
        },
      },
    },
  },
};

export const RETELL_TOOL_REQUEST_MENU = {
  name: 'request_menu',
  description: 'Request menu items for a vendor or all menu items. Use when caller asks what is available to order.',
  type: 'function' as const,
  function: {
    name: 'request_menu',
    description: 'Get menu items for a vendor, or all menu items if no vendor specified.',
    parameters: {
      type: 'object',
      properties: {
        vendor_id: {
          type: 'string',
          description: 'Vendor ID to get menu for. Optional; if omitted, returns all menu items.',
        },
      },
    },
  },
};

export const RETELL_TOOL_CREATE_UPCOMING_ORDER = {
  name: 'create_upcoming_order',
  description: 'Create an upcoming order for a client. Supports Custom, Food, and Meal types. Call after identifying the client.',
  type: 'function' as const,
  function: {
    name: 'create_upcoming_order',
    description: 'Create an upcoming order. Supports Custom (custom_name, custom_price), Food (vendorSelections with items & quantities), Meal (mealSelections with items & quantities).',
    parameters: {
      type: 'object',
      required: ['client_id', 'service_type'],
      properties: {
        client_id: {
          type: 'string',
          description: 'Client ID (from lookup_client)',
        },
        service_type: {
          type: 'string',
          description: 'Order type',
          enum: ['Custom', 'Food', 'Meal'],
        },
        custom_name: {
          type: 'string',
          description: 'For Custom: description of the custom item',
        },
        custom_price: {
          type: 'string',
          description: 'For Custom: price per order (e.g. "45.00")',
        },
        vendor_id: {
          type: 'string',
          description: 'For Custom: vendor ID',
        },
        delivery_day: {
          type: 'string',
          description: 'For Custom: delivery day',
          enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        },
        vendor_selections: {
          type: 'array',
          description: 'For Food: list of { vendorId, items: { itemId: quantity } }',
          items: {
            type: 'object',
            properties: {
              vendorId: { type: 'string' },
              items: {
                type: 'object',
                additionalProperties: { type: 'number' },
                description: 'menu_item_id -> quantity',
              },
            },
          },
        },
        delivery_day_orders: {
          type: 'object',
          description: 'For Food: { "Monday": { vendorSelections: [...] } } per delivery day',
          additionalProperties: {
            type: 'object',
            properties: {
              vendorSelections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    vendorId: { type: 'string' },
                    items: { type: 'object', additionalProperties: { type: 'number' } },
                  },
                },
              },
            },
          },
        },
        meal_selections: {
          type: 'object',
          description: 'For Meal: { "Breakfast"|"Lunch"|"Dinner": { vendorId?, items: { itemId: quantity } } }',
          additionalProperties: {
            type: 'object',
            properties: {
              vendorId: { type: 'string' },
              items: { type: 'object', additionalProperties: { type: 'number' } },
            },
          },
        },
        notes: {
          type: 'string',
          description: 'General order notes',
        },
        case_id: {
          type: 'string',
          description: 'Case ID',
        },
      },
    },
  },
};

export const RETELL_TOOL_CREATE_FROM_PREVIOUS_ORDER = {
  name: 'create_from_previous_order',
  description: 'Create upcoming order by repeating the client\'s last order. Use when caller says "same as last time" or "repeat my order".',
  type: 'function' as const,
  function: {
    name: 'create_from_previous_order',
    description: 'Repeat the client\'s most recent order as their upcoming order.',
    parameters: {
      type: 'object',
      required: ['client_id'],
      properties: {
        client_id: {
          type: 'string',
          description: 'Client ID (from lookup_client)',
        },
      },
    },
  },
};

export const RETELL_TOOLS = [
  RETELL_TOOL_LOOKUP_CLIENT,
  RETELL_TOOL_INQUIRE_CURRENT_ORDERS,
  RETELL_TOOL_REQUEST_MENU,
  RETELL_TOOL_CREATE_UPCOMING_ORDER,
  RETELL_TOOL_CREATE_FROM_PREVIOUS_ORDER,
];
