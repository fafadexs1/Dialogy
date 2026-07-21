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
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-slate-50 selection:bg-emerald-500/20 dark:bg-black dark:selection:bg-emerald-500/30">
      <div className="pointer-events-none absolute inset-0 hidden overflow-hidden dark:block">
        <div className="absolute -top-[20%] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-500/8 blur-[120px]" />
        <div className="absolute bottom-[8%] right-[8%] h-[620px] w-[620px] rounded-full bg-emerald-900/12 blur-[120px]" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col overflow-hidden">
        <Tabs defaultValue="dashboard" className="flex h-full flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-emerald-400/15 dark:bg-[#050807]/95 dark:shadow-[0_18px_50px_-34px_rgba(16,185,129,0.32)] dark:backdrop-blur-md">
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:shadow-lg dark:shadow-emerald-500/10">
                <LayoutDashboard className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">CRM</h1>
                <p className="text-xs text-slate-500 dark:text-zinc-400">Gerencie seus contatos e negociacoes.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <TabsList className="h-10 border border-slate-200 bg-slate-50 p-1 dark:border-emerald-400/15 dark:bg-white/[0.04]">
                <TabsTrigger
                  value="dashboard"
                  className="text-slate-500 transition-colors hover:text-slate-900 data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:text-zinc-400 dark:hover:text-white dark:data-[state=active]:bg-emerald-400/15 dark:data-[state=active]:text-emerald-100"
                >
                  <LayoutDashboard className="mr-2 h-4 w-4" />Visao
                </TabsTrigger>
                <TabsTrigger
                  value="kanban"
                  className="text-slate-500 transition-colors hover:text-slate-900 data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:text-zinc-400 dark:hover:text-white dark:data-[state=active]:bg-emerald-400/15 dark:data-[state=active]:text-emerald-100"
                >
                  <Kanban className="mr-2 h-4 w-4" />Kanban
                </TabsTrigger>
                <TabsTrigger
                  value="list"
                  className="text-slate-500 transition-colors hover:text-slate-900 data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:text-zinc-400 dark:hover:text-white dark:data-[state=active]:bg-emerald-400/15 dark:data-[state=active]:text-emerald-100"
                >
                  <List className="mr-2 h-4 w-4" />Lista
                </TabsTrigger>
                <TabsTrigger
                  value="automations"
                  className="text-slate-500 transition-colors hover:text-slate-900 data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm dark:text-zinc-400 dark:hover:text-white dark:data-[state=active]:bg-emerald-400/15 dark:data-[state=active]:text-emerald-100"
                >
                  <Zap className="mr-2 h-4 w-4" />Auto
                </TabsTrigger>
              </TabsList>

              <div className="hidden items-center gap-2 xl:flex">
                <Button asChild variant="outline" size="sm" className="gap-2 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100 dark:hover:bg-emerald-400/20 dark:hover:text-white">
                  <Link href="/campaigns">
                    <Send className="h-4 w-4" />
                    Campanhas
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-2 border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/10 dark:hover:text-white">
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
                <div className="h-full overflow-hidden bg-slate-50 dark:bg-black">
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
