import { type ClassValue, clsx } from 'clsx';

export function cn(...inputs: ClassValue[]) {
    return clsx(inputs);
}

export function formatDate(dateStr: string) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Rounds a number to 2 decimal places for currency calculations.
 * This prevents floating-point precision errors when working with monetary values.
 * @param value - The number to round
 * @returns The value rounded to 2 decimal places
 */
export function roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
}

export const VAL_TOLERANCE = 0.05;

/**
 * Checks if a value meets a minimum requirement with fuzzy tolerance.
 * @param value The actual value
 * @param minimum The minimum required
 * @returns true if value >= minimum - TOLERANCE
 */
export function isMeetingMinimum(value: number, minimum: number): boolean {
    return value >= minimum - VAL_TOLERANCE;
}

/**
 * Checks if a value exceeds a maximum limit with fuzzy tolerance.
 * @param value The actual value
 * @param maximum The limit
 * @returns true if value > maximum + TOLERANCE (i.e. it strictly exceeds the limit even with tolerance)
 */
export function isExceedingMaximum(value: number, maximum: number): boolean {
    return value > maximum + VAL_TOLERANCE;
}

/**
 * Checks if a value meets an exact target with fuzzy tolerance.
 * @param value The actual value
 * @param target The target value
 * @returns true if |value - target| <= TOLERANCE
 */
export function isMeetingExactTarget(value: number, target: number): boolean {
    return Math.abs(value - target) <= VAL_TOLERANCE;
}

/**
 * Gets the start of the week (Sunday at midnight) for a given date.
 * Weeks run from Sunday (day 0) through Saturday (day 6).
 * @param date - The date to get the week start for
 * @returns Date object representing Sunday at 00:00:00 of that week
 */
export function getWeekStart(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 = Sunday, 6 = Saturday
    const diff = d.getDate() - day; // Days to subtract to get to Sunday
    d.setDate(diff);
    return d;
}

/**
 * Gets the end of the week (Saturday at 23:59:59) for a given date.
 * Weeks run from Sunday (day 0) through Saturday (day 6).
 * @param date - The date to get the week end for
 * @returns Date object representing Saturday at 23:59:59.999 of that week
 */
export function getWeekEnd(date: Date): Date {
    const weekStart = getWeekStart(date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6); // Add 6 days to get to Saturday
    weekEnd.setHours(23, 59, 59, 999);
    return weekEnd;
}

/**
 * Gets the week range string for display (e.g., "Jan 5 - Jan 11, 2025")
 * @param date - Any date within the week
 * @returns Formatted string representing the week range
 */
export function getWeekRangeString(date: Date): string {
    const weekStart = getWeekStart(date);
    const weekEnd = getWeekEnd(date);
    
    const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    
    // If same month, only show year at the end
    if (weekStart.getMonth() === weekEnd.getMonth()) {
        return `${startStr} - ${endStr}`;
    }
    return `${startStr} - ${endStr}`;
}

/**
 * Checks if a date falls within a given week (Sunday-Saturday)
 * @param date - The date to check
 * @param weekStart - The Sunday that starts the week
 * @returns true if the date is within the week
 */
export function isDateInWeek(date: Date, weekStart: Date): boolean {
    const dateWeekStart = getWeekStart(date);
    return dateWeekStart.getTime() === getWeekStart(weekStart).getTime();
}

/**
 * Gets an array of week start dates for the week selector
 * @param weeksBack - Number of weeks to go back from current week
 * @param weeksForward - Number of weeks to go forward from current week
 * @returns Array of Date objects representing Sunday of each week
 */
export function getWeekOptions(weeksBack: number = 8, weeksForward: number = 2): Date[] {
    const today = new Date();
    const currentWeekStart = getWeekStart(today);
    const options: Date[] = [];
    
    // Go back
    for (let i = weeksBack; i >= 0; i--) {
        const weekDate = new Date(currentWeekStart);
        weekDate.setDate(weekDate.getDate() - (i * 7));
        options.push(weekDate);
    }
    
    // Go forward
    for (let i = 1; i <= weeksForward; i++) {
        const weekDate = new Date(currentWeekStart);
        weekDate.setDate(weekDate.getDate() + (i * 7));
        options.push(weekDate);
    }
    
    return options;
}
