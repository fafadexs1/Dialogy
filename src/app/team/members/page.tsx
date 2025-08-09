
'use client';

import React from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import { useAuth } from '@/hooks/use-auth';
import { Loader2, ShieldAlert, MoreVertical, Edit, UserX, UserCheck, DollarSign, BarChart } from 'lucide-react';
import { agents as mockAgents } from '@/lib/mock-data';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

export default function ManageMembersPage() {
    const user = useAuth();
    // In a real application, these members would be fetched based on the active workspace
    const members = mockAgents;

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
                    <h1 className="text-2xl font-bold flex items-center gap-2"><ShieldAlert /> Gerenciar Membros</h1>
                    <p className="text-muted-foreground">Gerencie os membros do seu workspace, suas permissões e status.</p>
                </header>
                <main className="flex-1 overflow-y-auto bg-muted/40 p-4 sm:p-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Membros do Workspace</CardTitle>
                            <CardDescription>
                                Total de {members.length} membros no workspace: <span className='font-semibold'>{user.workspaces?.find(ws => ws.id === user.activeWorkspaceId)?.name || ''}</span>
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className='w-[35%]'>Membro</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Função</TableHead>
                                        <TableHead>Membro Desde</TableHead>
                                        <TableHead>Uso do Gemini (Mês)</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {members.map((member) => (
                                        <TableRow key={member.id}>
                                            <TableCell>
                                                <div className="flex items-center gap-3">
                                                    <Avatar>
                                                        <AvatarImage src={member.avatar} alt={member.name} />
                                                        <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                                                    </Avatar>
                                                    <div>
                                                        <p className="font-medium">{member.name}</p>
                                                        <p className="text-sm text-muted-foreground">{member.email}</p>
                                                    </div>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={member.online ? 'default' : 'secondary'} className={member.online ? 'bg-green-500/20 text-green-700 border-transparent' : ''}>
                                                    {member.online ? 'Online' : 'Offline'}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant="outline">Membro</Badge>
                                            </TableCell>
                                            <TableCell>
                                                <span className="text-sm text-muted-foreground">{member.memberSince || 'N/A'}</span>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1 font-medium text-muted-foreground">
                                                  <DollarSign className="h-4 w-4 text-green-500" />
                                                  <span>
                                                    {(member.geminiUsage || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                                  </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon">
                                                            <MoreVertical className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem disabled>
                                                            <Edit className="mr-2 h-4 w-4" />
                                                            Editar Função
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem disabled>
                                                            <BarChart className="mr-2 h-4 w-4" />
                                                            Ver Histórico de Uso
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem disabled>
                                                            <UserCheck className="mr-2 h-4 w-4" />
                                                            Advertir Membro
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive">
                                                            <UserX className="mr-2 h-4 w-4" />
                                                            Remover do Workspace
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </main>
            </div>
        </MainLayout>
    )
}
