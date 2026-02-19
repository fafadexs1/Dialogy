'use client';

import type { User, Contact, Tag } from '@/lib/types';
import CustomerList from '@/components/crm/customer-list';
import CrmKanban from '@/components/crm/crm-kanban';
import CrmDashboard from '@/components/crm/crm-dashboard';
import CrmAutomations from '@/components/crm/crm-automations';
import { Loader2, LayoutDashboard, Kanban, List, Zap } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getContacts, getTags } from '@/actions/crm';
import { useCurrentUser } from '@/hooks/use-online-status';
import { motion } from 'framer-motion';

export default function CrmPage() {
  const user = useCurrentUser();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);

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
    if (user?.activeWorkspaceId) {
      fetchData();
    }
  }, [fetchData, user?.activeWorkspaceId]);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
            <Loader2 className="relative h-12 w-12 animate-spin text-emerald-500" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full flex-1 w-full min-h-0 flex flex-col overflow-hidden bg-background selection:bg-emerald-500/30">
      {/* Background Effects */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[20%] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute top-[10%] left-[10%] h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[100px]" />
        <div className="absolute bottom-[10%] right-[10%] h-[600px] w-[600px] rounded-full bg-violet-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col h-full w-full overflow-hidden">
        <Tabs defaultValue="dashboard" className="flex flex-col h-full">
          <div className="border-b border-white/5 px-6 py-4 bg-zinc-950/40 backdrop-blur-md flex items-center justify-between shrink-0">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shadow-lg shadow-blue-500/10">
                <LayoutDashboard className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white">CRM</h1>
                <p className="text-zinc-400 text-xs">Gerencie seus contatos e negociações.</p>
              </div>
            </div>

            <TabsList className="bg-white/5 border border-white/5 h-10 p-1">
              <TabsTrigger
                value="dashboard"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <LayoutDashboard className="w-4 h-4 mr-2" />Visão
              </TabsTrigger>
              <TabsTrigger
                value="kanban"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <Kanban className="w-4 h-4 mr-2" />Kanban
              </TabsTrigger>
              <TabsTrigger
                value="list"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <List className="w-4 h-4 mr-2" />Lista
              </TabsTrigger>
              <TabsTrigger
                value="automations"
                className="data-[state=active]:bg-white/10 data-[state=active]:text-white text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <Zap className="w-4 h-4 mr-2" />Auto
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-hidden p-6">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="h-full"
            >
              <TabsContent value="dashboard" className="h-full m-0 border-0 p-0 data-[state=active]:flex flex-col">
                <div className="h-full rounded-2xl border border-white/5 bg-zinc-950/20 backdrop-blur-sm overflow-hidden p-4">
                  <CrmDashboard contacts={contacts} tags={tags} workspaceId={user.activeWorkspaceId} />
                </div>
              </TabsContent>

              <TabsContent value="kanban" className="h-full m-0 border-0 p-0 data-[state=active]:flex flex-col">
                <div className="h-full rounded-2xl border border-white/5 bg-zinc-950/20 backdrop-blur-sm overflow-hidden">
                  <CrmKanban user={user} onContactClick={(c) => { }} />
                </div>
              </TabsContent>

              <TabsContent value="list" className="h-full m-0 border-0 p-0 data-[state=active]:flex flex-col">
                <div className="h-full rounded-2xl border border-white/5 bg-zinc-950/20 backdrop-blur-sm overflow-hidden">
                  <CustomerList user={user} />
                </div>
              </TabsContent>

              <TabsContent value="automations" className="h-full m-0 border-0 p-0 data-[state=active]:flex flex-col">
                <div className="h-full rounded-2xl border border-white/5 bg-zinc-950/20 backdrop-blur-sm overflow-hidden p-4">
                  {user.activeWorkspaceId && <CrmAutomations workspaceId={user.activeWorkspaceId} />}
                </div>
              </TabsContent>
            </motion.div>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
