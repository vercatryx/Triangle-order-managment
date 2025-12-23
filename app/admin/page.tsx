'use client';

import { useState } from 'react';
import styles from './Admin.module.css';
import { StatusManagement } from '@/components/admin/StatusManagement';
import { VendorManagement } from '@/components/admin/VendorManagement';
import { MenuManagement } from '@/components/admin/MenuManagement';
import { BoxTypeManagement } from '@/components/admin/BoxTypeManagement';
import { NavigatorManagement } from '@/components/admin/NavigatorManagement';
import { GlobalSettings } from '@/components/admin/GlobalSettings';

type Tab = 'vendors' | 'menus' | 'statuses' | 'boxes' | 'navigators' | 'settings';

export default function AdminPage() {
    const [activeTab, setActiveTab] = useState<Tab>('statuses');

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.title}>Admin Control Panel</h1>
                <p className={styles.subtitle}>Manage global configurations and resources.</p>
            </header>

            <div className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'vendors' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('vendors')}
                >
                    Vendors
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'menus' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('menus')}
                >
                    Menus
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'statuses' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('statuses')}
                >
                    Statuses
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'boxes' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('boxes')}
                >
                    Box Types
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'navigators' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('navigators')}
                >
                    Navigators
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'settings' ? styles.activeTab : ''}`}
                    onClick={() => setActiveTab('settings')}
                >
                    Settings
                </button>
            </div>

            <div className={styles.content}>
                {activeTab === 'statuses' && <StatusManagement />}
                {activeTab === 'vendors' && <VendorManagement />}
                {activeTab === 'menus' && <MenuManagement />}
                {activeTab === 'boxes' && <BoxTypeManagement />}
                {activeTab === 'navigators' && <NavigatorManagement />}
                {activeTab === 'settings' && <GlobalSettings />}
            </div>
        </div>
    );
}
