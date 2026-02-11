/**
 * Retell AI tool definitions for the operator agent.
 * Use these when configuring the agent in Retell dashboard.
 * Functions are invoked via tool calls — agent calls API routes.
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

export const RETELL_TOOL_CREATE_UPCOMING_ORDER = {
  name: 'create_upcoming_order',
  description: 'Create an upcoming order for a client. MVP: Custom type only. Call after identifying the client.',
  type: 'function' as const,
  function: {
    name: 'create_upcoming_order',
    description: 'Create a Custom upcoming order for the identified client.',
    parameters: {
      type: 'object',
      required: ['client_id'],
      properties: {
        client_id: {
          type: 'string',
          description: 'Client ID (from lookup_client)',
        },
        custom_name: {
          type: 'string',
          description: 'Description of the custom item',
        },
        custom_price: {
          type: 'string',
          description: 'Price per order (e.g. "45.00")',
        },
        vendor_id: {
          type: 'string',
          description: 'Vendor ID',
        },
        delivery_day: {
          type: 'string',
          description: 'Delivery day (e.g. Monday, Tuesday)',
          enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        },
        notes: {
          type: 'string',
          description: 'General order notes',
        },
      },
    },
  },
};

export const RETELL_TOOLS = [RETELL_TOOL_LOOKUP_CLIENT, RETELL_TOOL_CREATE_UPCOMING_ORDER];
