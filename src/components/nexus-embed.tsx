'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { createNexusAuthPayload, getNexusUrl } from '@/actions/nexus';

const NEXUS_LOAD_TIMEOUT_MS = 15000;

export function NexusEmbed({ nexusUrl: propNexusUrl }: { nexusUrl?: string }) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const user = useCurrentUser();
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [authPayload, setAuthPayload] = useState<string | null>(null);
    const [nexusUrl, setNexusUrl] = useState<string>((propNexusUrl || '').trim());
    const [isFullscreen, setIsFullscreen] = useState(false);
    const readyRef = useRef(false);
    const frameLoadedRef = useRef(false);
    const requestIdRef = useRef(0);

    useEffect(() => {
        if (!propNexusUrl) return;
        setNexusUrl(propNexusUrl.trim());
    }, [propNexusUrl]);

    const workspaceId = user?.activeWorkspaceId || user?.last_active_workspace_id || null;

    useEffect(() => {
        // Reset lifecycle whenever workspace changes.
        readyRef.current = false;
        frameLoadedRef.current = false;
        setAuthPayload(null);
        setErrorMessage(null);
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
    }, [workspaceId, nexusUrl]);

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

        const timeout = window.setTimeout(() => {
            if (readyRef.current || frameLoadedRef.current) return;
            setLoading(false);
            setErrorMessage('O NexusFlow demorou mais que o esperado para responder. Tente recarregar a pagina.');
        }, NEXUS_LOAD_TIMEOUT_MS);

        return () => {
            window.removeEventListener('message', handleMessage);
            clearTimeout(timeout);
        };
    }, [authPayload, nexusUrl]);

    const iframeSrc = useMemo(() => {
        if (!authPayload || !nexusUrl) return '';
        const separator = nexusUrl.includes('?') ? '&' : '?';
        return `${nexusUrl}${separator}auth=${authPayload}`;
    }, [authPayload, nexusUrl]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === containerRef.current);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullscreen = useCallback(async () => {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await containerRef.current?.requestFullscreen();
            }
        } catch (error) {
            console.error('[NexusEmbed] Fullscreen request failed:', error);
        }
    }, []);

    if (!user || !authPayload || !nexusUrl) {
        return (
            <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden bg-black">
                <Loader2 className="w-10 h-10 animate-spin text-primary" />
                <span className="ml-3 text-lg font-medium text-muted-foreground">
                    {errorMessage || 'Preparando conexao segura...'}
                </span>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="group relative h-full min-h-0 w-full overflow-hidden bg-black">
            {loading && (
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-1 overflow-hidden bg-background/30">
                    <span className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                    <span className="sr-only">Conectando ao NexusFlow</span>
                </div>
            )}
            {errorMessage && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95">
                    <Loader2 className="w-10 h-10 animate-spin text-primary" />
                    <span className="ml-3 text-lg font-medium text-muted-foreground">{errorMessage}</span>
                </div>
            )}
            <button
                type="button"
                onClick={toggleFullscreen}
                className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-black/65 text-white opacity-0 shadow-lg backdrop-blur transition hover:bg-black/85 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary group-hover:opacity-100"
                aria-label={isFullscreen ? 'Sair da tela cheia' : 'Abrir em tela cheia'}
                title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            >
                {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>
            <iframe
                ref={iframeRef}
                src={iframeSrc}
                className="w-full h-full border-none bg-background/50"
                allow="clipboard-read; clipboard-write; fullscreen"
                allowFullScreen
                onLoad={() => {
                    frameLoadedRef.current = true;
                    setLoading(false);
                }}
                title="NexusFlow"
            />
        </div>
    );
}
