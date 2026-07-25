'use client';

import * as React from 'react';
import { motion } from 'framer-motion';
import {
    BarChart3,
    Inbox,
    KanbanSquare,
    Layers,
    Megaphone,
    ShieldCheck,
    Users,
    Workflow,
    Zap,
} from 'lucide-react';
import { SectionHeading, Mark, ACCENTS, type AccentName } from './brand';
import { cn } from '@/lib/utils';

function Tile({
    accent,
    icon: Icon,
    title,
    description,
    className,
    children,
    delay = 0,
}: {
    accent: AccentName;
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
    className?: string;
    children?: React.ReactNode;
    delay?: number;
}) {
    return (
        <motion.article
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, delay }}
            className={cn(
                'group relative flex flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white p-6 transition-all duration-300 sm:p-7',
                'hover:-translate-y-1 hover:shadow-[0_28px_60px_-32px_rgba(15,23,42,0.35)]',
                className,
            )}
        >
            <span
                aria-hidden="true"
                className={cn(
                    'pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100',
                    ACCENTS[accent].glow,
                )}
            />
            <span
                className={cn(
                    'relative flex h-12 w-12 items-center justify-center rounded-2xl ring-1 transition-transform duration-300 group-hover:-rotate-6',
                    ACCENTS[accent].soft,
                )}
            >
                <Icon className="h-6 w-6" />
            </span>
            <h3 className="relative mt-5 text-lg font-extrabold tracking-tight text-slate-900">{title}</h3>
            <p className="relative mt-2 text-[0.94rem] leading-relaxed text-slate-600">{description}</p>
            {children ? <div className="relative mt-6 flex-1">{children}</div> : null}
        </motion.article>
    );
}

