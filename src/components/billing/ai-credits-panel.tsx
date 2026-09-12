'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { ArrowRight, ChevronDown, Coins, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import { getAiCreditBalanceAction, createAiCreditCheckoutAction } from '@/actions/ai-credits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import { AiCreditExplainer } from './ai-credit-explainer';

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const quantity = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 6 });
const presets = [1_000, 5_000, 10_000];

export function AiCreditsPanel({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getAiCreditBalanceAction>> | null>(null);
  const [credits, setCredits] = useState(1000);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [purchaseError, setPurchaseError] = useState('');
  const request = useRef(0);
  const cancelPending = useCallback(() => { request.current++; }, []);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    try {
      const result = await getAiCreditBalanceAction();
      if (id !== request.current) return;
      if (result.workspaceId !== workspaceId) throw new Error('O workspace ativo mudou. Atualize o saldo.');
      setData(result); setError('');
    } catch (e) {
      if (id === request.current) { setData(null); setError(e instanceof Error ? e.message : 'Erro ao carregar saldo.'); }
    } finally { if (id === request.current) setLoading(false); }
  }, [workspaceId]);
  useEffect(() => { setData(null); setError(''); setPurchaseError(''); void load(); return cancelPending; }, [load, cancelPending]);

  const value = data?.creditValueBrl;
  const hasPrice = typeof value === 'number' && Number.isFinite(value) && value > 0;
  const purchaseCents = hasPrice ? Math.ceil(credits * value * 100) : 0;
  const canPurchase = hasPrice && Number.isInteger(credits) && credits >= 1 && credits <= 1_000_000 && purchaseCents >= 500 && purchaseCents <= 99_999_999;
  const purchase = async () => {
    if (!canPurchase || busy) return;
    setBusy(true); setPurchaseError('');
    try {
      const result = await createAiCreditCheckoutAction(credits);
      if (result.url) window.location.assign(result.url);
      else setPurchaseError('Não foi possível abrir o pagamento. Tente novamente.');
    } catch (e) {
      setPurchaseError(e instanceof Error ? e.message : 'Recarga indisponível. Tente novamente.');
    } finally { setBusy(false); }
  };
  const chooseCredits = (amount: number) => { setCredits(amount); setPurchaseError(''); };

  return <section className="min-w-0 space-y-7">
    <div className="flex items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Créditos de IA</h2><p className="mt-1 text-sm text-muted-foreground">Saldo compartilhado pelos recursos de IA do workspace.</p></div>
      <Button variant="ghost" size="icon" className="shrink-0" disabled={loading || busy} aria-label="Atualizar saldo" title="Atualizar saldo" onClick={load}><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /></Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!data && !error && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando saldo...</p>}
    {data && <>
      <div className="grid grid-cols-2 gap-5 border-y py-5 sm:grid-cols-[1.3fr_1fr_1fr]">
        <div className="col-span-2 sm:col-span-1"><p className="flex items-center gap-2 text-sm text-muted-foreground"><Coins className="h-4 w-4 text-primary" />Disponíveis</p><p className="mt-2 break-words text-3xl font-semibold tabular-nums">{quantity(data.balance - data.reserved)}<span className="ml-2 text-xs font-normal text-muted-foreground">créditos</span></p></div>
        <div><p className="text-sm text-muted-foreground">Em processamento</p><p className="mt-2 break-words text-xl font-medium tabular-nums">{quantity(data.reserved)}</p></div>
        <div><p className="text-sm text-muted-foreground">Saldo total</p><p className="mt-2 break-words text-xl font-medium tabular-nums">{quantity(data.balance)}</p></div>
      </div>
      {!data.billingEnabled && <p role="status" className="border-l-2 border-amber-500 pl-3 text-sm text-muted-foreground">O consumo de créditos está desativado no momento.</p>}
      {hasPrice ? <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <form onSubmit={e => { e.preventDefault(); void purchase(); }} className="min-w-0 space-y-5">
          <div><h3 className="text-base font-semibold">Recarregar saldo</h3><p className="mt-1 text-sm text-muted-foreground">Escolha a quantidade de créditos.</p></div>
          <RadioGroup aria-label="Pacotes de créditos" value={String(credits)} onValueChange={v => chooseCredits(Number(v))} className="grid grid-cols-3 gap-2">
            {presets.map(amount => {
              const price = Math.ceil(amount * value * 100);
              const disabled = busy || price < 500 || price > 99_999_999;
              return <label key={amount} htmlFor={`credit-package-${amount}`} className={cn('flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-2.5 sm:p-3', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-primary/50', credits === amount && 'border-primary bg-primary/[0.04] ring-1 ring-primary')}>
                <RadioGroupItem id={`credit-package-${amount}`} value={String(amount)} disabled={disabled} />
                <span className="break-words text-sm font-semibold tabular-nums sm:text-base">{quantity(amount)}</span>
                <span className="break-words text-xs text-muted-foreground tabular-nums">{money(price / 100)}</span>
              </label>;
            })}
          </RadioGroup>
          <div className="space-y-2"><label htmlFor="recharge-credits" className="text-sm font-medium">Créditos para recarregar</label><Input id="recharge-credits" type="number" min="1" max="1000000" step="1" inputMode="numeric" disabled={busy} value={Number.isNaN(credits) ? '' : credits} onChange={e => chooseCredits(e.target.value === '' ? NaN : Number(e.target.value))} aria-describedby="recharge-minimum" /></div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-t pt-5"><span className="text-sm text-muted-foreground">Total da recarga</span><strong className="text-2xl tabular-nums">{Number.isFinite(purchaseCents) && purchaseCents >= 0 ? money(purchaseCents / 100) : '-'}</strong></div>
          <Button type="submit" disabled={busy || loading || !canPurchase} className="h-auto min-h-11 w-full whitespace-normal py-3">{busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}Recarregar{canPurchase && ` · ${money(purchaseCents / 100)}`}</Button>
          <p id="recharge-minimum" className="text-xs leading-relaxed text-muted-foreground">Recarga mínima de R$ 5,00. O valor final é apresentado antes do pagamento.</p>
          {purchaseError && <p role="alert" className="text-sm text-destructive">{purchaseError}</p>}
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0" />Os créditos entram no saldo após a confirmação do pagamento. Recarga avulsa, sem alterar a assinatura.</p>
        </form>
        <aside className="min-w-0 border-t pt-6 xl:border-l xl:border-t-0 xl:pl-7 xl:pt-0" aria-label="Valor e consumo dos créditos"><AiCreditExplainer creditValueBrl={value} /></aside>
      </div> : <p className="text-sm text-muted-foreground">O valor do crédito ainda não foi definido. Recargas indisponíveis.</p>}
      <details className="group border-y py-5">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden"><span>Extrato de créditos<span className="ml-2 font-normal text-muted-foreground">({data.entries.length})</span></span><ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" /></summary>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="sr-only">Extrato de créditos</caption><thead><tr className="border-b text-xs text-muted-foreground"><th scope="col" className="py-3 pr-3 font-medium">Data</th><th scope="col" className="py-3 pr-3 font-medium">Movimentação</th><th scope="col" className="py-3 text-right font-medium">Créditos</th></tr></thead>
          <tbody>{data.entries.map(entry => <tr key={entry.id} className="border-b last:border-0"><td className="py-3 pr-3 text-xs text-muted-foreground"><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString('pt-BR')}<span className="mt-1 block">{new Date(entry.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></time></td><td className="max-w-xs break-words py-3 pr-3 text-xs sm:text-sm">{entry.kind === 'usage' ? 'Consumo de IA' : entry.description}</td><td className={cn('py-3 text-right text-xs tabular-nums sm:text-sm', entry.amount > 0 && 'text-emerald-700 dark:text-emerald-300')}>{entry.amount > 0 ? '+' : ''}{quantity(entry.amount)}</td></tr>)}
            {!data.entries.length && <tr><td colSpan={3} className="py-8 text-center text-muted-foreground">Nenhuma movimentação.</td></tr>}
          </tbody>
        </table></div>
      </details>
    </>}
  </section>;
}
