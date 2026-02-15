/**
 * Phone number utilities for Retell look-up-client and similar APIs.
 * Handles formatted numbers, US country code, and other edge cases.
 */

/** Strip all non-digit characters from a phone string. */
export function normalizePhone(input: string | null | undefined): string {
    if (input == null || typeof input !== 'string') return '';
    return input.replace(/\D/g, '');
}

/**
 * Check if a stored phone value matches the search phone (both normalized).
 * Handles US format: "1" + 10 digits matches 10 digits and vice versa.
 * @param stored - Raw value from DB (e.g. "(845) 782-6353")
 * @param searchDigits - Normalized search input (e.g. "8457826353")
 */
export function phoneMatches(
    stored: string | null | undefined,
    searchDigits: string
): boolean {
    const storedDigits = normalizePhone(stored);
    if (!storedDigits) return false;

    if (storedDigits === searchDigits) return true;

    // US: 11 digits starting with 1 — compare last 10
    if (storedDigits.length === 11 && storedDigits.startsWith('1') && storedDigits.slice(1) === searchDigits) return true;
    if (searchDigits.length === 11 && searchDigits.startsWith('1') && searchDigits.slice(1) === storedDigits) return true;

    return false;
}

/**
 * Get all normalized variants to search for (handles US country code).
 * e.g. "8457826353" -> ["8457826353"]
 * e.g. "18457826353" -> ["18457826353", "8457826353"]
 */
export function getSearchVariants(phone: string): string[] {
    const digits = normalizePhone(phone);
    if (!digits) return [];

    const variants = [digits];
    if (digits.length === 11 && digits.startsWith('1')) {
        variants.push(digits.slice(1));
    }
    if (digits.length === 10 && digits[0] !== '0') {
        variants.push('1' + digits);
    }
    return variants;
}

/**
 * Escape special characters for safe use in SQL LIKE/ILIKE patterns.
 * Prevents % and _ from being interpreted as wildcards.
 */
export function escapeForIlike(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
}
