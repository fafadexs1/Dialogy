'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { joinWorkspaceAction } from '@/actions/invites';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface JoinFormProps {
    inviteCode: string;
}

export function JoinForm({ inviteCode }: JoinFormProps) {
    const [state, formAction, isPending] = useActionState(joinWorkspaceAction, { success: false, error: null });

    return (
        <div className="w-full space-y-4">
            {state.error && (
                <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Erro ao entrar</AlertTitle>
                    <AlertDescription>{state.error}</AlertDescription>
                </Alert>
            )}

            <form action={formAction} className="w-full">
                <input type="hidden" name="inviteCode" value={inviteCode} />
                <Button
                    type="submit"
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20"
                    disabled={isPending}
                >
                    {isPending ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Entrando...
                        </>
                    ) : (
                        <>
                            Aceitar Convite e Entrar
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </>
                    )}
                </Button>
            </form>
        </div>
    );
}
