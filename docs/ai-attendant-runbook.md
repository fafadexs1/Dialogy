# AI Attendant Runbook

## Objetivo

Diagnosticar rapidamente se uma resposta ruim veio de intencao, RAG, workflow, tool planner, validator, LLM, ferramenta externa, envio ou configuracao do agente.

## Checks rapidos

1. Rode os evals offline:

```bash
npm run eval:autopilot
```

2. Veja os testes de regressao:

```bash
npm test -- tests/autopilot-evals.spec.ts
```

3. Inspecione traces recentes no banco:

```sql
SELECT
  id,
  status,
  intent,
  confidence_score,
  metadata->>'workflowId' AS workflow_id,
  metadata->>'ragStrategy' AS rag_strategy,
  metadata->>'knowledgeCoverage' AS knowledge_coverage,
  metadata->'toolPlanner' AS tool_planner,
  metadata->'responseValidator' AS response_validator,
  metadata->>'fallbackReason' AS fallback_reason,
  timings,
  completed_at
FROM orchestrator_runs
WHERE workspace_id = $1
ORDER BY created_at DESC
LIMIT 50;
```

## Eventos por conversa

```sql
SELECT
  kind,
  status,
  duration_ms,
  payload,
  created_at
FROM orchestrator_events
WHERE run_id = $1
ORDER BY created_at ASC;
```

Leitura:

- `intent_resolution`: intencao, confianca, workflow escolhido e slots extraidos.
- `rag_selection`: documentos selecionados, estrategia e cobertura.
- `rag_fallback_static_documents`: vetor falhou ou nao trouxe contexto util e caiu para base estatica.
- `workflow_plan`: se o workflow respondeu direto, pediu slot ou planejou tools antes da resposta.
- `tool_planner`: tools aceitas/rejeitadas e promessas de consulta reparadas.
- `response_validator`: resposta final aprovada, reparada, convertida em fallback ou handoff.

## Sinais de alerta

- `fallbackRate` subindo: veja `fallback_reason`, `responseValidator.reasons` e erros de tool.
- `knowledgeCoverage = none/low`: base fraca, documento fora de categoria ou pergunta sem material.
- `tool_planner.rejectedActions`: tool fora da intencao, sem slot, desabilitada ou exigindo aprovacao.
- `responseValidator.decision != approve`: resposta vazia, vazamento tecnico, promessa sem tool ou sucesso sem consulta real.
- `tool_execution` com erro/timeout: problema externo, credencial, SGP/MCP ou budget curto.

## Taxas uteis

```sql
SELECT
  count(*) AS total,
  avg((status = 'fallback')::int) AS fallback_rate,
  avg((metadata->>'responseSent' = 'true')::int) AS response_sent_rate,
  intent,
  metadata->>'ragStrategy' AS rag_strategy,
  metadata->>'knowledgeCoverage' AS knowledge_coverage,
  metadata->'responseValidator'->>'decision' AS validator_action
FROM orchestrator_runs
WHERE workspace_id = $1
  AND created_at >= now() - interval '24 hours'
GROUP BY intent, rag_strategy, knowledge_coverage, validator_action
ORDER BY total DESC;
```

## Quando uma conversa real falhar

1. Abra `orchestrator_events` do `run_id`.
2. Identifique a primeira etapa com `fallback` ou `error`.
3. Se o humano corrigiu a resposta, transforme a conversa em novo caso offline em `src/services/autopilot/eval-cases.ts`.
4. Rode `npm run eval:autopilot`.
5. Corrija o componente que falhou antes de mexer no prompt.
