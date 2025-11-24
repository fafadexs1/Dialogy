'use client';

import type { User, Contact, Tag } from '@/lib/types';
import CustomerList from '@/components/crm/customer-list';
import CrmKanban from '@/components/crm/crm-kanban';
import CrmDashboard from '@/components/crm/crm-dashboard';
import { Loader2, LayoutDashboard, Kanban, List } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getContacts, getTags } from '@/actions/crm';
import { toast } from '@/hooks/use-toast';

export default function CrmPage() {
  const [user, setUser] = useState<User | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      const res = await fetch('/api/user');
      if (res.ok) {
        setUser(await res.json());
      }
    };
    fetchUser();
  }, []);

  const fetchData = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
    try {
      const [contactsRes, tagsRes] = await Promise.all([
        getContacts(user.activeWorkspaceId),
        getTags(user.activeWorkspaceId)
      ]);
      if (contactsRes.contacts) setContacts(contactsRes.contacts);
      if (tagsRes.tags) setTags(tagsRes.tags);
    } catch (error) {
      console.error("Error fetching CRM data", error);
    } finally {
      setLoading(false);
    }
  }, [user?.activeWorkspaceId]);

  useEffect(() => {
    if (user) {
      fetchData();
    }
  }, [user, fetchData]);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="relative h-full flex-1 w-full min-h-0 flex flex-col overflow-hidden bg-black selection:bg-blue-500/30">
      {/* Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]" />
        <div className="absolute -left-[10%] top-[20%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[100px]" />
        <div className="absolute -right-[10%] bottom-[20%] w-[40%] h-[40%] rounded-full bg-purple-500/10 blur-[100px]" />
      </div>

      <div className="relative z-10 flex flex-col h-full w-full overflow-hidden backdrop-blur-[1px]">
        <Tabs defaultValue="dashboard" className="flex flex-col h-full">
          <div className="border-b border-white/10 px-6 py-3 bg-black/20 backdrop-blur-xl flex items-center justify-between shrink-0">
            <h1 className="text-xl font-semibold text-white mr-4">CRM</h1>
            <TabsList className="grid w-[300px] grid-cols-3 bg-white/5 border border-white/10">
              <TabsTrigger value="dashboard" className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-zinc-400"><LayoutDashboard className="w-4 h-4 mr-2" />Visão</TabsTrigger>
              <TabsTrigger value="kanban" className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-zinc-400"><Kanban className="w-4 h-4 mr-2" />Kanban</TabsTrigger>
              <TabsTrigger value="list" className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-zinc-400"><List className="w-4 h-4 mr-2" />Lista</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-hidden">
            <TabsContent value="dashboard" className="h-full m-0 border-0 p-0 data-[state=active]:flex flex-col">
              <CrmDashboard contacts={contacts} tags={tags} />
            </TabsContent>

            <TabsContent value="kanban" className="h-full m-0 border-0 p-0 data-[state=active]:flex flex-col">
              <CrmKanban user={user} onContactClick={(c) => { }} />
            </TabsContent>

            <TabsContent value="list" className="h-full m-0 border-0 p-0 data-[state=active]:flex flex-col">
              <CustomerList user={user} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
