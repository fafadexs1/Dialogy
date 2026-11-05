'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Coins, CreditCard, Loader2, ReceiptText, RefreshCw, Settings2, ShieldCheck, MessageCircle } from 'lucide-react';
import { getAsaasBillingAction, createAsaasCheckoutAction, reconcileAsaasBillingAction, cancelAsaasSubscriptionAction } from '@/actions/asaas';
import { AsaasPaymentDialog } from '@/components/billing/asaas-payment-dialog';
import { WhatsappCostsPanel } from '@/components/billing/whatsapp-costs-panel';
import { AiCreditsPanel } from '@/components/billing/ai-credits-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { planHighlights } from '@/lib/billing-catalog';
import { paymentLabel } from '@/lib/asaas-billing';
import { cn } from '@/lib/utils';

type Data = Awaited<ReturnType<typeof getAsaasBillingAction>>;
type Invoice = Data['invoices'][number];
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string) => new Date(value.includes('T') ? value : `${value}T12:00:00`).toLocaleDateString('pt-BR');
const unpaid = (invoice: Invoice) => ['PENDING', 'OVERDUE'].includes(invoice.status);
const tabStyle = 'min-w-0 gap-1.5 rounded-none border-b-2 border-transparent px-2 py-3 text-xs shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none sm:px-4 sm:text-sm';

