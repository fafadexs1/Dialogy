
'use client';

import React, { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/main-layout';
import type { User, Team, BusinessHour, Role, Tag } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, UserPlus, X, Search, Loader2, Save, Users, Palette, Tag as TagIcon } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { getTeams, createTeam, updateTeam, deleteTeam, addTeamMember, removeTeamMember, updateBusinessHours } from '@/actions/teams';
import { getTags } from '@/actions/crm';
import { getWorkspaceMembers } from '@/actions/members';
import { getRolesAndPermissions } from '@/actions/permissions';

const daysOrder = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

const sortBusinessHours = (businessHours: BusinessHour[]) => {
  return [...businessHours].sort((a, b) => daysOrder.indexOf(a.day) - daysOrder.indexOf(b.day));
};


function TeamSettingsContent({ 
    team, 
    allMembers,
    roles,
    tags,
    onTeamUpdate,
    onTeamDelete,
}: { 
    team: Team, 
    allMembers: User[],
    roles: Role[],
    tags: Tag[],
    onTeamUpdate: (teamId: string, updatedTeam: Team) => void;
    onTeamDelete: (teamId: string) => void;
}) {
  const { toast } = useToast();
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [teamName, setTeamName] = useState(team.name);
  const sortedBusinessHours = sortBusinessHours(team.businessHours);

  const handleUpdateField = async (field: keyof Omit<Team, 'id' | 'businessHours' | 'members'>, value: any) => {
    const result = await updateTeam(team.id, { [field]: value });
    if (result.error) {
      toast({ title: 'Erro ao atualizar', description: result.error, variant: 'destructive' });
    } else {
      const updatedTeam = { ...team, [field]: value };
      onTeamUpdate(team.id, updatedTeam);
      toast({ title: "Campo atualizado!", duration: 2000 });
    }
  }
  
  const handleRemoveTeam = async () => {
    const result = await deleteTeam(team.id);
    if(result.error) {
      toast({ title: 'Erro ao remover', description: result.error, variant: 'destructive' });
    } else {
      toast({ title: 'Equipe removida com sucesso!' });
      onTeamDelete(team.id);
    }
  }

  const handleAddMember = async () => {
    const agentToAdd = allMembers.find(agent => agent.id === selectedAgentId);
    if (!agentToAdd) return;
    
    const result = await addTeamMember(team.id, agentToAdd.id);
    if(result.error) {
      toast({ title: 'Erro ao adicionar membro', description: result.error, variant: 'destructive' });
    } else {
      const updatedTeam = { ...team, members: [...team.members, agentToAdd] };
      onTeamUpdate(team.id, updatedTeam);
    }
    setSelectedAgentId('');
  }

  const handleRemoveMember = async (memberId: string) => {
     const result = await removeTeamMember(team.id, memberId);
     if(result.error) {
       toast({ title: 'Erro ao remover membro', description: result.error, variant: 'destructive' });
     } else {
        const updatedMembers = team.members.filter(m => m.id !== memberId);
        const updatedTeam = { ...team, members: updatedMembers };
        onTeamUpdate(team.id, updatedTeam);
     }
  }
  
  const handleBusinessHoursChange = async (dayLabel: string, field: keyof Omit<BusinessHour, 'day'>, value: any) => {
    const result = await updateBusinessHours(team.id, dayLabel, { [field]: value });
    if(result.error) {
      toast({ title: 'Erro ao salvar horário', description: result.error, variant: 'destructive' });
    } else {
       const updatedHours = team.businessHours.map(bh => bh.day === dayLabel ? { ...bh, [field]: value } : bh);
       const updatedTeam = { ...team, businessHours: updatedHours };
       onTeamUpdate(team.id, updatedTeam);
    }
  };

  return (
    <div className="space-y-6 p-1">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-3">
              <span className="h-4 w-4 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }}></span>
              <div>
                <CardTitle className="text-2xl">{team.name}</CardTitle>
                <CardDescription>Gerencie as configurações gerais e membros da equipe.</CardDescription>
              </div>
            </div>
             <Button variant="destructive" size="sm" onClick={handleRemoveTeam}>
                <Trash2 className="mr-2 h-4 w-4"/>
                Remover Equipe
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor={`team-name-${team.id}`}>Nome da Equipe</Label>
              <Input 
                id={`team-name-${team.id}`} 
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                onBlur={(e) => handleUpdateField('name', e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Cor da Equipe</Label>
               <div className="flex items-center gap-2 border rounded-md h-10 px-3 bg-background">
                  <Palette className="h-4 w-4 text-muted-foreground"/>
                  <input
                      type="color"
                      defaultValue={team.color}
                      onBlur={(e) => handleUpdateField('color', e.target.value)}
                      className="w-full h-8 p-0 border-none bg-transparent"
                  />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor={`team-role-${team.id}`}>Papel da Equipe</Label>
              <Select
                value={team.roleId}
                onValueChange={(value) => handleUpdateField('roleId', value)}
              >
                  <SelectTrigger id={`team-role-${team.id}`}>
                      <SelectValue placeholder="Selecione um papel" />
                  </SelectTrigger>
                  <SelectContent>
                      {roles.map(role => (
                          <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                      ))}
                  </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`team-tag-${team.id}`}>Tag Automática da Equipe</Label>
              <Select
                value={team.tagId || ''}
                onValueChange={(value) => handleUpdateField('tagId', value)}
              >
                  <SelectTrigger id={`team-tag-${team.id}`}>
                      <SelectValue placeholder="Nenhuma tag automática" />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="">Nenhuma tag</SelectItem>
                      {tags.map(tag => (
                          <SelectItem key={tag.id} value={tag.id}>
                            <div className='flex items-center gap-2'>
                                <span className='h-2 w-2 rounded-full' style={{backgroundColor: tag.color}}></span>
                                {tag.label}
                            </div>
                          </SelectItem>
                      ))}
                  </SelectContent>
              </Select>
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
                      <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <span className="font-medium">{member.name}</span>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRemoveMember(member.id)}>
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
                    {allMembers
                      .filter(agent => !team.members.some(m => m.id === agent.id))
                      .map(agent => (
                      <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAddMember} disabled={!selectedAgentId}>
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
          {sortedBusinessHours.map(bh => (
              <div key={bh.day} className="flex items-center justify-between p-3 rounded-lg bg-background border">
                <div className='flex items-center gap-4'>
                  <Switch 
                    id={`switch-${team.id}-${bh.day}`} 
                    checked={bh.isEnabled}
                    onCheckedChange={(checked) => handleBusinessHoursChange(bh.day, 'isEnabled', checked)}
                  />
                  <Label htmlFor={`switch-${team.id}-${bh.day}`} className='font-medium text-base min-w-[100px]'>{bh.day}</Label>
                </div>
                <div className={`flex items-center gap-2 transition-opacity ${bh.isEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                  <Input 
                    type="time" 
                    defaultValue={bh.startTime || '09:00'}
                    onBlur={(e) => handleBusinessHoursChange(bh.day, 'startTime', e.target.value)}
                    className="w-[110px]" 
                  />
                  <span className="text-muted-foreground">às</span>
                  <Input 
                    type="time" 
                    defaultValue={bh.endTime || '18:00'}
                    onBlur={(e) => handleBusinessHoursChange(bh.day, 'endTime', e.target.value)}
                    className="w-[110px]" 
                  />
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  )
}

function CreateTeamContent({ workspaceId, roles, onAddTeam, onCancel }: { workspaceId:string, roles: Role[], onAddTeam: (newTeam: Team) => void, onCancel: () => void }) {
    const { toast } = useToast();

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const name = formData.get('name') as string;
        const roleId = formData.get('roleId') as string;

        if (!name.trim() || !roleId) {
            toast({title: 'Campos obrigatórios', description: 'Nome da equipe e papel são obrigatórios.', variant: 'destructive' });
            return;
        };

        const result = await createTeam({ workspaceId, name, roleId });
        if (result.error || !result.team) {
            toast({title: 'Erro ao criar equipe', description: result.error, variant: 'destructive'});
        } else {
            toast({title: 'Equipe criada com sucesso!'});
            onAddTeam(result.team);
        }
    }

    return (
        <div className="p-1">
             <Card>
                <form onSubmit={handleSubmit}>
                    <CardHeader>
                        <CardTitle className="text-2xl">Criar Nova Equipe</CardTitle>
                        <CardDescription>Dê um nome e defina um papel (role) para sua nova equipe.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                         <div className="space-y-1">
                            <Label htmlFor="team-name">Nome da Equipe</Label>
                            <Input 
                                id="team-name"
                                name="name"
                                placeholder="Ex: Sucesso do Cliente"
                                autoFocus
                            />
                        </div>
                         <div className="space-y-1">
                            <Label htmlFor="team-role">Papel da Equipe</Label>
                             <Select name="roleId">
                                <SelectTrigger id="team-role">
                                    <SelectValue placeholder="Selecione um papel" />
                                </SelectTrigger>
                                <SelectContent>
                                    {roles.map(role => (
                                        <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                             <p className="text-xs text-muted-foreground">O papel define as permissões que todos os membros desta equipe terão.</p>
                        </div>
                    </CardContent>
                    <CardFooter className="gap-2">
                        <Button type="submit"><Save className='mr-2 h-4 w-4' /> Salvar Equipe</Button>
                        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    )
}


export default function TeamPage() {
    const user = useAuth();
    const [teams, setTeams] = useState<Team[]>([]);
    const [allMembers, setAllMembers] = useState<User[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [tags, setTags] = useState<Tag[]>([]);
    const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
    const [isCreating, setIsCreating] = useState(false);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const { toast } = useToast();

    useEffect(() => {
        const fetchData = async () => {
            if (!user?.activeWorkspaceId) return;
            setLoading(true);
            try {
                const [teamsData, membersData, rolesData, tagsData] = await Promise.all([
                    getTeams(user.activeWorkspaceId),
                    getWorkspaceMembers(user.activeWorkspaceId),
                    getRolesAndPermissions(user.activeWorkspaceId),
                    getTags(user.activeWorkspaceId)
                ]);

                if (teamsData.error) throw new Error(teamsData.error);
                setTeams(teamsData.teams || []);
                if (!selectedTeamId && teamsData.teams && teamsData.teams.length > 0) {
                    setSelectedTeamId(teamsData.teams[0].id);
                } else if (teamsData.teams?.length === 0) {
                    setSelectedTeamId(null);
                }

                if (membersData.error) throw new Error(membersData.error);
                // Cast to User[], as WorkspaceMember is a subset
                setAllMembers(membersData.members as User[] || []);

                if (rolesData.error) throw new Error(rolesData.error);
                setRoles(rolesData.roles || []);
                
                if (tagsData.error) throw new Error(tagsData.error);
                setTags(tagsData.tags?.filter(t => !t.is_close_reason) || []);

            } catch (e: any) {
                toast({ title: "Erro ao buscar dados", description: e.message, variant: "destructive" });
            } finally {
                setLoading(false);
            }
        };

        if(user) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, toast]);

    const handleTeamUpdate = (teamId: string, updatedTeam: Team) => {
        setTeams(prev => prev.map(t => t.id === teamId ? updatedTeam : t));
    };

    const handleTeamDelete = (teamId: string) => {
        setTeams(prev => prev.filter(t => t.id !== teamId));
        setSelectedTeamId(prevId => prevId === teamId ? (teams[0]?.id || null) : prevId);
    }
    
    const handleAddTeam = (newTeam: Team) => {
        setTeams(prev => [...prev, newTeam]);
        setIsCreating(false);
        setSelectedTeamId(newTeam.id);
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

    if (!user || loading) {
        return (
            <MainLayout user={user ?? undefined}>
                <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-8 w-8 animate-spin text-primary"/>
                </div>
            </MainLayout>
        );
    }

  return (
    <MainLayout user={user}>
      <div className="flex flex-col flex-1 h-full">
        <header className="p-4 border-b flex-shrink-0 bg-card">
          <h1 className="text-2xl font-bold flex items-center gap-2"><Users className="h-6 w-6"/>Gestão de Equipes</h1>
          <p className="text-muted-foreground">Crie e gerencie suas equipes, horários e permissões.</p>
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
                                <div className="flex -space-x-2 overflow-hidden">
                                    {team.members.slice(0, 3).map(member => (
                                        <Avatar key={member.id} className="h-6 w-6 border-2 border-background">
                                            <AvatarImage src={member.avatar} />
                                            <AvatarFallback>{member.name[0]}</AvatarFallback>
                                        </Avatar>
                                    ))}
                                    {team.members.length > 3 && (
                                        <Avatar className="h-6 w-6 border-2 border-background">
                                            <AvatarFallback>+{team.members.length - 3}</AvatarFallback>
                                        </Avatar>
                                    )}
                                </div>
                            </button>
                        ))}
                         {filteredTeams.length === 0 && !isCreating && (
                            <div className="text-center text-sm text-muted-foreground p-4">
                                Nenhuma equipe encontrada.
                            </div>
                        )}
                    </nav>
                 </div>
            </aside>
            {/* Main content area */}
            <main className="flex-1 overflow-y-auto">
                <div className="max-w-4xl mx-auto py-6 px-4">
                    {isCreating ? (
                        <CreateTeamContent workspaceId={user.activeWorkspaceId!} roles={roles} onAddTeam={handleAddTeam} onCancel={() => setIsCreating(false)} />
                    ) : selectedTeam ? (
                        <TeamSettingsContent 
                            key={selectedTeam.id}
                            team={selectedTeam} 
                            allMembers={allMembers}
                            roles={roles}
                            tags={tags}
                            onTeamUpdate={handleTeamUpdate}
                            onTeamDelete={handleTeamDelete}
                        />
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
