'use client';

import { useRef, useState } from 'react';
import { reviewStudioOutcomeAction } from '@/actions/agent-studio';
import type { StudioResults } from '@/services/agent-studio/results';
import { StudioTurnMetrics } from './studio-turn-metrics';
const statuses: Record<string, string> = { resolved: 'Resolvidas', waiting_input: 'Aguardando dados', transferred: 'Transferidas', failed: 'Falhas', running: 'Em execução', cancelled: 'Canceladas' };
const events: Record<string, string> = { procedure_selected: 'Procedimento iniciado', procedure_completed: 'Procedimento concluído', completed: 'Etapa concluída', collected: 'Dado validado', waiting_input: 'Informação solicitada', waiting_confirmation: 'Confirmação solicitada', validation_failed: 'Dado inválido', correction_requested: 'Correção solicitada', branch_selected: 'Caminho escolhido', transferred: 'Transferido', failed: 'Falha', cancelled: 'Invocação cancelada', expired: 'Prazo encerrado', outcome_unknown: 'Resultado sem confirmação', outcome_reviewed: 'Resultado conferido pela equipe', awaiting_operator: 'Aguardando equipe' };

export function StudioResultsMetrics({ agentId, results, onReviewed }: { agentId: string; results: StudioResults; onReviewed: () => void }) {
  const [reviewing, setReviewing] = useState('');
  const reviewInProgress = useRef(false);
  const [error, setError] = useState('');
  const review = async (sessionId: string, resolution: 'confirmed_succeeded' | 'confirmed_failed', operationId?: string) => {
    if (reviewInProgress.current) return;
    reviewInProgress.current = true;
    setReviewing(sessionId); setError('');
    try {
      const result = await reviewStudioOutcomeAction(agentId, sessionId, resolution, operationId);
      if (!result.success) setError(result.error);
      else onReviewed();
    } catch {
      setError('Não foi possível confirmar o retorno da revisão. Atualize os resultados antes de tentar novamente.');
    } finally {
      reviewInProgress.current = false;
      setReviewing('');
    }
  };
  const total = results.sessions.reduce((sum, item) => sum + item.count, 0);
  return <div className="space-y-5">
    {results.recent.some((session) => session.summary.uncertainOperations?.length) && <section className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h3 className="font-semibold">Operações aguardando conferência</h3>
      <p className="text-xs">Confira o resultado no sistema externo antes de registrar a revisão. Cada botão se refere somente à operação identificada abaixo.</p>
      {results.recent.flatMap((session) => (session.summary.uncertainOperations || []).map((operation) => <div key={`${session.id}:${operation.id}`} className="space-y-2 rounded-lg bg-white p-3 text-xs">
        <p>{operation.title || 'Operação anterior sem nome registrado'} · {new Date(operation.at).toLocaleString('pt-BR')}</p>
        <p className="break-all text-slate-500">Referência: {operation.id}</p>
        <div className="flex flex-wrap gap-2">
          <button disabled={Boolean(reviewing)} onClick={() => void review(session.id, 'confirmed_succeeded', operation.id)} className="rounded border border-amber-400 px-3 py-2 disabled:opacity-50">Confirmar que ocorreu</button>
          <button disabled={Boolean(reviewing)} onClick={() => void review(session.id, 'confirmed_failed', operation.id)} className="rounded border border-amber-400 px-3 py-2 disabled:opacity-50">Confirmar que não ocorreu</button>
        </div>
      </div>))}
    </section>}
    <p className="text-xs text-slate-500">Sessões iniciadas nos últimos {results.periodDays} dias. Cada sessão conta uma vez; simulações não entram nos resultados. Procedimento concluído não significa atendimento resolvido.</p>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4"><span className="text-xs text-slate-500">Sessões iniciadas</span><p className="mt-2 text-2xl font-bold">{total}</p></div>
      {Object.entries(statuses).map(([status, label]) => <div key={status} className="rounded-xl border border-slate-200 bg-white p-4"><span className="text-xs text-slate-500">{label}</span><p className="mt-2 text-2xl font-bold">{results.sessions.find((item) => item.status === status)?.count || 0}</p></div>)}
    </div>
    <p className="text-xs text-slate-600">Tempo médio até resolver: {results.averageResolutionSeconds === null ? 'sem sessões resolvidas no período' : `${Math.round(results.averageResolutionSeconds)} segundos`}. Calculado apenas sobre sessões resolvidas, incluindo espera pelo cliente.</p>
    {!total && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500">Ainda não há sessões registradas neste período.</p>}
    {results.recent.some((session) => session.summary.lastTurnMetrics) && <section className="space-y-3">
      <h3 className="font-semibold">Processamento recente da IA</h3>
      <p className="text-xs text-slate-500">Última resposta registrada de cada sessão recente. O consumo exibido não representa o total do atendimento.</p>
      {results.recent.filter((session) => session.summary.lastTurnMetrics).map((session) => <div key={session.id} className="overflow-hidden rounded-xl bg-slate-950 text-slate-100">
        <p className="px-3 pt-3 text-xs">Sessão iniciada em {new Date(session.startedAt).toLocaleString('pt-BR')}</p>
        {session.summary.usageTotals && <div className="space-y-1 px-3 py-3 text-xs text-slate-300">
          <p>Consumo registrado: <strong className="text-slate-100">{session.summary.usageTotals.totalTokens.toLocaleString('pt-BR')} tokens</strong> em {session.summary.usageTotals.recordedTurns} respostas finalizadas.</p>
          <p>Entrada: {session.summary.usageTotals.inputTokens.toLocaleString('pt-BR')} · Saída: {session.summary.usageTotals.outputTokens.toLocaleString('pt-BR')}</p>
          {session.summary.usageTotals.turnsWithoutUsage > 0 && <p className="text-amber-200">{session.summary.usageTotals.turnsWithoutUsage} respostas sem consumo informado pelo provedor.</p>}
          <p className="text-[10px] text-slate-400">Não inclui tentativas interrompidas nem consumo anterior ao início deste registro. Tokens não representam valor cobrado.</p>
        </div>}
        <StudioTurnMetrics metrics={session.summary.lastTurnMetrics} />
      </div>)}
    </section>}
    {results.procedures.length > 0 && <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">Por procedimento</h3><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{['Procedimento', 'Inícios', 'Conclusões', 'Falhas de coleta', 'Falhas de integração'].map((label) => <th key={label} className="p-2 font-medium text-slate-500">{label}</th>)}</tr></thead><tbody>{results.procedures.map((procedure) => <tr key={`${procedure.id}:${procedure.name}`} className="border-t border-slate-100"><td className="p-2">{procedure.name}</td><td className="p-2">{procedure.selected}</td><td className="p-2">{procedure.completed}</td><td className="p-2">{procedure.collectionFailures}</td><td className="p-2">{procedure.integrationFailures}</td></tr>)}</tbody></table></div></section>}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
    {results.recent.length > 0 && <section className="space-y-3"><h3 className="font-semibold">Atividade recente</h3><p className="text-xs text-slate-500">Até 20 sessões, com as últimas 150 etapas de cada uma. Sem mensagens, valores coletados ou credenciais.</p>{results.recent.map((session) => <details key={session.id} className="rounded-xl border border-slate-200 bg-white p-4"><summary className="cursor-pointer text-xs font-semibold">{new Date(session.startedAt).toLocaleString('pt-BR')} · {statuses[session.status] || session.status}{session.summary.outcomeUnknown && <span className="ml-2 text-amber-700">Revisão necessária · resultado incerto</span>}</summary>{session.summary.outcomeUnknown && !session.summary.uncertainOperations?.length && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><p>Confira o sistema externo antes de responder. Esta ação apenas registra o que realmente ocorreu; ela não repete a operação.</p><div className="mt-2 flex flex-wrap gap-2"><button disabled={Boolean(reviewing)} onClick={() => void review(session.id, 'confirmed_succeeded')} className="rounded border border-amber-400 bg-white px-3 py-1.5 disabled:opacity-50">Confirmar que ocorreu</button><button disabled={Boolean(reviewing)} onClick={() => void review(session.id, 'confirmed_failed')} className="rounded border border-amber-400 bg-white px-3 py-1.5 disabled:opacity-50">Confirmar que não ocorreu</button></div></div>}<ol className="mt-4 space-y-3 border-l border-slate-200 pl-4">{session.summary.events.map((event, index) => <li key={index} className="text-xs"><span className="font-medium">{events[event.kind] || 'Evento do atendimento'} · {event.label}</span><time className="ml-2 text-slate-500">{new Date(event.at).toLocaleTimeString('pt-BR')}</time></li>)}</ol></details>)}</section>}
  </div>;
}
