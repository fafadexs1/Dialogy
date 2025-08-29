

'use client';

import React, { useState, useEffect } from 'react';
import type { User, Team, BusinessHour, Role, Tag, ScheduleException } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, UserPlus, X, Search, Loader2, Save, Users, Palette, Tag as TagIcon, Copy, Calendar, CalendarOff, AlertCircle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { getTeams, createTeam, updateTeam, deleteTeam, addTeamMember, removeTeamMember, updateBusinessHours, createScheduleException, deleteScheduleException } from '@/actions/teams';
import { getTags } from '@/actions/crm';
import { getWorkspaceMembers } from '@/actions/members';
import { getRolesAndPermissions } from '@/actions/permissions';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';

const daysOrder = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

const sortBusinessHours = (businessHours: BusinessHour[]) => {
  return [...businessHours].sort((a, b) => daysOrder.indexOf(a.day) - daysOrder.indexOf(b.day));
};

function CopyButton({ textToCopy }: { textToCopy: string }) {
    const { toast } = useToast();
    const handleCopy = () => {
        navigator.clipboard.writeText(textToCopy);
        toast({ title: 'Copiado!', description: 'O ID foi copiado para a área de transferência.' });
    };
    return <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}><Copy className="h-3 w-3" /></Button>;
}

function AddExceptionDialog({ teamId, onAdd }: { teamId: string, onAdd: () => void }) {
    const [date, setDate] = useState<Date | undefined>(undefined);
    const [isClosed, setIsClosed] = useState(false);
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('18:00');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { toast } = useToast();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!date || !description) {
            toast({ title: 'Campos obrigatórios', description: 'Por favor, selecione a data e preencha a descrição.', variant: 'destructive' });
            return;
        }
        setIsSubmitting(true);
        const result = await createScheduleException(teamId, {
            date: date.toISOString().split('T')[0],
            description,
            is_closed: isClosed,
            start_time: startTime,
            end_time: endTime,
        });

        if (result.success) {
            toast({ title: 'Exceção adicionada!' });
            onAdd();
        } else {
            toast({ title: 'Erro ao adicionar exceção', description: result.error, variant: 'destructive' });
        }
        setIsSubmitting(false);
    }
    
    return (
        <Dialog>
            <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                    <Plus className="mr-2 h-4 w-4" /> Adicionar Exceção
                </Button>
            </DialogTrigger>
            <DialogContent>
                <form onSubmit={handleSubmit}>
                    <DialogHeader>
                        <DialogTitle>Adicionar Exceção ao Calendário</DialogTitle>
                        <p className="text-sm text-muted-foreground">Configure um dia com horário diferente ou sem expediente.</p>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div>
                            <Label>Data</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                    variant={"outline"}
                                    className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                                    >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {date ? format(date, "PPP", { locale: ptBR }) : <span>Selecione a data</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <CalendarComponent mode="single" selected={date} onSelect={setDate} initialFocus />
                                </PopoverContent>
                            </Popover>
                        </div>
                         <div>
                            <Label htmlFor="exception-description">Descrição</Label>
                            <Input id="exception-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Feriado de Ano Novo" />
                        </div>
                        <div className="flex items-center space-x-2">
                           <Checkbox id="is-closed" checked={isClosed} onCheckedChange={(checked) => setIsClosed(Boolean(checked))} />
                           <Label htmlFor="is-closed">A equipe não trabalhará neste dia.</Label>
                        </div>
                        {!isClosed && (
                            <div className="flex items-center gap-2 animate-in fade-in-50">
                                <div className="flex-1">
                                    <Label>Início</Label>
                                    <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                                </div>
                                <div className="flex-1">
                                    <Label>Fim</Label>
                                    <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                                </div>
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <DialogClose asChild><Button variant="ghost">Cancelar</Button></DialogClose>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Salvar Exceção
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}

function TeamSettingsContent({ 
    team, 
    allMembers,
    roles,
    tags,
    onTeamUpdate,
    onTeamDelete,
    onMutate,
}: { 
    team: Team, 
    allMembers: User[],
    roles: Role[],
    tags: Tag[],
    onTeamUpdate: (teamId: string, updatedTeam: Team) => void;
    onTeamDelete: (teamId: string) => void;
    onMutate: () => void;
}) {
  const { toast } = useToast();
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [teamName, setTeamName] = useState(team.name);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const sortedBusinessHours = sortBusinessHours(team.businessHours || []);

  const handleUpdateField = async (field: keyof Omit<Team, 'id' | 'businessHours' | 'members' | 'scheduleExceptions'>, value: any) => {
    // Treat "no-tag" as null for the database
    const finalValue = value === 'no-tag' ? null : value;
    
    const result = await updateTeam(team.id, { [field]: finalValue });
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
    
    setIsAddingMember(true);
    const result = await addTeamMember(team.id, agentToAdd.id);
    if(result.error) {
      toast({ title: 'Erro ao adicionar membro', description: result.error, variant: 'destructive' });
    } else {
      const updatedTeam = { ...team, members: [...team.members, agentToAdd] };
      onTeamUpdate(team.id, updatedTeam);
    }
    setIsAddingMember(false);
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
  
  const handleBusinessHoursChange = async (businessHourId: string, field: keyof Omit<BusinessHour, 'id' | 'day'>, value: any) => {
    const result = await updateBusinessHours(team.id, businessHourId, { [field]: value });
    if(result.error) {
      toast({ title: 'Erro ao salvar horário', description: result.error, variant: 'destructive' });
    } else {
       const updatedHours = team.businessHours.map(bh => bh.id === businessHourId ? { ...bh, [field]: value } : bh);
       const updatedTeam = { ...team, businessHours: updatedHours };
       onTeamUpdate(team.id, updatedTeam);
    }
  };
  
  const handleRemoveException = async (exceptionId: string) => {
    const result = await deleteScheduleException(exceptionId);
    if (result.error) {
        toast({ title: 'Erro ao remover exceção', description: result.error, variant: 'destructive'});
    } else {
        toast({ title: 'Exceção removida!'});
        onMutate();
    }
  }

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
                <div className="flex items-center gap-1 mt-2">
                    <span className="text-xs font-mono text-muted-foreground">ID: {team.id}</span>
                    <CopyButton textToCopy={team.id} />
                </div>
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
                value={team.tagId || 'no-tag'}
                onValueChange={(value) => handleUpdateField('tagId', value)}
              >
                  <SelectTrigger id={`team-tag-${team.id}`}>
                      <SelectValue placeholder="Nenhuma tag automática" />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="no-tag">Nenhuma tag</SelectItem>
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
              <Button onClick={handleAddMember} disabled={!selectedAgentId || isAddingMember}>
                {isAddingMember ? <Loader2 className="mr-2 h-4 w-4 animate-spin"/> : <UserPlus className="mr-2 h-4 w-4"/>}
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
              <div key={bh.id} className="flex items-center justify-between p-3 rounded-lg bg-background border">
                <div className='flex items-center gap-4'>
                  <Switch 
                    id={`switch-${team.id}-${bh.id}`} 
                    checked={bh.isEnabled}
                    onCheckedChange={(checked) => handleBusinessHoursChange(bh.id, 'isEnabled', checked)}
                  />
                  <Label htmlFor={`switch-${team.id}-${bh.id}`} className='font-medium text-base min-w-[100px]'>{bh.day}</Label>
                </div>
                <div className={`flex items-center gap-2 transition-opacity ${bh.isEnabled ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                  <Input 
                    type="time" 
                    defaultValue={bh.startTime || '09:00'}
                    onBlur={(e) => handleBusinessHoursChange(bh.id, 'startTime', e.target.value)}
                    className="w-[110px]" 
                  />
                  <span className="text-muted-foreground">às</span>
                  <Input 
                    type="time" 
                    defaultValue={bh.endTime || '18:00'}
                    onBlur={(e) => handleBusinessHoursChange(bh.id, 'endTime', e.target.value)}
                    className="w-[110px]" 
                  />
                </div>
              </div>
            ))}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row justify-between items-center">
          <div>
            <CardTitle>Exceções de Calendário</CardTitle>
            <CardDescription>Configure feriados, eventos ou dias com horários especiais.</CardDescription>
          </div>
          <AddExceptionDialog teamId={team.id} onAdd={onMutate} />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {team.scheduleExceptions && team.scheduleExceptions.length > 0 ? (
                team.scheduleExceptions.map(ex => (
                    <div key={ex.id} className="flex items-center justify-between p-3 text-sm border rounded-md bg-secondary/30">
                        <div className="flex items-center gap-3">
                            <CalendarOff className="h-5 w-5 text-muted-foreground" />
                            <div>
                                <p className="font-semibold">{ex.description}</p>
                                <p className="text-xs">
                                    <span className="font-medium">{format(new Date(ex.date), 'PPP', { locale: ptBR })}</span>
                                    {' - '}
                                    {ex.is_closed ? 'Fechado o dia todo' : `${ex.start_time} às ${ex.end_time}`}
                                </p>
                            </div>
                        </div>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveException(ex.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                    </div>
                ))
            ) : (
                <div className="text-center p-6 border-2 border-dashed rounded-lg">
                    <p className="text-sm text-muted-foreground">Nenhuma exceção configurada para os próximos dias.</p>
                </div>
            )}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}

function CreateTeamContent({ workspaceId, roles, onAddTeam, onCancel }: { workspaceId:string, roles: Role[], onAddTeam: (newTeam: Team) => void, onCancel: () => void }) {
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsSubmitting(true);
        const formData = new FormData(e.currentTarget);
        const name = formData.get('name') as string;
        const roleId = formData.get('roleId') as string;

        if (!name.trim() || !roleId) {
            toast({title: 'Campos obrigatórios', description: 'Nome da equipe e papel são obrigatórios.', variant: 'destructive' });
            setIsSubmitting(false);
            return;
        };

        const result = await createTeam({ workspaceId, name, roleId });
        if (result.error || !result.team) {
            toast({title: 'Erro ao criar equipe', description: result.error, variant: 'destructive'});
        } else {
            toast({title: 'Equipe criada com sucesso!'});
            onAddTeam(result.team);
        }
        setIsSubmitting(false);
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
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>}
                            <Save className='mr-2 h-4 w-4' /> Salvar Equipe
                        </Button>
                        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    )
}


export default function TeamPage() {
    const [user, setUser] = useState<User | null>(null);
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
        const fetchUser = async () => {
            try {
                const res = await fetch('/api/user');
                if (res.ok) {
                    setUser(await res.json());
                } else {
                    setLoading(false);
                }
            } catch (e) {
                setLoading(false);
            }
        };
        fetchUser();
    }, []);

    const fetchData = React.useCallback(async () => {
        if (!user?.activeWorkspaceId) return;
        setLoading(true);
        try {
            const [teamsData, membersData, rolesData, tagsData] = await Promise.all([
                getTeams(user.activeWorkspaceId),
                getWorkspaceMembers(user.activeWorkspaceId),
                getRolesAndPermissions(user.activeWorkspaceId),
                getTags(user.activeWorkspaceId)
            ]);

            if (teamsData) {
                if (teamsData.error) throw new Error(teamsData.error);
                setTeams(teamsData.teams || []);
                if (teamsData.teams && teamsData.teams.length > 0) {
                     // Check if the previously selected team still exists
                    if (!teamsData.teams.some(t => t.id === selectedTeamId)) {
                        setSelectedTeamId(teamsData.teams[0].id);
                    }
                } else {
                    setSelectedTeamId(null);
                }
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
    }, [user?.activeWorkspaceId, toast, selectedTeamId]);


    useEffect(() => {
        if(user) fetchData();
    }, [user, fetchData]);

    const handleTeamUpdate = (teamId: string, updatedTeam: Team) => {
        setTeams(prev => prev.map(t => t.id === teamId ? updatedTeam : t));
    };

    const handleTeamDelete = (teamId: string) => {
        setTeams(prev => {
            const newTeams = prev.filter(t => t.id !== teamId);
             setSelectedTeamId(newTeams[0]?.id || null);
             if (newTeams.length === 0) setIsCreating(false);
            return newTeams;
        });
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

    if (loading || !user) {
        return (
            <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-primary"/>
            </div>
        );
    }

  return (
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
                       user.activeWorkspaceId && <CreateTeamContent workspaceId={user.activeWorkspaceId} roles={roles} onAddTeam={handleAddTeam} onCancel={() => setIsCreating(false)} />
                    ) : selectedTeam ? (
                        <TeamSettingsContent 
                            key={selectedTeam.id}
                            team={selectedTeam} 
                            allMembers={allMembers}
                            roles={roles}
                            tags={tags}
                            onTeamUpdate={handleTeamUpdate}
                            onTeamDelete={handleTeamDelete}
                            onMutate={fetchData}
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
  );
}
