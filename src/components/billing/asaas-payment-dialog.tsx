'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, Check, CheckCircle2, Copy, CreditCard, Download, Loader2, LockKeyhole, QrCode, ReceiptText, RefreshCw, ShieldCheck } from 'lucide-react';
import { getAsaasPaymentAction, prepareAsaasPaymentAction, payAsaasCardAction } from '@/actions/asaas';
import { cardPaymentSchema, type CheckoutPayment, type PaymentMethod } from '@/lib/asaas-checkout';
import { paymentLabel } from '@/lib/asaas-billing';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const money = (amount: number) => amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const date = (value: string) => new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
const methods = [
  { id: 'PIX', label: 'Pix', note: 'QR Code ou copia e cola', icon: QrCode },
  { id: 'CREDIT_CARD', label: 'Cartão', note: 'Crédito à vista', icon: CreditCard },
  { id: 'BOLETO', label: 'Boleto', note: 'Pague no seu banco', icon: ReceiptText },
] as const;

export function AsaasPaymentDialog({ workspaceId, paymentId, workspaceName, onClose, onPaid }: {
  workspaceId: string; paymentId: string; workspaceName: string; onClose: () => void; onPaid: () => void;
}) {
  const [payment, setPayment] = useState<CheckoutPayment | null>(null);
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pollingStopped, setPollingStopped] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const notified = useRef(false);
  const paidCallback = useRef(onPaid);
  paidCallback.current = onPaid;

  const receive = useCallback((next: CheckoutPayment, preserveCodes = false) => {
    if (!mounted.current) return;
    setPayment(previous => {
      const same = preserveCodes && next.canPay && previous?.billingType === next.billingType && previous?.amount === next.amount && previous?.dueDate === next.dueDate;
      return same ? { ...next, pix: previous?.pix, boleto: previous?.boleto } : next;
    });
    if (next.paid && !notified.current) { setError(''); notified.current = true; paidCallback.current(); }
  }, []);

  const refresh = useCallback(async (manual = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (manual) { setChecking(true); setError(''); }
    try {
      const result = await getAsaasPaymentAction({ workspaceId, paymentId });
      if (!mounted.current) return;
      if (result.success) receive(result.payment, true);
      else setError(result.error);
    } catch { if (mounted.current) setError('Não foi possível consultar o pagamento. Use “Verificar pagamento” para tentar novamente.'); }
    finally { inFlight.current = false; if (mounted.current) setChecking(false); }
  }, [workspaceId, paymentId, receive]);

  useEffect(() => {
    mounted.current = true;
    void refresh(true);
    return () => { mounted.current = false; };
  }, [refresh]);

  const shouldPoll = !!payment && !payment.paid && (payment.canPay || payment.awaitingConfirmation);
  useEffect(() => {
    if (!shouldPoll) return;
    const started = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - started > 5 * 60_000) { setPollingStopped(true); window.clearInterval(interval); return; }
      if (document.visibilityState === 'visible') void refresh();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [shouldPoll, refresh]);

  async function prepare() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setCopied(false);
    try {
      const result = await prepareAsaasPaymentAction({ workspaceId, paymentId, method });
      if (result.success) receive(result.payment);
      else setError(result.error);
    } catch { setError('Não foi possível preparar a fatura. Verifique sua conexão e tente novamente.'); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function payCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const value = (key: string) => String(fields.get(key) || '');
    const [month, year] = value('expiry').split('/').map(part => part.trim());
    const card = cardPaymentSchema.safeParse({
      creditCard: { holderName: value('holderName'), number: value('number'), expiryMonth: month?.padStart(2, '0'), expiryYear: year?.length === 2 ? `20${year}` : year, ccv: value('ccv') },
      creditCardHolderInfo: { name: value('holderName'), email: value('email'), cpfCnpj: value('cpfCnpj'), postalCode: value('postalCode'), addressNumber: value('addressNumber'), phone: value('phone') },
    });
    if (!card.success) { setError('Confira o número e a validade do cartão, CPF/CNPJ, CEP e telefone com DDD.'); return; }
    inFlight.current = true; setBusy(true); setError('');
    // Sensitive inputs are neither persisted nor held in React state, and are
    // removed from the form immediately after the user submits this payment.
    form.reset();
    try {
      const result = await payAsaasCardAction({ workspaceId, paymentId, card: card.data });
      if (result.success) receive(result.payment);
      else { setError(result.error); setPayment(current => current ? { ...current, canPay: false, awaitingConfirmation: true } : current); }
    } catch {
      setError('A resposta do pagamento não chegou. Estamos consultando a fatura antes de permitir outra tentativa.');
      setPayment(current => current ? { ...current, canPay: false, awaitingConfirmation: true } : current);
    } finally { inFlight.current = false; setBusy(false); void refresh(); }
  }

  async function copy(code: string) {
    try { await navigator.clipboard.writeText(code); setCopied(true); }
    catch { setError('Não foi possível copiar automaticamente. Selecione e copie o código abaixo.'); }
  }

  const code = method === 'PIX' ? payment?.pix?.code : payment?.boleto?.code;
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[94dvh] w-[calc(100%-1.5rem)] max-w-3xl gap-0 overflow-y-auto rounded-2xl p-0 sm:w-full" onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader className="border-b px-5 py-5 sm:px-7">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><LockKeyhole className="h-3.5 w-3.5" />PAGAMENTO SEGURO</div>
        <DialogTitle className="text-xl">{payment?.paid ? 'Pagamento confirmado' : 'Pagar sua fatura'}</DialogTitle>
        <DialogDescription>Conclua o pagamento aqui no Dialogy e acompanhe a confirmação.</DialogDescription>
      </DialogHeader>
      <div className="grid min-w-0 sm:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="min-w-0 border-b bg-muted/35 px-5 py-5 sm:border-b-0 sm:border-r sm:px-6 sm:py-7">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Resumo da fatura</p>
          <p className="mt-3 break-words text-sm font-medium">{workspaceName}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{payment ? money(payment.amount) : '—'}</p>
          {payment && <p className="mt-2 text-xs text-muted-foreground">Vencimento {date(payment.dueDate)}</p>}
          <div className="mt-5 hidden items-start gap-2 border-t pt-4 text-xs sm:flex leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Processado pelo Asaas. O Dialogy não armazena o número ou o código de segurança do cartão.</span></div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Este pagamento quita somente esta fatura. As próximas mensalidades aparecerão em Faturas.</p>
        </aside>
        <section aria-label="Pagamento da fatura" className="min-w-0 px-5 py-6 sm:px-7">
          {error && <p role="alert" className="mb-5 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive">{error}</p>}
          {!payment ? <div className="flex min-h-48 flex-col items-center justify-center gap-4 text-sm text-muted-foreground">{checking ? <><Loader2 className="h-6 w-6 animate-spin" />Consultando sua fatura…</> : <Button variant="outline" onClick={() => void refresh(true)}>Tentar novamente</Button>}</div>
            : payment.paid ? <div role="status" className="flex min-h-64 flex-col items-center justify-center text-center"><span className="mb-5 rounded-full bg-emerald-500/10 p-4"><CheckCircle2 className="h-9 w-9 text-emerald-600" /></span><h3 className="text-xl font-semibold">Tudo certo com seu pagamento</h3><p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">Recebemos a confirmação de {money(payment.amount)}. A situação do seu plano foi atualizada.</p><Button className="mt-7 w-full" onClick={onClose}>Voltar ao meu plano<ArrowRight className="h-4 w-4" /></Button></div>
            : payment.awaitingConfirmation ? <div role="status" className="flex min-h-64 flex-col items-center justify-center text-center"><span className="mb-5 rounded-full bg-amber-500/10 p-4"><RefreshCw className="h-8 w-8 text-amber-600" /></span><h3 className="text-lg font-semibold">Aguardando confirmação</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">Estamos verificando o resultado com o Asaas. Uma nova tentativa está bloqueada para evitar pagamento duplicado. Se a situação persistir, entre em contato com o suporte.</p></div>
            : !payment.canPay ? <div role="status" className="py-12 text-center"><ReceiptText className="mx-auto mb-4 h-8 w-8 text-muted-foreground" /><h3 className="font-semibold">{paymentLabel(payment.status)}</h3><p className="mt-3 text-sm text-muted-foreground">Esta fatura não está disponível para pagamento. Consulte o histórico ou entre em contato com o suporte.</p></div>
            : <>
              <div role="group" aria-label="Forma de pagamento" className="mb-6 grid grid-cols-3 gap-2">{methods.map(item => <button key={item.id} type="button" aria-pressed={method === item.id} disabled={busy} onClick={() => { setMethod(item.id); setCopied(false); setError(''); }} className={cn('flex min-w-0 flex-col items-center gap-2 rounded-xl border px-2 py-3 text-sm font-medium transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50', method === item.id ? 'border-emerald-600/60 bg-emerald-500/5 text-foreground ring-1 ring-emerald-600/40 dark:border-primary dark:ring-primary' : 'bg-background text-muted-foreground')}><item.icon className="h-5 w-5" />{item.label}</button>)}</div>
              {method === 'CREDIT_CARD' ? <form onSubmit={event => void payCard(event)} className="space-y-4" autoComplete="off">
                <div><h3 className="font-semibold">Pagar com cartão</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Cobrança à vista, realizada agora, mesmo se o vencimento for futuro.</p></div>
                <fieldset disabled={busy} className="grid min-w-0 grid-cols-2 gap-3">
                  <CardField name="number" label="Número do cartão" placeholder="0000 0000 0000 0000" inputMode="numeric" maxLength={23} full />
                  <CardField name="holderName" label="Nome no cartão" placeholder="Como está no cartão" maxLength={150} full />
                  <CardField name="expiry" label="Validade" placeholder="MM/AA" inputMode="numeric" maxLength={7} />
                  <CardField name="ccv" label="Código de segurança" placeholder="CVV" inputMode="numeric" type="password" maxLength={4} />
                  <p className="col-span-2 mt-2 text-xs font-medium text-muted-foreground">Dados do titular</p>
                  <CardField name="cpfCnpj" label="CPF ou CNPJ" inputMode="numeric" maxLength={18} full />
                  <CardField name="email" label="E-mail" type="email" maxLength={200} full />
                  <CardField name="phone" label="Telefone com DDD" inputMode="tel" maxLength={16} full />
                  <CardField name="postalCode" label="CEP" inputMode="numeric" maxLength={9} />
                  <CardField name="addressNumber" label="Número do endereço" maxLength={20} />
                </fieldset>
                <Button disabled={busy || checking} className="h-12 w-full" type="submit">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}{busy ? 'Processando pagamento…' : `Pagar ${money(payment.amount)}`}</Button>
                {busy && <p role="status" className="text-center text-xs text-muted-foreground">Aguarde a resposta. Isso pode levar até um minuto.</p>}
              </form> : <div className="space-y-5">
                <div><h3 className="font-semibold">{method === 'PIX' ? 'Pague com Pix' : 'Pague com boleto'}</h3><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{method === 'PIX' ? 'Use o aplicativo do seu banco para escanear o QR Code ou pagar com o código copia e cola.' : 'Copie a linha digitável ou abra o boleto para pagar no aplicativo do seu banco.'}</p></div>
                {code ? <>
                  {method === 'PIX' && payment.pix && <div className="flex flex-col items-center gap-3"><div className="rounded-xl border bg-white p-3">{/* Provider-generated raster QR; never route payment data through an image optimizer. */}<Image unoptimized src={payment.pix.image} alt="QR Code Pix desta fatura" width={192} height={192} className="h-48 w-48" /></div><p className="text-xs text-muted-foreground">Validade do código: {date(payment.pix.expiresAt)}{payment.pix.expiresAt.length > 10 ? ` às ${payment.pix.expiresAt.slice(11, 16)}` : ''}</p></div>}
                  <div className="space-y-2"><Label htmlFor="payment-code">{method === 'PIX' ? 'Pix copia e cola' : 'Linha digitável'}</Label><textarea id="payment-code" readOnly value={code} className="min-h-20 w-full resize-none break-all rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onFocus={event => event.target.select()} /></div>
                  <Button type="button" className="h-11 w-full" onClick={() => void copy(code)}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Código copiado' : method === 'PIX' ? 'Copiar código Pix' : 'Copiar linha digitável'}</Button>
                  {method === 'BOLETO' && payment.boleto?.url && <Button asChild variant="outline" className="w-full"><a href={payment.boleto.url} target="_blank" rel="noopener noreferrer"><Download className="h-4 w-4" />Abrir boleto em PDF</a></Button>}
                  <p role="status" className="text-center text-xs leading-relaxed text-muted-foreground">{method === 'PIX' ? 'Após pagar, aguarde a confirmação nesta tela.' : 'O boleto será confirmado após a compensação bancária. Você pode fechar esta tela e acompanhar em Faturas.'}</p>
                </> : <><Button disabled={busy || checking} className="h-12 w-full" onClick={() => void prepare()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : method === 'PIX' ? <QrCode className="h-4 w-4" /> : <ReceiptText className="h-4 w-4" />}{busy ? 'Preparando pagamento…' : method === 'PIX' ? 'Gerar QR Code Pix' : 'Gerar boleto'}</Button><p className="text-xs leading-relaxed text-muted-foreground">Ao mudar a forma de pagamento, use somente o código mais recente desta fatura.</p></>}
              </div>}
            </>}
          {payment && !payment.paid && <div className="mt-6 border-t pt-4"><Button variant="ghost" className="h-auto w-full whitespace-normal text-xs text-muted-foreground" disabled={busy || checking} onClick={() => void refresh(true)}><RefreshCw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />{checking ? 'Consultando…' : 'Verificar pagamento'}</Button>{pollingStopped && <p className="mt-2 text-center text-xs text-muted-foreground">A consulta automática foi pausada. Clique acima para atualizar.</p>}</div>}
        </section>
      </div>
    </DialogContent>
  </Dialog>;
}

function CardField({ name, label, full, ...props }: { name: string; label: string; full?: boolean } & React.ComponentProps<typeof Input>) {
  return <div className={cn('min-w-0 space-y-1.5', full && 'col-span-2')}><Label htmlFor={`pay-${name}`} className="text-xs">{label}</Label><Input {...props} id={`pay-${name}`} name={name} required className="h-10 min-w-0 text-base sm:text-sm" autoComplete="off" data-private="true" onInput={event => {
    const input = event.currentTarget;
    if (name === 'expiry') { const digits = input.value.replace(/\D/g, '').slice(0, 4); input.value = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits; }
    if (name === 'number') input.value = input.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
    if (name === 'ccv') input.value = input.value.replace(/\D/g, '').slice(0, 4);
  }} /></div>;
}
