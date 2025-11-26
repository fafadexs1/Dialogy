'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error('[GlobalError] Uncaught error:', error);
    }, [error]);

    return (
        <html>
            <body>
                <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background p-4 text-foreground">
                    <h2 className="text-2xl font-bold">Algo deu errado!</h2>
                    <p className="text-muted-foreground">
                        Ocorreu um erro crítico. Por favor, recarregue a página.
                    </p>
                    {error.digest && (
                        <p className="text-xs text-muted-foreground">Error ID: {error.digest}</p>
                    )}
                    <div className="flex gap-2">
                        <Button onClick={() => reset()}>Tentar novamente</Button>
                        <Button variant="outline" onClick={() => window.location.reload()}>
                            Recarregar Página
                        </Button>
                    </div>
                </div>
            </body>
        </html>
    );
}
