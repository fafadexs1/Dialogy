
'use client';

import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Save, Loader2, ShieldAlert, User as UserIcon, Settings } from "lucide-react";
import { useCurrentUser } from '@/hooks/use-online-status';
import { saveSGPGlobalConfig, saveSGPUserConfig, getSGPConfig, getCRMFields, getTeams } from '../actions';
import { SGPGlobalConfig, SGPUserConfig } from '../types';
import { toast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

export function SGPConfigForm() {
    const user = useCurrentUser();
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);

    // Config State
    const [isAdmin, setIsAdmin] = useState(false);

    // Global Config
    const [globalConfig, setGlobalConfig] = useState<SGPGlobalConfig>({ baseUrl: '', cpfFieldId: '', appId: '', appToken: '' });

    // User Config
    const [userConfig, setUserConfig] = useState({ username: '', password: '' });

    // Options
    const [crmFields, setCrmFields] = useState<{ id: string, label: string }[]>([]);
    const [teams, setTeams] = useState<{ id: string, name: string }[]>([]);
    const [teamSectors, setTeamSectors] = useState<Record<string, string>>({});

    useEffect(() => {
        if (user?.activeWorkspaceId) {
            Promise.all([
                getSGPConfig(user.activeWorkspaceId),
                getCRMFields(user.activeWorkspaceId),
                getTeams(user.activeWorkspaceId)
            ]).then(([configRes, fieldsRes, teamsRes]) => {

                if (configRes.global) {
                    setGlobalConfig({
                        baseUrl: configRes.global.baseUrl || '',
                        cpfFieldId: configRes.global.cpfFieldId || '',
                        appId: configRes.global.appId || '',
                        appToken: configRes.global.appToken || '',
                        teamSectors: configRes.global.teamSectors || {}
                    });
                    setTeamSectors(configRes.global.teamSectors || {});
                }

                if (configRes.user) {
                    setUserConfig(prev => ({ ...prev, username: configRes.user?.username || '' }));
                }

                setIsAdmin(configRes.isAdmin);

                if (fieldsRes.fields) {
                    setCrmFields(fieldsRes.fields.map(f => ({ id: f.id, label: f.label })));
                }

                if (teamsRes.teams) {
                    setTeams(teamsRes.teams);
                }

                setFetching(false);
            });
        }
    }, [user?.activeWorkspaceId]);

    const handleSaveGlobal = async () => {
        if (!user?.activeWorkspaceId) return;
        if (!globalConfig.baseUrl) {
            toast({ title: "Erro", description: "O Endpoint da API é obrigatório.", variant: "destructive" });
            return;
        }

        setLoading(true);
        try {
            const res = await saveSGPGlobalConfig(user.activeWorkspaceId, {
                baseUrl: globalConfig.baseUrl || '',
                cpfFieldId: globalConfig.cpfFieldId || '',
                appId: globalConfig.appId || '',
                appToken: globalConfig.appToken || '',
                teamSectors: teamSectors
            });
            if (res.success) {
                toast({ title: "Configuração Geral salva", description: "Configurações do workspace atualizadas." });
            } else {
                toast({ title: "Erro", description: res.error || "Falha ao salvar.", variant: "destructive" });
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSaveUser = async () => {
        if (!user?.activeWorkspaceId) return;
        if (!userConfig.username || !userConfig.password) {
            toast({ title: "Erro", description: "Usuário e senha são obrigatórios.", variant: "destructive" });
            return;
        }

        setLoading(true);
        try {
            const res = await saveSGPUserConfig(user.activeWorkspaceId, userConfig);
            if (res.success) {
                toast({ title: "Credenciais salvas", description: "Seu token de acesso foi gerado com sucesso." });
                setUserConfig(prev => ({ ...prev, password: '' })); // Clear password
            } else {
                toast({ title: "Erro", description: res.error || "Falha ao salvar credenciais.", variant: "destructive" });
            }
        } finally {
            setLoading(false);
        }
    };

    if (fetching) {
        return <div className="flex justify-center p-8"><Loader2 className="animate-spin h-8 w-8 text-muted-foreground" /></div>;
    }

    return (
        <div className="space-y-6">
            {/* Global Configuration Section (Admin Only or Read Only) */}
            <Card className={isAdmin ? (globalConfig.baseUrl ? "border-green-200" : "border-yellow-200") : ""}>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Settings className="h-5 w-5 text-muted-foreground" />
                            <CardTitle>Configuração Global (Workspace)</CardTitle>
                        </div>
                        {isAdmin && <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">Administrador</span>}
                    </div>
                    <CardDescription>
                        Definições válidas para todos os usuários desta workspace.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Endpoint Field */}
                    <div className="space-y-2">
                        <Label htmlFor="endpoint" className="flex items-center gap-1">
                            Endpoint da API <span className="text-red-500">*</span>
                        </Label>
                        <Input
                            id="endpoint"
                            placeholder="https://api.sgp.exemplo.com/v1"
                            value={globalConfig.baseUrl}
                            onChange={(e) => setGlobalConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                            disabled={!isAdmin}
                        />
                        {!isAdmin && <p className="text-xs text-muted-foreground">Apenas administradores podem alterar este campo.</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* App Field */}
                        <div className="space-y-2">
                            <Label htmlFor="appId">App (ID)</Label>
                            <Input
                                id="appId"
                                placeholder="ex: meu-app-sgp"
                                value={globalConfig.appId || ''}
                                onChange={(e) => setGlobalConfig(prev => ({ ...prev, appId: e.target.value }))}
                                disabled={!isAdmin}
                            />
                        </div>

                        {/* Token Field */}
                        <div className="space-y-2">
                            <Label htmlFor="appToken">Token (App)</Label>
                            <Input
                                id="appToken"
                                type="password"
                                placeholder="ex: sgp_token_..."
                                value={globalConfig.appToken || ''}
                                onChange={(e) => setGlobalConfig(prev => ({ ...prev, appToken: e.target.value }))}
                                disabled={!isAdmin}
                            />
                        </div>
                    </div>

                    {/* CPF Field Selector */}
                    <div className="space-y-2">
                        <Label htmlFor="cpfField">Campo de CPF no CRM</Label>
                        <Select
                            value={globalConfig.cpfFieldId}
                            onValueChange={(val) => setGlobalConfig(prev => ({ ...prev, cpfFieldId: val }))}
                            disabled={!isAdmin}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione o campo personalizado..." />
                            </SelectTrigger>
                            <SelectContent>
                                {crmFields.length === 0 ? (
                                    <div className="p-2 text-sm text-muted-foreground">Nenhum campo personalizado encontrado no CRM.</div>
                                ) : (
                                    crmFields.map(field => (
                                        <SelectItem key={field.id} value={field.id}>{field.label}</SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            Selecione qual campo personalizado do CRM corresponde ao CPF do cliente no SGP.
                        </p>
                    </div>

                    {isAdmin && (
                        <>
                            <Separator className="my-6" />

                            <div className="space-y-4 mb-6">
                                <Label>Mapeamento de Setores por Equipe</Label>
                                <div className="border rounded-md">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Equipe Dialogy</TableHead>
                                                <TableHead>ID do Setor SGP</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {teams.map(team => (
                                                <TableRow key={team.id}>
                                                    <TableCell className="font-medium">{team.name}</TableCell>
                                                    <TableCell>
                                                        <Input
                                                            className="w-32"
                                                            placeholder="ID Setor"
                                                            value={teamSectors[team.id] || ''}
                                                            onChange={(e) => {
                                                                const val = e.target.value;
                                                                setTeamSectors(prev => ({ ...prev, [team.id]: val }));
                                                            }}
                                                        />
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {teams.length === 0 && (
                                                <TableRow>
                                                    <TableCell colSpan={2} className="text-center text-muted-foreground p-4">Nenhuma equipe encontrada.</TableCell>
                                                </TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                                <p className="text-xs text-muted-foreground">Informe o ID numérico do setor no SGP correspondente a cada equipe de atendimento.</p>
                            </div>

                            <div className="pt-2 flex justify-end">
                                <Button onClick={handleSaveGlobal} disabled={loading}>
                                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Salvar Configurações Globais
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* User Credentials Section */}
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <UserIcon className="h-5 w-5 text-muted-foreground" />
                        <CardTitle>Suas Credenciais</CardTitle>
                    </div>
                    <CardDescription>
                        Insira seu usuário e senha individual para gerar o token de acesso.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="username">Usuário (Username) <span className="text-red-500">*</span></Label>
                            <Input
                                id="username"
                                placeholder="seu.usuario"
                                value={userConfig.username}
                                onChange={(e) => setUserConfig(prev => ({ ...prev, username: e.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="password">Senha (Password) <span className="text-red-500">*</span></Label>
                            <Input
                                id="password"
                                type="password"
                                placeholder={userConfig.username ? "••••••••" : "Insira a senha"}
                                value={userConfig.password}
                                onChange={(e) => setUserConfig(prev => ({ ...prev, password: e.target.value }))}
                            />
                        </div>
                    </div>

                    <div className="pt-4 flex justify-end">
                        <Button onClick={handleSaveUser} disabled={loading} variant="secondary" className="border-primary/20 border">
                            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Gerar Token e Salvar
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
