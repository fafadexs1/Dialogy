'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Loader2 } from 'lucide-react';
import { createNexusAuthPayload, getNexusUrl } from '@/actions/nexus';

const NEXUS_READY_TIMEOUT_MS = 7000;
const MAX_BOOT_RETRIES = 1;

export function NexusEmbed({ nexusUrl: propNexusUrl }: { nexusUrl?: string }) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const user = useCurrentUser();
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [authPayload, setAuthPayload] = useState<string | null>(null);
    const [nexusUrl, setNexusUrl] = useState<string>((propNexusUrl || '').trim());
    const [bootRetry, setBootRetry] = useState(0);
    const readyRef = useRef(false);
    const requestIdRef = useRef(0);

    useEffect(() => {
        if (!propNexusUrl) return;
        setNexusUrl(propNexusUrl.trim());
    }, [propNexusUrl]);

    const workspaceId = user?.activeWorkspaceId || user?.last_active_workspace_id || null;

    useEffect(() => {
        // Reset lifecycle whenever workspace changes.
        readyRef.current = false;
        setAuthPayload(null);
        setErrorMessage(null);
        setBootRetry(0);
        setLoading(Boolean(workspaceId));
    }, [workspaceId]);

    useEffect(() => {
        if (!workspaceId) {
            setLoading(false);
            return;
        }

        let cancelled = false;
        const currentRequestId = ++requestIdRef.current;

        (async () => {
            try {
                setErrorMessage(null);
                setLoading(true);
                readyRef.current = false;

                let resolvedUrl = nexusUrl;
                if (!resolvedUrl) {
                    resolvedUrl = (await getNexusUrl()).trim();
                    if (!resolvedUrl) {
                        throw new Error('URL do NexusFlow nao configurada.');
                    }
                    if (!cancelled && currentRequestId === requestIdRef.current) {
                        setNexusUrl(resolvedUrl);
                    }
                }

                const sso = await createNexusAuthPayload(workspaceId);
                if (cancelled || currentRequestId !== requestIdRef.current) return;

                if (!sso.success || !sso.authPayload) {
                    throw new Error(sso.error || 'Falha ao preparar autenticacao segura do NexusFlow.');
                }

                setAuthPayload(sso.authPayload);
            } catch (err) {
                if (cancelled || currentRequestId !== requestIdRef.current) return;
                console.error('[NexusEmbed] Error preparing auth:', err);
                setErrorMessage('Nao foi possivel autenticar com seguranca no NexusFlow para este workspace.');
                setAuthPayload(null);
                setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [workspaceId, bootRetry]);

    useEffect(() => {
        if (!authPayload || !nexusUrl) return;

        let nexusOrigin = '';
        try {
            nexusOrigin = new URL(nexusUrl).origin;
        } catch {
            nexusOrigin = '';
        }

        const handleMessage = (event: MessageEvent) => {
            if (nexusOrigin && event.origin !== nexusOrigin) return;
            if (event.data?.type === 'NEXUS_READY') {
                console.log('[NexusEmbed] Nexus is READY.');
                readyRef.current = true;
                setLoading(false);
                setErrorMessage(null);
            }
        };

        window.addEventListener('message', handleMessage);

        const timeout = setTimeout(() => {
            if (readyRef.current) return;

            if (bootRetry < MAX_BOOT_RETRIES) {
                console.warn(`[NexusEmbed] Timeout waiting for NEXUS_READY. Retrying bootstrap (${bootRetry + 1}/${MAX_BOOT_RETRIES})...`);
                setBootRetry((prev) => prev + 1);
                return;
            }

            setLoading(false);
            setErrorMessage('Nao foi possivel concluir a conexao inicial com o NexusFlow. Tente recarregar a pagina.');
        }, NEXUS_READY_TIMEOUT_MS);

        return () => {
            window.removeEventListener('message', handleMessage);
            clearTimeout(timeout);
        };
    }, [authPayload, nexusUrl, bootRetry]);

    const iframeSrc = useMemo(() => {
        if (!authPayload || !nexusUrl) return '';
        const separator = nexusUrl.includes('?') ? '&' : '?';
        return `${nexusUrl}${separator}auth=${authPayload}&dialogy_boot=${bootRetry}`;
    }, [authPayload, nexusUrl, bootRetry]);

    if (!user || !authPayload || !nexusUrl) {
        return (
            <div className="w-full h-[calc(100vh-20px)] relative rounded-2xl overflow-hidden border border-border shadow-2xl bg-black flex items-center justify-center">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <span className="ml-3 text-lg font-medium text-muted-foreground">
                    {errorMessage || (bootRetry > 0 ? 'Retrying secure link...' : 'Preparing Neural Link...')}
                </span>
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
                src={iframeSrc}
                className="w-full h-full border-none bg-background/50"
                allow="clipboard-write"
                title="NexusFlow"
            />
        </div>
    );
}
