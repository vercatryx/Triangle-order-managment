'use client';

import { useActionState } from 'react';
import { vendorLogin } from '@/lib/auth-actions';
import styles from '../login/page.module.css';

export default function VendorLoginPage() {
    const [state, action, isPending] = useActionState(vendorLogin, undefined);

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className="text-center">
                    <h2 className={styles.title}>
                        Vendor Portal
                    </h2>
                    <p className={styles.subtitle}>
                        Sign in to access your vendor account
                    </p>
                </div>

                <form className={styles.form} action={action}>
                    <div className={styles.formGroup}>
                        <div>
                            <label htmlFor="email" className={styles.label}>
                                Email
                            </label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                required
                                className={styles.inputLarge}
                                placeholder="Enter your email"
                            />
                        </div>
                        <div style={{ marginTop: '1.5rem' }}>
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
                            />
                        </div>
                    </div>

                    {state?.message && (
                        <div className={styles.errorMessage}>
                            {state.message}
                        </div>
                    )}

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

