import crypto from 'crypto';

/** When set to "true" or "1", signature verification is skipped (any caller can use the API). */
const SKIP_VERIFY = process.env.RETELL_SKIP_VERIFY === 'true' || process.env.RETELL_SKIP_VERIFY === '1';

/**
 * Verify that the request body was sent by Retell using the x-retell-signature header.
 * Uses HMAC-SHA256 with your Retell API key (webhook-capable key).
 * Set RETELL_SKIP_VERIFY=true to temporarily bypass (e.g. for testing).
 * @param rawBody - The raw request body string (use request.text() before parsing).
 * @param signature - The value of the X-Retell-Signature header.
 * @returns true if the signature is valid (or verification is skipped).
 */
export function verifyRetellSignature(rawBody: string, signature: string | null | undefined): boolean {
    if (SKIP_VERIFY) return true;
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey || !signature) return false;
    const expected = crypto.createHmac('sha256', apiKey).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature, 'hex');
    if (sigBuf.length !== expected.length) return false;
    return crypto.timingSafeEqual(sigBuf, Buffer.from(expected, 'hex'));
}
