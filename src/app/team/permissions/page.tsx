'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Permission, Role } from '@/lib/types';
import { AlertCircle, ArrowUpRight, BarChart3, Check, CheckCheck, ChevronRight, ContactRound, Fingerprint, HeartHandshake, KeyRound, LayoutList, Loader2, LockKeyhole, Megaphone, MessageCircle, Pencil, Plus, Search, Settings2, ShieldCheck, Sparkles, Table2, Trash2, Users, Workflow, X } from 'lucide-react';
import { getRolesAndPermissions, updateRolePermissionAction, createRoleAction, updateRoleAction, deleteRoleAction } from '@/actions/permissions';
import { useCurrentUser } from '@/hooks/use-online-status';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { filterPermissionGroups, hasRolePermission, isProtectedRole, setRolePermission, type PermissionFilter } from '@/lib/permission-editor';
import shared from '../team-page.module.css';
import styles from './permissions-page.module.css';

const categoryOrder = ['Chat', 'CRM', 'Equipes', 'Membros', 'Campanhas', 'Automações', 'Analytics', 'Workspace', 'Faturamento', 'Atalhos'];
const compareCategories = (a: string, b: string) => {
  const position = (value: string) => categoryOrder.includes(value) ? categoryOrder.indexOf(value) : categoryOrder.length;
  return position(a) - position(b) || a.localeCompare(b, 'pt-BR');
};
const categoryDescriptions: Record<string, string> = {
  Chat: 'Conversas, atendimentos e conexão com seus clientes.',
  CRM: 'Contatos e informações que aproximam sua equipe dos clientes.',
  Equipes: 'Organização de pessoas e equipes de atendimento.',
  Membros: 'Pessoas, funções e controle de acesso ao workspace.',
  Campanhas: 'Comunicação com seus contatos e gestão de campanhas.',
  Automações: 'Piloto Automático e agentes que apoiam a equipe.',
  Analytics: 'Visibilidade sobre os resultados do atendimento.',
  Workspace: 'Configurações e convites para o seu espaço de trabalho.',
  Faturamento: 'Informações de cobrança e histórico do workspace.',
  Atalhos: 'Respostas e atalhos compartilhados com a equipe.',
};

function CategoryIcon({ category, size = 18 }: { category: string; size?: number }) {
  const Icon = ({ Chat: MessageCircle, CRM: ContactRound, Equipes: Users, Membros: ShieldCheck, Campanhas: Megaphone, Automações: Workflow, Analytics: BarChart3, Workspace: Settings2, Faturamento: KeyRound, Atalhos: Sparkles } as Record<string, typeof Users>)[category] || KeyRound;
  return <Icon size={size} />;
}

function RoleForm({ role, workspaceId, onSaved }: { role: Role | null; workspaceId: string; onSaved: (roleId?: string) => Promise<void> }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    if (!name) { setError('Dê um nome à função para continuar.'); setPending(false); return; }
    form.set('name', name);
    try {
      const result = role ? await updateRoleAction({}, form) : await createRoleAction({}, form);
      if (!result.success) { setError(result.error || 'Não foi possível salvar a função.'); return; }
      await onSaved('roleId' in result ? result.roleId as string : role?.id);
      toast({ title: role ? 'Função atualizada!' : 'Função criada!' });
    } catch { setError('Não foi possível salvar agora. Tente novamente.'); }
    finally { setPending(false); }
  };
  return <form onSubmit={submit}>
    <input type="hidden" name="workspaceId" value={workspaceId} />
    {role && <input type="hidden" name="roleId" value={role.id} />}
    <div className={styles.formFields}>
      <div><Label htmlFor="role-name">Nome da função</Label><Input id="role-name" name="name" autoFocus required maxLength={100} defaultValue={role?.name} placeholder="Ex: Sucesso do Cliente" /></div>
      <div><Label htmlFor="role-description">Uma breve descrição</Label><Input id="role-description" name="description" maxLength={300} defaultValue={role?.description} placeholder="Como essa função contribui com a equipe?" /></div>
      {!role && <p className={styles.formHint}><KeyRound size={15} />A nova função começa sem acessos. Depois de criar, escolha as permissões na página.</p>}
      {error && <p className={styles.formError} role="alert"><AlertCircle size={16} />{error}</p>}
    </div>
    <DialogFooter><DialogClose asChild><Button type="button" variant="outline" disabled={pending}>Cancelar</Button></DialogClose><Button type="submit" disabled={pending}>{pending ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Check size={15} className="mr-2" />}{role ? 'Salvar alterações' : 'Criar função'}</Button></DialogFooter>
  </form>;
}

