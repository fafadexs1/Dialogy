
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Redirect from the base /superadmin route to the default billing page.
export default function SuperAdminPage() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/superadmin/billing');
    }, [router]);
    
    return null;
}

    