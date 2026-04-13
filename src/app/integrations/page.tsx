'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import type { Integration } from '@/lib/types';
import { IntegrationCard } from '@/components/integrations/integration-card';
import { Loader2, Search, Zap } from 'lucide-react';
import { getIntegrations } from '@/actions/integrations';
import { toast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';

const CATEGORIES = [
    { id: 'all', label: 'Todos' },
    { id: 'messaging', label: 'Mensageria' },
    { id: 'crm', label: 'CRM' },
    { id: 'utilities', label: 'Utilitarios' },
];

export default function IntegrationsPage() {
    const user = useCurrentUser();
    const [integrations, setIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const integrationsRes = await getIntegrations();
            if (integrationsRes.integrations) {
                const enriched = integrationsRes.integrations.map(i => {
                    const searchableText = `${i.name} ${i.description} ${i.id}`.toLowerCase();
                    return {
                        ...i,
                        category: searchableText.includes('messenger') ||
                            searchableText.includes('instagram') ||
                            searchableText.includes('whatsapp') ||
                            searchableText.includes('telegram')
                            ? 'messaging'
                            : i.name.toLowerCase().includes('crm') ? 'crm' : 'utilities'
                    };
                });
                setIntegrations(enriched as Integration[]);
            } else {
                toast({ title: 'Erro de Rede', description: 'Nao foi possivel carregar as configuracoes.', variant: 'destructive' });
            }
        } catch {
            toast({ title: 'Erro de Rede', description: 'Nao foi possivel se conectar ao servidor.', variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filteredIntegrations = useMemo(() => {
        return integrations.filter(integration => {
            const matchesSearch = integration.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                integration.description.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesCategory = selectedCategory === 'all' || (integration as any).category === selectedCategory;
            return matchesSearch && matchesCategory;
        });
    }, [integrations, searchQuery, selectedCategory]);

    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: {
                staggerChildren: 0.05,
            },
        },
    };

    const itemVariants = {
        hidden: { y: 20, opacity: 0 },
        visible: {
            y: 0,
            opacity: 1,
            transition: { type: 'spring', stiffness: 100, damping: 20 }
        },
    };

    if (loading || !user) {
        return (
            <div className="flex h-full items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 animate-pulse rounded-full bg-emerald-500/20 blur-xl" />
                        <Loader2 className="relative h-12 w-12 animate-spin text-emerald-500" />
                    </div>
                    <p className="animate-pulse text-sm font-medium text-emerald-500/80">Carregando ecossistema...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="relative flex min-h-screen flex-col overflow-hidden bg-background selection:bg-emerald-500/30">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-[20%] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[120px]" />
                <div className="absolute left-[10%] top-[10%] h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[100px]" />
                <div className="absolute bottom-[10%] right-[10%] h-[600px] w-[600px] rounded-full bg-violet-500/5 blur-[120px]" />
            </div>

            <div className="relative z-10 mx-auto w-full max-w-[1600px] space-y-8 p-4 md:p-8">
                <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
                    <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10">
                            <Zap className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-slate-950">Extensoes e Integracoes</h1>
                            <p className="mt-1 text-slate-500">
                                Conecte o Dialogy as suas ferramentas favoritas e potencialize seu atendimento.
                            </p>
                        </div>
                    </div>
                    <div className="hidden items-center gap-2 md:flex">
                        <div className="rounded-xl border border-slate-200 bg-white px-4 py-2 shadow-sm">
                            <span className="mr-2 text-sm text-slate-500">Disponiveis:</span>
                            <span className="font-semibold text-slate-950">{integrations.length}</span>
                        </div>
                    </div>
                </div>

                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.14)] md:flex-row"
                >
                    <div className="flex w-full gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 no-scrollbar md:w-auto">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat.id}
                                onClick={() => setSelectedCategory(cat.id)}
                                className={`
                                    relative whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all
                                    ${selectedCategory === cat.id
                                        ? 'text-slate-950'
                                        : 'text-slate-500 hover:bg-slate-200 hover:text-slate-900'
                                    }
                                `}
                            >
                                {selectedCategory === cat.id && (
                                    <motion.div
                                        layoutId="activeCategory"
                                        className="absolute inset-0 rounded-lg bg-white shadow-sm"
                                        initial={false}
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    />
                                )}
                                <span className="relative z-10">{cat.label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="relative w-full max-w-md flex-1">
                        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                            <Search className="h-4 w-4 text-slate-400" />
                        </div>
                        <Input
                            placeholder="Buscar integracao (ex: Telegram, Instagram)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-11 rounded-xl border-slate-200 bg-white pl-10 text-slate-900 placeholder:text-slate-400 focus-visible:border-emerald-500/20 focus-visible:ring-emerald-500/20"
                        />
                    </div>
                </motion.div>

                <AnimatePresence mode="popLayout">
                    <div className="min-h-[400px]">
                        {filteredIntegrations.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center justify-center py-24 text-center"
                            >
                                <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-slate-200 bg-slate-100">
                                    <Search className="h-10 w-10 text-slate-400" />
                                </div>
                                <h3 className="mb-2 text-xl font-semibold text-slate-950">Nenhuma integracao encontrada</h3>
                                <p className="mb-6 max-w-sm text-slate-500">
                                    Nao encontramos resultados para sua busca ou filtro. Tente buscar por outros termos.
                                </p>
                                <Button
                                    variant="outline"
                                    onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }}
                                    className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                                >
                                    Limpar Filtros
                                </Button>
                            </motion.div>
                        ) : (
                            <motion.div
                                variants={containerVariants}
                                initial="hidden"
                                animate="visible"
                                className="grid grid-cols-1 gap-6 pb-20 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                            >
                                {filteredIntegrations.map((integration) => (
                                    <motion.div key={integration.id} variants={itemVariants} layout>
                                        <IntegrationCard
                                            integration={integration}
                                            isSuperAdmin={user.is_superadmin}
                                            onEditSuccess={fetchData}
                                        />
                                    </motion.div>
                                ))}
                            </motion.div>
                        )}
                    </div>
                </AnimatePresence>
            </div>
        </div>
    );
}
