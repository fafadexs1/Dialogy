'use client';
import { useEffect,useState } from 'react';
import { RefreshCw,Check,Undo2 } from 'lucide-react';
import { getPendingAiCreditCallsAction,reconcileAiCreditCallAction } from '@/actions/ai-credits';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

export function AiCreditReconciliation() {
  const [calls,setCalls]=useState<Awaited<ReturnType<typeof getPendingAiCreditCallsAction>>>([]);
  const [tokens,setTokens]=useState<Record<string,{inputTokens:number;outputTokens:number}>>({});
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const refresh=async()=>{try{setCalls(await getPendingAiCreditCallsAction());setError('');}catch(e){setError(e instanceof Error?e.message:'Falha ao carregar.');}};
  useEffect(()=>{void refresh();},[]);
  const reconcile=async(id:string,outcome:'release'|'settle')=>{setBusy(true);try{await reconcileAiCreditCallAction({id,outcome,...(tokens[id]||{inputTokens:0,outputTokens:0})});await refresh();toast({title:'Reserva conciliada'});}catch(e){toast({title:'Falha ao conciliar',description:e instanceof Error?e.message:'Tente novamente.',variant:'destructive'});}finally{setBusy(false);}};
  return <section className="space-y-3 border-t py-5"><div className="flex items-center justify-between"><h3 className="font-semibold">Consumos pendentes de conciliacao</h3><Button size="icon" variant="ghost" title="Atualizar pendencias" aria-label="Atualizar pendencias" onClick={refresh}><RefreshCw className="h-4 w-4"/></Button></div>{error&&<p role="alert" className="text-sm text-destructive">{error}</p>}{!error&&!calls.length&&<p className="text-sm text-muted-foreground">Nenhum consumo pendente.</p>}
    {calls.map(call=><div key={call.id} className="space-y-3 rounded-lg border p-4"><div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{call.workspace}</strong><span>{call.reserved.toLocaleString('pt-BR',{maximumFractionDigits:6})} creditos reservados</span></div><p className="break-all text-xs text-muted-foreground">{call.model} · {call.source} · {new Date(call.createdAt).toLocaleString('pt-BR')}</p><div className="grid gap-3 sm:grid-cols-2">{(['inputTokens','outputTokens'] as const).map(field=><label key={field} className="text-sm">{field==='inputTokens'?'Tokens de entrada confirmados':'Tokens de saida confirmados'}<Input type="number" min="0" step="1" value={tokens[call.id]?.[field]??''} onChange={e=>setTokens({...tokens,[call.id]:{...(tokens[call.id]||{inputTokens:0,outputTokens:0}),[field]:Number(e.target.value)}})}/></label>)}</div><div className="flex flex-wrap gap-2"><Button disabled={busy||!tokens[call.id]} onClick={()=>reconcile(call.id,'settle')}><Check className="mr-2 h-4 w-4"/>Cobrar consumo confirmado</Button><Button disabled={busy} variant="outline" onClick={()=>reconcile(call.id,'release')}><Undo2 className="mr-2 h-4 w-4"/>Liberar sem cobranca</Button></div></div>)}
  </section>;
}
