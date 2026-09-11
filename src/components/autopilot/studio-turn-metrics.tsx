import type { StudioReasoningState } from '@/services/agent-studio/reasoning-contract';

export function StudioTurnMetrics({ metrics }: { metrics?: StudioReasoningState['lastTurnMetrics'] }) {
  if (!metrics) return null;
  return <details className="shrink-0 border-t border-slate-800 p-3 text-xs text-slate-300">
    <summary className="cursor-pointer">Resumo da última resposta</summary>
    <dl className="mt-2 grid grid-cols-2 gap-2">
      <dt>Tempo de processamento da IA</dt><dd>{(metrics.durationMs / 1000).toFixed(1)} s</dd>
      <dt>Decisões do modelo</dt><dd>{metrics.modelDecisions}</dd>
      <dt>Ações consultadas ou executadas</dt><dd>{metrics.toolCalls}</dd>
      <dt>Pedidos em andamento</dt><dd>{metrics.activeRequests}</dd>
      <dt>Pedidos pausados</dt><dd>{metrics.pausedRequests}</dd>
      <dt>Resultados sem confirmação</dt><dd>{metrics.uncertainOperations}</dd>
    </dl>
    {metrics.usage?.length ? <ul className="mt-2 space-y-1">{metrics.usage.map(entry => <li key={`${entry.model}:${entry.stage}`} className="break-words">
      {entry.model} · {entry.stage === 'consult' ? 'apoio' : 'atendimento'}: {entry.totalTokens.toLocaleString('pt-BR')} tokens
    </li>)}</ul> : <p className="mt-2">Consumo não informado pelo provedor.</p>}
    {metrics.budgetReached && <p className="mt-2 text-amber-200">Um limite de processamento ou de ações foi atingido. Verifique o que ficou pendente.</p>}
    <p className="mt-2 text-[10px] text-slate-400">Dados da execução. Não comprovam satisfação do cliente ou entrega no canal.</p>
  </details>;
}
