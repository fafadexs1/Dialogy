'use client';

import Link from 'next/link';
import type { Contact } from '@/lib/types';
import CustomerList from '@/components/crm/customer-list';
import CrmKanban from '@/components/crm/crm-kanban';
import CrmDashboard from '@/components/crm/crm-dashboard';
import CrmAutomations from '@/components/crm/crm-automations';
import { Loader2, LayoutDashboard, Kanban, List, Zap, Send, BarChart2 } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getContacts } from '@/actions/crm';
import { useCurrentUser } from '@/hooks/use-online-status';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';

export default function CrmPage() {
  const user = useCurrentUser();
  const [contacts, setContacts] = useState<Contact[]>([]);

  const fetchData = useCallback(async () => {
    if (!user?.activeWorkspaceId) return;
    try {
      const contactsRes = await getContacts(user.activeWorkspaceId);
      if (contactsRes.contacts) setContacts(contactsRes.contacts);
    } catch (error) {
      console.error("Error fetching CRM data", error);
    }
  }, [user?.activeWorkspaceId]);

  useEffect(() => {
    if (user?.activeWorkspaceId) {
      fetchData();
    }
  }, [fetchData, user?.activeWorkspaceId]);

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute inset-0 animate-pulse rounded-full bg-emerald-500/20 blur-xl" />
            <Loader2 className="relative h-12 w-12 animate-spin text-emerald-500" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background selection:bg-emerald-500/30">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-[20%] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[120px]" />
        <div className="absolute left-[10%] top-[10%] h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[100px]" />
        <div className="absolute bottom-[10%] right-[10%] h-[600px] w-[600px] rounded-full bg-violet-500/5 blur-[120px]" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden">
        <Tabs defaultValue="dashboard" className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-900/85 px-6 py-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.18)] dark:shadow-[0_18px_40px_-30px_rgba(0,0,0,0.5)] backdrop-blur-md">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10 shadow-lg shadow-blue-500/10">
                <LayoutDashboard className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-slate-50">CRM</h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">Gerencie seus contatos e negociacoes.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <TabsList className="h-10 border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900/50 p-1">
                <TabsTrigger
                  value="dashboard"
                  className="text-slate-500 dark:text-slate-400 transition-colors hover:text-slate-900 dark:hover:text-slate-200 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-slate-950 dark:data-[state=active]:text-slate-50 data-[state=active]:shadow-sm"
                >
                  <LayoutDashboard className="mr-2 h-4 w-4" />Visao
                </TabsTrigger>
                <TabsTrigger
                  value="kanban"
                  className="text-slate-500 dark:text-slate-400 transition-colors hover:text-slate-900 dark:hover:text-slate-200 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-slate-950 dark:data-[state=active]:text-slate-50 data-[state=active]:shadow-sm"
                >
                  <Kanban className="mr-2 h-4 w-4" />Kanban
                </TabsTrigger>
                <TabsTrigger
                  value="list"
                  className="text-slate-500 dark:text-slate-400 transition-colors hover:text-slate-900 dark:hover:text-slate-200 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-slate-950 dark:data-[state=active]:text-slate-50 data-[state=active]:shadow-sm"
                >
                  <List className="mr-2 h-4 w-4" />Lista
                </TabsTrigger>
                <TabsTrigger
                  value="automations"
                  className="text-slate-500 dark:text-slate-400 transition-colors hover:text-slate-900 dark:hover:text-slate-200 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-slate-950 dark:data-[state=active]:text-slate-50 data-[state=active]:shadow-sm"
                >
                  <Zap className="mr-2 h-4 w-4" />Auto
                </TabsTrigger>
              </TabsList>

              <div className="hidden items-center gap-2 xl:flex">
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <Link href="/campaigns">
                    <Send className="h-4 w-4" />
                    Campanhas
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <Link href="/analytics">
                    <BarChart2 className="h-4 w-4" />
                    Analytics
                  </Link>
                </Button>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="h-full"
            >
              <TabsContent value="dashboard" className="m-0 h-full border-0 p-0 data-[state=active]:flex data-[state=active]:flex-col">
                <div className="h-full overflow-hidden bg-background p-4 md:p-6">
                  <CrmDashboard contacts={contacts} tags={[]} workspaceId={user.activeWorkspaceId} />
                </div>
              </TabsContent>

              <TabsContent value="kanban" className="m-0 h-full border-0 p-0 data-[state=active]:flex data-[state=active]:flex-col">
                <div className="h-full overflow-hidden bg-background">
                  <CrmKanban user={user} onContactClick={() => {}} />
                </div>
              </TabsContent>

              <TabsContent value="list" className="m-0 h-full border-0 p-0 data-[state=active]:flex data-[state=active]:flex-col">
                <div className="h-full overflow-hidden bg-background p-4 md:p-6">
                  <CustomerList user={user} />
                </div>
              </TabsContent>

              <TabsContent value="automations" className="m-0 h-full border-0 p-0 data-[state=active]:flex data-[state=active]:flex-col">
                <div className="h-full overflow-hidden bg-background p-4 md:p-6">
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
