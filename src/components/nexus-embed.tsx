'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/providers/auth-provider';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Loader2 } from 'lucide-react';
import { getNexusConfig } from '@/actions/nexus';

export function NexusEmbed() {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { session } = useAuth();
    const user = useCurrentUser();
    const [loading, setLoading] = useState(true);
    const [authPayload, setAuthPayload] = useState<string | null>(null);

    // 1. Prepare Auth Payload (Check for Shared Credentials)
    useEffect(() => {
        async function prepareAuth() {
            if (!user) return;

            try {
                let targetUser = user;

                // If user belongs to a workspace, check for shared credentials.
                // We prioritize activeWorkspaceId from the rich user object.
                const wsId = user.activeWorkspaceId || user.last_active_workspace_id;

                if (wsId) {
                    const config = await getNexusConfig(wsId);

                    if (config && config.email) {
                        console.log('[NexusEmbed] Using Shared Credentials:', config.email);
                        // Create a proxy user identity for the shared account
                        targetUser = {
                            ...user,
                            email: config.email,
                            // We don't overwrite ID to avoid session conflicts, but the email is what triggers the specific user login in Tester
                            // name: config.email.split('@')[0], 
                        };
                    }
                }

                const payload = encodeURIComponent(btoa(JSON.stringify({
                    user: targetUser,
                    session: { ...session, access_token: 'iframe-token' }
                })));
                setAuthPayload(payload);
            } catch (err) {
                console.error('[NexusEmbed] Error preparing auth:', err);
            }
        }
        prepareAuth();
    }, [user, session]);


    // 2. Handle Handshake & PostMessage (Legacy + Backup)
    useEffect(() => {
        const iframe = iframeRef.current;
        if (!iframe || !authPayload) return;

        const sendAuth = () => {
            // For legacy support if the URL param fails or is missing
            // We can still try postMessage, but URL param is primary now.
            // We won't focus heavily on postMessage here as URL is the fix.
        };

        const handleMessage = (event: MessageEvent) => {
            if (event.data.type === 'NEXUS_READY') {
                console.log("Nexus is READY. UI Loaded.");
                setLoading(false);
            }
        };

        window.addEventListener('message', handleMessage);

        // Visual timeout to ensure we don't show loading forever if Nexus loads but doesn't send READY
        // (Since we are using URL auth, it might just load and work)
        const timeout = setTimeout(() => {
            setLoading(false);
        }, 5000);

        return () => {
            window.removeEventListener('message', handleMessage);
            clearTimeout(timeout);
        };
    }, [authPayload]);


    if (!user || !authPayload) {
        return (
            <div className="w-full h-[calc(100vh-20px)] relative rounded-2xl overflow-hidden border border-border shadow-2xl bg-black flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <span className="ml-3 text-lg font-medium text-muted-foreground">Preparing Neural Link...</span>
            </div>
        );
    }

    return (
        <div className="w-full h-[calc(100vh-20px)] relative rounded-2xl overflow-hidden border border-border shadow-2xl bg-black">
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                    <span className="ml-3 text-lg font-medium text-muted-foreground">Connecting to Nexus...</span>
                </div>
            )}
            <iframe
                ref={iframeRef}
                src={`${process.env.NEXT_PUBLIC_NEXUS_URL || "http://localhost:3000"}?auth=${authPayload}`}
                className="w-full h-full border-none bg-background/50"
                allow="clipboard-write"
                title="NexusFlow"
                onLoad={() => {
                    // Fallback: If onload fires, we assume it's loading. 
                    // We wait a bit then remove loader if we haven't received READY yet.
                    setTimeout(() => setLoading(false), 2000);
                }}
            />
        </div>
    );
}
