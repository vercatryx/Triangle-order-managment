/**
 * Operator-specific types. Do NOT import from lib/types.
 * Self-contained for the Retell AI operator feature.
 */

export type OperatorServiceType = 'Food' | 'Meal' | 'Boxes' | 'Custom';

/** Client info returned by lookup (minimal, non-sensitive) */
export interface OperatorClientInfo {
  clientId: string;
  fullName: string;
  serviceType: OperatorServiceType;
  eligibility: boolean;
  eligibilityReason?: string;
}

/** Custom order payload (MVP - per UPCOMING_ORDER_SCHEMA.md) */
export interface OperatorCustomOrderPayload {
  serviceType: 'Custom';
  caseId?: string;
  custom_name?: string;
  custom_price?: string | number;
  vendorId?: string;
  deliveryDay?: string;
  notes?: string;
}

/** Box order element */
export interface OperatorBoxOrderItem {
  boxTypeId?: string;
  vendorId?: string;
  quantity?: number;
  items?: Record<string, number>;
  itemNotes?: Record<string, string>;
}

/** Food/Meal vendor selection */
export interface OperatorVendorSelection {
  vendorId: string;
  items: Record<string, number>;
  itemNotes?: Record<string, string>;
}

/** Generic upcoming order payload (union for validation) */
export type OperatorUpcomingOrderPayload =
  | OperatorCustomOrderPayload
  | {
      serviceType: 'Boxes';
      caseId?: string;
      boxOrders?: OperatorBoxOrderItem[];
      notes?: string;
    }
  | {
      serviceType: 'Food' | 'Meal';
      caseId?: string;
      vendorSelections?: OperatorVendorSelection[];
      deliveryDayOrders?: Record<string, { vendorSelections: OperatorVendorSelection[] }>;
      mealSelections?: Record<string, { vendorId?: string; items: Record<string, number>; itemNotes?: Record<string, string> }>;
      notes?: string;
    };
