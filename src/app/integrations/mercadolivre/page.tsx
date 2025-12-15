'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Loader2, Store, Plus, Trash2, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getMercadoLivreAccounts, unlinkMercadoLivreAccount } from '@/actions/mercadolivre';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

interface MLAccount {
    id: string;
    nickname: string;
    user_id: number;
    created_at: string;
}

export default function MercadoLivreIntegrationPage() {
    const [accounts, setAccounts] = useState<MLAccount[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isConnecting, setIsConnecting] = useState(false);
    const { toast } = useToast();

    const fetchAccounts = async () => {
        setIsLoading(true);
        try {
            // We assume this action will be created, initially returning empty
            const res = await getMercadoLivreAccounts();
            if (res.success && res.accounts) {
                setAccounts(res.accounts);
            } else {
                // Silently fail or show empty state
                setAccounts([]);
            }
        } catch (error) {
            console.error('Failed to fetch ML accounts', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchAccounts();
    }, []);

    const handleConnect = () => {
        setIsConnecting(true);
        // Redirect to our backend auth route which handles the OAuth redirection
        window.location.href = '/api/integrations/mercadolivre/auth';
    };

    const handleUnlink = async (id: string) => {
        try {
            await unlinkMercadoLivreAccount(id);
            toast({ title: 'Conta desconectada' });
            fetchAccounts();
        } catch (error) {
            toast({ title: 'Erro ao desconectar', variant: 'destructive' });
        }
    };

    return (
        <div className="container max-w-4xl py-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Integração Mercado Livre</h1>
                    <p className="text-muted-foreground mt-2">
                        Conecte suas contas do Mercado Livre para centralizar perguntas e mensagens.
                    </p>
                </div>
                <Button onClick={handleConnect} disabled={isConnecting} className="bg-[#FFE600] text-black hover:bg-[#FFE600]/90">
                    {isConnecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                    Conectar Nova Conta
                </Button>
            </div>

            <div className="grid gap-6">
                {isLoading ? (
                    <div className="flex justify-center py-10">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : accounts.length === 0 ? (
                    <Card className="border-dashed border-2">
                        <CardHeader className="text-center pb-10 pt-10">
                            <div className="mx-auto bg-[#FFE600]/20 p-4 rounded-full mb-4 w-fit">
                                <Store className="h-8 w-8 text-[#B18C00]" />
                            </div>
                            <CardTitle>Nenhuma conta conectada</CardTitle>
                            <CardDescription className="max-w-md mx-auto mt-2">
                                Comece conectando sua loja oficial ou conta de vendedor do Mercado Livre para receber perguntas em tempo real.
                            </CardDescription>
                            <div className="mt-6 flex justify-center">
                                <Button onClick={handleConnect} variant="outline">
                                    Conectar Agora
                                </Button>
                            </div>
                        </CardHeader>
                    </Card>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {accounts.map((account) => (
                            <Card key={account.id} className="overflow-hidden">
                                <CardHeader className="flex flex-row items-center gap-4 bg-secondary/30 pb-4">
                                    <Avatar className="h-12 w-12 border-2 border-white/10">
                                        <AvatarFallback className="bg-[#FFE600] text-black font-bold">
                                            {account.nickname.substring(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1">
                                        <CardTitle className="text-lg">{account.nickname}</CardTitle>
                                        <CardDescription>ID: {account.user_id}</CardDescription>
                                    </div>
                                    <Badge variant="secondary" className="bg-green-500/10 text-green-500 hover:bg-green-500/20">
                                        Ativo
                                    </Badge>
                                </CardHeader>
                                <CardContent className="pt-6">
                                    <div className="flex items-center text-sm text-muted-foreground mb-2">
                                        <Store className="mr-2 h-4 w-4" />
                                        Conta Vendedor
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Conectado em: {new Date(account.created_at).toLocaleDateString()}
                                    </p>
                                </CardContent>
                                <CardFooter className="bg-secondary/10 flex justify-between items-center py-3">
                                    <Button variant="link" size="sm" className="text-muted-foreground h-auto p-0">
                                        Ver no Mercado Livre <ExternalLink className="ml-1 h-3 w-3" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
                                        onClick={() => handleUnlink(account.id)}
                                    >
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Desconectar
                                    </Button>
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            <Alert className="bg-blue-950/30 border-blue-900 text-blue-200">
                <AlertTitle>Configuração Necessária</AlertTitle>
                <AlertDescription>
                    Certifique-se de que sua aplicação no Mercado Livre tem a Redirect URI configurada para:
                    <code className="bg-black/30 px-1 py-0.5 rounded ml-1 text-xs">{typeof window !== 'undefined' ? `${window.location.origin}/api/integrations/mercadolivre/callback` : '/api/integrations/mercadolivre/callback'}</code>
                </AlertDescription>
            </Alert>
        </div>
    );
}