export function Platform() {
    return (
        <section id="plataforma" className="relative bg-white py-20 sm:py-28">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <SectionHeading
                    accent="violet"
                    eyebrow={
                        <>
                            <Layers className="h-3.5 w-3.5" />A plataforma inteira
                        </>
                    }
                    title={
                        <>
                            Não é só um chatbot.{' '}
                            <Mark tone="violet">É a operação toda.</Mark>
                        </>
                    }
                    description="Atendimento, vendas, CRM, automação e relatório no mesmo lugar. Você troca cinco ferramentas (e cinco mensalidades) por uma."
                />

                <div className="mt-14 grid gap-4 lg:grid-cols-3">
                    <Tile
                        accent="emerald"
                        icon={Inbox}
                        title="Inbox unificado com filas de verdade"
                        description="Departamentos, distribuição automática, transferência com contexto e nada de dois atendentes respondendo o mesmo cliente."
                        className="lg:col-span-2 lg:row-span-2"
                        delay={0}
                    >
                        <QueueVisual />
                    </Tile>

                    <Tile
                        accent="violet"
                        icon={KanbanSquare}
                        title="CRM com pipeline Kanban"
                        description="Cada conversa vira um card. Arraste entre etapas, marque valor, agende follow-up — sem sair do atendimento."
                        delay={0.05}
                    >
                        <KanbanVisual />
                    </Tile>

                    <Tile
                        accent="blue"
                        icon={Workflow}
                        title="Automações sem programar"
                        description="Monte fluxos no NexusFlow arrastando blocos: horário de atendimento, menu, coleta de dados, integração com seu sistema."
                        delay={0.1}
                    >
                        <FlowVisual />
                    </Tile>

                    <Tile
                        accent="amber"
                        icon={Megaphone}
                        title="Campanhas e reativação"
                        description="Dispare templates aprovados pela Meta para listas segmentadas e traga de volta quem parou de responder."
                        delay={0.15}
                    />

                    <Tile
                        accent="rose"
                        icon={Users}
                        title="Equipe sob controle"
                        description="Usuários ilimitados em todos os planos, permissões granulares por cargo e histórico de quem falou o quê."
                        delay={0.2}
                    />

                    <Tile
                        accent="blue"
                        icon={BarChart3}
                        title="Relatórios que viram decisão"
                        description="Tempo de primeira resposta, SLA, volume por canal e desempenho de cada atendente — exportável quando precisar."
                        delay={0.25}
                    />
                </div>

                {/* Reassurance strip */}
                <div className="mt-6 grid gap-4 rounded-[28px] border border-slate-200/80 bg-slate-50/70 p-6 sm:grid-cols-3 sm:p-7">
                    {[
                        {
                            icon: ShieldCheck,
                            title: 'API Oficial da Meta',
                            copy: 'Seu número verificado, sem risco de bloqueio por uso indevido.',
                        },
                        {
                            icon: Zap,
                            title: 'No ar em minutos',
                            copy: 'Conecte um canal, importe contatos e comece a atender no mesmo dia.',
                        },
                        {
                            icon: Users,
                            title: 'Suporte que responde',
                            copy: 'Time brasileiro, em português, dentro do próprio WhatsApp.',
                        },
                    ].map((item) => (
                        <div key={item.title} className="flex items-start gap-3">
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-900 ring-1 ring-slate-200">
                                <item.icon className="h-5 w-5" />
                            </span>
                            <div>
                                <p className="text-[0.92rem] font-extrabold text-slate-900">{item.title}</p>
                                <p className="mt-0.5 text-[0.86rem] leading-relaxed text-slate-600">{item.copy}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

/* -------------------------------------------------------------------------- */
/*  Mini visuals                                                              */
/* -------------------------------------------------------------------------- */

const QUEUES = [
    { name: 'Comercial', count: 12, tone: 'bg-emerald-500', width: 'w-[78%]', agents: ['JS', 'MR', 'AL'] },
    { name: 'Suporte', count: 7, tone: 'bg-blue-500', width: 'w-[52%]', agents: ['PC', 'DF'] },
    { name: 'Financeiro', count: 3, tone: 'bg-violet-500', width: 'w-[28%]', agents: ['RT'] },
];

function QueueVisual() {
    return (
        <div className="flex h-full flex-col rounded-2xl border border-slate-100 bg-slate-50/70 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
                <span className="text-[0.72rem] font-black uppercase tracking-wide text-slate-400">
                    Distribuição automática
                </span>
                <span className="rounded-full bg-brand-green px-2 py-0.5 text-[0.66rem] font-black text-slate-900">
                    22 conversas ativas
                </span>
            </div>
            <div className="flex flex-1 flex-col justify-between gap-3.5">
                {QUEUES.map((queue) => (
                    <div key={queue.name} className="rounded-xl bg-white p-3 ring-1 ring-slate-100">
                        <div className="flex items-center justify-between">
                            <span className="flex items-center gap-2 text-[0.82rem] font-bold text-slate-900">
                                <span className={cn('h-2 w-2 rounded-full', queue.tone)} />
                                {queue.name}
                            </span>
                            <div className="flex items-center gap-2">
                                <div className="flex -space-x-1.5">
                                    {queue.agents.map((agent) => (
                                        <span
                                            key={agent}
                                            className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-[0.58rem] font-black text-slate-600 ring-2 ring-white"
                                        >
                                            {agent}
                                        </span>
                                    ))}
                                </div>
                                <span className="text-[0.72rem] font-bold text-slate-400">{queue.count}</span>
                            </div>
                        </div>
                        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className={cn('h-full rounded-full', queue.tone, queue.width)} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

const KANBAN = [
    { label: 'Novo', tone: 'bg-slate-300', cards: 2 },
    { label: 'Proposta', tone: 'bg-amber-400', cards: 3 },
    { label: 'Fechado', tone: 'bg-emerald-500', cards: 1 },
];

function KanbanVisual() {
    return (
        <div className="grid grid-cols-3 gap-2">
            {KANBAN.map((column) => (
                <div key={column.label} className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                    <div className="mb-2 flex items-center gap-1.5">
                        <span className={cn('h-1.5 w-1.5 rounded-full', column.tone)} />
                        <span className="text-[0.62rem] font-black uppercase tracking-wide text-slate-500">
                            {column.label}
                        </span>
                    </div>
                    <div className="space-y-1.5">
                        {Array.from({ length: column.cards }).map((_, index) => (
                            <div key={index} className="rounded-lg bg-white p-1.5 ring-1 ring-slate-100">
                                <div className="h-1.5 w-3/4 rounded-full bg-slate-200" />
                                <div className="mt-1 h-1.5 w-1/2 rounded-full bg-slate-100" />
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

const FLOW = [
    { label: 'Mensagem recebida', tone: 'bg-blue-500' },
    { label: 'É horário comercial?', tone: 'bg-amber-500' },
    { label: 'IA atende e qualifica', tone: 'bg-violet-500' },
    { label: 'Envia para a fila certa', tone: 'bg-emerald-500' },
];

function FlowVisual() {
    return (
        <div className="space-y-1.5">
            {FLOW.map((node, index) => (
                <React.Fragment key={node.label}>
                    <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', node.tone)} />
                        <span className="text-[0.76rem] font-semibold text-slate-700">{node.label}</span>
                    </div>
                    {index < FLOW.length - 1 ? <div className="ml-[1.05rem] h-2 w-px bg-slate-200" /> : null}
                </React.Fragment>
            ))}
        </div>
    );
}
