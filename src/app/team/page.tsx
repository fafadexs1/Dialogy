
'use client';

import React, { useState } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, Team, BusinessHour } from '@/lib/types';
import { agents as mockAgents } from '@/lib/mock-data';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Palette, UserPlus, X, Bot, Search } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createClient } from '@/lib/supabase/client';
import { redirect } from 'next/navigation';
import { cn } from '@/lib/utils';

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
    enabled: !['sab', 'dom'].includes(day.id),
    startTime: '09:00',
    endTime: '18:00',
}));


const initialTeams: Team[] = [
  { id: 'team-1', name: 'Suporte Técnico', color: '#3b82f6', members: [mockAgents[0], mockAgents[3]], businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)), webhookUrl: 'https://api.example.com/suporte-tecnico' },
  { id: 'team-2', name: 'Vendas', color: '#10b981', members: [mockAgents[1], mockAgents[2]], businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
  { id: 'team-3', name: 'Financeiro', color: '#f97316', members: [mockAgents[0]], businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)) },
];

function TeamSettingsContent({ team, onTeamUpdate, onRemoveTeam }: { team: Team, onTeamUpdate: (teamId: string, field: keyof Team, value: any) => void, onRemoveTeam: (teamId: string) => void }) {
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const agents = mockAgents;

  const handleAddMember = (teamId: string) => {
    const agentToAdd = agents.find(agent => agent.id === selectedAgentId);
    if (!agentToAdd) return;

    const isAlreadyMember = team.members.some(member => member.id === agentToAdd.id);
    if (!isAlreadyMember) {
        onTeamUpdate(teamId, 'members', [...team.members, agentToAdd]);
    }
    setSelectedAgentId('');
  }

  const handleRemoveMember = (teamId: string, memberId: string) => {
     onTeamUpdate(teamId, 'members', team.members.filter(member => member.id !== memberId));
  }
  
  const handleBusinessHoursChange = (dayLabel: string, field: keyof BusinessHour, value: any) => {
    const updatedHours = team.businessHours.map(bh => 
        bh.day === dayLabel ? { ...bh, [field]: value } : bh
    );
    onTeamUpdate(team.id, 'businessHours', updatedHours);
  };

  return (
    <div className="space-y-6 p-1">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl">{team.name}</CardTitle>
              <CardDescription>Gerencie as configurações gerais e membros da equipe.</CardDescription>
            </div>
             <Button variant="destructive_outline" size="sm" onClick={() => onRemoveTeam(team.id)}>
                <Trash2 className="mr-2 h-4 w-4"/>
                Remover Equipe
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1 col-span-2">
              <Label htmlFor={`team-name-${team.id}`}>Nome da Equipe</Label>
              <Input 
                id={`team-name-${team.id}`} 
                value={team.name}
                onChange={(e) => onTeamUpdate(team.id, 'name', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`team-color-${team.id}`}>Cor</Label>
              <div className="flex items-center gap-2 border rounded-md h-10 px-3 bg-background">
                 <input
                  id={`team-color-${team.id}`}
                  type="color"
                  value={team.color}
                  onChange={(e) => onTeamUpdate(team.id, 'color', e.target.value)}
                  className="w-6 h-6 p-0 border-none bg-transparent cursor-pointer"
                />
                <span className="text-sm uppercase">{team.color}</span>
              </div>
            </div>
          </div>
          <div>
            <Label>Membros da Equipe ({team.members.length})</Label>
            <div className="mt-2 space-y-2">
              {team.members.map(member => (
                <div key={member.id} className="flex items-center justify-between p-2 rounded-md bg-secondary/50">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.avatar} alt={member.name} />
                      <AvatarFallback>{member.firstName.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{member.name}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRemoveMember(team.id, member.id)}>
                    <X className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
             <div className="flex items-end gap-2 mt-4">
              <div className="flex-1 space-y-1">
                <Select onValueChange={setSelectedAgentId} value={selectedAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Adicionar um novo membro" />
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
              <Button onClick={() => handleAddMember(team.id)} disabled={!selectedAgentId}>
                <UserPlus className="mr-2 h-4 w-4"/>
                Adicionar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horário de Atendimento</CardTitle>
          <CardDescription>Defina quando sua equipe estará disponível para atender.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {team.businessHours.map(bh => (
              <div key={bh.day} className="flex items-center justify-between p-3 rounded-lg bg-background border">
                <div className='flex items-center gap-4'>
                  <Switch 
                    id={`switch-${team.id}-${bh.day}`} 
                    checked={bh.enabled}
                    onCheckedChange={(checked) => handleBusinessHoursChange(bh.day, 'enabled', checked)}
                  />
                  <Label htmlFor={`switch-${team.id}-${bh.day}`} className='font-medium text-base min-w-[100px]'>{bh.day}</Label>
                </div>
                <div className={`flex items-center gap-2 transition-opacity ${bh.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                  <Input 
                    type="time" 
                    value={bh.startTime}
                    onChange={(e) => handleBusinessHoursChange(bh.day, 'startTime', e.target.value)}
                    className="w-[110px]" 
                  />
                  <span className="text-muted-foreground">às</span>
                  <Input 
                    type="time" 
                    value={bh.endTime}
                    onChange={(e) => handleBusinessHoursChange(bh.day, 'endTime', e.target.value)}
                    className="w-[110px]" 
                  />
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot /> Webhooks de Automação</CardTitle>
          <CardDescription>As mensagens recebidas por esta equipe serão enviadas para a URL configurada.</CardDescription>
        </CardHeader>
        <CardContent>
            <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1">
                <Label htmlFor={`webhook-url-${team.id}`}>URL do Webhook</Label>
                <Input
                    id={`webhook-url-${team.id}`}
                    placeholder="https://sua-api.com/webhook"
                    value={team.webhookUrl || ''}
                    onChange={(e) => onTeamUpdate(team.id, 'webhookUrl', e.target.value)}
                />
                </div>
                <Button variant="outline">Salvar URL</Button>
            </div>
        </CardContent>
      </Card>
    </div>
  )
}

function CreateTeamContent({ onAddTeam, onCancel }: { onAddTeam: (name: string, color: string) => void, onCancel: () => void }) {
    const [newTeamName, setNewTeamName] = useState('');
    const [newTeamColor, setNewTeamColor] = useState('#3b82f6');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeamName.trim()) return;
        onAddTeam(newTeamName, newTeamColor);
    }

    return (
        <div className="p-1">
             <Card>
                <form onSubmit={handleSubmit}>
                    <CardHeader>
                        <CardTitle className="text-2xl">Criar Nova Equipe</CardTitle>
                        <CardDescription>Dê um nome e uma cor para sua nova equipe para começar a adicionar membros e configurar horários.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                         <div className="space-y-1">
                            <Label htmlFor="team-name">Nome da Equipe</Label>
                            <Input 
                                id="team-name"
                                placeholder="Ex: Sucesso do Cliente"
                                value={newTeamName}
                                onChange={(e) => setNewTeamName(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="team-color">Cor</Label>
                            <div className="flex items-center gap-2 border rounded-md h-10 px-3 bg-background">
                                <input
                                id="team-color"
                                type="color"
                                value={newTeamColor}
                                onChange={(e) => setNewTeamColor(e.target.value)}
                                className="w-6 h-6 p-0 border-none bg-transparent cursor-pointer"
                                />
                                <span className="font-mono uppercase">{newTeamColor}</span>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="gap-2">
                        <Button type="submit">Salvar Equipe</Button>
                        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    )
}


export default function TeamPage() {
    const [user, setUser] = useState<User | null>(null);
    const [teams, setTeams] = useState<Team[]>(initialTeams);
    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(initialTeams[0]?.id || null);
    const [isCreating, setIsCreating] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const supabase = createClient();

    React.useEffect(() => {
        const fetchUser = async () => {
            const { data: { user: authUser } } = await supabase.auth.getUser();
            if (authUser) {
                 const appUser = mockAgents.find(a => a.email === authUser.email) || {
                    ...mockAgents[0],
                    name: authUser.user_metadata.full_name || authUser.email,
                    email: authUser.email,
                    id: authUser.id
                };
                setUser(appUser);
            } else {
                redirect('/login');
            }
        };
        fetchUser();
    }, [supabase.auth]);

    const handleTeamUpdate = (teamId: string, field: keyof Team, value: any) => {
        setTeams(teams.map(team => team.id === teamId ? { ...team, [field]: value } : team));
    }
    
    const handleAddTeam = (name: string, color: string) => {
        const newTeam: Team = {
          id: `team-${Date.now()}`,
          name,
          color,
          members: [],
          businessHours: JSON.parse(JSON.stringify(defaultBusinessHours)),
        };
        setTeams([...teams, newTeam]);
        setIsCreating(false);
        setSelectedTeamId(newTeam.id);
    };

    const handleRemoveTeam = (id: string) => {
        setTeams(teams.filter(team => team.id !== id));
        if (selectedTeamId === id) {
            setSelectedTeamId(teams[0]?.id || null);
        }
    };
    
    const handleSelectTeam = (id: string) => {
        setSelectedTeamId(id);
        setIsCreating(false);
    }

    const handleCreateClick = () => {
        setIsCreating(true);
        setSelectedTeamId(null);
    }
    
    const filteredTeams = teams.filter(team => team.name.toLowerCase().includes(searchTerm.toLowerCase()));
    const selectedTeam = teams.find(t => t.id === selectedTeamId);

    if (!user) {
        return null; // or a loading spinner
    }

  return (
    <MainLayout user={user}>
      <div className="flex flex-col flex-1 h-full">
        <header className="p-4 border-b flex-shrink-0 bg-card">
          <h1 className="text-2xl font-bold">Gestão de Equipes</h1>
          <p className="text-muted-foreground">Crie e gerencie suas equipes, horários e automações.</p>
        </header>
        <div className="flex-1 flex min-h-0 bg-muted/40">
            {/* Left Sidebar for teams list */}
            <aside className="w-full max-w-xs border-r bg-background flex flex-col">
                 <div className="p-4 space-y-4 flex-shrink-0 border-b">
                    <Button className="w-full" onClick={handleCreateClick}>
                        <Plus className="mr-2 h-4 w-4"/>
                        Criar Equipe
                    </Button>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input 
                            placeholder="Buscar equipe..." 
                            className="pl-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)} 
                        />
                    </div>
                 </div>
                 <div className="flex-1 overflow-y-auto">
                    <nav className="p-2 space-y-1">
                        {filteredTeams.map(team => (
                            <button
                                key={team.id}
                                onClick={() => handleSelectTeam(team.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 text-left p-2 rounded-md text-sm font-medium transition-colors",
                                    selectedTeamId === team.id 
                                        ? "bg-primary/10 text-primary" 
                                        : "hover:bg-accent text-foreground"
                                )}
                            >
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: team.color }}></span>
                                <span className="flex-1 truncate">{team.name}</span>
                                <Avatar className="h-6 w-6">
                                    <AvatarImage src={team.members[0]?.avatar} />
                                    <AvatarFallback>{team.members.length}</AvatarFallback>
                                </Avatar>
                            </button>
                        ))}
                    </nav>
                 </div>
            </aside>
            {/* Main content area */}
            <main className="flex-1 overflow-y-auto">
                <div className="max-w-4xl mx-auto py-6 px-4">
                    {isCreating ? (
                        <CreateTeamContent onAddTeam={handleAddTeam} onCancel={() => setIsCreating(false)} />
                    ) : selectedTeam ? (
                        <TeamSettingsContent team={selectedTeam} onTeamUpdate={handleTeamUpdate} onRemoveTeam={handleRemoveTeam}/>
                    ) : (
                        <div className="text-center py-20">
                            <h2 className="text-xl font-medium text-muted-foreground">Selecione uma equipe ou crie uma nova</h2>
                            <p className="text-muted-foreground">Comece selecionando uma equipe à esquerda ou clique em "Criar Equipe".</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
      </div>
    </MainLayout>
  );
}


    