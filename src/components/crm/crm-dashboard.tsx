'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, BarChart3, CircleDollarSign, Clock3, Send, Target, TrendingUp, Trophy, Users } from 'lucide-react';
import type { DealMetrics } from '@/lib/types';
import { getDealMetrics } from '@/actions/deals';
import { getPipelineStages } from '@/actions/crm';
import { labelizePipelineStageValue, sortPipelineStages, type PipelineStage } from '@/lib/crm-pipeline';

interface CrmDashboardProps {
  totalContacts: number | null;
  workspaceId?: string;
}

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CrmDashboard({ totalContacts, workspaceId }: CrmDashboardProps) {
  const [deals, setDeals] = useState<DealMetrics | null>(null);
  const [stages, setStages] = useState<PipelineStage[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    let mounted = true;
    Promise.all([getDealMetrics(workspaceId), getPipelineStages(workspaceId)]).then(([dealResult, stageResult]) => {
      if (!mounted) return;
      setDeals(dealResult.metrics || null);
      setStages(sortPipelineStages(stageResult.stages || []));
    });
    return () => { mounted = false; };
  }, [workspaceId]);

  const stageCounts = stages.map((stage) => ({ ...stage, count: deals?.dealsByStage.find((item) => item.stage === stage.value)?.count || 0 }));
  const topStage = Math.max(1, ...stageCounts.map((stage) => stage.count));
  const metrics = [
    { title: 'Contatos na base', value: totalContacts == null ? '—' : totalContacts.toLocaleString('pt-BR'), detail: 'Total no workspace', icon: Users, tone: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-400/10' },
    { title: 'Ticket médio', value: deals ? money(deals.averageTicket) : '—', detail: deals ? `${deals.winRate}% de negócios ganhos` : 'Carregando negócios', icon: Target, tone: 'text-indigo-700 dark:text-indigo-300', bg: 'bg-indigo-50 dark:bg-indigo-400/10' },
    { title: 'Ciclo médio', value: deals ? `${deals.averageCycleTimeDays} dias` : '—', detail: 'Tempo até o fechamento', icon: Clock3, tone: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-400/10' },
  ];
  const weekly = [
    { label: 'Novos negócios', value: deals ? String(deals.trends.newDeals.current) : '—', icon: Target },
    { label: 'Negócios ganhos', value: deals ? String(deals.trends.closedWon.current) : '—', icon: Trophy },
    { label: 'Receita fechada', value: deals ? money(deals.trends.revenue.current) : '—', icon: TrendingUp },
  ];

  return (
    <div className="h-full overflow-y-auto px-5 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-[1740px] space-y-6 pb-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300">Panorama comercial</p><h2 className="mt-1 text-[28px] font-semibold tracking-[-0.045em] text-[#132b20] dark:text-white md:text-[34px]">Visão geral</h2><p className="mt-1 text-sm text-slate-500 dark:text-zinc-400">Acompanhe o ritmo da operação e encontre o próximo passo.</p></div>
          <div className="flex items-center gap-2"><Link href="/campaigns" className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#dce7db] bg-white px-3.5 text-xs font-semibold text-[#285139] shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-emerald-200 dark:hover:bg-emerald-400/10"><Send className="h-3.5 w-3.5" /> Campanhas <ArrowUpRight className="h-3 w-3 opacity-50" /></Link><Link href="/analytics" className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#dce7db] bg-white px-3.5 text-xs font-semibold text-[#285139] shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 dark:border-white/10 dark:bg-white/[0.04] dark:text-emerald-200 dark:hover:bg-emerald-400/10"><BarChart3 className="h-3.5 w-3.5" /> Analytics <ArrowUpRight className="h-3 w-3 opacity-50" /></Link></div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-[minmax(0,1.55fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative min-h-[212px] overflow-hidden rounded-[24px] bg-[#143827] p-6 text-white shadow-[0_18px_45px_-28px_rgba(5,44,22,.65)] md:p-7">
            <div className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full border-[42px] border-white/[0.045]" /><div className="pointer-events-none absolute -bottom-24 right-14 h-48 w-48 rounded-full bg-emerald-400/15 blur-[55px]" />
            <div className="relative flex h-full flex-col justify-between gap-7"><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[0.19em] text-emerald-100/70">Valor em oportunidades</span><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 bg-white/10"><CircleDollarSign className="h-5 w-5 text-lime-200" /></span></div><div><div className="break-words text-[clamp(1.75rem,2.5vw,2.625rem)] font-semibold tracking-[-0.06em]">{deals ? money(deals.totalPipelineValue) : '—'}</div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-emerald-100/75"><span className="rounded-full bg-white/10 px-2.5 py-1 text-lime-100">{deals ? money(deals.weightedPipelineValue) : '—'}</span> previsão ponderada</div></div></div>
          </div>
          {metrics.map(({ title, value, detail, icon: Icon, tone, bg }) => <div key={title} className="flex min-h-[212px] flex-col justify-between rounded-[24px] border border-[#e1e9df] bg-white p-6 shadow-[0_12px_36px_-28px_rgba(14,47,27,.35)] dark:border-white/10 dark:bg-[#121b16] md:p-7"><div className="flex items-start justify-between gap-2"><span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">{title}</span><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${bg} ${tone}`}><Icon className="h-[18px] w-[18px]" /></span></div><div><p className="text-[29px] font-semibold tracking-[-0.05em] text-[#142d20] dark:text-white md:text-[32px]">{value}</p><p className="mt-2 text-xs text-slate-500 dark:text-zinc-400">{detail}</p></div></div>)}
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(330px,1fr)]">
          <section className="rounded-[24px] border border-[#e1e9df] bg-white p-5 shadow-[0_12px_36px_-28px_rgba(14,47,27,.35)] dark:border-white/10 dark:bg-[#121b16] md:p-7">
            <div className="mb-7 flex flex-wrap items-start justify-between gap-3"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">O caminho até a venda</p><h3 className="mt-1 text-xl font-semibold tracking-tight text-[#142d20] dark:text-white">Distribuição do funil</h3><p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">Negócios abertos em cada etapa configurada.</p></div><Link href="/crm#kanban" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-400/10">Abrir funil <ArrowUpRight className="h-3.5 w-3.5" /></Link></div>
            {stageCounts.length ? <div className="space-y-5">{stageCounts.map((stage) => <div key={stage.value} className="grid grid-cols-[minmax(100px,170px)_minmax(0,1fr)_38px] items-center gap-3"><div className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} /><span className="truncate text-xs font-medium text-slate-700 dark:text-zinc-200" title={stage.label}>{stage.label || labelizePipelineStageValue(stage.value)}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-[#edf2ec] dark:bg-white/10"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(stage.count ? 4 : 0, (stage.count / topStage) * 100)}%`, backgroundColor: stage.color }} /></div><span className="text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-zinc-200">{stage.count}</span></div>)}</div> : <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-dashed border-[#dce7db] text-center text-sm text-slate-500 dark:border-white/10 dark:text-zinc-400">As etapas do seu funil aparecerão aqui.</div>}
          </section>

          <section className="rounded-[24px] border border-[#e1e9df] bg-white p-5 shadow-[0_12px_36px_-28px_rgba(14,47,27,.35)] dark:border-white/10 dark:bg-[#121b16] md:p-7">
            <div className="mb-6"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Últimos 7 dias</p><h3 className="mt-1 text-xl font-semibold tracking-tight text-[#142d20] dark:text-white">Ritmo comercial</h3><p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">Movimento real dos negócios no período.</p></div>
            <div className="space-y-3">{weekly.map(({ label, value, icon: Icon }) => <div key={label} className="flex items-center gap-3 rounded-2xl border border-[#e6ece4] bg-[#fafbf8] p-3.5 dark:border-white/10 dark:bg-white/[0.03]"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300"><Icon className="h-[18px] w-[18px]" /></span><span className="min-w-0 flex-1 text-xs font-medium text-slate-500 dark:text-zinc-400">{label}</span><span className="text-sm font-semibold tabular-nums text-[#142d20] dark:text-white">{value}</span></div>)}</div>
          </section>
        </div>

        {deals?.dealsByStage.length ? <section className="rounded-[24px] border border-[#e1e9df] bg-white p-5 dark:border-white/10 dark:bg-[#121b16] md:p-7"><div className="mb-5 flex items-center justify-between"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-300">Negócios por etapa</p><h3 className="mt-1 text-xl font-semibold tracking-tight text-[#142d20] dark:text-white">Valor em movimento</h3></div><ArrowRight className="h-5 w-5 text-[#a7c6ae]" /></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{deals.dealsByStage.map((stage) => { const setting = stages.find((item) => item.value === stage.stage); return <div key={stage.stage} className="rounded-2xl border border-[#e6ece4] bg-[#fafbf8] p-4 dark:border-white/10 dark:bg-white/[0.03]"><div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-zinc-400"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: setting?.color || '#94a3b8' }} />{setting?.label || labelizePipelineStageValue(stage.stage)}</div><p className="mt-4 text-lg font-semibold tracking-tight text-[#142d20] dark:text-white">{money(stage.totalValue)}</p><p className="mt-1 text-[11px] text-slate-400">{stage.count} negócios</p></div>; })}</div></section> : null}
      </div>
    </div>
  );
}
