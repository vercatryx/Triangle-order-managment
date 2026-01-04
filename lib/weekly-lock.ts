/**
 * Weekly Locking Logic (Authoritative Implementation)
 * 
 * The system evaluates order changes using weekly blocks, not individual delivery dates.
 * A week is strictly defined as: Sunday at 12:00 AM through Saturday at 11:59 PM
 * Weeks always reset on Sunday and are never calculated by counting forward seven days.
 */

import { AppSettings } from './types';

/**
 * Get the start of a week (Sunday at 12:00 AM) for a given date
 */
export function getWeekStart(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    
    // Get day of week (0 = Sunday, 6 = Saturday)
    const day = d.getDay();
    
    // Calculate days to subtract to get to Sunday
    const daysToSunday = day === 0 ? 0 : day;
    
    d.setDate(d.getDate() - daysToSunday);
    return d;
}

/**
 * Get the end of a week (Saturday at 11:59:59.999 PM) for a given date
 */
export function getWeekEnd(date: Date): Date {
    const weekStart = getWeekStart(date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    return weekEnd;
}

/**
 * Check if a date falls within a specific week (inclusive)
 */
export function isDateInWeek(date: Date, weekStart: Date): boolean {
    const weekEnd = getWeekEnd(weekStart);
    return date >= weekStart && date <= weekEnd;
}

/**
 * Get the cutoff datetime for the current time period
 * Returns a Date object representing when the cutoff occurs
 */
function getCutoffDateTime(settings: AppSettings, referenceDate: Date): Date {
    const cutoffDayName = settings.weeklyCutoffDay;
    const cutoffTimeStr = settings.weeklyCutoffTime || '17:00';
    const [cutoffHours, cutoffMinutes] = cutoffTimeStr.split(':').map(Number);

    const dayNameToNumber: { [key: string]: number } = {
        'Sunday': 0,
        'Monday': 1,
        'Tuesday': 2,
        'Wednesday': 3,
        'Thursday': 4,
        'Friday': 5,
        'Saturday': 6
    };

    const cutoffDayNumber = dayNameToNumber[cutoffDayName];
    if (cutoffDayNumber === undefined) {
        throw new Error(`Invalid cutoff day: ${cutoffDayName}`);
    }

    // Find the most recent cutoff occurrence before or on the reference date
    const cutoffDate = new Date(referenceDate);
    cutoffDate.setHours(cutoffHours, cutoffMinutes, 0, 0);
    
    // If reference date's time is before cutoff time on the same day, we need to go back
    let daysBack = 0;
    while (daysBack < 14) {
        const checkDate = new Date(referenceDate);
        checkDate.setDate(referenceDate.getDate() - daysBack);
        checkDate.setHours(cutoffHours, cutoffMinutes, 0, 0);
        
        if (checkDate.getDay() === cutoffDayNumber && checkDate <= referenceDate) {
            cutoffDate.setTime(checkDate.getTime());
            break;
        }
        daysBack++;
    }

    return cutoffDate;
}

/**
 * Determine which week is locked based on the cutoff settings and current time.
 * Returns the start date (Sunday) of the locked week, or null if no week is locked.
 * 
 * Rules:
 * - If cutoff is reached before Sunday (i.e., cutoff day is Saturday or earlier in the week), 
 *   the next full week (Sunday–Saturday) is locked
 * - If cutoff is reached on Sunday or later, the current week (from cutoff forward) is locked
 */
export function getLockedWeekStart(settings: AppSettings, currentTime: Date = new Date()): Date | null {
    const cutoffDateTime = getCutoffDateTime(settings, currentTime);
    
    // If cutoff hasn't been reached yet, no week is locked
    if (currentTime < cutoffDateTime) {
        return null;
    }

    const cutoffDayOfWeek = cutoffDateTime.getDay();
    const cutoffWeekStart = getWeekStart(cutoffDateTime);

    // If cutoff occurred before Sunday (Saturday or earlier), lock the NEXT week
    // If cutoff occurred on Sunday or later, lock the CURRENT week
    if (cutoffDayOfWeek === 6) {
        // Cutoff on Saturday - lock the next week
        const nextWeekStart = new Date(cutoffWeekStart);
        nextWeekStart.setDate(cutoffWeekStart.getDate() + 7);
        return nextWeekStart;
    } else if (cutoffDayOfWeek === 0) {
        // Cutoff on Sunday - lock the current week (the week starting on this Sunday)
        return cutoffWeekStart;
    } else {
        // Cutoff on Monday-Friday - lock the current week (the week containing the cutoff)
        return cutoffWeekStart;
    }
}

/**
 * Check if a delivery date falls within a locked week
 */
export function isDeliveryDateLocked(
    deliveryDate: Date,
    settings: AppSettings,
    currentTime: Date = new Date()
): boolean {
    const lockedWeekStart = getLockedWeekStart(settings, currentTime);
    
    if (!lockedWeekStart) {
        return false; // No week is locked
    }

    return isDateInWeek(deliveryDate, lockedWeekStart);
}

/**
 * Check if ANY delivery date in a set is locked
 * This enforces the rule: "If any delivery in a week is blocked, then all deliveries in that week must be blocked"
 */
export function areAnyDeliveriesLocked(
    deliveryDates: Date[],
    settings: AppSettings,
    currentTime: Date = new Date()
): boolean {
    if (deliveryDates.length === 0) {
        return false;
    }

    // Group deliveries by week
    const deliveriesByWeek = new Map<string, Date[]>();
    
    for (const deliveryDate of deliveryDates) {
        const weekStart = getWeekStart(deliveryDate);
        const weekKey = weekStart.toISOString();
        
        if (!deliveriesByWeek.has(weekKey)) {
            deliveriesByWeek.set(weekKey, []);
        }
        deliveriesByWeek.get(weekKey)!.push(deliveryDate);
    }

    // Check if any week containing deliveries is locked
    for (const [weekKey, dates] of deliveriesByWeek) {
        const weekStart = new Date(weekKey);
        
        // Check if any delivery in this week falls in a locked week
        for (const deliveryDate of dates) {
            if (isDeliveryDateLocked(deliveryDate, settings, currentTime)) {
                // This week is locked - all deliveries in this week must be considered locked
                return true;
            }
        }
    }

    return false;
}

/**
 * Calculate the earliest effective date for order changes.
 * The earliest effective date is always a Sunday.
 * 
 * If a week is locked:
 * - Return the Sunday following the locked week
 * If no week is locked:
 * - Return the upcoming Sunday (or current Sunday if it's still Sunday and before cutoff)
 */
export function getEarliestEffectiveDate(
    settings: AppSettings,
    currentTime: Date = new Date()
): Date {
    const lockedWeekStart = getLockedWeekStart(settings, currentTime);
    
    if (!lockedWeekStart) {
        // No week is locked - earliest effective date is the upcoming Sunday
        const todayWeekStart = getWeekStart(currentTime);
        const todayDayOfWeek = currentTime.getDay();
        
        // If today is Sunday and before cutoff, we can still make changes for this week
        // Otherwise, the earliest effective date is next Sunday
        if (todayDayOfWeek === 0) {
            const cutoffDateTime = getCutoffDateTime(settings, currentTime);
            if (currentTime < cutoffDateTime) {
                // Still before cutoff on Sunday - can make changes for this week
                return todayWeekStart;
            }
        }
        
        // Next Sunday
        const nextSunday = new Date(todayWeekStart);
        nextSunday.setDate(todayWeekStart.getDate() + 7);
        return nextSunday;
    }

    // A week is locked - earliest effective date is the Sunday after the locked week
    const sundayAfterLockedWeek = new Date(lockedWeekStart);
    sundayAfterLockedWeek.setDate(lockedWeekStart.getDate() + 7);
    return sundayAfterLockedWeek;
}

/**
 * Get the locked week range as a human-readable string
 */
export function getLockedWeekDescription(
    settings: AppSettings,
    currentTime: Date = new Date()
): string | null {
    const lockedWeekStart = getLockedWeekStart(settings, currentTime);
    
    if (!lockedWeekStart) {
        return null;
    }

    const lockedWeekEnd = getWeekEnd(lockedWeekStart);
    
    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', { 
            weekday: 'long', 
            month: 'long', 
            day: 'numeric' 
        });
    };

    return `${formatDate(lockedWeekStart)} - ${formatDate(lockedWeekEnd)}`;
}