export default function PermissionsPage() {
  const user = useCurrentUser();
  const workspaceId = user?.activeWorkspaceId;
  const workspace = user?.workspaces?.find(item => item.id === workspaceId);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [roleQuery, setRoleQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [access, setAccess] = useState<PermissionFilter>('all');
  const [view, setView] = useState<'role' | 'compare'>('role');
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [editor, setEditor] = useState<Role | 'create' | null>(null);
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [pending, setPending] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const fetchVersion = useRef(0);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle');

  const fetchData = useCallback(async () => {
    if (!workspaceId) return;
    const version = ++fetchVersion.current;
    setError('');
    try {
      const result = await getRolesAndPermissions(workspaceId);
      if (version !== fetchVersion.current) return;
      if (result.error) throw new Error(result.error);
      setRoles(result.roles || []);
      setPermissions(result.permissions || []);
      setCanEdit(result.canEdit === true);
      setSelectedRoleId(current => result.roles.some(role => role.id === current) ? current : (result.roles.find(role => role.is_default) || result.roles.find(role => !isProtectedRole(role)) || result.roles[0])?.id || null);
    } catch (reason) {
      if (version === fetchVersion.current) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar as funções.');
    } finally { if (version === fetchVersion.current) setLoading(false); }
  }, [workspaceId]);

  useEffect(() => {
    setLoading(true);
    setSelectedRoleId(null);
    setSaveState('idle');
    void fetchData();
  }, [fetchData]);

  const categories = [...new Set(permissions.map(permission => permission.category))].sort(compareCategories);
  const categoryKey = categories.join('|');
  useEffect(() => { setOpenGroups(categoryKey ? categoryKey.split('|').slice(0, 2) : []); }, [categoryKey]);
  const selectedRole = roles.find(role => role.id === selectedRoleId);
  const groups = selectedRole ? filterPermissionGroups(permissions, selectedRole, query, category, view === 'compare' ? 'all' : access).sort(([a], [b]) => compareCategories(a, b)) : [];
  const filteredRoles = roles.filter(role => `${role.name} ${role.description}`.toLocaleLowerCase('pt-BR').includes(roleQuery.toLocaleLowerCase('pt-BR').trim()));
  const countPermissions = (role: Role) => permissions.filter(permission => hasRolePermission(role, permission.id)).length;
  const busy = pending.size > 0;
  const protectedRole = selectedRole ? isProtectedRole(selectedRole) : false;
  const clearFilters = () => { setQuery(''); setCategory('all'); setAccess('all'); };

  const changePermission = async (role: Role, permission: Permission, enabled: boolean) => {
    const key = `${role.id}:${permission.id}`;
    if (!canEdit || isProtectedRole(role) || pendingRef.current.has(key)) return;
    const previous = hasRolePermission(role, permission.id);
    pendingRef.current.add(key);
    setPending(new Set(pendingRef.current));
    setRoles(current => setRolePermission(current, role.id, permission, enabled));
    try {
      const result = await updateRolePermissionAction(role.id, permission.id, enabled);
      if (!result.success) throw new Error(result.error || 'Não foi possível salvar o acesso.');
      setSaveState('saved');
    } catch (reason) {
      setRoles(current => setRolePermission(current, role.id, permission, previous));
      setSaveState('error');
      toast({ title: 'A alteração não foi salva', description: reason instanceof Error ? reason.message : 'Tente novamente.', variant: 'destructive' });
    } finally {
      pendingRef.current.delete(key);
      setPending(new Set(pendingRef.current));
    }
  };

  const deleteRole = async () => {
    if (!roleToDelete || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const result = await deleteRoleAction(roleToDelete.id, workspaceId!);
      if (!result.success) { setDeleteError(result.error || 'Não foi possível remover a função.'); return; }
      await fetchData();
      setRoleToDelete(null);
      toast({ title: 'Função removida' });
    } catch { setDeleteError('Não foi possível remover agora. Tente novamente.'); }
    finally { setDeleting(false); }
  };

  const permissionControl = (role: Role, permission: Permission, compact = false) => {
    const key = `${role.id}:${permission.id}`;
    const saving = pending.has(key);
    const disabled = !canEdit || isProtectedRole(role) || saving;
    const checked = hasRolePermission(role, permission.id);
    return <div className={styles.permissionControl}>
      {saving && <Loader2 size={13} className="animate-spin" aria-label="Salvando acesso" />}
      {compact ? <Checkbox aria-label={`${permission.description} — ${role.name}`} checked={checked} disabled={disabled} onCheckedChange={value => void changePermission(role, permission, value === true)} /> : <Switch id={`access-${role.id}-${permission.id}`} aria-label={`${permission.description} — ${role.name}`} checked={checked} disabled={disabled} onCheckedChange={value => void changePermission(role, permission, value)} />}
    </div>;
  };

  if (loading || !user) return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" aria-label="Carregando funções e permissões" /></div>;

  return <div className={cn(shared.page, shared.surface)}>
    <header className={cn(shared.pageHeader, styles.pageHeader)}>
      <div className={shared.headerTop}>
        <nav className={shared.breadcrumb} aria-label="Localização"><span>Workspace</span><ChevronRight size={12} /><Link href="/team">Equipes</Link><ChevronRight size={12} /><span aria-current="page">Permissões</span></nav>
        <span className={shared.headerLabel}><HeartHandshake size={14} /> Feito de pessoas</span>
      </div>
      <div className={cn(shared.welcomeRow, styles.welcomeRow)}>
        <div><span className={shared.eyebrow}>CONFIANÇA EM CADA CONEXÃO</span><h1>As pessoas certas.<br />Os acessos certos<span className={shared.titleDot}>.</span></h1><p>Autonomia para colaborar. Clareza para cuidar do seu workspace.</p></div>
        {canEdit && <Button className={shared.createButton} disabled={busy} onClick={() => setEditor('create')}><Plus size={17} /> Criar função <ArrowUpRight size={16} /></Button>}
      </div>
      <div className={shared.workspaceSummary}><span><ShieldCheck size={15} /><strong>{roles.length}</strong> {roles.length === 1 ? 'função' : 'funções'}</span><span><KeyRound size={15} /><strong>{permissions.length}</strong> permissões disponíveis</span><span><LayoutList size={15} /><strong>{categories.length}</strong> áreas do workspace</span><span className={shared.summaryHint}>{workspace?.name || 'Seu workspace'}</span></div>
    </header>
    {error ? <div className={styles.errorState} role="alert"><span className={shared.emptyIcon}><AlertCircle size={26} /></span><h2>Vamos tentar de novo?</h2><p>{error}</p><Button variant="outline" onClick={() => void fetchData()}>Recarregar funções</Button></div> : <div className={styles.workspace}>
      <aside className={styles.roleSidebar} aria-label="Funções do workspace">
        <div className={styles.sidebarHeading}><h2>Suas funções</h2><span className={shared.count}>{roles.length}</span></div>
        <div className={styles.roleSearch}><Search size={15} /><Input aria-label="Buscar função" placeholder="Encontrar uma função..." value={roleQuery} onChange={event => setRoleQuery(event.target.value)} /></div>
        <nav className={styles.roleList} aria-label="Selecionar função">
          {filteredRoles.map(role => <button type="button" key={role.id} className={cn(styles.roleOption, selectedRoleId === role.id && styles.selectedRole)} aria-current={selectedRoleId === role.id ? 'true' : undefined} onClick={() => { setSelectedRoleId(role.id); setAccess('all'); }}>
            <span className={styles.roleIcon}>{isProtectedRole(role) ? <LockKeyhole size={18} /> : role.is_default ? <Users size={18} /> : <Fingerprint size={18} />}</span>
            <span className={styles.roleOptionText}><strong>{role.name}</strong><span>{isProtectedRole(role) ? 'Acesso total · protegida' : `${countPermissions(role)} de ${permissions.length} acessos${role.is_default ? ' · padrão' : ''}`}</span></span><ChevronRight size={14} />
          </button>)}
          {filteredRoles.length === 0 && <p className={styles.noRoles}>{roleQuery ? 'Nenhuma função com esse nome.' : 'Crie sua primeira função para começar.'}</p>}
        </nav>
        <div className={styles.sidebarNote}><span className={shared.sectionIcon}><HeartHandshake size={20} /></span><h3>Autonomia com cuidado.</h3><p>Permita que cada pessoa tenha os acessos que fazem sentido para o seu trabalho.</p><Link href="/team/members">Ver pessoas do workspace <ArrowUpRight size={12} /></Link></div>
      </aside>
      <main className={styles.mainContent}>
        {selectedRole ? <>
          <div className={styles.roleHero}>
            <div className={styles.roleIdentity}><span className={styles.heroIcon}>{protectedRole ? <LockKeyhole size={27} /> : <Fingerprint size={27} />}</span><div><span className={shared.eyebrow}>ESPAÇO DA FUNÇÃO</span><h2>{selectedRole.name}</h2><p>{selectedRole.description || 'Defina os acessos de quem faz parte desta função.'}</p></div></div>
            {canEdit && !protectedRole && <Button variant="outline" size="sm" className={styles.editButton} disabled={busy} onClick={() => setEditor(selectedRole)}><Pencil size={13} /> Editar função</Button>}
          </div>
          <div className={styles.roleOverview}><span><KeyRound size={14} /><strong>{countPermissions(selectedRole)}</strong> de {permissions.length} acessos permitidos</span>{selectedRole.is_default && <span className={styles.defaultBadge}>Função padrão</span>}<div className={cn(styles.saveStatus, saveState === 'error' && styles.failedSave)} role="status" aria-live="polite">{!canEdit ? <><LockKeyhole size={13} />Somente consulta</> : busy ? <><Loader2 size={13} className="animate-spin" /> Salvando alteração...</> : saveState === 'error' ? <><AlertCircle size={13} /> Alteração não salva. Tente novamente.</> : <><CheckCheck size={14} />{saveState === 'saved' ? 'Alteração salva' : 'Alterações salvas automaticamente'}</>}</div></div>
          {(!canEdit || protectedRole) && <div className={styles.accessNote}><LockKeyhole size={16} /><p>{!canEdit ? 'Você pode consultar os acessos. Para fazer alterações, solicite a permissão de editar funções.' : 'Esta função tem acesso total e é protegida. Suas permissões não podem ser alteradas.'}</p></div>}
          <div className={styles.tools}>
            <div className={styles.viewToggle} role="group" aria-label="Modo de visualizar permissões"><button type="button" aria-pressed={view === 'role'} onClick={() => setView('role')}><LayoutList size={14} /> Por função</button><button type="button" aria-pressed={view === 'compare'} onClick={() => { setView('compare'); setAccess('all'); }}><Table2 size={14} /> Comparar funções</button></div>
            <div className={styles.permissionSearch}><Search size={16} /><Input aria-label="Buscar permissão" placeholder="Buscar uma permissão..." value={query} onChange={event => setQuery(event.target.value)} />{query && <Button variant="ghost" size="icon" aria-label="Limpar busca de permissões" onClick={() => setQuery('')}><X size={13} /></Button>}</div>
            {view === 'role' && <Select value={access} onValueChange={value => setAccess(value as PermissionFilter)}><SelectTrigger aria-label="Filtrar permissões por acesso" className={styles.accessFilter}><SelectValue /></SelectTrigger><SelectContent className={shared.surface}><SelectItem value="all">Todos os acessos</SelectItem><SelectItem value="allowed">Permitidos</SelectItem><SelectItem value="blocked">Não permitidos</SelectItem></SelectContent></Select>}
          </div>
          <div className={styles.categoryFilters}>
            <Select value={category} onValueChange={value => { setCategory(value); if (value !== 'all') setOpenGroups([value]); }}><SelectTrigger aria-label="Filtrar por área do workspace" className={styles.areaFilter}><LayoutList size={14} /><SelectValue /></SelectTrigger><SelectContent className={shared.surface}><SelectItem value="all">Todas as áreas</SelectItem>{categories.map(item => <SelectItem key={item} value={item}><span className="flex items-center gap-2"><CategoryIcon category={item} size={13} />{item}</span></SelectItem>)}</SelectContent></Select>
            <span className={styles.resultsCount}>{groups.reduce((total, [, items]) => total + items.length, 0)} de {permissions.length} permissões</span>
            {(query || category !== 'all' || access !== 'all') && <Button variant="ghost" size="sm" onClick={clearFilters} className={styles.clearFilters}><X size={12} />Limpar filtros</Button>}
          </div>
          {groups.length === 0 ? <div className={styles.emptyState}><span className={shared.emptyIcon}><Search size={25} /></span><h3>{permissions.length ? 'Nenhum acesso encontrado por aqui' : 'As permissões ainda não estão disponíveis'}</h3><p>{permissions.length ? 'Tente outro termo ou ajuste os filtros para encontrar o que procura.' : 'Recarregue a página para buscar as permissões do workspace.'}</p><Button variant="outline" onClick={permissions.length ? clearFilters : () => void fetchData()}>{permissions.length ? 'Limpar filtros' : 'Recarregar'}</Button></div> : view === 'role' ? <Accordion type="multiple" value={query || category !== 'all' || access !== 'all' ? groups.map(([name]) => name) : openGroups} onValueChange={setOpenGroups} className={styles.permissionGroups}>
            {groups.map(([name, items]) => <AccordionItem value={name} key={name} className={styles.permissionGroup}>
              <AccordionTrigger className={styles.groupTrigger}><span className={styles.groupIcon}><CategoryIcon category={name} /></span><span className={styles.groupTitle}><strong>{name}</strong><span>{categoryDescriptions[name] || 'Permissões disponíveis nesta área do workspace.'}</span></span><span className={styles.groupCount}>{items.filter(item => hasRolePermission(selectedRole, item.id)).length}<span> / {items.length}</span></span></AccordionTrigger>
              <AccordionContent className={styles.groupContent}>{items.map(permission => <div key={permission.id} className={styles.permissionRow}><Label htmlFor={`access-${selectedRole.id}-${permission.id}`}>{permission.description}</Label><span className={cn(styles.accessLabel, hasRolePermission(selectedRole, permission.id) && styles.allowedLabel)}>{hasRolePermission(selectedRole, permission.id) ? 'Permitido' : 'Não permitido'}</span>{permissionControl(selectedRole, permission)}</div>)}</AccordionContent>
            </AccordionItem>)}
          </Accordion> : <div className={styles.matrixContainer}><table className={styles.matrix}><caption className="sr-only">Comparação das permissões entre as funções do workspace</caption><thead><tr><th scope="col">Permissão</th>{roles.map(role => <th key={role.id} scope="col"><span>{role.name}</span>{isProtectedRole(role) && <LockKeyhole size={12} aria-label="Função protegida" />}</th>)}</tr></thead><tbody>{groups.map(([name, items]) => <React.Fragment key={name}><tr className={styles.matrixCategory}><th scope="rowgroup" colSpan={roles.length + 1}><CategoryIcon category={name} size={14} /> {name}</th></tr>{items.map(permission => <tr key={permission.id}><th scope="row">{permission.description}</th>{roles.map(role => <td key={role.id}>{permissionControl(role, permission, true)}</td>)}</tr>)}</React.Fragment>)}</tbody></table></div>}
          <div className={styles.bottomNote}><span><ShieldCheck size={14} /> Os acessos são aplicados a quem usa esta função.</span>{canEdit && !protectedRole && !selectedRole.is_default && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { setDeleteError(''); setRoleToDelete(selectedRole); }}><Trash2 size={12} /> Remover função</Button>}</div>
        </> : <div className={styles.emptyState}><span className={shared.emptyIcon}><Fingerprint size={30} /></span><h2>Um espaço para cada responsabilidade.</h2><p>Crie uma função e defina os acessos que combinam com a sua equipe.</p>{canEdit && <Button onClick={() => setEditor('create')}><Plus size={15} className="mr-2" /> Criar primeira função</Button>}</div>}
      </main>
    </div>}
    <Dialog open={editor !== null} onOpenChange={open => { if (!open) setEditor(null); }}><DialogContent className={cn(shared.surface, styles.roleDialog)}><DialogHeader><span className={shared.sectionIcon}><Fingerprint size={22} /></span><DialogTitle>{editor === 'create' ? 'Uma nova forma de colaborar' : 'Uma função com a sua identidade'}</DialogTitle><DialogDescription>{editor === 'create' ? 'Dê um nome à função. Depois, escolha quais portas ela pode abrir.' : 'Atualize o nome e a descrição sem alterar os acessos configurados.'}</DialogDescription></DialogHeader>{editor && workspaceId && <RoleForm key={editor === 'create' ? 'create' : editor.id} role={editor === 'create' ? null : editor} workspaceId={workspaceId} onSaved={async id => { await fetchData(); if (id) setSelectedRoleId(id); setEditor(null); }} />}</DialogContent></Dialog>
    <AlertDialog open={roleToDelete !== null} onOpenChange={open => { if (!open && !deleting) setRoleToDelete(null); }}><AlertDialogContent className={shared.surface}><AlertDialogHeader><AlertDialogTitle>Remover a função {roleToDelete?.name}?</AlertDialogTitle><AlertDialogDescription>Esta ação remove a função e os acessos configurados nela. Funções vinculadas a pessoas ou equipes não podem ser removidas.</AlertDialogDescription></AlertDialogHeader>{deleteError && <p className={styles.formError} role="alert"><AlertCircle size={16} />{deleteError}</p>}<AlertDialogFooter><AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel><AlertDialogAction disabled={deleting} onClick={event => { event.preventDefault(); void deleteRole(); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleting && <Loader2 size={14} className="mr-2 animate-spin" />}Remover função</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
