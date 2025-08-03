'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, Team, BusinessHour } from '@/lib/types';
import { agents } from '@/lib/mock-data';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Palette } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

const daysOfWeek = [
  { id: 'seg', label: 'Segunda-feira' },
  { id: 'ter', label: 'Terça-feira' },
  { id: 'qua', label: 'Quarta-feira' },
  { id: 'qui', label: 'Quinta-feira' },
  { id: 'sex', label: 'Sexta-feira' },
  { id: 'sab', label: 'Sábado' },
  { id: 'dom', label: 'Domingo' },
];

const defaultBusinessHours: BusinessHour[] = daysOfWeek.map(day => ({
    day: day.label,
    enabled: day.id !== 'sab' && day.id !== 'dom',
    startTime: '09:00',
    endTime: '18:00',
}));


const initialTeams: Team[] = [
  { id: 'team-1', name: 'Suporte Técnico', color: '#3b82f6', businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
  { id: 'team-2', name: 'Vendas', color: '#10b981', businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
  { id: 'team-3', name: 'Financeiro', color: '#f97316', businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
];

function TeamsLayout() {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamColor, setNewTeamColor] = useState('#cccccc');


  const handleAddTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    const newTeam: Team = {
      id: `team-${Date.now()}`,
      name: newTeamName,
      color: newTeamColor,
      businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)), // Create a deep copy
    };
    setTeams([...teams, newTeam]);
    setNewTeamName('');
    setNewTeamColor('#cccccc');
  };

  const handleRemoveTeam = (id: string) => {
    setTeams(teams.filter(team => team.id !== id));
  };
  
  const handleTeamUpdate = (teamId: string, field: keyof Team, value: any) => {
     setTeams(teams.map(team => 
        team.id === teamId ? { ...team, [field]: value } : team
    ));
  }

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
                <h1 className="text-3xl font-bold">Gestão de Equipes</h1>
                <p className="text-muted-foreground">Gerencie suas equipes, horários de atendimento e outras configurações.</p>
            </header>
            <Card>
                <CardHeader>
                    <CardTitle>Gerenciar Equipes e Horários de Atendimento</CardTitle>
                    <CardDescription>Crie equipes, defina suas cores e configure horários de trabalho específicos para cada uma delas.</CardDescription>
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
                        <div className="space-y-1">
                          <Label htmlFor="team-color">Cor</Label>
                          <div className="flex items-center gap-2 border rounded-md h-10 px-2 bg-background">
                              <Palette className="h-4 w-4 text-muted-foreground"/>
                              <input
                                  id="team-color"
                                  type="color"
                                  value={newTeamColor}
                                  onChange={(e) => setNewTeamColor(e.target.value)}
                                  className="w-6 h-6 p-0 border-none bg-transparent"
                              />
                          </div>
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
                                        <div className="flex items-center gap-3">
                                           <span className="h-4 w-4 rounded-full" style={{ backgroundColor: team.color }}></span>
                                           {team.name}
                                        </div>
                                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleRemoveTeam(team.id); }} className='mr-2 hover:bg-destructive/10'>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                            <span className="sr-only">Remover Equipe</span>
                                        </Button>
                                    </div>
                                </AccordionTrigger>
                                <AccordionContent>
                                    <div className="p-4 border rounded-md m-2 mt-0 bg-background space-y-6">
                                        <div>
                                            <h4 className="font-semibold mb-4">Configurações Gerais de {team.name}</h4>
                                            <div className="flex items-end gap-4">
                                                <div className="flex-1 space-y-1">
                                                    <Label htmlFor={`team-name-${team.id}`}>Nome da Equipe</Label>
                                                    <Input 
                                                        id={`team-name-${team.id}`} 
                                                        value={team.name}
                                                        onChange={(e) => handleTeamUpdate(team.id, 'name', e.target.value)}
                                                    />
                                                </div>
                                                 <div className="space-y-1">
                                                    <Label htmlFor={`team-color-${team.id}`}>Cor</Label>
                                                    <div className="flex items-center gap-2 border rounded-md h-10 px-2 bg-white">
                                                        <input
                                                            id={`team-color-${team.id}`}
                                                            type="color"
                                                            value={team.color}
                                                            onChange={(e) => handleTeamUpdate(team.id, 'color', e.target.value)}
                                                            className="w-6 h-6 p-0 border-none bg-transparent"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
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
                                    </div>
                                </AccordionContent>
                            </AccordionItem>
                        ))}
                    </Accordion>
                </CardContent>
            </Card>
        </div>
    </main>
  );
}


export default function TeamPage() {
  // In a real app, you would fetch user data from your database
  // For now, we'll use the first agent from our mock data
  const user = agents[0];

  return (
    <MainLayout user={user}>
      <TeamsLayout />
    </MainLayout>
  );
}
