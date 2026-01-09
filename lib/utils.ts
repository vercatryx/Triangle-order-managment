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
