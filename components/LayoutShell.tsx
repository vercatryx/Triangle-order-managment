'use client';

import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { usePathname } from 'next/navigation';

export function LayoutShell({ children, userName, userRole }: { children: React.ReactNode, userName?: string, userRole?: string }) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const pathname = usePathname();

    if (pathname === '/login') {
        return <>{children}</>;
    }

    // Width constants
    const SIDEBAR_WIDTH = 260;
    const SIDEBAR_COLLAPSED_WIDTH = 80;
    const currentSidebarWidth = isCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;

    return (
        <div style={{ display: 'flex', minHeight: '100vh' }}>
            <Sidebar
                isCollapsed={isCollapsed}
                toggle={() => setIsCollapsed(!isCollapsed)}
                userName={userName}
                userRole={userRole}
            />

            <main style={{
                flex: 1,
                marginLeft: `${currentSidebarWidth}px`,
                padding: '2rem 20px 0 20px',
                backgroundColor: 'var(--bg-app)',
                transition: 'margin-left 0.3s ease',
                // Fix horizontal scroll: ensure main container clips overflow
                // but allows vertical scroll.
                // However, we want the PAGE to scroll vertically, so we just need
                // to prevent horizontal overflow spilling out of this container.
                overflowX: 'hidden',
                minWidth: 0, // Critical for flex children to shrink below content size
                display: 'flex',
                flexDirection: 'column'
            }}>
                {children}
            </main>
        </div>
    );
}
