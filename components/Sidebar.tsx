'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, Truck, Utensils, Box as BoxIcon, Settings, LayoutDashboard } from 'lucide-react';
import styles from './Sidebar.module.css';

const navItems = [
    { label: 'Client Dashboard', href: '/clients', icon: Users },
    { label: 'Admin Control', href: '/admin', icon: Settings },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <aside className={styles.sidebar}>
            <div className={styles.logo}>
                <LayoutDashboard className={styles.logoIcon} />
                <span>Admin Portal</span>
            </div>

            <nav className={styles.nav}>
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname.startsWith(item.href);

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`${styles.navItem} ${isActive ? styles.active : ''}`}
                        >
                            <Icon size={20} />
                            <span>{item.label}</span>
                        </Link>
                    );
                })}
            </nav>

            <div className={styles.footer}>
                <div className={styles.user}>Admin User</div>
            </div>
        </aside>
    );
}
