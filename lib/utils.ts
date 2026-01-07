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
