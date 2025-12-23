export type ServiceType = 'Food' | 'Boxes' | 'Cooking supplies' | 'Care plan';

export interface ClientProfile {
  id: string;
  fullName: string;
  address: string;
  phoneNumber: string;
  navigatorId: string;
  endDate: string; // ISO Date
  screeningTookPlace: boolean;
  screeningSigned: boolean;
  notes: string;
  statusId: string;
  serviceType: ServiceType;

  // Food Specific
  approvedMealsPerWeek?: number;

  // Order Configuration (Active Request)
  activeOrder?: OrderConfiguration;

  createdAt: string;
  updatedAt: string;
}

export interface OrderConfiguration {
  serviceType: ServiceType;
  // Previously single vendor/menuSelections, now supporting multi-vendor for Food
  vendorSelections: {
    vendorId: string;
    items: { [itemId: string]: number }; // itemId -> quantity
  }[];

  lastUpdated: string;
  updatedBy: string; // Admin ID or Name

  // For Boxes (still typically single vendor per box type, but keeping flexible)
  boxTypeId?: string;
  boxQuantity?: number;

  // Delivery Schedule Configuration
  deliveryDistribution?: { [dayOfWeek: string]: number }; // e.g. "Monday": 5
}

export interface DeliveryRecord {
  id: string;
  clientId: string;
  vendorId: string; // Still per-vendor for delivery records
  serviceType: ServiceType;
  deliveryDate: string; // ISO Date

  // Snapshot of what was delivered
  itemsSummary: string; // JSON or text summary

  proofOfDeliveryImage: string; // Path or URL
  createdAt: string;
}

// Configuration Entities
export interface ClientStatus {
  id: string;
  name: string;
  isSystemDefault?: boolean;
  deliveriesAllowed: boolean;
}

export interface Vendor {
  id: string;
  name: string;
  isActive: boolean;
  deliveryDays: string[]; // e.g. ["Monday", "Thursday"]
  allowsMultipleDeliveries: boolean;
  serviceType: ServiceType; // Vendor usually specializes in Food OR Boxes? Or both? Assuming one for simplicity mostly.
}

export interface MenuItem {
  id: string;
  vendorId: string;
  name: string;
  value: number;
  isActive: boolean;
}

export interface BoxType {
  id: string;
  name: string;
  vendorIds: string[]; // Vendors that supply this box
  isActive: boolean;
}

export interface Navigator {
  id: string;
  name: string;
  isActive: boolean;
}

export interface AppSettings {
  weeklyCutoffDay: string; // e.g. "Friday"
  weeklyCutoffTime: string; // e.g. "17:00"
}

export interface DatabaseSchema {
  clients: ClientProfile[];
  statuses: ClientStatus[];
  vendors: Vendor[];
  menuItems: MenuItem[];
  boxTypes: BoxType[];
  navigators: Navigator[];
  deliveryHistory: DeliveryRecord[];
  settings: AppSettings;
}
