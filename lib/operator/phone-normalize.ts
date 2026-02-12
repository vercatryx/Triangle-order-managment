/**
 * Phone number normalization to E.164 for operator client lookup.
 * Self-contained — no imports from other lib modules.
 */

const E164_PREFIX = '+1';

/**
 * Normalize a phone number to E.164 format (US/CA: +1XXXXXXXXXX).
 * Strips non-digits, adds +1 if 10 digits, preserves +1 if 11 digits.
 */
export function normalizePhoneToE164(input: string | null | undefined): string | null {
  if (input == null || typeof input !== 'string') return null;
  const digits = input.replace(/\D/g, '');
  if (digits.length === 0) return null;
  if (digits.length === 10) return `${E164_PREFIX}${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 10) return `+${digits.slice(-11)}`; // Take last 11, assume country 1
  return null;
}

/**
 * Normalize for DB comparison — ensure consistent format.
 * Returns null if invalid.
 */
export function normalizeForLookup(phone: string | null | undefined): string | null {
  return normalizePhoneToE164(phone);
}

/**
 * Return variants to try when matching phones in DB (different formats may be stored).
 * Accepts E.164-style numbers (10+ digits) and shorter numbers for test/short-format DB values.
 */
export function getPhoneLookupVariants(phone: string | null | undefined): string[] {
  if (phone == null || typeof phone !== 'string') return [];
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 0) return [];

  const variants: string[] = [];

  // 10+ digits: normalize to E.164 and add common variants
  const e164 = normalizePhoneToE164(phone);
  if (e164) {
    variants.push(e164);
    if (digits.length === 11 && digits.startsWith('1')) {
      variants.push(digits.slice(1)); // 10-digit
      variants.push(digits); // 11-digit
    } else if (digits.length === 10) {
      variants.push(digits);
      variants.push('1' + digits);
    }
  }

  // Always include digits-only and original (for short numbers like 555-1001 in test data)
  variants.push(digits);
  const trimmed = phone.trim();
  if (trimmed && trimmed !== digits) variants.push(trimmed);

  return [...new Set(variants)];
}
