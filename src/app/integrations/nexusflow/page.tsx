'use client';

import { useActionState, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, Lock, Save } from 'lucide-react';
import { useCurrentUser } from '@/hooks/use-online-status';
import { getNexusConfig, updateNexusConfigAction } from '@/actions/nexus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFormStatus } from 'react-dom';

type NexusConfig = {
    mode?: 'workspace_managed' | 'existing_account';
    email?: string;
    username?: string;
    autoProvisioned?: boolean;
    nexusUserId?: string;
    createdAt?: string;
    updatedAt?: string;
} | null;

type ActionState = {
    success: boolean;
    error: string | null;
    config: NexusConfig;
};

const initialActionState: ActionState = {
    success: false,
    error: null,
    config: null,
};

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending} className="min-w-[170px]">
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {pending ? 'Salvando...' : 'Salvar Integracao'}
        </Button>
    );
}

export default function NexusFlowIntegrationPage() {
    const user = useCurrentUser();
    const [config, setConfig] = useState<NexusConfig>(null);
    const [isFetching, setIsFetching] = useState(true);
    const [mode, setMode] = useState<'workspace_managed' | 'existing_account'>('workspace_managed');
    const [existingEmail, setExistingEmail] = useState('');
    const [existingPassword, setExistingPassword] = useState('');
    const [state, formAction] = useActionState(updateNexusConfigAction, initialActionState);

    useEffect(() => {
        if (!user?.activeWorkspaceId) {
            setIsFetching(false);
            return;
        }

        setIsFetching(true);
        getNexusConfig(user.activeWorkspaceId)
            .then((cfg) => {
                setConfig(cfg);
                setMode(cfg?.mode === 'existing_account' ? 'existing_account' : 'workspace_managed');
                setExistingEmail(cfg?.mode === 'existing_account' ? (cfg.email || '') : '');
                setExistingPassword('');
            })
            .finally(() => {
                setIsFetching(false);
            });
    }, [user?.activeWorkspaceId]);

    useEffect(() => {
        if (!state.success || !state.config) return;
        setConfig(state.config);
        setMode(state.config.mode === 'existing_account' ? 'existing_account' : 'workspace_managed');
        setExistingEmail(state.config.mode === 'existing_account' ? (state.config.email || '') : '');
        setExistingPassword('');
    }, [state]);

    if (!user || isFetching) {
        return (
            <div className="flex h-64 w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!user.activeWorkspaceId) {
        return (
            <div className="p-8 text-center text-muted-foreground">
                Selecione um workspace para visualizar a integracao.
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto space-y-8 py-8">
            <header>
                <h1 className="text-3xl font-bold tracking-tight">Integracao NexusFlow</h1>
                <p className="text-muted-foreground mt-2 text-lg">
                    Padrão automatico por workspace, com opcao segura de vincular conta existente.
                </p>
            </header>

            <Card className="border-none shadow-sm bg-card/50 ring-1 ring-purple-500/10">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                        <Lock className="h-5 w-5" />
                        Conta Compartilhada do Workspace
                    </CardTitle>
                    <CardDescription>
                        A escolha fica salva no workspace. No modo de conta existente, o Dialogy valida email + senha no ato do vinculo e nao armazena a senha.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <form action={formAction} className="space-y-6">
                        <input type="hidden" name="workspaceId" value={user.activeWorkspaceId} />
                        <input type="hidden" name="mode" value={mode} />

                        <div className="space-y-3">
                            <Label>Modo de conexao</Label>
                            <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                                <input
                                    type="radio"
                                    checked={mode === 'workspace_managed'}
                                    onChange={() => setMode('workspace_managed')}
                                />
                                <span className="text-sm">
                                    <strong>Conta automatica do workspace</strong><br />
                                    O Dialogy cria e reutiliza sempre a mesma conta tecnica para este workspace.
                                </span>
                            </label>
                            <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                                <input
                                    type="radio"
                                    checked={mode === 'existing_account'}
                                    onChange={() => setMode('existing_account')}
                                />
                                <span className="text-sm">
                                    <strong>Vincular conta existente</strong><br />
                                    Usa um usuario NexusFlow ja existente, validado por senha, e nao cria novo automaticamente.
                                </span>
                            </label>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="existingEmail">E-mail da conta existente</Label>
                            <Input
                                id="existingEmail"
                                name="existingEmail"
                                type="email"
                                value={existingEmail}
                                onChange={(e) => setExistingEmail(e.target.value)}
                                placeholder="exemplo@empresa.com"
                                disabled={mode !== 'existing_account'}
                            />
                            <p className="text-xs text-muted-foreground">
                                Obrigatorio somente no modo "Vincular conta existente".
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="existingPassword">Senha da conta existente</Label>
                            <Input
                                id="existingPassword"
                                name="existingPassword"
                                type="password"
                                value={existingPassword}
                                onChange={(e) => setExistingPassword(e.target.value)}
                                placeholder="Digite a senha para validar o vinculo"
                                disabled={mode !== 'existing_account'}
                                autoComplete="new-password"
                            />
                            <p className="text-xs text-muted-foreground">
                                Usada apenas para validacao do vinculo. A senha nao e salva no Dialogy.
                            </p>
                        </div>

                        {state.error && (
                            <p className="text-sm text-red-500">{state.error}</p>
                        )}

                        {state.success && !state.error && (
                            <p className="text-sm text-emerald-600">Configuracao NexusFlow atualizada com sucesso.</p>
                        )}

                        <div className="pt-2">
                            <SubmitButton />
                        </div>
                    </form>

                    <div className="space-y-2">
                        <Label>Identidade ativa no workspace</Label>
                        <div className="max-w-2xl rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all">
                            {config?.email || 'Ainda nao provisionada.'}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>Usuario</Label>
                        <div className="max-w-2xl rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all">
                            {config?.username || '-'}
                        </div>
                    </div>

                    <p className="text-sm text-muted-foreground">
                        Modo atual: {config?.mode === 'existing_account' ? 'Conta existente vinculada' : 'Conta automatica do workspace'}.
                    </p>
                    {config?.mode === 'existing_account' && config?.nexusUserId && (
                        <p className="text-xs text-muted-foreground">
                            ID da conta vinculada no NexusFlow: <span className="font-mono">{config.nexusUserId}</span>
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
