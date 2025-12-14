'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[InboxError] Uncaught error:', error);
    }, [error]);

    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-4 bg-black/20 backdrop-blur-xl">
            <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-6 w-6" />
                <h2 className="text-xl font-bold">Erro no Inbox</h2>
            </div>
            <p className="text-muted-foreground text-center max-w-md">
                Ocorreu um problema ao carregar suas conversas. Isso pode acontecer devido a uma atualização do sistema.
            </p>
            {error.digest && (
                <p className="text-xs text-muted-foreground">Code: {error.digest}</p>
            )}
            <div className="flex gap-2">
                <Button onClick={() => reset()}>Tentar novamente</Button>
                <Button variant="outline" onClick={() => window.location.reload()}>
                    Recarregar Página
                </Button>
                <Button variant="ghost" className='text-white/50 hover:text-white' onClick={() => window.open('/status', '_blank')}>
                    Verificar Status
                </Button>
            </div>
        </div>
    );
}
