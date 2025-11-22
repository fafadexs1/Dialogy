

'use client';
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Redirect from the base /settings route to the default profile page.
export default function SettingsPage() {
    const router = useRouter();
    useEffect(() => {
        router.replace('/settings/profile');
    }, [router]);
    
    return null;
}
