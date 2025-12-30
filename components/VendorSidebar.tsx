'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Package, ShoppingCart, Settings, LayoutDashboard, ChevronLeft, ChevronRight, LogOut, Store } from 'lucide-react';
import styles from './Sidebar.module.css';
import { logout } from '@/lib/auth-actions';
import { useState } from 'react';

const navItems = [
    { label: 'Dashboard', href: '/vendor', icon: LayoutDashboard },
    { label: 'Orders', href: '/vendor/orders', icon: ShoppingCart },
    { label: 'Menu Items', href: '/vendor/items', icon: Package },
    { label: 'Vendor Details', href: '/vendor/details', icon: Settings },
];

export function VendorSidebar({
    isCollapsed = false,
    toggle,
    userName = 'Vendor',
    userRole = 'vendor'
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
                        <Store className={styles.logoIcon} />
                        <span>Vendor Portal</span>
                    </div>
                )}
                {isCollapsed && (
                    <div className={styles.logoCollapsed}>
                        <Store className={styles.logoIcon} size={24} />
                    </div>
                )}
                <button onClick={toggle} className={styles.toggleBtn}>
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>
            </div>

            <nav className={styles.nav}>
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.href || (item.href !== '/vendor' && pathname.startsWith(item.href));

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
                    {!isCollapsed ? userName : (userName[0] || 'V').toUpperCase()}

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

