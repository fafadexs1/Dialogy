'use client';

import React, { useState, useEffect } from 'react';
import type { User, Team, BusinessHour, Role, Tag } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, UserPlus, X, Search, Loader2, Save, Users, Palette, Copy, CalendarDays, CalendarOff, Clock3, HeartHandshake, ArrowUpRight, ChevronRight, ChevronsUpDown, History, Settings2, Route, ShieldCheck, Check, AlertCircle } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { getTeams, createTeam, updateTeam, deleteTeam, addTeamMember, removeTeamMember, updateBusinessHours, createScheduleException, deleteScheduleException } from '@/actions/teams';
import { getTags } from '@/actions/crm';
import { getWorkspaceMembers } from '@/actions/members';
import { getRolesAndPermissions } from '@/actions/permissions';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { DialogDescription } from '@/components/ui/dialog';
import { scheduleDateKey, splitScheduleExceptions } from '@/lib/team-calendar';
import styles from './team-page.module.css';
import { DistributionDiagnostics } from '@/components/team/distribution-diagnostics';

const daysOrder = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const DEFAULT_BUSINESS_HOURS = {
  start: '09:00',
  end: '18:00',
};

const sortBusinessHours = (businessHours: BusinessHour[]) => {
  return [...businessHours].sort((a, b) => daysOrder.indexOf(a.day) - daysOrder.indexOf(b.day));
};

function CopyButton({ textToCopy }: { textToCopy: string }) {
  const { toast } = useToast();
  const handleCopy = () => {
    navigator.clipboard.writeText(textToCopy);
    toast({ title: 'Copiado!', description: 'O ID foi copiado para a área de transferência.' });
  };
  return <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Copiar ID da equipe" onClick={handleCopy}><Copy className="h-3 w-3" /></Button>;
}

