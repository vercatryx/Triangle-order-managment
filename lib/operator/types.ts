/**
 * Operator-specific types. Do NOT import from lib/types.
 * Self-contained for the Retell AI operator feature.
 */

export type OperatorServiceType = 'Food' | 'Meal' | 'Boxes' | 'Custom';

/** Client info returned by lookup (minimal, non-sensitive) */
export interface OperatorClientInfo {
  clientId: string;
  fullName: string;
  phoneNumber?: string | null;
  secondaryPhoneNumber?: string | null;
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

/** Current order summary for inquire-current-orders */
export interface OperatorCurrentOrder {
  orderId: string;
  orderNumber: string;
  serviceType: string;
  status: string;
  scheduledDeliveryDate: string | null;
  totalItems: number;
  totalValue: number;
  notes: string | null;
}

/** Menu item for request-menu */
export interface OperatorMenuItem {
  id: string;
  vendorId?: string;
  name: string;
  value: number;
  priceEach?: number;
  minimumOrder?: number;
  deliveryDays?: string[] | null;
  itemType?: 'menu' | 'meal';
}

/** Last order structure for create-from-previous-order */
export interface OperatorLastOrder {
  orderId: string;
  serviceType: string;
  scheduledDeliveryDate: string | null;
  vendorSelections?: { vendorId: string; items: Record<string, number> }[];
  boxOrders?: {
    boxTypeId?: string;
    vendorId?: string;
    quantity: number;
    items?: Record<string, number>;
  }[];
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
