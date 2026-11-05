'use client';

import { useCallback, useEffect, useState } from 'react';
import { KanbanSquare, LayoutDashboard, List, Loader2, Zap } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getContacts, getWorkspaceUsers } from '@/actions/crm';
import { useCurrentUser } from '@/hooks/use-online-status';
import type { Contact, User } from '@/lib/types';
import CustomerList from '@/components/crm/customer-list';
import CrmKanban from '@/components/crm/crm-kanban';
import CrmDashboard from '@/components/crm/crm-dashboard';
import CrmAutomations from '@/components/crm/crm-automations';
import CustomerProfile from '@/components/crm/customer-profile';
import { AddContactForm } from '@/components/crm/add-contact-form';
import { AddActivityForm } from '@/components/crm/add-activity-form';

const sections = [
  { value: 'dashboard', label: 'Visão geral', icon: LayoutDashboard },
  { value: 'kanban', label: 'Funil', icon: KanbanSquare },
  { value: 'list', label: 'Contatos', icon: List },
  { value: 'automations', label: 'Automações', icon: Zap },
] as const;
type Section = (typeof sections)[number]['value'];

export default function CrmPage() {
  const user = useCurrentUser();
  const [totalContacts, setTotalContacts] = useState<number | null>(null);
  const [section, setSection] = useState<Section>('dashboard');
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [workspaceUsers, setWorkspaceUsers] = useState<User[]>([]);
  const [kanbanVersion, setKanbanVersion] = useState(0);

  const fetchData = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
    try {
      const result = await getContacts(user.activeWorkspaceId, { limit: 1 });
      if (result.contacts) setTotalContacts(result.total);
    } catch (error) {
      console.error('Error fetching CRM data', error);
    }
  }, [user?.activeWorkspaceId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const sync = () => {
      const hash = window.location.hash.slice(1);
      setSection(sections.find((item) => item.value === hash)?.value || 'dashboard');
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  const changeSection = (value: string) => {
    const next = value as Section;
    setSection(next);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${next}`);
  };

  const openContact = (contact: Contact) => {
    setSelectedContact(contact);
    setProfileOpen(true);
    if (user?.activeWorkspaceId) getWorkspaceUsers(user.activeWorkspaceId).then((result) => setWorkspaceUsers(result.users || []));
  };

  const refreshContact = (updated?: Contact | null) => {
    if (updated) setSelectedContact(updated);
    setEditOpen(false);
    setActivityOpen(false);
    fetchData();
    setKanbanVersion((version) => version + 1);
  };

  if (!user) return <div className="flex h-full items-center justify-center bg-[#f4f6f2] dark:bg-[#090e0c]"><Loader2 className="h-9 w-9 animate-spin text-emerald-600" /></div>;
  return (
    <div className="crm-experience flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-[#f4f6f2] text-[#13231c] dark:bg-[#090e0c] dark:text-white">
      <Tabs value={section} onValueChange={changeSection} className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 border-b border-[#dfe7dd] bg-white/90 px-4 shadow-[0_8px_30px_-25px_rgba(14,40,24,.45)] backdrop-blur-xl dark:border-white/10 dark:bg-[#101a15]/95 md:px-8">
          <TabsList className="mx-auto flex h-auto w-full max-w-[1800px] justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-1.5 md:gap-2 md:p-2">
            {sections.map(({ value, label, icon: Icon }) => <TabsTrigger key={value} value={value} className="flex h-11 shrink-0 items-center gap-2.5 rounded-xl border border-transparent px-3.5 text-slate-500 shadow-none transition hover:bg-[#f2f6f0] hover:text-[#183b29] data-[state=active]:border-emerald-200 data-[state=active]:bg-emerald-50 data-[state=active]:text-[#146b42] data-[state=active]:shadow-none dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-white dark:data-[state=active]:border-emerald-400/20 dark:data-[state=active]:bg-emerald-400/10 dark:data-[state=active]:text-emerald-200 md:h-12 md:px-4"><Icon className="h-[18px] w-[18px] shrink-0" /><span className="text-[13px] font-semibold">{label}</span></TabsTrigger>)}
          </TabsList>
        </div>
        <div className="min-h-0 flex-1">
          <TabsContent value="dashboard" className="m-0 h-full min-h-0 p-0"><CrmDashboard totalContacts={totalContacts} workspaceId={user.activeWorkspaceId} /></TabsContent>
          <TabsContent value="kanban" className="m-0 h-full min-h-0 p-0"><CrmKanban key={kanbanVersion} user={user} onContactClick={openContact} /></TabsContent>
          <TabsContent value="list" className="m-0 h-full min-h-0 p-0"><CustomerList user={user} /></TabsContent>
          <TabsContent value="automations" className="m-0 h-full min-h-0 p-0">{user.activeWorkspaceId && <CrmAutomations workspaceId={user.activeWorkspaceId} />}</TabsContent>
        </div>
      </Tabs>
      {selectedContact && <>
        <CustomerProfile contact={selectedContact} isOpen={profileOpen} setIsOpen={setProfileOpen} onAction={(action, contact) => { setSelectedContact(contact); if (action === 'edit') setEditOpen(true); else setActivityOpen(true); }} onMutate={() => refreshContact()} />
        {user.activeWorkspaceId && <AddContactForm isOpen={editOpen} setIsOpen={setEditOpen} onSave={refreshContact} contact={selectedContact} workspaceId={user.activeWorkspaceId} agents={workspaceUsers} user={user} />}
        <AddActivityForm contact={selectedContact} isOpen={activityOpen} setIsOpen={setActivityOpen} onSave={() => refreshContact()} />
      </>}
    </div>
  );
}
