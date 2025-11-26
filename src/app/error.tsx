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
        console.error('[AppError] Uncaught error:', error);
    }, [error]);

    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-4">
            <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-6 w-6" />
                <h2 className="text-xl font-bold">Algo deu errado!</h2>
            </div>
            <p className="text-muted-foreground text-center">
                Não foi possível carregar esta seção.
            </p>
            {error.digest && (
                <p className="text-xs text-muted-foreground">Code: {error.digest}</p>
            )}
            <Button onClick={() => reset()}>Tentar novamente</Button>
        </div>
    );
}
