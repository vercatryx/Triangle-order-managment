/**
 * Centralized Order Date Calculation Utilities
 * 
 * This file contains ALL order date assignment logic:
 * - Next delivery dates (first occurrence)
 * - Scheduled delivery dates
 * - Take effect dates (using weekly locking)
 * - Multi-vendor date calculations
 * 
 * IMPORTANT: All date calculations for orders should use functions from this file.
 */

import { Vendor, AppSettings } from './types';
import { getEarliestEffectiveDate } from './weekly-lock';

/**
 * Day name to day number mapping (consistent across all date calculations)
 */
export const DAY_NAME_TO_NUMBER: { [key: string]: number } = {
    'Sunday': 0,
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6
};

/**
 * Get day number from day name (0 = Sunday, 6 = Saturday)
 */
export function getDayNumber(dayName: string): number | undefined {
    return DAY_NAME_TO_NUMBER[dayName];
}

/**
 * Get all delivery day numbers for a vendor
 */
function getVendorDeliveryDayNumbers(vendor: Vendor | { deliveryDays?: string[] }): number[] {
    const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
    if (!deliveryDays || deliveryDays.length === 0) {
        return [];
    }

    return deliveryDays
        .map((day: string) => DAY_NAME_TO_NUMBER[day])
        .filter((num: number | undefined): num is number => num !== undefined);
}

/**
 * Calculate the next delivery date (first occurrence) for a vendor.
 * Returns the next upcoming delivery date based on the vendor's delivery days.
 * 
 * @param vendorId - The vendor ID
 * @param vendors - Array of all vendors
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Date object for the next delivery date, or null if vendor has no delivery days
 */
export function getNextDeliveryDate(
    vendorId: string,
    vendors: Vendor[],
    referenceDate: Date = new Date()
): Date | null {
    if (!vendorId) return null;

    const vendor = vendors.find(v => v.id === vendorId);
    if (!vendor) return null;

    const deliveryDayNumbers = getVendorDeliveryDayNumbers(vendor);
    if (deliveryDayNumbers.length === 0) return null;

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    // Find the first occurrence (next delivery day, starting from today)
    for (let i = 0; i <= 14; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        if (deliveryDayNumbers.includes(checkDate.getDay())) {
            return checkDate;
        }
    }

    return null;
}

/**
 * Calculate the next delivery date for a specific day of week.
 * Returns the next occurrence of the specified day.
 * 
 * @param deliveryDay - Day name (e.g., "Monday", "Tuesday")
 * @param vendors - Array of all vendors (for validation if vendorId is provided)
 * @param vendorId - Optional vendor ID to validate the vendor delivers on this day
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Date object for the next occurrence of the delivery day, or null if invalid
 */
export function getNextDeliveryDateForDay(
    deliveryDay: string,
    vendors: Vendor[],
    vendorId?: string,
    referenceDate: Date = new Date()
): Date | null {
    if (!deliveryDay) return null;

    const targetDayNumber = DAY_NAME_TO_NUMBER[deliveryDay];
    if (targetDayNumber === undefined) return null;

    // If vendorId is provided, verify the vendor delivers on this day
    if (vendorId) {
        const vendor = vendors.find(v => v.id === vendorId);
        if (!vendor) return null;
        const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
        if (!deliveryDays || !deliveryDays.includes(deliveryDay)) {
            return null;
        }
    }

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    // Find the next occurrence of this day
    for (let i = 0; i <= 14; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        if (checkDate.getDay() === targetDayNumber) {
            return checkDate;
        }
    }

    return null;
}

/**
 * Calculate the take effect date (second occurrence) for a vendor.
 * DEPRECATED: This uses the old "second occurrence" logic. 
 * Use getEarliestEffectiveDate() instead, which respects weekly locking.
 * 
 * @param vendorId - The vendor ID
 * @param vendors - Array of all vendors
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Date object for the second occurrence delivery date, or null
 */
export function getTakeEffectDateLegacy(
    vendorId: string,
    vendors: Vendor[],
    referenceDate: Date = new Date()
): Date | null {
    if (!vendorId) return null;

    const vendor = vendors.find(v => v.id === vendorId);
    if (!vendor) return null;

    const deliveryDayNumbers = getVendorDeliveryDayNumbers(vendor);
    if (deliveryDayNumbers.length === 0) return null;

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    // Find the second occurrence (next next delivery day, starting from tomorrow)
    let foundCount = 0;
    for (let i = 1; i <= 21; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        const dayOfWeek = checkDate.getDay();

        if (deliveryDayNumbers.includes(dayOfWeek)) {
            foundCount++;
            if (foundCount === 2) {
                return checkDate;
            }
        }
    }

    return null;
}

