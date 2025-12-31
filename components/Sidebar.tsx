'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, Truck, Utensils, Box as BoxIcon, Settings, LayoutDashboard, ChevronLeft, ChevronRight, LogOut, Store, History } from 'lucide-react';
import styles from './Sidebar.module.css';
import { logout } from '@/lib/auth-actions';
import { useState } from 'react';

const navItems = [
    { label: 'Client Dashboard', href: '/clients', icon: Users },
    { label: 'My History', href: '/navigator-history', icon: History, role: 'navigator' },
    { label: 'Vendors', href: '/vendors', icon: Store },
    { label: 'Admin Control', href: '/admin', icon: Settings },
];

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
                            backgroundColor: '#1f2937',
                            border: '1px solid #374151',
                            borderRadius: '0.375rem',
                            padding: '0.5rem',
                            marginBottom: '0.5rem',
                            zIndex: 50,
                            minWidth: isCollapsed ? 'max-content' : 'auto'
                        }}>
                            <button
                                onClick={() => logout()}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    width: '100%',
                                    color: '#ef4444',
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
