'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Clock } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Team {
  id: string;
  name: string;
}

const initialTeams: Team[] = [
  { id: 'team-1', name: 'Suporte Técnico' },
  { id: 'team-2', name: 'Vendas' },
  { id: 'team-3', name: 'Financeiro' },
];

const daysOfWeek = [
  { id: 'seg', label: 'Segunda-feira' },
  { id: 'ter', label: 'Terça-feira' },
  { id: 'qua', label: 'Quarta-feira' },
  { id: 'qui', label: 'Quinta-feira' },
  { id: 'sex', label: 'Sexta-feira' },
  { id: 'sab', label: 'Sábado' },
  { id: 'dom', label: 'Domingo' },
];

export function SettingsLayout() {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [newTeamName, setNewTeamName] = useState('');

  const handleAddTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    const newTeam = {
      id: `team-${Date.now()}`,
      name: newTeamName,
    };
    setTeams([...teams, newTeam]);
    setNewTeamName('');
  };

  const handleRemoveTeam = (id: string) => {
    setTeams(teams.filter(team => team.id !== id));
  };

  return (
    <main className="flex-1 flex-col bg-secondary/10 p-6 flex">
        <div className="mx-auto w-full max-w-6xl">
            <header className="mb-8">
                <h1 className="text-3xl font-bold">Configurações</h1>
                <p className="text-muted-foreground">Gerencie as equipes, regras de negócio e outras configurações da sua plataforma.</p>
            </header>

            <Tabs defaultValue="teams-hours" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="teams-hours">Equipes e Horários</TabsTrigger>
                    <TabsTrigger value="channels">Canais</TabsTrigger>
                    <TabsTrigger value="automation">Automação</TabsTrigger>
                    <TabsTrigger value="integrations">Integrações</TabsTrigger>
                </TabsList>
                
                <TabsContent value="teams-hours" className="mt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Teams Management */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Gerenciar Equipes</CardTitle>
                                <CardDescription>Crie e organize as equipes que usarão o Dialogy.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleAddTeam} className="flex items-end gap-2 mb-6">
                                    <div className="flex-1 space-y-1">
                                        <Label htmlFor="team-name">Nome da Equipe</Label>
                                        <Input 
                                            id="team-name"
                                            placeholder="Ex: Sucesso do Cliente"
                                            value={newTeamName}
                                            onChange={(e) => setNewTeamName(e.target.value)}
                                        />
                                    </div>
                                    <Button type="submit" size="sm">
                                        <PlusCircle className="mr-2 h-4 w-4" />
                                        Adicionar
                                    </Button>
                                </form>
                                <div className="space-y-2">
                                    <h4 className="font-medium text-sm text-muted-foreground">Equipes existentes</h4>
                                    {teams.map(team => (
                                        <div key={team.id} className="flex items-center justify-between p-2 border rounded-md bg-background text-sm">
                                            <span>{team.name}</span>
                                            <Button variant="ghost" size="icon" onClick={() => handleRemoveTeam(team.id)}>
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                                <span className="sr-only">Remover</span>
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Business Hours */}
                        <Card>
                             <CardHeader>
                                <CardTitle>Horário de Atendimento</CardTitle>
                                <CardDescription>Defina os horários em que sua equipe estará disponível para atendimento.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {daysOfWeek.map(day => (
                                    <div key={day.id} className="flex items-center justify-between p-3 border rounded-md bg-background">
                                        <div className='flex items-center gap-4'>
                                           <Switch id={`switch-${day.id}`} defaultChecked={day.id !== 'sab' && day.id !== 'dom'} />
                                           <Label htmlFor={`switch-${day.id}`} className='font-medium min-w-[100px]'>{day.label}</Label>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Input type="time" defaultValue="09:00" className="w-[100px]" />
                                            <span>até</span>
                                            <Input type="time" defaultValue="18:00" className="w-[100px]" />
                                        </div>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
                
                <TabsContent value="channels">
                    <p className="text-muted-foreground text-center p-8">Em breve: Configurações dos canais de comunicação.</p>
                </TabsContent>
                <TabsContent value="automation">
                    <p className="text-muted-foreground text-center p-8">Em breve: Configurações de automação e regras de negócio.</p>
                </TabsContent>
                <TabsContent value="integrations">
                    <p className="text-muted-foreground text-center p-8">Em breve: Configurações de integrações com outras plataformas.</p>
                </TabsContent>

            </Tabs>
        </div>
    </main>
  );
}
