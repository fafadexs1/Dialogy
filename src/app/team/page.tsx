'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, Team, BusinessHour } from '@/lib/types';
import { agents as mockAgents } from '@/lib/mock-data'; // Renamed to avoid conflict
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Palette, UserPlus, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import InternalChatLayout from '@/components/layout/internal-chat-layout';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  { id: 'team-1', name: 'Suporte Técnico', color: '#3b82f6', members: [mockAgents[0], mockAgents[3]], businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
  { id: 'team-2', name: 'Vendas', color: '#10b981', members: [mockAgents[1], mockAgents[2]], businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
  { id: 'team-3', name: 'Financeiro', color: '#f97316', members: [mockAgents[0]], businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
];

function TeamSettingsLayout() {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [newTeamName, setNewTeamName] = useState('');
  const [newTeamColor, setNewTeamColor] = useState('#cccccc');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const agents = mockAgents;


  const handleAddTeam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    const newTeam: Team = {
      id: `team-${Date.now()}`,
      name: newTeamName,
      color: newTeamColor,
      members: [],
      businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)),
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

  const handleAddMember = (teamId: string) => {
    const agentToAdd = agents.find(agent => agent.id === selectedAgentId);
    if (!agentToAdd) return;

    setTeams(teams.map(team => {
        if (team.id === teamId) {
            const isAlreadyMember = team.members.some(member => member.id === agentToAdd.id);
            if (!isAlreadyMember) {
                return { ...team, members: [...team.members, agentToAdd] };
            }
        }
        return team;
    }));
    setSelectedAgentId('');
  }

  const handleRemoveMember = (teamId: string, memberId: string) => {
     setTeams(teams.map(team => {
        if (team.id === teamId) {
           return { ...team, members: team.members.filter(member => member.id !== memberId) };
        }
        return team;
    }));
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
    <div className="p-6">
      <div className="mx-auto w-full max-w-6xl">
        <Card>
          <CardHeader>
            <CardTitle>Gerenciar Equipes</CardTitle>
            <CardDescription>Crie equipes, adicione membros e configure seus horários de atendimento.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="p-4 border rounded-lg bg-secondary/30 mb-6">
              <h3 className="text-lg font-semibold mb-2">Adicionar Nova Equipe</h3>
              <form onSubmit={handleAddTeam} className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                  <Label htmlFor="team-name">Nome da Equipe</Label>
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
                  Adicionar
                </Button>
              </form>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4">Equipes Atuais ({teams.length})</h3>
              <Accordion type="single" collapsible className="w-full">
                {teams.map((team) => (
                  <AccordionItem value={team.id} key={team.id}>
                    <div className="flex items-center w-full hover:bg-accent rounded-md">
                      <AccordionTrigger className="text-base font-medium flex-1 px-2">
                        <div className="flex items-center gap-3">
                          <span className="h-4 w-4 rounded-full" style={{ backgroundColor: team.color }}></span>
                          {team.name}
                          <div className="flex items-center -space-x-2">
                            {team.members.slice(0, 3).map(member => (
                              <Avatar key={member.id} className="h-6 w-6 border-2 border-background">
                                <AvatarImage src={member.avatar} alt={member.name} />
                                <AvatarFallback>{member.firstName.charAt(0)}</AvatarFallback>
                              </Avatar>
                            ))}
                            {team.members.length > 3 && (
                              <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium border-2 border-background">
                                +{team.members.length - 3}
                              </div>
                            )}
                          </div>
                        </div>
                      </AccordionTrigger>
                      <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleRemoveTeam(team.id); }} className='mr-2 hover:bg-destructive/10 shrink-0'>
                        <Trash2 className="h-4 w-4 text-destructive" />
                        <span className="sr-only">Remover Equipe</span>
                      </Button>
                    </div>
                    <AccordionContent>
                      <div className="p-4 border rounded-md m-2 mt-0 bg-background grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-6">
                          <div>
                            <h4 className="font-semibold mb-4">Configurações Gerais</h4>
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
                            <h4 className="font-semibold mb-4">Membros da Equipe ({team.members.length})</h4>
                            <div className="space-y-2 mb-4">
                              {team.members.map(member => (
                                <div key={member.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/30">
                                  <div className="flex items-center gap-2">
                                    <Avatar className="h-8 w-8">
                                      <AvatarImage src={member.avatar} alt={member.name} />
                                      <AvatarFallback>{member.firstName.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                    <span className="text-sm font-medium">{member.name}</span>
                                  </div>
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRemoveMember(team.id, member.id)}>
                                    <X className="h-4 w-4 text-muted-foreground" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                            <div className="flex items-end gap-2">
                              <div className="flex-1 space-y-1">
                                <Label>Adicionar Membro</Label>
                                <Select onValueChange={setSelectedAgentId}>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Selecione um agente" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {agents
                                      .filter(agent => !team.members.some(m => m.id === agent.id))
                                      .map(agent => (
                                      <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <Button onClick={() => handleAddMember(team.id)}>
                                <UserPlus className="mr-2 h-4 w-4"/>
                                Adicionar
                              </Button>
                            </div>
                          </div>
                        </div>
                        
                        <div>
                          <h4 className="font-semibold mb-4">Horário de Atendimento</h4>
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
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function TeamPage() {
  // In a real app with Supabase, you would fetch the current user session
  // For now, we'll use a mock user, but this component is now client-side
  const user = mockAgents[0];

  return (
    <MainLayout user={user}>
      <div className="flex flex-col flex-1 h-full">
        <header className="p-4 border-b flex-shrink-0">
          <h1 className="text-2xl font-bold">Equipes</h1>
          <p className="text-muted-foreground">Comunicação interna e gestão de equipes.</p>
        </header>
        <Tabs defaultValue="management" className="flex-1 flex flex-col min-h-0">
          <div className="p-4 border-b flex-shrink-0">
            <TabsList>
              <TabsTrigger value="communication">Comunicação</TabsTrigger>
              <TabsTrigger value="management">Gestão de Equipes</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="communication" className="m-0 p-0 flex-1 flex min-h-0">
            <InternalChatLayout user={user} />
          </TabsContent>
          <TabsContent value="management" className="m-0 flex-1 overflow-y-auto min-h-0">
             <TeamSettingsLayout />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
