/**
 * Single-shape converter for clients.upcoming_order (Food/Meal).
 *
 * Canonical shape: vendorSelections only (with itemsByDay, selectedDeliveryDays, itemNotesByDay).
 * Legacy shape: deliveryDayOrders (day -> { vendorSelections: [] }).
 *
 * Use normalizeUpcomingOrder() on read so the app only ever sees vendorSelections.
 * Persist only vendorSelections (no deliveryDayOrders) on write.
 */

export type DeliveryDayOrders = Record<
    string,
    { vendorSelections?: Array<{ vendorId?: string; items?: Record<string, number>; itemNotes?: Record<string, string> }> }
>;

export type VendorSelectionNormalized = {
    vendorId: string;
    items?: Record<string, number>;
    itemsByDay: Record<string, Record<string, number>>;
    selectedDeliveryDays: string[];
    itemNotes?: Record<string, string>;
    itemNotesByDay: Record<string, Record<string, string>>;
};

/**
 * Converts deliveryDayOrders format into vendorSelections format (with itemsByDay / selectedDeliveryDays).
 * Idempotent-friendly: only includes selections that have a vendorId.
 */
export function deliveryDayOrdersToVendorSelections(
    deliveryDayOrders: DeliveryDayOrders
): VendorSelectionNormalized[] {
    if (!deliveryDayOrders || typeof deliveryDayOrders !== 'object' || Object.keys(deliveryDayOrders).length === 0) {
        return [];
    }

    const vendorMap = new Map<string, VendorSelectionNormalized>();

    for (const day of Object.keys(deliveryDayOrders).sort()) {
        const dayData = deliveryDayOrders[day];
        const selections = dayData?.vendorSelections ?? [];

        for (const sel of selections) {
            if (!sel?.vendorId) continue;

            if (!vendorMap.has(sel.vendorId)) {
                vendorMap.set(sel.vendorId, {
                    vendorId: sel.vendorId,
                    items: {},
                    itemsByDay: {},
                    selectedDeliveryDays: [],
                    itemNotesByDay: {}
                });
            }

            const v = vendorMap.get(sel.vendorId)!;
            if (!v.selectedDeliveryDays.includes(day)) {
                v.selectedDeliveryDays.push(day);
            }
            v.itemsByDay[day] = sel.items && typeof sel.items === 'object' ? { ...sel.items } : {};
            if (sel.itemNotes && typeof sel.itemNotes === 'object') {
                v.itemNotesByDay[day] = { ...sel.itemNotes };
            } else if (!v.itemNotesByDay[day]) {
                v.itemNotesByDay[day] = {};
            }
        }
    }

    return Array.from(vendorMap.values());
}

export type UpcomingOrderRaw = {
    serviceType?: string;
    caseId?: string | null;
    vendorSelections?: any[];
    deliveryDayOrders?: DeliveryDayOrders;
    mealSelections?: Record<string, any>;
    boxOrders?: any[];
    notes?: string | null;
    [key: string]: any;
};

/**
 * Normalizes a raw upcoming_order payload to the single canonical shape:
 * - Food/Meal: vendorSelections only; deliveryDayOrders removed (converted into vendorSelections).
 * - Other fields (mealSelections, boxOrders, caseId, notes, etc.) are preserved as-is.
 * - Non-Food/Meal payloads are returned unchanged (no deliveryDayOrders to convert).
 */
export function normalizeUpcomingOrder(raw: UpcomingOrderRaw | null | undefined): UpcomingOrderRaw | null {
    if (raw == null || typeof raw !== 'object') {
        return raw ?? null;
    }

    const serviceType = raw.serviceType ?? 'Food';
    if (serviceType !== 'Food' && serviceType !== 'Meal') {
        return raw;
    }

    const hasVendorSelections =
        Array.isArray(raw.vendorSelections) &&
        raw.vendorSelections.length > 0 &&
        raw.vendorSelections.some((s: any) => s?.vendorId || (s?.items && Object.keys(s.items || {}).length > 0));

    const hasDeliveryDayOrders =
        raw.deliveryDayOrders &&
        typeof raw.deliveryDayOrders === 'object' &&
        Object.keys(raw.deliveryDayOrders).length > 0;

    if (!hasDeliveryDayOrders) {
        return raw;
    }

    // If we already have real vendorSelections, keep them and just drop deliveryDayOrders
    if (hasVendorSelections) {
        const out = { ...raw };
        delete out.deliveryDayOrders;
        return out;
    }

    // Convert deliveryDayOrders -> vendorSelections and remove deliveryDayOrders
    const vendorSelections = deliveryDayOrdersToVendorSelections(raw.deliveryDayOrders!);
    const out: UpcomingOrderRaw = { ...raw };
    out.vendorSelections = vendorSelections.length > 0 ? vendorSelections : [];
    delete out.deliveryDayOrders;
    return out;
}

/**
 * Returns true if the payload is in legacy shape (has deliveryDayOrders with content).
 * Useful for migration scripts to count how many need conversion.
 */
export function hasLegacyDeliveryDayOrders(raw: UpcomingOrderRaw | null | undefined): boolean {
    if (raw == null || typeof raw !== 'object') return false;
    const ddo = raw.deliveryDayOrders;
    if (!ddo || typeof ddo !== 'object') return false;
    return Object.keys(ddo).length > 0;
}
