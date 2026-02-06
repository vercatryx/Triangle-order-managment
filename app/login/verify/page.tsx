import { verifyOtp } from '@/lib/auth-actions';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Verify Email' };

export default async function VerifyPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const resolvedParams = await searchParams;
    const email = resolvedParams?.email as string;
    const code = resolvedParams?.code as string;

    if (!email || !code) {
        return (
            <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif' }}>
                <h1>Invalid Link</h1>
                <p>Missing email or code parameters.</p>
                <a href="/login" style={{ color: '#0070f3' }}>Back to Login</a>
            </div>
        );
    }

    try {
        // verifyOtp handles the redirect on success
        const result = await verifyOtp(email, code);

        if (!result.success) {
            return (
                <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif' }}>
                    <h1>Login Failed</h1>
                    <p>{result.message || 'Invalid or expired link.'}</p>
                    <a href="/login" style={{ color: '#0070f3' }}>Back to Login</a>
                </div>
            );
        }
    } catch (error: any) {
        // verifyOtp throws NEXT_REDIRECT on success, so we catch it here to let it pass through
        // However, in a Server Component, we can let it bubble up if it's a redirect.
        // But verifyOtp catches NEXT_REDIRECT and re-throws it?
        // Let's check verifyOtp implementation again.
        // It says: if (error.message === 'NEXT_REDIRECT') throw error;
        // So yes, it will bubble up.
        if (error.message === 'NEXT_REDIRECT' || error.digest?.startsWith('NEXT_REDIRECT')) {
            throw error;
        }

        return (
            <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'sans-serif' }}>
                <h1>An Error Occurred</h1>
                <p>Please try again or log in manually.</p>
                <a href="/login" style={{ color: '#0070f3' }}>Back to Login</a>
            </div>
        );
    }

    // Should theoretically not reach here if success redirects
    return null;
}