function AddExceptionDialog({ teamId, onAdd }: { teamId: string, onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [isClosed, setIsClosed] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !description.trim()) {
      toast({ title: 'Campos obrigatórios', description: 'Por favor, selecione a data e preencha a descrição.', variant: 'destructive' });
      return;
    }
    if (!isClosed && (!startTime || !endTime || startTime === endTime)) {
      toast({ title: 'Confira o horário', description: 'Informe horários de início e fim diferentes.', variant: 'destructive' });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await createScheduleException(teamId, {
        date: format(date, 'yyyy-MM-dd'),
        description: description.trim(),
        is_closed: isClosed,
        start_time: startTime,
        end_time: endTime,
      });

      if (result.success) {
        toast({ title: 'Exceção adicionada!' });
        setOpen(false);
        setDate(undefined);
        setDescription('');
        setIsClosed(false);
        setStartTime('09:00');
        setEndTime('18:00');
        onAdd();
      } else {
        toast({ title: 'Erro ao adicionar exceção', description: result.error, variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Não foi possível salvar', description: 'Tente novamente em instantes.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-2 h-4 w-4" /> Adicionar data
        </Button>
      </DialogTrigger>
      <DialogContent className={styles.surface}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Uma data fora da rotina</DialogTitle>
            <DialogDescription>Adicione um feriado, evento ou dia com horário especial.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div>
              <Label htmlFor="exception-date">Data</Label>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button id="exception-date" type="button"
                    variant={"outline"}
                    className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP", { locale: ptBR }) : <span>Selecione a data</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className={cn(styles.surface, "w-auto p-0")}>
                  <CalendarComponent mode="single" selected={date} onSelect={value => { setDate(value); if (value) setCalendarOpen(false); }} locale={ptBR} autoFocus />
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
                  <Label htmlFor="exception-start">Início</Label>
                  <Input id="exception-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
                <div className="flex-1">
                  <Label htmlFor="exception-end">Fim</Label>
                  <Input id="exception-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">Cancelar</Button></DialogClose>
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
  const [routingKeywords, setRoutingKeywords] = useState((team.agentRoutingConfig?.keywords || []).join(', '));
  const [routingResponseHint, setRoutingResponseHint] = useState(team.agentRoutingConfig?.responseHint || '');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const availableMembers = [...new Map(allMembers.filter(member => !team.members.some(current => current.id === member.id)).map(member => [member.id, member])).values()];
  const selectedMember = availableMembers.find(member => member.id === selectedAgentId);
  const sortedBusinessHours = sortBusinessHours(team.businessHours || []);

  const handleUpdateField = async (field: keyof Omit<Team, 'id' | 'businessHours' | 'members' | 'scheduleExceptions'>, value: any) => {
    // Treat "no-tag" as null for the database
    const finalValue = value === 'no-tag' ? null : value;

    const result = await updateTeam(team.id, { [field]: finalValue });
    if (result.error) {
      toast({ title: 'Erro ao atualizar', description: result.error, variant: 'destructive' });
    } else {
      const updatedTeam = { ...team, [field]: finalValue };
      onTeamUpdate(team.id, updatedTeam);
      toast({ title: "Campo atualizado!", duration: 2000 });
    }
  }

  const handleRoutingConfigUpdate = async (patch: NonNullable<Team['agentRoutingConfig']>) => {
    const nextConfig = {
      enabled: team.agentRoutingConfig?.enabled ?? false,
      autoTransfer: team.agentRoutingConfig?.autoTransfer ?? true,
      keywords: team.agentRoutingConfig?.keywords || [],
      responseHint: team.agentRoutingConfig?.responseHint || '',
      ...patch,
    };

    const result = await updateTeam(team.id, { agentRoutingConfig: nextConfig });
    if (result.error) {
      toast({ title: 'Erro ao atualizar roteamento', description: result.error, variant: 'destructive' });
      return;
    }

    onTeamUpdate(team.id, { ...team, agentRoutingConfig: nextConfig });
    toast({ title: 'Roteamento atualizado!', duration: 2000 });
  };

  const handleRoutingKeywordsBlur = () => {
    const keywords = routingKeywords
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .slice(0, 30);
    void handleRoutingConfigUpdate({ keywords });
  };

  const handleRoutingResponseBlur = () => {
    void handleRoutingConfigUpdate({ responseHint: routingResponseHint.trim() || null });
  };

  const handleRemoveTeam = async () => {
    const result = await deleteTeam(team.id);
    if (result.error) {
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
    if (result.error) {
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
    if (result.error) {
      toast({ title: 'Erro ao remover membro', description: result.error, variant: 'destructive' });
    } else {
      const updatedMembers = team.members.filter(m => m.id !== memberId);
      const updatedTeam = { ...team, members: updatedMembers };
      onTeamUpdate(team.id, updatedTeam);
    }
  }

  const handleBusinessHoursChange = async (businessHourId: string, field: keyof Omit<BusinessHour, 'id' | 'day'>, value: any) => {
    const currentHour = team.businessHours.find((bh) => bh.id === businessHourId);
    const payload = { [field]: value } as Partial<Pick<BusinessHour, 'isEnabled' | 'startTime' | 'endTime'>>;
    if (field === 'isEnabled' && value) {
      if (!currentHour?.startTime) {
        payload.startTime = DEFAULT_BUSINESS_HOURS.start;
      }
      if (!currentHour?.endTime) {
        payload.endTime = DEFAULT_BUSINESS_HOURS.end;
      }
    }
    const result = await updateBusinessHours(team.id, businessHourId, payload);
    if (result.error) {
      toast({ title: 'Erro ao salvar horário', description: result.error, variant: 'destructive' });
    } else {
      const updatedHours = team.businessHours.map(bh => bh.id === businessHourId ? { ...bh, ...payload } : bh);
      const updatedTeam = { ...team, businessHours: updatedHours };
      onTeamUpdate(team.id, updatedTeam);
    }
  };

  const handleRemoveException = async (exceptionId: string) => {
    const result = await deleteScheduleException(exceptionId);
    if (result.error) {
      toast({ title: 'Erro ao remover exceção', description: result.error, variant: 'destructive' });
    } else {
      toast({ title: 'Exceção removida!' });
      onMutate();
    }
  }

  return (
    <div className={styles.teamDetail}>
      <div className={styles.teamHeading}>
        <div className={styles.teamIdentity}>
          <div className={styles.teamEmblem} style={{ '--team-color': team.color } as React.CSSProperties}><Users size={25} /></div>
          <div className="min-w-0">
            <span className={styles.eyebrow}>ESPAÇO DA EQUIPE</span>
            <h2 className={styles.teamName}>{team.name}</h2>
            <div className={styles.teamMeta}>
              <span><Users size={13} /> {team.members.length} {team.members.length === 1 ? 'pessoa' : 'pessoas'}</span>
              <span><ShieldCheck size={13} /> {roles.find(role => role.id === team.roleId)?.name || 'Papel da equipe'}</span>
            </div>
          </div>
        </div>
        <div className={styles.headingAvatars} aria-label="Membros da equipe">
          {team.members.slice(0, 4).map(member => (
            <Avatar key={member.id} className="h-10 w-10 border-[3px] border-card">
              <AvatarImage src={member.avatar || undefined} alt={member.name} />
              <AvatarFallback>{member.name.charAt(0)}</AvatarFallback>
            </Avatar>
          ))}
          {team.members.length > 4 && <span className={styles.avatarMore}>+{team.members.length - 4}</span>}
        </div>
      </div>
      <Tabs defaultValue="overview" className={styles.detailTabs}>
        <TabsList className={styles.tabBar} aria-label="Configurações da equipe">
          <TabsTrigger value="overview"><Users size={15} /> A equipe</TabsTrigger>
          <TabsTrigger value="schedule"><CalendarDays size={15} /> Horários e feriados</TabsTrigger>
          <TabsTrigger value="routing"><Route size={15} /> Roteamento</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className={styles.tabContent}>
          <Card className={styles.panel}>
            <CardHeader className={styles.panelHeading}>
              <span className={styles.sectionIcon}><Settings2 size={19} /></span>
              <div><CardTitle className="text-base">Do seu jeito</CardTitle><CardDescription>Nome, identidade e permissões da equipe.</CardDescription></div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`team-name-${team.id}`}>Nome da equipe</Label>
                  <Input id={`team-name-${team.id}`} value={teamName} onChange={e => setTeamName(e.target.value)} onBlur={e => { if (e.target.value.trim() && e.target.value !== team.name) void handleUpdateField('name', e.target.value.trim()); }} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`team-color-${team.id}`}>Cor da equipe</Label>
                  <div className={styles.colorInput}>
                    <Palette size={15} className="text-muted-foreground" />
                    <input id={`team-color-${team.id}`} aria-label="Cor da equipe" type="color" defaultValue={team.color} onBlur={e => { if (e.target.value !== team.color) void handleUpdateField('color', e.target.value); }} />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`team-role-${team.id}`}>Papel da equipe</Label>
                  <Select value={team.roleId} onValueChange={value => handleUpdateField('roleId', value)}>
                    <SelectTrigger id={`team-role-${team.id}`}><SelectValue placeholder="Selecione um papel" /></SelectTrigger>
                    <SelectContent className={styles.surface}>{roles.map(role => <SelectItem key={role.id} value={role.id}>{role.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`team-tag-${team.id}`}>Tag automática</Label>
                  <Select value={team.tagId || 'no-tag'} onValueChange={value => handleUpdateField('tagId', value)}>
                    <SelectTrigger id={`team-tag-${team.id}`}><SelectValue placeholder="Nenhuma tag" /></SelectTrigger>
                    <SelectContent className={styles.surface}>
                      <SelectItem value="no-tag">Nenhuma tag</SelectItem>
                      {tags.map(tag => <SelectItem key={tag.id} value={tag.id}><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />{tag.label}</span></SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className={styles.idLine}><span>ID da equipe</span><code>{team.id}</code><CopyButton textToCopy={team.id} /></div>
            </CardContent>
          </Card>
          <Card className={styles.panel}>
            <CardHeader className={styles.panelHeading}>
              <span className={styles.sectionIcon}><HeartHandshake size={19} /></span>
              <div className="flex-1"><CardTitle className="text-base">Quem faz acontecer</CardTitle><CardDescription>Pessoas que dão vida ao atendimento.</CardDescription></div>
              <span className={styles.count}>{team.members.length}</span>
            </CardHeader>
            <CardContent>
              <div className={styles.memberList}>
                {team.members.map(member => (
                  <div key={member.id} className={styles.memberRow}>
                    <Avatar className="h-10 w-10"><AvatarImage src={member.avatar || undefined} alt={member.name} /><AvatarFallback>{member.name.charAt(0)}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.name}</p><p className="text-xs text-muted-foreground">Membro da equipe</p></div>
                    <Button size="icon" variant="ghost" className={styles.subtleAction} aria-label={`Remover ${member.name} da equipe`} onClick={() => handleRemoveMember(member.id)}><X size={15} /></Button>
                  </div>
                ))}
                {team.members.length === 0 && <p className={styles.emptyInline}>Toda boa equipe começa com alguém. Adicione a primeira pessoa abaixo.</p>}
              </div>
              <div className={styles.addMember}>
                <Popover open={memberPickerOpen} onOpenChange={setMemberPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" role="combobox" aria-expanded={memberPickerOpen} aria-label="Selecionar um novo membro" className={styles.memberPickerTrigger}>
                      {selectedMember ? <><Avatar className="h-7 w-7 shrink-0"><AvatarImage src={selectedMember.avatar || selectedMember.avatar_url || undefined} alt={selectedMember.name} /><AvatarFallback>{selectedMember.name.charAt(0)}</AvatarFallback></Avatar><span className="truncate">{selectedMember.name}</span></> : <span className="truncate text-muted-foreground">Escolha alguém para somar</span>}
                      <ChevronsUpDown className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className={cn(styles.surface, styles.memberPicker)}>
                    <Command className={styles.memberCommand} filter={(value, search, keywords) => {
                      const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
                      const text = normalize(keywords?.join(' ') || value);
                      return normalize(search).trim().split(/\s+/).every(word => text.includes(word)) ? 1 : 0;
                    }}>
                      <CommandInput placeholder="Buscar por nome ou e-mail..." aria-label="Buscar pessoa para adicionar à equipe" />
                      <CommandList aria-label="Pessoas disponíveis para a equipe">
                        <CommandEmpty>{availableMembers.length === 0 ? 'Todas as pessoas do workspace já estão nesta equipe.' : 'Nenhuma pessoa encontrada. Tente outro nome ou e-mail.'}</CommandEmpty>
                        <CommandGroup heading="Pessoas do workspace">
                          {availableMembers.map(member => <CommandItem key={member.id} value={member.id} keywords={[member.name, member.email || '']} onSelect={() => { setSelectedAgentId(member.id); setMemberPickerOpen(false); }} className={styles.memberPickerOption}>
                            <Avatar className="h-9 w-9 shrink-0"><AvatarImage src={member.avatar || member.avatar_url || undefined} alt={member.name} /><AvatarFallback>{member.name.split(' ').filter(Boolean).map(part => part[0]).slice(0, 2).join('')}</AvatarFallback></Avatar>
                            <span className="min-w-0 flex-1"><span className={styles.pickerName}>{member.name}</span>{member.email && <span className={styles.pickerEmail}>{member.email}</span>}</span>
                            <Check className={cn('h-4 w-4 shrink-0 text-primary', selectedAgentId === member.id ? 'opacity-100' : 'opacity-0')} />
                          </CommandItem>)}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Button onClick={handleAddMember} disabled={!selectedAgentId || isAddingMember}>
                  {isAddingMember ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />} Adicionar
                </Button>
              </div>
            </CardContent>
          </Card>
          <div className={styles.detailFooter}>
            <span><Check size={14} /> Alterações salvas ao sair de cada campo</span>
            <Dialog>
              <DialogTrigger asChild><Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive"><Trash2 className="mr-2 h-3.5 w-3.5" /> Remover equipe</Button></DialogTrigger>
              <DialogContent className={styles.surface}>
                <DialogHeader><DialogTitle>Remover {team.name}?</DialogTitle><DialogDescription>Esta ação remove a equipe e suas configurações de atendimento. Os membros continuam no workspace.</DialogDescription></DialogHeader>
                <DialogFooter><DialogClose asChild><Button variant="outline">Cancelar</Button></DialogClose><Button variant="destructive" onClick={handleRemoveTeam}>Remover equipe</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </TabsContent>
        <TabsContent value="schedule" className={styles.tabContent}>
          <div className={styles.scheduleNote}><Clock3 size={18} /><p>Um ritmo bom para todo mundo.<span> Defina a rotina da equipe e reserve espaço para as datas especiais.</span></p></div>
          <Card className={styles.panel}>
            <CardHeader className={styles.panelHeading}><span className={styles.sectionIcon}><Clock3 size={19} /></span><div><CardTitle className="text-base">A rotina da semana</CardTitle><CardDescription>Escolha os dias e horários de atendimento.</CardDescription></div></CardHeader>
            <CardContent>
              <div className={styles.hoursList}>
                {sortedBusinessHours.map(bh => (
                  <div key={bh.id} className={cn(styles.hoursRow, !bh.isEnabled && styles.dayOff)}>
                    <div className={styles.dayLabel}><Switch id={`switch-${team.id}-${bh.id}`} checked={bh.isEnabled} onCheckedChange={checked => handleBusinessHoursChange(bh.id, 'isEnabled', checked)} /><Label htmlFor={`switch-${team.id}-${bh.id}`}>{bh.day}</Label></div>
                    {bh.isEnabled ? (
                      <div className={styles.timeRange}>
                        <Input type="time" aria-label={`Início em ${bh.day}`} defaultValue={bh.startTime || DEFAULT_BUSINESS_HOURS.start} onBlur={e => handleBusinessHoursChange(bh.id, 'startTime', e.target.value)} />
                        <span>até</span>
                        <Input type="time" aria-label={`Fim em ${bh.day}`} defaultValue={bh.endTime || DEFAULT_BUSINESS_HOURS.end} onBlur={e => handleBusinessHoursChange(bh.id, 'endTime', e.target.value)} />
                      </div>
                    ) : <span className={styles.restLabel}>Sem expediente</span>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <ScheduleExceptions team={team} onMutate={onMutate} onRemove={handleRemoveException} />
        </TabsContent>
        <TabsContent value="routing" className={styles.tabContent}>
          <DistributionDiagnostics teamId={team.id} />
          <Card className={styles.panel}>
            <CardHeader className={styles.panelHeading}><span className={styles.sectionIcon}><Route size={19} /></span><div><CardTitle className="text-base">Cada conversa, no lugar certo</CardTitle><CardDescription>Encaminhe atendimentos para quem pode ajudar.</CardDescription></div></CardHeader>
            <CardContent className="space-y-6">
              <div className={styles.routingToggle}>
                <div><Label htmlFor={`team-routing-${team.id}`}>Roteamento automático por IA</Label><p className="mt-1 text-sm text-muted-foreground">Use palavras-chave para direcionar conversas para esta equipe.</p></div>
                <Switch id={`team-routing-${team.id}`} checked={Boolean(team.agentRoutingConfig?.enabled)} onCheckedChange={checked => handleRoutingConfigUpdate({ enabled: checked })} />
              </div>
              <div className="space-y-2"><Label htmlFor={`team-routing-keywords-${team.id}`}>Palavras-chave</Label><Input id={`team-routing-keywords-${team.id}`} value={routingKeywords} onChange={event => setRoutingKeywords(event.target.value)} onBlur={handleRoutingKeywordsBlur} placeholder="Ex: contratar, orçamento, planos, vendas" /><p className="text-xs text-muted-foreground">Separe por vírgulas. Escolha termos que combinem com esta equipe.</p></div>
              <div className="space-y-2"><Label htmlFor={`team-routing-response-${team.id}`}>Mensagem antes da transferência</Label><Input id={`team-routing-response-${team.id}`} value={routingResponseHint} onChange={event => setRoutingResponseHint(event.target.value)} onBlur={handleRoutingResponseBlur} placeholder={`Vou encaminhar seu atendimento para a equipe ${team.name}.`} /></div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ScheduleExceptions({ team, onMutate, onRemove }: { team: Team; onMutate: () => void; onRemove: (id: string) => void }) {
  const [period, setPeriod] = useState('upcoming');
  const [year, setYear] = useState('all');
  const [today, setToday] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  useEffect(() => {
    const timer = window.setInterval(() => setToday(format(new Date(), 'yyyy-MM-dd')), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const { upcoming, history } = splitScheduleExceptions(team.scheduleExceptions || [], today);
  const years = [...new Set(history.map(ex => scheduleDateKey(ex.date).slice(0, 4)))].sort().reverse();
  const entries = period === 'history' ? history.filter(ex => year === 'all' || ex.date.startsWith(year)) : upcoming;

  return (
    <Card className={styles.panel}>
      <CardHeader className={cn(styles.panelHeading, styles.calendarHeading)}>
        <span className={styles.sectionIcon}><CalendarDays size={19} /></span>
        <div className="min-w-0 flex-1"><CardTitle className="text-base">Datas que merecem atenção</CardTitle><CardDescription>Feriados, eventos e horários especiais, com histórico.</CardDescription></div>
        <AddExceptionDialog teamId={team.id} onAdd={onMutate} />
      </CardHeader>
      <CardContent>
        <Tabs value={period} onValueChange={setPeriod}>
          <div className={styles.calendarToolbar}>
            <TabsList className={styles.periodTabs} aria-label="Período das datas especiais">
              <TabsTrigger value="upcoming"><CalendarDays size={14} /> Próximas <span className={styles.smallCount}>{upcoming.length}</span></TabsTrigger>
              <TabsTrigger value="history"><History size={14} /> Histórico <span className={styles.smallCount}>{history.length}</span></TabsTrigger>
            </TabsList>
            {period === 'history' && years.length > 0 && <Select value={year} onValueChange={setYear}><SelectTrigger className="w-[145px]" aria-label="Filtrar histórico por ano"><SelectValue /></SelectTrigger><SelectContent className={styles.surface}><SelectItem value="all">Todos os anos</SelectItem>{years.map(item => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>}
          </div>
          {['upcoming', 'history'].map(value => (
            <TabsContent key={value} value={value} className="mt-0">
              {entries.length ? <div className={styles.exceptionList}>
                {entries.map(ex => {
                  const date = parseISO(scheduleDateKey(ex.date));
                  return <div key={ex.id} className={styles.exceptionRow}>
                    <div className={styles.dateTile}><span>{format(date, 'MMM', { locale: ptBR }).replace('.', '')}</span><strong>{format(date, 'dd')}</strong></div>
                    <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{ex.description}</p><p className="mt-1 text-xs text-muted-foreground">{format(date, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}</p></div>
                    <span className={cn(styles.exceptionStatus, ex.is_closed && styles.closedStatus)}>{ex.is_closed ? <CalendarOff size={13} /> : <Clock3 size={13} />}{ex.is_closed ? 'Sem expediente' : `${ex.start_time?.slice(0, 5)} – ${ex.end_time?.slice(0, 5)}`}</span>
                    {value === 'upcoming' && <Button variant="ghost" size="icon" className={styles.subtleAction} aria-label={`Remover data: ${ex.description}`} onClick={() => onRemove(ex.id)}><Trash2 size={15} /></Button>}
                  </div>;
                })}
              </div> : <div className={styles.calendarEmpty}>
                <span className={styles.emptyIcon}>{value === 'history' ? <History size={25} /> : <CalendarDays size={25} />}</span>
                <h3>{value === 'history' ? 'A história começa por aqui' : 'Tudo em dia por aqui'}</h3>
                <p>{value === 'history' ? 'As datas passadas ficam guardadas aqui para você consultar quando precisar.' : 'Nenhuma data especial pela frente. Adicione os próximos feriados e eventos da equipe.'}</p>
              </div>}
            </TabsContent>
          ))}
        </Tabs>
        <p className={styles.historyHint}><History size={13} /> Depois que a data passa, ela continua disponível no histórico.</p>
      </CardContent>
    </Card>
  );
}

function CreateTeamContent({ workspaceId, roles, onAddTeam, onCancel }: { workspaceId: string, roles: Role[], onAddTeam: (newTeam: Team) => void, onCancel: () => void }) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const roleId = formData.get('roleId') as string;

    if (!name.trim() || !roleId) {
      toast({ title: 'Campos obrigatórios', description: 'Nome da equipe e papel são obrigatórios.', variant: 'destructive' });
      setIsSubmitting(false);
      return;
    };

    const result = await createTeam({ workspaceId, name, roleId });
    if (result.error || !result.team) {
      toast({ title: 'Erro ao criar equipe', description: result.error, variant: 'destructive' });
    } else {
      toast({ title: 'Equipe criada com sucesso!' });
      onAddTeam(result.team);
    }
    setIsSubmitting(false);
  }

  return (
    <div className="p-1">
      <Card className={styles.panel}>
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <span className={styles.sectionIcon}><UserPlus size={23} /></span>
            <CardTitle className="pt-3 text-2xl">Boas conexões começam aqui</CardTitle>
            <CardDescription>Dê um nome à sua nova equipe e escolha como ela vai colaborar.</CardDescription>
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
                <SelectContent className={styles.surface}>
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
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
  const user = useCurrentUser();
  const [teams, setTeams] = useState<Team[]>([]);
  const [allMembers, setAllMembers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const { toast } = useToast();

  const fetchData = React.useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
    setLoadError(null);
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
          setSelectedTeamId(current => teamsData.teams.some(t => t.id === current) ? current : teamsData.teams[0].id);
        } else {
          setSelectedTeamId(null);
        }
      }

      if (membersData.error) throw new Error(membersData.error);
      // Cast to User[], as WorkspaceMember is a subset
      setAllMembers(membersData.members as unknown as User[] || []);

      if (rolesData.error) throw new Error(rolesData.error);
      setRoles(rolesData.roles || []);

      if (tagsData.error) throw new Error(tagsData.error);
      setTags(tagsData.tags?.filter(t => !t.is_close_reason) || []);

    } catch (e: any) {
      setLoadError(e.message || 'Não foi possível carregar as equipes.');
      toast({ title: "Erro ao buscar dados", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [user?.activeWorkspaceId, toast]);


  useEffect(() => {
    if (user?.activeWorkspaceId) {
      setLoading(true);
      void fetchData();
    }
  }, [user?.activeWorkspaceId, fetchData]);

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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const peopleCount = new Set(teams.flatMap(team => team.members.map(member => member.id))).size;
  return (
    <div className={cn(styles.page, styles.surface)}>
      <header className={styles.pageHeader}>
        <div className={styles.headerTop}>
          <span className={styles.breadcrumb}>Workspace <ChevronRight size={12} /> Equipes</span>
          <span className={styles.headerLabel}><HeartHandshake size={14} /> Feito de pessoas</span>
        </div>
        <div className={styles.welcomeRow}>
          <div><span className={styles.eyebrow}>GENTE QUE CONECTA</span><h1>Juntos, o atendimento<br className="hidden sm:block" /> fica mais humano<span className={styles.titleDot}>.</span></h1><p>Um espaço para cuidar de quem cuida dos seus clientes.</p></div>
          <Button onClick={handleCreateClick} className={styles.createButton}><Plus size={17} /> Criar equipe <ArrowUpRight size={16} /></Button>
        </div>
        <div className={styles.workspaceSummary}>
          <span><Users size={15} /><strong>{teams.length}</strong> {teams.length === 1 ? 'equipe' : 'equipes'}</span>
          <span><HeartHandshake size={15} /><strong>{peopleCount}</strong> {peopleCount === 1 ? 'pessoa conectada' : 'pessoas conectadas'}</span>
          <span className={styles.summaryHint}>Cada pessoa faz a diferença.</span>
        </div>
      </header>
      {loadError && <div className={styles.loadError} role="alert"><AlertCircle size={18} /><p>{loadError}</p><Button variant="outline" size="sm" onClick={() => void fetchData()}>Tentar novamente</Button></div>}
      <div className={styles.workspace}>
        <aside className={styles.teamSidebar} aria-label="Lista de equipes">
          <div className={styles.sidebarTitle}><h2>Suas equipes</h2><span className={styles.count}>{teams.length}</span></div>
          <div className={styles.teamSearch}><Search size={16} /><Input aria-label="Buscar equipe" placeholder="Encontrar uma equipe..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>
          <nav className={styles.teamList} aria-label="Selecionar equipe">
            {filteredTeams.map(team => (
              <button key={team.id} onClick={() => handleSelectTeam(team.id)} aria-current={selectedTeamId === team.id ? 'true' : undefined} className={cn(styles.teamOption, selectedTeamId === team.id && styles.teamSelected)}>
                <span className={styles.listEmblem} style={{ '--team-color': team.color } as React.CSSProperties}><Users size={18} /></span>
                <span className="min-w-0 flex-1"><span className={styles.listName}>{team.name}</span><span className={styles.listDescription}>{team.members.length} {team.members.length === 1 ? 'pessoa na equipe' : 'pessoas na equipe'}</span></span>
                <ChevronRight size={15} className={styles.teamArrow} />
              </button>
            ))}
            {filteredTeams.length === 0 && <div className={styles.sidebarEmpty}><Search size={22} /><p>{searchTerm ? 'Nenhuma equipe com esse nome.' : 'Sua primeira equipe começa aqui.'}</p>{searchTerm && <Button variant="ghost" size="sm" onClick={() => setSearchTerm('')}>Limpar busca</Button>}</div>}
          </nav>
          <div className={styles.sidebarNote}><span className={styles.sectionIcon}><HeartHandshake size={20} /></span><h3>Cada talento tem seu lugar.</h3><p>Organize pessoas, alinhe a rotina e abra espaço para boas conversas.</p></div>
        </aside>
        <main className={styles.mainContent}>
          {isCreating ? (
            user.activeWorkspaceId && <CreateTeamContent workspaceId={user.activeWorkspaceId} roles={roles} onAddTeam={handleAddTeam} onCancel={() => setIsCreating(false)} />
          ) : selectedTeam ? (
            <TeamSettingsContent key={selectedTeam.id} team={selectedTeam} allMembers={allMembers} roles={roles} tags={tags} onTeamUpdate={handleTeamUpdate} onTeamDelete={handleTeamDelete} onMutate={fetchData} />
          ) : (
            <div className={styles.welcomeEmpty}><span className={styles.emptyIcon}><HeartHandshake size={34} /></span><span className={styles.eyebrow}>MELHOR QUANDO É JUNTO</span><h2>Uma boa conversa<br />começa com uma boa equipe.</h2><p>Reúna as pessoas certas e organize um atendimento com a cara do seu negócio.</p><Button onClick={handleCreateClick}><Plus size={16} className="mr-2" /> Criar sua primeira equipe</Button></div>
          )}
        </main>
      </div>
    </div>
  );
}
