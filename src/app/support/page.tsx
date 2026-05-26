'use client';

import { motion } from 'framer-motion';
import {
    Ticket,
    BookOpen,
    MessageCircle,
    Search,
    ArrowRight,
    LifeBuoy,
    ShieldCheck,
    Mail,
    Zap,
    ExternalLink
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@/components/ui/accordion";

const actionCards = [
    {
        href: '/support/tickets/new',
        title: 'Abrir chamado',
        description: 'Relate incidentes, solicite novos recursos e fale com o time tecnico.',
        cta: 'Iniciar atendimento',
        icon: Ticket,
        gradient: 'from-blue-500/20 via-blue-500/5 to-transparent',
        border: 'group-hover:border-blue-500/30',
        iconColor: 'text-blue-400',
        iconBg: 'bg-blue-500/10'
    },
    {
        href: '/support/tickets',
        title: 'Meus tickets',
        description: 'Acompanhe respostas, SLA e historico completo das solicitacoes.',
        cta: 'Ver historico',
        icon: MessageCircle,
        gradient: 'from-violet-500/20 via-violet-500/5 to-transparent',
        border: 'group-hover:border-violet-500/30',
        iconColor: 'text-violet-400',
        iconBg: 'bg-violet-500/10'
    },
    {
        href: 'https://docs.dialogy.app',
        title: 'Documentacao',
        description: 'Acesse guias objetivos, referencias de API e materiais de integracao.',
        cta: 'Ler tutoriais',
        icon: BookOpen,
        gradient: 'from-emerald-500/20 via-emerald-500/5 to-transparent',
        border: 'group-hover:border-emerald-500/30',
        iconColor: 'text-emerald-400',
        iconBg: 'bg-emerald-500/10',
        external: true
    }
];

const faqItems = [
    { value: 'item-1', q: 'Como conectar meu WhatsApp?', a: 'Para conectar seu WhatsApp, navegue até a seção de "Integrações" no menu lateral, selecione "WhatsApp" e siga o passo a passo para escanear o QR Code gerado. Certifique-se de que o número não esteja vinculado a outra conta Business API.' },
    { value: 'item-2', q: 'Onde vejo consumo e faturas?', a: 'Você pode acessar todas as informações financeiras em "Configurações" > "Cobrança". Lá você encontrará seu histórico de faturas, consumo atual e previsão para o próximo ciclo.' },
    { value: 'item-3', q: 'Como criar um agente de IA?', a: 'Vá até o menu "Automações" > "Agentes Inteligentes" e clique em "Novo Agente". Recomendamos começar utilizando um dos nossos templates pré-configurados para agilizar o processo.' },
    { value: 'item-4', q: 'Webhook e API têm exemplos?', a: 'Sim, nossa documentação é completa e inclui exemplos de payloads para todas as requisições, métodos de autenticação e fluxos de integração passo a passo.' },
    { value: 'item-5', q: 'Posso adicionar membros à minha equipe?', a: 'Sim. Dependendo do seu plano, você pode convidar membros para sua equipe em "Configurações" > "Equipe", definindo níveis de permissão específicos para cada usuário.' }
];

export default function SupportPage() {
    const containerVariants = {
        hidden: { opacity: 0 },
        visible: {
            opacity: 1,
            transition: { staggerChildren: 0.1 }
        }
    };

    const itemVariants = {
        hidden: { y: 20, opacity: 0 },
        visible: {
            y: 0,
            opacity: 1,
            transition: { type: 'spring', stiffness: 100, damping: 20 }
        }
    };

    return (
        <div className="relative flex h-full min-h-screen flex-col overflow-y-auto overflow-x-hidden bg-background selection:bg-emerald-500/30">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-[20%] left-1/2 h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-emerald-500/5 blur-[120px]" />
                <div className="absolute left-[10%] top-[10%] h-[500px] w-[500px] rounded-full bg-blue-500/5 blur-[100px]" />
                <div className="absolute bottom-[10%] right-[10%] h-[600px] w-[600px] rounded-full bg-violet-500/5 blur-[120px]" />
            </div>

            <motion.div
                className="relative z-10 mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
            >
                <motion.div variants={itemVariants} className="mb-16 text-center">
                    <div className="mb-4 inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-400">
                        <Zap className="mr-2 h-4 w-4" />
                        Centro de Suporte
                    </div>
                    <h1 className="mb-6 text-4xl font-bold tracking-tight text-slate-950 dark:text-white sm:text-5xl md:text-6xl">
                        Como podemos <span className="bg-gradient-to-r from-emerald-400 to-blue-500 bg-clip-text text-transparent">ajudar você?</span>
                    </h1>
                    <p className="mx-auto mb-10 max-w-2xl text-lg text-slate-600 dark:text-zinc-400">
                        Encontre respostas, acesse documentações ou entre em contato com nosso time de especialistas para resolver seus problemas rapidamente.
                    </p>

                    <div className="mx-auto max-w-2xl">
                        <div className="relative group">
                            <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-blue-500 opacity-20 blur transition group-hover:opacity-35" />
                            <div className="relative flex items-center rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#07080b] shadow-[0_24px_60px_-40px_rgba(15,23,42,0.18)]">
                                <Search className="absolute left-4 h-5 w-5 text-slate-400 dark:text-zinc-500" />
                                <Input
                                    placeholder="Busque por artigos, tutoriais ou topicos de ajuda..."
                                    className="h-14 truncate rounded-2xl border-0 bg-transparent pl-12 pr-4 text-base text-slate-900 placeholder:text-slate-400 focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                                />
                                <div className="absolute right-2 hidden sm:block">
                                    <kbd className="inline-flex h-8 items-center gap-1 rounded border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/10 px-2 text-xs font-medium text-slate-500 dark:text-zinc-400">
                                        <span className="text-xs">⌘</span>K
                                    </kbd>
                                </div>
                            </div>
                        </div>
                    </div>
                </motion.div>

                <motion.section variants={itemVariants} className="mb-20 grid grid-cols-1 gap-6 md:grid-cols-3">
                    {actionCards.map((card) => {
                        const Icon = card.icon;
                        return (
                            <Link
                                key={card.title}
                                href={card.href}
                                target={card.external ? '_blank' : undefined}
                                rel={card.external ? 'noopener noreferrer' : undefined}
                                className="group relative block h-full"
                            >
                                <div className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${card.gradient} opacity-0 transition-opacity duration-500 group-hover:opacity-100`} />
                                <Card className={`relative h-full overflow-hidden rounded-3xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-[#07080b] transition-all duration-300 ${card.border} hover:-translate-y-1 hover:shadow-[0_24px_60px_-34px_rgba(15,23,42,0.2)]`}>
                                    <CardHeader>
                                        <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-2xl ${card.iconBg} ${card.iconColor} ring-1 ring-inset ring-slate-200 dark:ring-white/10`}>
                                            <Icon className="h-6 w-6" />
                                        </div>
                                        <CardTitle className="text-xl font-bold text-slate-950 dark:text-white">{card.title}</CardTitle>
                                        <CardDescription className="line-clamp-2 text-slate-500 dark:text-zinc-400">
                                            {card.description}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <div className={`inline-flex items-center text-sm font-semibold ${card.iconColor} transition-all group-hover:translate-x-1`}>
                                            {card.cta}
                                            {card.external ? <ExternalLink className="ml-2 h-4 w-4" /> : <ArrowRight className="ml-2 h-4 w-4" />}
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        );
                    })}
                </motion.section>

                <motion.div variants={itemVariants} className="grid grid-cols-1 gap-8 lg:grid-cols-3">
                    <section className="lg:col-span-2">
                        <div className="mb-6 flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white dark:border-white/10 dark:bg-[#07080b] shadow-sm">
                                <LifeBuoy className="h-5 w-5 text-emerald-400" />
                            </div>
                            <h2 className="text-2xl font-bold text-slate-950 dark:text-white">Perguntas Frequentes</h2>
                        </div>

                        <Card className="border-slate-200/80 bg-white dark:border-white/10 dark:bg-[#07080b] shadow-[0_18px_40px_-28px_rgba(15,23,42,0.14)]">
                            <CardContent className="p-6">
                                <Accordion type="single" collapsible className="w-full space-y-2">
                                    {faqItems.map((item) => (
                                        <AccordionItem key={item.value} value={item.value} className="rounded-lg border-slate-200 dark:border-white/10 px-2 transition-colors data-[state=open]:bg-slate-50 dark:data-[state=open]:bg-white/5">
                                            <AccordionTrigger className="px-2 py-4 text-slate-900 dark:text-zinc-200 hover:text-slate-950 dark:hover:text-white hover:no-underline">
                                                {item.q}
                                            </AccordionTrigger>
                                            <AccordionContent className="px-2 pb-4 text-slate-500 dark:text-zinc-400">
                                                {item.a}
                                            </AccordionContent>
                                        </AccordionItem>
                                    ))}
                                </Accordion>
                            </CardContent>
                        </Card>
                    </section>

                    <section className="flex flex-col gap-6">
                        <div className="relative overflow-hidden rounded-3xl border border-indigo-200 dark:border-indigo-500/20 bg-white dark:bg-[#07080b] p-1 shadow-[0_22px_52px_-34px_rgba(99,102,241,0.26)]">
                            <div className="absolute inset-0 bg-[url('/noise.png')] opacity-20 mixed-blend-overlay" />
                            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-indigo-500/12 blur-[60px]" />

                            <div className="relative rounded-[20px] bg-white dark:bg-[#07080b] p-6 backdrop-blur-xl">
                                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20">
                                    <ShieldCheck className="h-6 w-6" />
                                </div>
                                <h3 className="mb-2 text-xl font-bold text-slate-950 dark:text-white">Suporte Enterprise</h3>
                                <p className="mb-6 text-sm text-slate-500 dark:text-zinc-400">
                                    Clientes do plano Enterprise possuem atendimento prioritário e gerente de contas dedicado.
                                </p>

                                <div className="space-y-3">
                                    <Button className="w-full gap-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700" size="lg">
                                        <Mail className="h-4 w-4" />
                                        Contatar Gerente
                                    </Button>
                                    <div className="text-center">
                                        <span className="text-xs text-slate-500 dark:text-zinc-500">Tempo médio de resposta: &lt; 2 horas</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-3xl border border-slate-200/80 bg-white dark:border-white/10 dark:bg-[#07080b] p-6 shadow-[0_18px_40px_-28px_rgba(15,23,42,0.14)]">
                            <h3 className="mb-2 text-lg font-semibold text-slate-950 dark:text-white">Precisa de mais ajuda?</h3>
                            <p className="mb-4 text-sm text-slate-500 dark:text-zinc-400">
                                Nossa comunidade no Discord é ativa e pode ajudar com dúvidas rápidas.
                            </p>
                            <Button variant="outline" className="w-full gap-2 rounded-xl border-slate-200 bg-transparent text-slate-700 hover:bg-slate-50 hover:text-slate-950 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-white">
                                <ExternalLink className="h-4 w-4" />
                                Acessar Comunidade
                            </Button>
                        </div>
                    </section>
                </motion.div>

                <motion.div variants={itemVariants} className="mt-20 text-center">
                    <p className="text-sm text-slate-500 dark:text-zinc-500">
                        &copy; {new Date().getFullYear()} Dialogy. Todos os direitos reservados.
                    </p>
                </motion.div>
            </motion.div>
        </div>
    );
}
