import { ClientProfile } from './types';

/**
 * Error handler utility
 * This is a pure utility function, not a Server Action
 */
export function handleError(error: any) {
    if (error) {
        console.error('Supabase Error:', error);
        throw new Error(error.message);
    }
}

/**
 * Maps database client record to ClientProfile type
 * This is a pure utility function, not a Server Action
 */
export function mapClientFromDB(c: any): ClientProfile {
    return {
        id: c.id,
        fullName: c.full_name,
        email: c.email || '',
        address: c.address || '',
        phoneNumber: c.phone_number || '',
        secondaryPhoneNumber: c.secondary_phone_number || null,
        navigatorId: c.navigator_id || '',
        endDate: c.end_date || '',
        screeningTookPlace: c.screening_took_place,
        screeningSigned: c.screening_signed,
        screeningStatus: c.screening_status || 'not_started',
        notes: c.notes || '',
        statusId: c.status_id || '',
        serviceType: c.service_type as any,
        approvedMealsPerWeek: c.approved_meals_per_week,
        parentClientId: c.parent_client_id || null,
        dob: c.dob || null,
        cin: c.cin ?? null,
        authorizedAmount: c.authorized_amount ?? null,
        expirationDate: c.expiration_date || null,
        activeOrder: c.active_order, // Metadata matches structure
        mealOrder: (c.service_type === 'Food' || c.service_type === 'Meal') && c.upcoming_order?.mealSelections
            ? { id: c.id, clientId: c.id, caseId: c.upcoming_order.caseId ?? null, mealSelections: c.upcoming_order.mealSelections, notes: c.upcoming_order.notes ?? null, created_at: undefined, updated_at: undefined, updated_by: undefined }
            : undefined,
        locationId: c.location_id || null,
        createdAt: c.created_at,
        updatedAt: c.updated_at
    };
}
