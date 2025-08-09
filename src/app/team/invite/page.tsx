
'use client';

import { MainLayout } from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { Loader2, Mail, UserPlus } from 'lucide-react';


export default function InviteMemberPage() {
    const user = useAuth();
    
    if (!user) {
        return (
            <MainLayout>
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                </div>
            </MainLayout>
        )
    }

    return (
        <MainLayout user={user}>
             <div className="flex flex-col flex-1 h-full">
                <header className="p-4 sm:p-6 border-b flex-shrink-0 bg-background">
                    <h1 className="text-2xl font-bold flex items-center gap-2"><UserPlus /> Convidar Membros</h1>
                    <p className="text-muted-foreground">Adicione novos membros ao seu workspace: <span className='font-semibold'>{user.workspaces?.find(ws => ws.id === user.activeWorkspaceId)?.name || ''}</span></p>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6 flex items-center justify-center">
                    <Card className="w-full max-w-lg">
                        <CardHeader>
                            <CardTitle>Enviar Convite</CardTitle>
                            <CardDescription>O membro receberá um e-mail com instruções para acessar o workspace.</CardDescription>
                        </CardHeader>
                        <CardContent className='space-y-4'>
                            <div className="space-y-2">
                                <Label htmlFor="email">E-mail do Convidado</Label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input id="email" type="email" placeholder="nome@empresa.com" className="pl-10" />
                                </div>
                            </div>
                             <div className="space-y-2">
                                <Label htmlFor="role">Função (Role)</Label>
                                <Select defaultValue="membro">
                                    <SelectTrigger id="role">
                                        <SelectValue placeholder="Selecione uma função" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="membro">Membro</SelectItem>
                                        <SelectItem value="admin" disabled>Administrador (em breve)</SelectItem>
                                    </SelectContent>
                                </Select>
                                <p className='text-xs text-muted-foreground'>Membros podem visualizar e gerenciar conversas e contatos. Não podem alterar configurações do workspace.</p>
                            </div>
                        </CardContent>
                        <CardFooter>
                            <Button className='w-full'>
                                <Send className='mr-2 h-4 w-4' />
                                Enviar Convite
                            </Button>
                        </CardFooter>
                    </Card>
                </main>
            </div>
        </MainLayout>
    )
}
