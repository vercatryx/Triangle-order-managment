'use client';

import { useState } from 'react';
import styles from './Admin.module.css';
import { StatusManagement } from '@/components/admin/StatusManagement';
import { VendorManagement } from '@/components/admin/VendorManagement';
import { MenuManagement } from '@/components/admin/MenuManagement';
import { BoxCategoriesManagement } from '@/components/admin/BoxCategoriesManagement';
import { NavigatorManagement } from '@/components/admin/NavigatorManagement';
import { AdminManagement } from '@/components/admin/AdminManagement';

import { GlobalSettings } from '@/components/admin/GlobalSettings';

type Tab = 'vendors' | 'menus' | 'statuses' | 'boxes' | 'navigators' | 'settings' | 'admins';

export default function AdminPage() {
    const [activeTab, setActiveTab] = useState<Tab>('admins');

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.title}>Admin Control Panel</h1>
                <p className={styles.subtitle}>Manage global configurations and resources.</p>
            </header>

            <div className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'menus' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('menus')}
                >
                    Menus
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'boxes' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('boxes')}
                >
                    Box Categories
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'vendors' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('vendors')}
                >
                    Vendors
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'navigators' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('navigators')}
                >
                    Navigators
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'statuses' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('statuses')}
                >
                    Statuses
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'settings' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'admins' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('admins')}
                >
                    Admins
                </button>
            </div>

            <div className={styles.content}>
                {activeTab === 'menus' && <MenuManagement />}
                {activeTab === 'boxes' && <BoxCategoriesManagement />}

                {activeTab === 'vendors' && <VendorManagement />}
                {activeTab === 'navigators' && <NavigatorManagement />}
                {activeTab === 'statuses' && <StatusManagement />}
                {activeTab === 'settings' && <GlobalSettings />}
                {activeTab === 'admins' && <AdminManagement />}
            </div>
        </div>
    );
}
