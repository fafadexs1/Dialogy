'use client';
import {useEffect,useState} from 'react';
import {getDistributionDiagnosticsAction} from '@/actions/distribution-diagnostics';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle,CardDescription} from '@/components/ui/card';

const reasons:Record<string,string>={eligible:'Pode receber',offline:'Sem presença recente',not_accepting:'Distribuição pausada',
  portfolio_full:'Carteira cheia',sender:'Está transferindo',capacity:'Carga protegida',entry_pacing:'Entrada gradual',load_band:'Carga acima da faixa'};
export function DistributionDiagnostics({teamId}:{teamId:string}) {
  const [result,setResult]=useState<Awaited<ReturnType<typeof getDistributionDiagnosticsAction>> | null>(null);
  const [loading,setLoading]=useState(false);
  const load=async()=>{setLoading(true);try{setResult(await getDistributionDiagnosticsAction(teamId));}
    catch{setResult({success:false,error:'Falha ao consultar a distribuição.'});}finally{setLoading(false);}};
  useEffect(()=>{let active=true;setLoading(true);getDistributionDiagnosticsAction(teamId).then(value=>{if(active)setResult(value);})
    .catch(()=>{if(active)setResult({success:false,error:'Falha ao consultar a distribuição.'});}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};},[teamId]);
  return <Card><CardHeader><div className="flex items-center justify-between gap-3"><CardTitle className="text-base">Distribuição de atendimentos</CardTitle>
    <Button variant="outline" size="sm" onClick={load} disabled={loading}>{loading?'Consultando…':'Atualizar'}</Button></div>
    <CardDescription>Histórico do turno desde as 6h. A carga considera todas as conversas da pessoa nesta workspace.</CardDescription></CardHeader>
    <CardContent>{result?.success?<>
      <p className="mb-3 text-sm text-muted-foreground">{result.diagnostics.mode==='active'?'Equilíbrio por oportunidades ativo':result.diagnostics.mode==='shadow'?'Nova regra em avaliação comparativa':'Regra anterior ativa'} · {result.diagnostics.repeatedOperations24h} repetições evitadas nas últimas 24h.</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left">
        {['Pessoa','Situação na nova regra','Carteira','Carga','Recebimentos','Conversas distintas','Oportunidades da nova regra'].map(label=><th className="p-2 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>
        {result.diagnostics.members.map(member=><tr className="border-b" key={member.agentId}><td className="p-2">{member.agentName}{result.availability?.isWithinBusinessHours!==false && result.diagnostics.previewSelectedAgentId===member.agentId&&<span className="block text-xs text-muted-foreground">Próximo na previsão</span>}{member.alert&&<span className="block text-amber-600">Revisar: {member.missedConsecutive} oportunidades sem receber</span>}</td>
          <td className="p-2">{result.availability?.isWithinBusinessHours===false?'Fora do expediente':reasons[member.decision?.reason ?? ''] ?? 'Indisponível'}</td><td className="p-2">{member.portfolioCount} — sem limite</td>
          <td className="p-2">{member.effectiveLoad.toFixed(2)}/{member.capacity}</td><td className="p-2">{member.assignments}</td><td className="p-2">{member.distinctChats}</td><td className="p-2">{member.eligibleOpportunities}</td></tr>)}</tbody></table></div>
      <p className="mt-3 text-xs text-muted-foreground">A previsão usa uma nova conversa padrão. A escolha final considera a conversa recebida e quem está transferindo.</p>
    </>:<p role={result&&!result.success?'alert':undefined} className="text-sm text-muted-foreground">{result&&!result.success?result.error:'Consultando distribuição…'}</p>}</CardContent></Card>;
}
