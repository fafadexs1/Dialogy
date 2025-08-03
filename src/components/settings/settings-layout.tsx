
'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

interface BusinessHour {
  day: string;
  enabled: boolean;
  startTime: string;
  endTime: string;
}

interface Team {
  id: string;
  name: string;
  businessHours: BusinessHour[];
}

const daysOfWeek = [
  { id: 'seg', label: 'Segunda-feira' },
  { id: 'ter', label: 'Terça-feira' },
  { id: 'qua', label: 'Quarta-feira' },
  { id: 'qui', label: 'Quinta-feira' },
  { id: 'sex', label: 'Sexta-feira' },
  { id: 'sab', label: 'Sábado' },
  { id: 'dom', label: 'Domingo' },
];

const defaultBusinessHours = daysOfWeek.map(day => ({
    day: day.label,
    enabled: day.id !== 'sab' && day.id !== 'dom',
    startTime: '09:00',
    endTime: '18:00',
}));


const initialTeams: Team[] = [
  { id: 'team-1', name: 'Suporte Técnico', businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
  { id: 'team-2', name: 'Vendas', businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
  { id: 'team-3', name: 'Financeiro', businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
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
      businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)), // Create a deep copy
    };
    setTeams([...teams, newTeam]);
    setNewTeamName('');
  };

  const handleRemoveTeam = (id: string) => {
    setTeams(teams.filter(team => team.id !== id));
  };
  
  const handleBusinessHoursChange = (teamId: string, dayLabel: string, field: keyof BusinessHour, value: any) => {
    setTeams(teams.map(team => {
        if (team.id === teamId) {
            return {
                ...team,
                businessHours: team.businessHours.map(bh => 
                    bh.day === dayLabel ? { ...bh, [field]: value } : bh
                )
            };
        }
        return team;
    }));
  };

  return (
    <main className="flex-1 flex-col bg-secondary/10 p-6 flex">
        <div className="mx-auto w-full max-w-6xl">
            <header className="mb-8">
                <h1 className="text-3xl font-bold">Configurações</h1>
                <p className="text-muted-foreground">Gerencie as equipes, regras de negócio e outras configurações da sua plataforma.</p>
            </header>

            <Tabs defaultValue="teams-hours" className="w-full">
                <TabsList className="grid w-full grid-cols-4 mb-6">
                    <TabsTrigger value="teams-hours">Equipes e Horários</TabsTrigger>
                    <TabsTrigger value="channels">Canais</TabsTrigger>
                    <TabsTrigger value="automation">Automação</TabsTrigger>
                    <TabsTrigger value="integrations">Integrações</TabsTrigger>
                </TabsList>
                
                <TabsContent value="teams-hours" className="mt-0">
                   <Card>
                        <CardHeader>
                            <CardTitle>Gerenciar Equipes e Horários de Atendimento</CardTitle>
                            <CardDescription>Crie equipes e defina horários de trabalho específicos para cada uma delas.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form onSubmit={handleAddTeam} className="flex items-end gap-2 mb-6 p-4 border rounded-lg bg-secondary/30">
                                <div className="flex-1 space-y-1">
                                    <Label htmlFor="team-name">Nome da Nova Equipe</Label>
                                    <Input 
                                        id="team-name"
                                        placeholder="Ex: Sucesso do Cliente"
                                        value={newTeamName}
                                        onChange={(e) => setNewTeamName(e.target.value)}
                                    />
                                </div>
                                <Button type="submit">
                                    <PlusCircle className="mr-2 h-4 w-4" />
                                    Adicionar Equipe
                                </Button>
                            </form>

                            <Accordion type="single" collapsible className="w-full">
                                {teams.map((team) => (
                                    <AccordionItem value={team.id} key={team.id}>
                                        <AccordionTrigger className='text-base font-medium px-2 hover:bg-accent rounded-md'>
                                            <div className='flex items-center justify-between w-full'>
                                                <span>{team.name}</span>
                                                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleRemoveTeam(team.id); }} className='mr-2 hover:bg-destructive/10'>
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                    <span className="sr-only">Remover Equipe</span>
                                                </Button>
                                            </div>
                                        </AccordionTrigger>
                                        <AccordionContent>
                                            <div className="p-4 border rounded-md m-2 mt-0 bg-background">
                                                <h4 className="font-semibold mb-4">Horário de Atendimento de {team.name}</h4>
                                                <div className="space-y-3">
                                                    {team.businessHours.map(bh => (
                                                        <div key={bh.day} className="flex items-center justify-between">
                                                            <div className='flex items-center gap-4'>
                                                                <Switch 
                                                                    id={`switch-${team.id}-${bh.day}`} 
                                                                    checked={bh.enabled}
                                                                    onCheckedChange={(checked) => handleBusinessHoursChange(team.id, bh.day, 'enabled', checked)}
                                                                />
                                                                <Label htmlFor={`switch-${team.id}-${bh.day}`} className='font-medium min-w-[100px]'>{bh.day}</Label>
                                                            </div>
                                                            <div className={`flex items-center gap-2 transition-opacity ${bh.enabled ? 'opacity-100' : 'opacity-50'}`}>
                                                                <Input 
                                                                    type="time" 
                                                                    value={bh.startTime}
                                                                    onChange={(e) => handleBusinessHoursChange(team.id, bh.day, 'startTime', e.target.value)}
                                                                    className="w-[100px]" 
                                                                    disabled={!bh.enabled} 
                                                                />
                                                                <span>até</span>
                                                                <Input 
                                                                    type="time" 
                                                                    value={bh.endTime}
                                                                    onChange={(e) => handleBusinessHoursChange(team.id, bh.day, 'endTime', e.target.value)}
                                                                    className="w-[100px]" 
                                                                    disabled={!bh.enabled}
                                                                />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                            </Accordion>

                        </CardContent>
                    </Card>
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