/**
 * Calculate the take effect date for a specific delivery day (second occurrence).
 * DEPRECATED: This uses the old "second occurrence" logic.
 * Use getEarliestEffectiveDate() instead, which respects weekly locking.
 * 
 * @param deliveryDay - Day name (e.g., "Monday", "Tuesday")
 * @param vendors - Array of all vendors
 * @param vendorId - Optional vendor ID to validate
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Date object for the second occurrence, or null
 */
export function getTakeEffectDateForDayLegacy(
    deliveryDay: string,
    vendors: Vendor[],
    vendorId?: string,
    referenceDate: Date = new Date()
): Date | null {
    if (!deliveryDay) return null;

    const targetDayNumber = DAY_NAME_TO_NUMBER[deliveryDay];
    if (targetDayNumber === undefined) return null;

    // If vendorId is provided, verify the vendor delivers on this day
    if (vendorId) {
        const vendor = vendors.find(v => v.id === vendorId);
        if (!vendor) return null;
        const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
        if (!deliveryDays || !deliveryDays.includes(deliveryDay)) {
            return null;
        }
    }

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    // Find the second occurrence (starting from tomorrow)
    let foundCount = 0;
    for (let i = 1; i <= 21; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        if (checkDate.getDay() === targetDayNumber) {
            foundCount++;
            if (foundCount === 2) {
                return checkDate;
            }
        }
    }

    return null;
}

/**
 * Get the earliest take effect date using weekly locking logic.
 * This is the PREFERRED method - always returns a Sunday and respects weekly cutoff rules.
 * 
 * @param settings - App settings containing cutoff configuration
 * @param referenceDate - Optional reference date (defaults to current time)
 * @returns Date object for the earliest effective date (always a Sunday), or null if settings are invalid
 */
export function getTakeEffectDate(
    settings: AppSettings,
    referenceDate: Date = new Date()
): Date | null {
    if (!settings) return null;
    return getEarliestEffectiveDate(settings, referenceDate);
}

/**
 * Get the earliest delivery date from multiple vendors.
 * Useful for Food orders with multiple vendors.
 * 
 * @param vendorIds - Array of vendor IDs
 * @param vendors - Array of all vendors
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns The earliest delivery date across all vendors, or null if none found
 */
export function getEarliestDeliveryDate(
    vendorIds: string[],
    vendors: Vendor[],
    referenceDate: Date = new Date()
): Date | null {
    const dates: Date[] = [];

    for (const vendorId of vendorIds) {
        const date = getNextDeliveryDate(vendorId, vendors, referenceDate);
        if (date) dates.push(date);
    }

    if (dates.length === 0) return null;
    return dates.reduce((earliest, current) => current < earliest ? current : earliest);
}

/**
 * Get all delivery dates for an order configuration.
 * Handles both single-day and multi-day order formats.
 * 
 * @param orderConfig - The order configuration
 * @param vendors - Array of all vendors
 * @param serviceType - Service type ('Food' or 'Boxes')
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Array of delivery dates
 */
export function getAllDeliveryDatesForOrder(
    orderConfig: any,
    vendors: Vendor[],
    serviceType: 'Food' | 'Boxes',
    referenceDate: Date = new Date()
): Date[] {
    const deliveryDates: Date[] = [];

    if (serviceType === 'Food') {
        if (orderConfig.deliveryDayOrders) {
            // Multi-day format: get delivery dates for each day in deliveryDayOrders
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const selection of daySelections) {
                    if (selection.vendorId) {
                        const date = getNextDeliveryDateForDay(day, vendors, selection.vendorId, referenceDate);
                        if (date) deliveryDates.push(date);
                    }
                }
            }
        } else if (orderConfig.vendorSelections) {
            // Single-day format: get next delivery date for each vendor
            for (const selection of orderConfig.vendorSelections) {
                if (selection.vendorId) {
                    const date = getNextDeliveryDate(selection.vendorId, vendors, referenceDate);
                    if (date) deliveryDates.push(date);
                }
            }
        }
    } else if (serviceType === 'Boxes' && orderConfig.vendorId) {
        const date = getNextDeliveryDate(orderConfig.vendorId, vendors, referenceDate);
        if (date) deliveryDates.push(date);
    }

    return deliveryDates;
}

/**
 * Get a formatted string representation of a delivery date.
 * 
 * @param date - The date to format
 * @returns Formatted string like "Monday, January 15, 2024"
 */
export function formatDeliveryDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Get a formatted string representation for display with day and date.
 * 
 * @param date - The date to format
 * @returns Formatted string like "Monday, Jan 15"
 */
export function formatDeliveryDateShort(date: Date): string {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
    });
}


