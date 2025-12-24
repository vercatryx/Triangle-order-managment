'use client';

import { useActionState } from 'react';
import { login } from '@/lib/auth-actions';
import styles from './page.module.css';

export default function LoginPage() {
    const [state, action, isPending] = useActionState(login, undefined);

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className="text-center">
                    <h2 className={styles.title}>
                        Welcome Back
                    </h2>
                    <p className={styles.subtitle}>
                        Sign in to access your account
                    </p>
                </div>

                <form className={styles.form} action={action}>
                    <div className={styles.formGroup}>
                        <div>
                            <label htmlFor="username" className={styles.label}>
                                Username
                            </label>
                            <input
                                id="username"
                                name="username"
                                type="text"
                                required
                                className={styles.inputLarge}
                                placeholder="Enter your username"
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
