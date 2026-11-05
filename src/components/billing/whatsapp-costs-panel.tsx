'use client';

import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, Loader2, MessageCircle, RefreshCw } from 'lucide-react';
import { getWhatsappCostAnalytics, type MetaCostConnection } from '@/actions/whatsapp-cost-analytics';
import { Button } from '@/components/ui/button';

const labels: Record<string, string> = { MARKETING: 'Marketing', MARKETING_LITE: 'Marketing Lite', UTILITY: 'Utilidade', AUTHENTICATION: 'Autenticação', AUTHENTICATION_INTERNATIONAL: 'Autenticação internacional', SERVICE: 'Serviço', REFERRAL_CONVERSION: 'Ponto de entrada' };
function Account({ account, periodLabel }: { account: MetaCostConnection; periodLabel: string }) {
  const categories = new Map<string, { volume: number; cost: number; known: boolean }>();
  for (const point of account.points) {
    const previous = categories.get(point.category) || { volume: 0, cost: 0, known: true };
    previous.volume += point.volume;
    previous.known &&= point.cost !== null;
    previous.cost += point.cost ?? 0;
    categories.set(point.category, previous);
  }
  const rows = [...categories.entries()].sort((a, b) => b[1].volume - a[1].volume);
  const totalVolume = rows.reduce((sum, row) => sum + row[1].volume, 0);
  const hasCost = rows.length > 0 && rows.every(row => row[1].known) && Boolean(account.currency);
  const money = (value: number) => account.currency ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: account.currency }).format(value) : '—';
  return <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5 sm:p-6"><div><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted-foreground">Conta oficial · {periodLabel}</p><h3 className="mt-1 text-lg font-semibold">{account.name}</h3></div><span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">Dados da Meta</span></div>
    {account.error ? <p role="alert" className="p-6 text-sm text-muted-foreground">{account.error}</p> : !rows.length ? <p className="p-6 text-sm text-muted-foreground">A Meta não retornou dados de consumo para este período.</p> : <><div className="grid grid-cols-2 divide-x border-b"><div className="p-5 sm:p-6"><p className="text-xs text-muted-foreground">Mensagens entregues</p><p className="mt-2 text-2xl font-semibold tabular-nums">{totalVolume.toLocaleString('pt-BR')}</p></div><div className="p-5 sm:p-6"><p className="text-xs text-muted-foreground">Custo informado pela Meta</p><p className="mt-2 text-2xl font-semibold tabular-nums">{hasCost ? money(rows.reduce((sum, row) => sum + row[1].cost, 0)) : 'Indisponível'}</p></div></div><div className="space-y-3 p-5 sm:p-6">{rows.map(([category, value]) => <div key={category} className="flex items-center justify-between gap-3 text-sm"><span>{labels[category] || category}</span><span className="text-right tabular-nums text-muted-foreground">{value.volume.toLocaleString('pt-BR')} · {value.known && account.currency ? money(value.cost) : 'custo indisponível'}</span></div>)}</div></>}
  </section>;
}
export function WhatsappCostsPanel() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getWhatsappCostAnalytics>> | null>(null);
  const [selection, setSelection] = useState('current');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setData(null);
    setError('');
    void getWhatsappCostAnalytics(selection).then(result => {
      if (active) setData(result);
    }).catch(() => {
      if (active) setError('Não foi possível carregar o consumo deste mês. Verifique seu acesso à cobrança e tente novamente.');
    });
    return () => { active = false; };
  }, [selection, revision]);
  const selectedMonth = /^\d{4}-\d{2}$/.test(selection) ? selection : data?.period.month || '';
  const periodLabel = data ? new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${data.period.month}-01T12:00:00Z`)) + (data.period.partial ? ' · até agora' : '') : '';
  return <div className="space-y-6"><div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-emerald-50 via-background to-background p-6 dark:from-emerald-950/30"><div className="relative"><div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><Activity className="h-5 w-5" /></div><p className="text-xs font-semibold uppercase tracking-[.18em] text-emerald-700 dark:text-emerald-400">Visibilidade para suas conversas</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Seu consumo no WhatsApp</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Acompanhe o volume entregue e os valores informados pela Meta para suas conexões oficiais. Esses valores são aproximados e não são cobranças da Dialogy.</p></div></div>
    <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[.14em] text-muted-foreground">Período do consumo</p><div role="group" aria-label="Escolher período" className="flex flex-wrap gap-2"><Button type="button" size="sm" variant={selection === 'current' ? 'default' : 'outline'} aria-pressed={selection === 'current'} onClick={() => setSelection('current')}>Este mês</Button><Button type="button" size="sm" variant={selection === 'previous' ? 'default' : 'outline'} aria-pressed={selection === 'previous'} onClick={() => setSelection('previous')}>Mês passado</Button></div></div>
      <div className="space-y-1.5"><label htmlFor="whatsapp-cost-month" className="block text-xs font-medium text-muted-foreground">Escolher outro mês</label><input id="whatsapp-cost-month" type="month" value={selectedMonth} min={data?.period.earliestMonth} max={data?.period.currentMonth} onChange={event => { if (event.target.value) setSelection(event.target.value); }} className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>
      <p className="w-full text-xs text-muted-foreground">Meses no horário de Brasília. A Meta fornece dados dos últimos 12 meses; o mês atual está em andamento.</p>
    </div>
    {error ? <div role="alert" className="space-y-3 text-sm text-muted-foreground"><p>{error}</p><Button variant="outline" onClick={() => setRevision(value => value + 1)}><RefreshCw />Tentar novamente</Button></div> : !data ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Consultando a Meta...</p> : <><div className="space-y-4">{data.accounts.map((account, index) => <Account key={index} account={account} periodLabel={periodLabel} />)}{!data.accounts.length && <p className="rounded-2xl border p-6 text-sm text-muted-foreground">Nenhuma conexão oficial neste workspace.</p>}</div>{data.referenceRates.length > 0 && <section className="rounded-2xl border p-5"><h3 className="text-sm font-semibold">Tarifas de referência</h3><p className="mt-1 text-xs text-muted-foreground">Valores por mensagem configurados pela administração. A Meta pode aplicar outros valores conforme país, faixas e regras da conta.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{data.referenceRates.map(rate=><div key={rate.category} className="flex justify-between gap-3 text-sm"><span>{labels[rate.category] || rate.category}</span><span className="tabular-nums text-muted-foreground">{new Intl.NumberFormat('pt-BR',{style:'currency',currency:rate.currency,minimumFractionDigits:2,maximumFractionDigits:8}).format(rate.rate)}</span></div>)}</div></section>}{data.unofficialConnections > 0 && <div className="flex items-start gap-3 rounded-2xl border p-5"><MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /><div><p className="text-sm font-semibold">{data.unofficialConnections} {data.unofficialConnections === 1 ? 'conexão não oficial' : 'conexões não oficiais'}</p><p className="mt-1 text-sm text-muted-foreground">A Meta não fornece dados de tarifação para essas conexões.</p></div></div>}</>}
    <a href="https://whatsappbusiness.com/products/platform-pricing/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4">Entenda a tarifação da Meta <ArrowUpRight className="h-4 w-4" /></a>
  </div>;
}
