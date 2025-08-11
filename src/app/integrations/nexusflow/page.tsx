
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// This page is deprecated and will redirect to /autopilot
export default function NexusFlowPage() {
    const router = useRouter();

    useEffect(() => {
        router.replace('/autopilot');
    }, [router]);

    return null; // Render nothing while redirecting
}
