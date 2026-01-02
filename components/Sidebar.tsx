'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, Truck, Utensils, Box as BoxIcon, Settings, LayoutDashboard, ChevronLeft, ChevronRight, LogOut, Store, History } from 'lucide-react';
import styles from './Sidebar.module.css';
import { logout } from '@/lib/auth-actions';
import { useState, useEffect } from 'react';

const navItems = [
    { label: 'Client Dashboard', href: '/clients', icon: Users },
    { label: 'My History', href: '/navigator-history', icon: History, role: 'navigator' },
    { label: 'Vendors', href: '/vendors', icon: Store },
    { label: 'Admin Control', href: '/admin', icon: Settings },
];

import { useTime } from '@/lib/time-context';
import { Clock, Edit2, X, Check } from 'lucide-react';

function TimeWidget() {
    const { currentTime, isFakeTime, setFakeTime } = useTime();
    const [isEditing, setIsEditing] = useState(false);

    // Format for datetime-local: YYYY-MM-DDThh:mm
    const formatForInput = (date: Date) => {
        const offset = date.getTimezoneOffset() * 60000;
        const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
        return localISOTime;
    };

    const [inputValue, setInputValue] = useState(formatForInput(currentTime));

    // Sync input when not editing or when time changes naturally (if real time)
    useEffect(() => {
        if (!isEditing) {
            setInputValue(formatForInput(currentTime));
        }
    }, [currentTime, isEditing]);

    const handleSave = () => {
        const date = new Date(inputValue);
        if (!isNaN(date.getTime())) {
            setFakeTime(date);
            setIsEditing(false);
        }
    };

    const handleClear = () => {
        setFakeTime(null);
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <div style={{
                backgroundColor: 'var(--bg-panel)',
                border: '1px solid var(--color-primary)',
                borderRadius: '0.5rem',
                padding: '0.75rem',
                fontSize: '0.85rem',
                color: 'var(--text-primary)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--primary-color)' }}>Set System Time</span>
                    <button onClick={() => setIsEditing(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <X size={14} />
                    </button>
                </div>

                <input
                    type="datetime-local"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    style={{
                        background: 'var(--bg-panel)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-primary)',
                        borderRadius: '0.25rem',
                        padding: '0.25rem',
                        fontSize: '0.8rem',
                        width: '100%'
                    }}
                />

                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '4px' }}>
                    <button
                        onClick={handleSave}
                        style={{
                            flex: 1,
                            backgroundColor: 'var(--primary-color)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.25rem',
                            padding: '0.25rem',
                            fontSize: '0.75rem',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px'
                        }}
                    >
                        <Check size={12} /> Set
                    </button>
                    <button
                        onClick={handleClear}
                        style={{
                            flex: 1,
                            backgroundColor: 'var(--color-danger)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '0.25rem',
                            padding: '0.25rem',
                            fontSize: '0.75rem',
                            cursor: 'pointer'
                        }}
                    >
                        Reset
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            style={{
                backgroundColor: isFakeTime ? 'rgba(220, 38, 38, 0.1)' : 'var(--bg-surface)',
                border: isFakeTime ? '1px solid var(--color-danger)' : '1px solid var(--border-color)',
                borderRadius: '0.5rem',
                padding: '0.75rem',
                fontSize: '0.85rem',
                color: isFakeTime ? 'var(--color-danger)' : 'var(--text-secondary)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative'
            }}
            title="Click to override system time"
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Clock size={14} />
                    <span>{isFakeTime ? 'Fake Time Active' : 'System Time'}</span>
                </div>
                <Edit2 size={12} style={{ opacity: 0.5 }} />
            </div>
            <div style={{ fontSize: '1.1rem', fontWeight: 500, color: isFakeTime ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
            <div style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                {currentTime.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
            </div>
        </div>
    );
}

export function Sidebar({
    isCollapsed = false,
    toggle,
    userName = 'Admin',
    userRole = 'admin'
}: {
    isCollapsed?: boolean;
    toggle?: () => void;
    userName?: string;
    userRole?: string;
}) {
    const pathname = usePathname();
    const [isLogoutVisible, setIsLogoutVisible] = useState(false);
    const { currentTime, isFakeTime } = useTime();

    return (
        <aside
            className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''}`}
        >
            <div className={styles.header}>
                {!isCollapsed && (
                    <div className={styles.logo}>
                        <LayoutDashboard className={styles.logoIcon} />
                        <span>Admin Portal</span>
                    </div>
                )}
                {isCollapsed && (
                    <div className={styles.logoCollapsed}>
                        <LayoutDashboard className={styles.logoIcon} size={24} />
                    </div>
                )}
                <button onClick={toggle} className={styles.toggleBtn}>
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>
            </div>

            <nav className={styles.nav}>
                {navItems.filter(item => {
                    if (item.label === 'Admin Control') {
                        return userRole === 'admin' || userRole === 'super-admin';
                    }
                    if (item.label === 'Vendors') {
                        return userRole === 'admin' || userRole === 'super-admin';
                    }
                    if ((item as any).role) {
                        return userRole === (item as any).role;
                    }
                    return true;
                }).map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname.startsWith(item.href);

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                            title={isCollapsed ? item.label : undefined}
                        >
                            <Icon size={20} />
                            {!isCollapsed && <span>{item.label}</span>}
                        </Link>
                    );
                })}
            </nav>

            {/* Time Display Widget */}
            <div style={{
                padding: '0 1rem',
                marginTop: 'auto',
                marginBottom: '1rem',
                display: isCollapsed ? 'none' : 'block'
            }}>
                <TimeWidget />
            </div>

            <div className={styles.footer}>
                <div
                    className={`${isCollapsed ? styles.userCollapsed : styles.user} cursor-pointer`}
                    onClick={() => setIsLogoutVisible(!isLogoutVisible)}
                    style={{ cursor: 'pointer', position: 'relative' }}
                >
                    {!isCollapsed ? userName : (userName[0] || 'A').toUpperCase()}

                    {isLogoutVisible && (
                        <div style={{
                            position: 'absolute',
                            bottom: '100%',
                            left: '0',
                            width: '100%',
                            backgroundColor: 'var(--bg-panel)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '0.375rem',
                            padding: '0.5rem',
                            marginBottom: '0.5rem',
                            zIndex: 50,
                            minWidth: isCollapsed ? 'max-content' : 'auto',
                            boxShadow: 'var(--shadow-md)'
                        }}>
                            <button
                                onClick={() => logout()}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    width: '100%',
                                    color: 'var(--color-danger)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontSize: '0.875rem',
                                    padding: '0.25rem'
                                }}
                            >
                                <LogOut size={16} />
                                <span>Log Out</span>
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
}