function InvoiceStatus({ status }: { status: string }) {
  return <Badge variant="outline" className={cn('max-w-full whitespace-normal rounded-md text-xs font-medium',
    status === 'OVERDUE' && 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'].includes(status) && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  )}>{paymentLabel(status)}</Badge>;
}

export function AsaasBillingPanel() {
  const params = useSearchParams();
  const creditReturn = params.get('credits');
  const [tab, setTab] = useState(creditReturn ? 'credits' : 'plan');
  const [data, setData] = useState<Data | null>(null);
  const [selected, setSelected] = useState(params.get('plan') || 'pro');
  const [name, setName] = useState('');
  const [document, setDocument] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try {
      const result = await getAsaasBillingAction();
      setData(result);
      setError('');
    } catch {
      setError('Não foi possível carregar a cobrança. Tente novamente.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run(action: () => Promise<{ success: boolean; error?: string; paymentId?: string | null }>, success: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await action();
      if (!result.success) { setError(result.error || 'Não foi possível concluir.'); return; }
      setNotice(success); setCheckout(false); setCancel(false); setManage(false);
      await load();
      if (result.paymentId) setPaymentId(result.paymentId);
    } catch {
      setError('A operação não foi confirmada. Atualize antes de tentar novamente.');
    } finally { setBusy(false); }
  }

  if (!data) return <div className="flex min-h-64 flex-col items-center justify-center gap-4 text-sm" role="status">
    {error || <><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />Carregando cobrança...</>}
    {error && <Button onClick={load} variant="outline"><RefreshCw />Tentar novamente</Button>}
  </div>;

  const offers = data.plans.filter(p => p.id !== 'enterprise');
  const plan = offers.find(p => p.id === selected) || offers.find(p => p.highlighted) || offers[0];
  const current = data.plans.find(p => p.id === data.subscription?.plan);
  const pending = data.invoices.filter(unpaid).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const nextInvoice = pending[0];
  const canSubscribe = data.ready && data.workspace.canManage && !data.legacyStripe && (!data.subscription || data.subscription.canceled);
  const subscriptionLabel = data.subscription?.canceled ? 'Renovação cancelada'
    : data.subscription?.status === 'trialing' ? 'Em período de teste'
    : data.subscription?.status === 'active' ? 'Assinatura ativa' : 'Pagamento pendente';

  return <div className="mx-auto w-full min-w-0 max-w-5xl pb-10 [letter-spacing:0]">
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">Cobrança</h1>
        <p className="mt-1 break-words text-sm text-muted-foreground">{data.workspace.name}</p>
      </div>
      {data.environment === 'sandbox' && <Badge variant="outline" className="border-amber-500/30 text-amber-700 dark:text-amber-300">Ambiente de testes</Badge>}
    </header>

    <Tabs value={tab} onValueChange={value => { setTab(value); setNotice(''); setError(''); }} className="min-w-0">
      <TabsList aria-label="Cobrança" className="mb-7 grid h-auto w-full grid-cols-4 justify-start rounded-none border-b bg-transparent p-0 sm:flex">
        <TabsTrigger value="plan" className={tabStyle}><CreditCard className="h-4 w-4 shrink-0" />Meu plano</TabsTrigger>
        <TabsTrigger value="credits" className={tabStyle}><Coins className="h-4 w-4 shrink-0" />Créditos de IA</TabsTrigger>
        <TabsTrigger value="whatsapp" className={tabStyle}><MessageCircle className="h-4 w-4 shrink-0" />WhatsApp</TabsTrigger>
        <TabsTrigger value="invoices" className={tabStyle}><ReceiptText className="h-4 w-4 shrink-0" />Faturas{pending.length > 0 && <span className="hidden rounded bg-amber-500/15 px-1.5 text-xs text-amber-800 sm:inline dark:text-amber-300">{pending.length}</span>}</TabsTrigger>
      </TabsList>

      {error && !checkout && !cancel && <p role="alert" className="mb-5 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mb-5 flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 p-3 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p>}

      <TabsContent value="whatsapp"><WhatsappCostsPanel /></TabsContent>

      <TabsContent value="plan" className="space-y-6">
        {data.legacyStripe && <p className="border-l-2 border-amber-500 pl-4 text-sm leading-relaxed text-muted-foreground">Sua assinatura atual continua no Stripe. Para alterar o plano, entre em contato com o suporte. Nenhuma nova assinatura será criada aqui. <a href="/settings/billing?provider=stripe" className="underline">Gerenciar assinatura atual</a></p>}
        {!data.ready && !data.subscription && <p className="border-l-2 border-amber-500 pl-4 text-sm leading-relaxed text-muted-foreground">A contratação online está temporariamente indisponível. Para contratar, entre em contato com o suporte.</p>}
        {!data.workspace.canManage && <p className="text-sm text-muted-foreground">Somente o proprietário deste workspace pode contratar ou gerenciar a assinatura.</p>}

        {data.subscription && <>
          <section aria-label="Assinatura atual" className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
              <div>
                <p className="mb-2 text-sm text-muted-foreground">Seu plano</p>
                <h2 className="text-2xl font-semibold">{current?.label || data.subscription.plan}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{money(data.subscription.price)}/mês contratado</p>
                <p className="mt-3 flex items-center gap-2 text-sm"><span className={cn('h-2 w-2 shrink-0 rounded-full', data.subscription.canceled ? 'bg-muted-foreground' : data.subscription.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500')} />{subscriptionLabel}</p>
              </div>
              <Button variant="outline" onClick={() => setManage(true)}><Settings2 />Gerenciar</Button>
            </div>
            {data.subscription.accessUntil && <p className="text-sm text-muted-foreground">{data.subscription.status === 'trialing' ? 'Seu período de teste vai até ' : 'Acesso ao plano até '}<strong className="font-medium text-foreground">{date(data.subscription.accessUntil)}</strong>.</p>}
            {!data.subscription.linked && <Button disabled={busy || !data.ready || !data.workspace.canManage} onClick={()=>{setSelected(data.subscription!.plan);setError('');setCheckout(true);}}>Retomar contratação</Button>}
            {nextInvoice ? <div className="flex flex-wrap items-center justify-between gap-5 border-y border-amber-500/25 bg-amber-500/[0.06] px-4 py-5 sm:px-5">
              <div>
                <p className="text-sm font-medium">{nextInvoice.status === 'OVERDUE' ? 'Uma fatura precisa da sua atenção' : 'Próxima fatura'}</p>
                <p className="mt-2 text-2xl font-semibold tabular-nums">{money(nextInvoice.amount)}</p>
                <p className="mt-1 text-sm text-muted-foreground">Vencimento em {date(nextInvoice.due_date)}</p>
              </div>
              <Button disabled={!data.ready || !data.workspace.canManage} className="w-full sm:w-auto" onClick={() => setPaymentId(nextInvoice.id)}>Pagar fatura<ArrowRight /></Button>
            </div> : <div className="flex items-start gap-3 py-2">
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
              <div><p className="text-sm font-medium">Nenhuma fatura em aberto</p><p className="mt-1 text-sm text-muted-foreground">As cobranças emitidas ficam na aba Faturas.</p></div>
            </div>}
            {current && <details className="group border-b pb-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">O que está incluído no plano<ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /></summary>
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">{planHighlights(current.limits).map(feature => <li key={feature} className="flex items-start gap-2 text-sm text-muted-foreground"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{feature}</li>)}</ul>
            </details>}
          </section>
          <button type="button" onClick={() => setTab('credits')} className="group flex w-full items-center justify-between gap-4 border-b py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex min-w-0 items-start gap-3"><Coins className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><span><span className="block text-sm font-medium">Créditos para seus agentes de IA</span><span className="mt-1 block text-sm text-muted-foreground">Consulte o saldo e recarregue quando precisar.</span></span></span><ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" />
          </button>
        </>}
        {(!data.subscription || data.subscription.canceled) && <>
          <div id="available-plans"><h2 className="text-lg font-semibold">{data.subscription?.canceled ? 'Escolha um plano para voltar' : 'Escolha seu plano'}</h2><p className="mt-1 text-sm text-muted-foreground">{data.subscription?.canceled ? 'Você pode contratar novamente o mesmo plano ou escolher outro. Seu histórico de faturas será mantido.' : 'Uma assinatura para todo o workspace. Usuários ilimitados.'}</p></div>
          {plan ? <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <RadioGroup aria-label="Planos disponíveis" value={plan.id} onValueChange={setSelected} className="gap-3">
              {offers.map(offer => <label key={offer.id} htmlFor={`billing-plan-${offer.id}`} className={cn('flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border bg-background p-4 transition-colors hover:border-primary/50 sm:p-5', plan.id === offer.id && 'border-primary bg-primary/[0.04] ring-1 ring-primary')}>
                <RadioGroupItem id={`billing-plan-${offer.id}`} value={offer.id} className="mt-1 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2"><span className="break-words font-semibold">{offer.label}</span>{offer.highlighted && <Badge variant="secondary" className="rounded px-1.5 text-[10px] font-medium">Recomendado</Badge>}</span>
                  <span className="mt-1.5 hidden text-xs leading-relaxed text-muted-foreground sm:block">{offer.description}</span>
                  <span className="mt-3 block text-xl font-semibold tabular-nums">{money(offer.price)}<span className="ml-1 text-xs font-normal text-muted-foreground">/mês</span></span>
                </span>
              </label>)}
            </RadioGroup>
            <section aria-label="Resumo do plano" className="flex min-w-0 flex-col border-t pt-6 xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0">
              <p className="text-sm text-muted-foreground">Você escolheu</p>
              <h3 className="mt-1 text-lg font-semibold">{plan.label}</h3>
              <ul className="order-2 my-5 space-y-2.5 xl:order-none">{planHighlights(plan.limits).map(feature => <li key={feature} className="flex items-start gap-2 text-sm"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{feature}</li>)}</ul>
              <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t pt-4 xl:mt-0"><span className="text-sm text-muted-foreground">Assinatura mensal</span><strong className="text-xl tabular-nums">{money(plan.price)}</strong></div>
              {!!plan.trialDays && !data.subscription && <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{plan.trialDays} dias de teste na primeira contratação</p>}
              <Button className="mt-5 h-auto min-h-11 w-full whitespace-normal py-3" disabled={busy || !canSubscribe} onClick={() => { setSelected(plan.id); setError(''); setCheckout(true); }}>Continuar com {plan.label}<ArrowRight /></Button>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">PIX, boleto ou cartão. Créditos de IA são recarregados separadamente.</p>
            </section>
          </div> : <p className="py-6 text-sm text-muted-foreground">Nenhum plano disponível para contratação. Entre em contato com o suporte.</p>}
          <p className="border-t pt-5 text-xs text-muted-foreground">Precisa de uma operação personalizada? O plano Enterprise está disponível sob consulta com o suporte.</p>
        </>}
      </TabsContent>

      <TabsContent value="credits">
        {creditReturn === 'success' && <p role="status" className="mb-5 border-l-2 border-primary pl-4 text-sm">Recebemos seu retorno do pagamento. Os créditos serão liberados após a confirmação; acompanhe o saldo e o extrato abaixo.</p>}
        {creditReturn === 'cancelled' && <p role="status" className="mb-5 border-l-2 border-amber-500 pl-4 text-sm">A recarga não foi concluída. Você pode escolher um valor e tentar novamente.</p>}
        <AiCreditsPanel workspaceId={data.workspace.id} />
      </TabsContent>

      <TabsContent value="invoices" className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-semibold">Faturas do plano</h2><p className="mt-1 text-sm text-muted-foreground">{pending.length ? `${pending.length} ${pending.length === 1 ? 'fatura em aberto' : 'faturas em aberto'}` : 'Nenhuma fatura em aberto'}</p></div>
          <Button variant="outline" size="sm" disabled={busy || !data.workspace.canManage} onClick={() => run(reconcileAsaasBillingAction, 'Pagamentos atualizados.')}><RefreshCw className={cn(busy && 'animate-spin')} />Atualizar</Button>
        </div>
        {data.invoices.length ? <ul aria-label="Faturas do plano" className="divide-y border-y">
          {[...pending, ...data.invoices.filter(p => !unpaid(p))].map(invoice => <li key={invoice.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 py-5">
            <ReceiptText className="hidden h-5 w-5 shrink-0 text-muted-foreground sm:block" />
            <div className="min-w-0 flex-1 basis-36"><p className="font-semibold tabular-nums">{money(invoice.amount)}</p><p className="mt-1 text-xs text-muted-foreground">Vencimento {date(invoice.due_date)}</p></div>
            <div className="min-w-0 flex-1 basis-36"><InvoiceStatus status={invoice.status} /><p className="mt-1.5 text-xs text-muted-foreground">{({ UNDEFINED: 'PIX, boleto ou cartão', CREDIT_CARD: 'Cartão', BOLETO: 'Boleto', PIX: 'PIX' } as Record<string, string>)[invoice.billing_type] || invoice.billing_type}</p></div>
            {unpaid(invoice) ? <Button disabled={!data.ready || !data.workspace.canManage} size="sm" className="w-full sm:w-auto" onClick={() => setPaymentId(invoice.id)}>Pagar fatura<ArrowRight /></Button> : invoice.invoice_url ? <Button asChild variant="outline" size="sm" className="w-full sm:w-auto"><a href={invoice.invoice_url} target="_blank" rel="noopener noreferrer" aria-label={`${unpaid(invoice) ? 'Pagar' : 'Ver'} fatura de ${money(invoice.amount)}, vencimento ${date(invoice.due_date)}`}>{unpaid(invoice) ? 'Pagar fatura' : 'Ver fatura'}<ArrowUpRight /></a></Button> : <span className="text-xs text-muted-foreground">Fatura sem link</span>}
          </li>)}
        </ul> : <div className="flex min-h-56 flex-col items-center justify-center border-y py-10 text-center"><ReceiptText className="mb-3 h-7 w-7 text-muted-foreground" /><h3 className="text-sm font-medium">Suas faturas aparecerão aqui</h3><p className="mt-2 max-w-sm text-sm text-muted-foreground">Após contratar um plano, acompanhe os vencimentos e os pagamentos neste histórico.</p></div>}
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" />Pagamento do plano processado pelo ASAAS. O extrato das recargas fica na aba Créditos de IA.</p>
      </TabsContent>
    </Tabs>

    {paymentId && <AsaasPaymentDialog key={paymentId} workspaceId={data.workspace.id} workspaceName={data.workspace.name} paymentId={paymentId} onClose={() => { setPaymentId(null); void load(); }} onPaid={() => { setNotice('Pagamento confirmado. Seu plano foi atualizado.'); void load(); }} />}

    <Dialog open={checkout} onOpenChange={v => { if (!busy) setCheckout(v); }}>
      <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto rounded-lg">
        <DialogHeader><DialogTitle>Finalizar contratação</DialogTitle><DialogDescription>Informe os dados de quem será responsável pelo pagamento.</DialogDescription></DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2 border-y py-4"><span className="font-medium">{plan?.label}</span><span className="font-semibold">{plan && money(plan.price)}<span className="text-sm font-normal text-muted-foreground">/mês</span></span></div>
        {!!plan?.trialDays && !data.subscription && <p className="text-sm text-muted-foreground">Primeiro vencimento após {plan.trialDays} dias de teste. Novas faturas são emitidas mensalmente.</p>}
        {data.subscription?.canceled && <p className="text-sm text-muted-foreground">Esta é uma nova contratação, sem reiniciar o período de teste. Se ainda houver acesso vigente, o primeiro vencimento será após esse período; caso contrário, será hoje. O novo plano será liberado após a confirmação do pagamento.</p>}
        <form onSubmit={e => { e.preventDefault(); if (plan) void run(() => createAsaasCheckoutAction({ workspaceId: data.workspace.id, planId: plan.id, name, cpfCnpj: document }), 'Assinatura criada. A fatura aparecerá aqui assim que for emitida.'); }} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="payer-name">Nome ou razão social</Label><Input id="payer-name" required minLength={3} maxLength={150} value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Nome completo ou nome da empresa" /></div>
          <div className="space-y-2"><Label htmlFor="payer-document">CPF ou CNPJ de cobrança</Label><Input id="payer-document" required inputMode="numeric" maxLength={18} value={document} onChange={e => setDocument(e.target.value)} placeholder="CPF ou CNPJ" /></div>
          <p className="text-xs leading-relaxed text-muted-foreground">Na próxima etapa, pague com Pix, boleto ou cartão aqui no Dialogy. Cada fatura é paga separadamente. O pagamento é processado pelo Asaas.</p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy} className="h-11 w-full">{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}Contratar e continuar</Button>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={manage} onOpenChange={setManage}>
      <DialogContent className="max-w-md rounded-lg"><DialogHeader><DialogTitle>Gerenciar assinatura</DialogTitle><DialogDescription>{current?.label || data.subscription?.plan} · {subscriptionLabel}</DialogDescription></DialogHeader>
        {data.subscription?.canceled ? <><p className="text-sm text-muted-foreground">A renovação foi cancelada. Escolha um plano para contratar novamente.</p><Button onClick={() => { setManage(false); setTab('plan'); window.setTimeout(() => window.document.getElementById('available-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }}>Escolher novo plano<ArrowRight /></Button></> : <p className="text-sm text-muted-foreground">Para trocar de plano durante uma assinatura ativa, entre em contato com o suporte.</p>}
        {data.subscription?.accessUntil && <p className="text-sm">Acesso ao plano até {date(data.subscription.accessUntil)}.</p>}
        {!data.subscription?.canceled && <Button variant="outline" disabled={!data.workspace.canManage} onClick={() => { setManage(false); setError(''); setCancel(true); }} className="mt-2 text-destructive">Cancelar renovação</Button>}
      </DialogContent>
    </Dialog>

    <Dialog open={cancel} onOpenChange={v => { if (!busy) setCancel(v); }}>
      <DialogContent className="max-w-md rounded-lg"><DialogHeader><DialogTitle>Cancelar a renovação?</DialogTitle><DialogDescription>As próximas cobranças deixarão de ser emitidas. Seu acesso permanece até o fim do período pago ou do teste. Pagamentos já realizados não serão estornados.</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setCancel(false)}>Manter assinatura</Button><Button variant="destructive" disabled={busy} onClick={() => run(()=>cancelAsaasSubscriptionAction(data.workspace.id), 'Renovação cancelada.')}>{busy && <Loader2 className="animate-spin" />}Confirmar cancelamento</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
