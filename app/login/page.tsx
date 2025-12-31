'use client';

import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, checkEmailIdentity } from '@/lib/auth-actions';
import styles from './page.module.css';

export default function LoginPage() {
    const router = useRouter();
    const [state, action, isPending] = useActionState(login, undefined);
    const [step, setStep] = useState<1 | 2>(1);
    const [username, setUsername] = useState('');
    const [checkingIdentity, setCheckingIdentity] = useState(false);
    const [identityError, setIdentityError] = useState('');

    const handleNext = async () => {
        if (!username.trim()) {
            setIdentityError('Please enter a username or email.');
            return;
        }

        setCheckingIdentity(true);
        setIdentityError('');

        try {
            console.log('Checking identity for:', username);
            const result = await checkEmailIdentity(username);
            console.log('Identity result:', result);

            if (result.exists) {
                if (result.type === 'client' && result.id) {
                    console.log('Redirecting to client portal:', result.id);
                    // Redirect to client portal
                    router.push(`/client-portal/${result.id}`);
                    // Don't turn off checkingIdentity so we show loading state during redirect
                    return;
                }
                setStep(2);
                setCheckingIdentity(false);
            } else {
                setIdentityError('No account found with that email/username.');
                setCheckingIdentity(false);
            }
        } catch (err) {
            console.error('Identity check error:', err);
            setIdentityError('An error occurred. Please try again.');
            setCheckingIdentity(false);
        }
    };

    const handleBack = () => {
        setStep(1);
        setIdentityError('');
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className="text-center">
                    <h2 className={styles.title}>
                        Welcome Back
                    </h2>
                    <p className={styles.subtitle}>
                    </p>
                </div>

                <form className={styles.form} action={action}>
                    <div className={styles.formGroup}>
                        {step === 1 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <label htmlFor="username" className={styles.label}>
                                    Username or Email
                                </label>
                                <input
                                    id="username"
                                    name="username"
                                    type="text"
                                    required
                                    className={styles.inputLarge}
                                    placeholder="Enter your username or email"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    // Allow Enter key to trigger Next
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleNext();
                                        }
                                    }}
                                    disabled={checkingIdentity}
                                    autoFocus
                                />
                                {identityError && (
                                    <div className={styles.errorMessage} style={{ marginTop: '0.5rem' }}>
                                        {identityError}
                                    </div>
                                )}
                            </div>
                        )}

                        {step === 2 && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                <div className={styles.userInfoDisplay} style={{ marginBottom: '1.5rem', padding: '0.75rem', background: 'var(--background-secondary)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{username}</span>
                                    <button
                                        type="button"
                                        onClick={handleBack}
                                        style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}
                                    >
                                        Change
                                    </button>
                                </div>
                                <input type="hidden" name="username" value={username} />
                                <div>
                                    <label htmlFor="password" className={styles.label}>
                                        Password
                                    </label>
                                    <input
                                        id="password"
                                        name="password"
                                        type="password"
                                        required
                                        className={styles.inputLarge}
                                        placeholder="Enter your password"
                                        autoFocus
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {step === 2 && state?.message && (
                        <div className={styles.errorMessage}>
                            {state.message}
                        </div>
                    )}

                    <div style={{ marginTop: '1.5rem' }}>
                        {step === 1 ? (
                            <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); handleNext(); }}
                                disabled={checkingIdentity}
                                className={styles.btnLarge}
                            >
                                {checkingIdentity ? (
                                    <>
                                        <div className={styles.spinner} />
                                        Checking...
                                    </>
                                ) : (
                                    'Next'
                                )}
                            </button>
                        ) : (
                            <button
                                type="submit"
                                disabled={isPending}
                                className={styles.btnLarge}
                            >
                                {isPending ? (
                                    <>
                                        <div className={styles.spinner} />
                                        Signing in...
                                    </>
                                ) : (
                                    'Sign In'
                                )}
                            </button>
                        )}
                    </div>

                    <p className={styles.secureText}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        Protected by secure authentication
                    </p>
                </form>
            </div>
        </div>
    );
}
