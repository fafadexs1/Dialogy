'use client';

import React, { useEffect, useState } from 'react';

interface ResponsiveLayoutWrapperProps {
    children: React.ReactNode; // This will now be just ONE layout passed from server
    desktopLayout: React.ReactNode;
    mobileLayout: React.ReactNode;
    defaultLayout: 'mobile' | 'desktop';
}

export default function ResponsiveLayoutWrapper({
    desktopLayout,
    mobileLayout,
    defaultLayout,
}: ResponsiveLayoutWrapperProps) {
    const [layout, setLayout] = useState<'mobile' | 'desktop'>(defaultLayout);
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);

        // Check if the server guess matches the actual viewport
        const checkViewport = () => {
            const isMobileViewport = window.innerWidth < 768; // Tailwind 'md' breakpoint
            const actualLayout = isMobileViewport ? 'mobile' : 'desktop';

            if (actualLayout !== layout) {
                console.log('[LAYOUT] Viewport mismatch detected. Switching layout to:', actualLayout);
                setLayout(actualLayout);
            }
        };

        checkViewport();

        const resizeHandler = () => {
            checkViewport();
        };

        window.addEventListener('resize', resizeHandler);
        return () => window.removeEventListener('resize', resizeHandler);
    }, [layout]);

    // Before hydration (SSR), render the default layout chosen by server
    if (!isMounted) {
        return defaultLayout === 'mobile' ? <>{mobileLayout}</> : <>{desktopLayout}</>;
    }

    // After hydration, match viewport
    return layout === 'mobile' ? <>{mobileLayout}</> : <>{desktopLayout}</>;
}
