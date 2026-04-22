'use client';

import React, { useEffect, useState } from 'react';

interface ResponsiveLayoutWrapperProps {
    desktopLayout: React.ReactNode;
    mobileLayout: React.ReactNode;
    loadingFallback?: React.ReactNode;
}

export default function ResponsiveLayoutWrapper({
    desktopLayout,
    mobileLayout,
    loadingFallback,
}: ResponsiveLayoutWrapperProps) {
    const [layout, setLayout] = useState<'mobile' | 'desktop' | null>(null);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(min-width: 768px)');
        const syncLayout = () => {
            setLayout(mediaQuery.matches ? 'desktop' : 'mobile');
        };

        syncLayout();

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', syncLayout);
            return () => mediaQuery.removeEventListener('change', syncLayout);
        }

        mediaQuery.addListener(syncLayout);
        return () => mediaQuery.removeListener(syncLayout);
    }, []);

    if (layout === null) {
        return <>{loadingFallback ?? null}</>;
    }

    return layout === 'mobile' ? <>{mobileLayout}</> : <>{desktopLayout}</>;
}
