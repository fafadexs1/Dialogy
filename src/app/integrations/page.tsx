'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import type { Integration } from '@/lib/types';
import { IntegrationCard } from '@/components/integrations/integration-card';
import { Loader2, Search, SlidersHorizontal, Zap, ArrowLeft } from 'lucide-react';
import { getIntegrations } from '@/actions/integrations';
import { toast } from '@/hooks/use-toast';
import { useCurrentUser } from '@/hooks/use-online-status';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

const CATEGORIES = [
    { id: 'all', label: 'Todos' },
    { id: 'messaging', label: 'Mensageria' },
    { id: 'crm', label: 'CRM' },
    { id: 'utilities', label: 'Utilitários' },
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
                // Mock categories for now as they might not be in the DB yet
                const enriched = integrationsRes.integrations.map(i => ({
                    ...i,
                    category: i.name.toLowerCase().includes('messenger') || i.name.toLowerCase().includes('instagram') || i.name.toLowerCase().includes('whatsapp') ? 'messaging' :
                        i.name.toLowerCase().includes('crm') ? 'crm' : 'utilities'
                }));
                // @ts-ignore
                setIntegrations(enriched);
            } else {
                toast({ title: 'Erro de Rede', description: 'Não foi possível carregar as configurações.', variant: 'destructive' });
            }
        } catch (error: any) {
            toast({ title: 'Erro de Rede', description: 'Não foi possível se conectar ao servidor.', variant: 'destructive' });
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
            <div className="flex items-center justify-center h-full bg-zinc-950">
                <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                        <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
                        <Loader2 className="relative h-12 w-12 animate-spin text-emerald-500" />
                    </div>
                    <p className="text-sm font-medium text-emerald-500/80 animate-pulse">Carregando ecossistema...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="relative flex min-h-screen flex-col overflow-hidden bg-background selection:bg-emerald-500/30">
            {/* Background Effects */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-[20%] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[120px]" />
                <div className="absolute top-[10%] left-[10%] h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[100px]" />
                <div className="absolute bottom-[10%] right-[10%] h-[600px] w-[600px] rounded-full bg-violet-500/5 blur-[120px]" />
            </div>

            <div className="relative z-10 w-full max-w-[1600px] mx-auto p-4 md:p-8 space-y-8">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                            <Zap className="h-6 w-6 text-emerald-400" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-bold tracking-tight text-white">
                                Extensões & Integrações
                            </h1>
                            <p className="text-zinc-400 mt-1">
                                Conecte o Dialogy às suas ferramentas favoritas e potencialize seu atendimento.
                            </p>
                        </div>
                    </div>
                    <div className="hidden md:flex items-center gap-2">
                        <div className="px-4 py-2 rounded-xl bg-white/5 border border-white/5 backdrop-blur-md">
                            <span className="text-zinc-400 text-sm mr-2">Disponíveis:</span>
                            <span className="text-white font-semibold">{integrations.length}</span>
                        </div>
                    </div>
                </div>

                {/* Filters & Search Toolbar */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="flex flex-col md:flex-row gap-4 items-center justify-between bg-zinc-950/40 backdrop-blur-md p-2 rounded-2xl border border-white/5"
                >
                    <div className="flex gap-1 p-1 bg-white/5 rounded-xl w-full md:w-auto overflow-x-auto no-scrollbar">
                        {CATEGORIES.map((cat) => (
                            <button
                                key={cat.id}
                                onClick={() => setSelectedCategory(cat.id)}
                                className={`
                                    relative px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap
                                    ${selectedCategory === cat.id
                                        ? 'text-white'
                                        : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'
                                    }
                                `}
                            >
                                {selectedCategory === cat.id && (
                                    <motion.div
                                        layoutId="activeCategory"
                                        className="absolute inset-0 bg-white/10 rounded-lg"
                                        initial={false}
                                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                                    />
                                )}
                                <span className="relative z-10">{cat.label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="relative flex-1 max-w-md w-full">
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Search className="h-4 w-4 text-zinc-500" />
                        </div>
                        <Input
                            placeholder="Buscar integração (ex: Instagram, Messenger)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-10 h-11 bg-white/5 border-white/5 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500/20 text-zinc-200 placeholder:text-zinc-600 rounded-xl"
                        />
                    </div>
                </motion.div>

                {/* Grid */}
                <AnimatePresence mode="popLayout">
                    <div className="min-h-[400px]">
                        {filteredIntegrations.length === 0 ? (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="flex flex-col items-center justify-center py-24 text-center"
                            >
                                <div className="h-24 w-24 rounded-full bg-white/5 flex items-center justify-center mb-6 border border-white/5">
                                    <Search className="h-10 w-10 text-zinc-600" />
                                </div>
                                <h3 className="text-xl font-semibold text-white mb-2">Nenhuma integração encontrada</h3>
                                <p className="text-zinc-500 max-w-sm mb-6">
                                    Não encontramos resultados para sua busca ou filtro. Tente buscar por outros termos.
                                </p>
                                <Button
                                    variant="outline"
                                    onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }}
                                    className="border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white"
                                >
                                    Limpar Filtros
                                </Button>
                            </motion.div>
                        ) : (
                            <motion.div
                                variants={containerVariants}
                                initial="hidden"
                                animate="visible"
                                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20"
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
