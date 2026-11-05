// Phase 0 baseline for docs/PLAN-ia-autonoma-transferir-encerrar.md.
// Read-only and aggregate-only: one REPEATABLE READ READ ONLY transaction, no message text,
// no customer values, no writes. Every metric is a proxy and says what it does not prove.
//
//   node scripts/baseline-ia-decisions.cjs [--days=30] [--workspace-id=<uuid>]
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const days = Number(arg('days', '30'));
if (!Number.isFinite(days) || days <= 0 || days > 365) throw new Error('--days must be between 1 and 365');
const workspaceId = arg('workspace-id', null);
if (workspaceId && !/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new Error('--workspace-id must be a UUID');
const end = new Date();
const start = new Date(end.getTime() - days * 86_400_000);

const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });

// Live tests create real chats in the Inbox; they are excluded so they do not inflate the baseline.
const REAL_SESSIONS = `agent_studio_sessions s
  WHERE s.started_at >= $1 AND s.started_at < $2 AND ($3::uuid IS NULL OR s.workspace_id = $3)
    AND NOT EXISTS (SELECT 1 FROM agent_studio_live_tests t WHERE t.workspace_id = s.workspace_id AND t.chat_id = s.chat_id)`;
// chats has no "closed_by_system_agent_id" column (verified against the configured database on 2026-11-05).
// A close made by a system agent leaves a system message with metadata.event='close' and
// metadata.closed_by_system_agent_id (see agent-tools/runtime.ts). That includes bots and flows, not only the LLM:
// metadata.tool = 'close_chat' marks the Autopilot tool path.
const AI_CLOSE_MESSAGE = `messages cm WHERE cm.type = 'system' AND cm.metadata->>'event' = 'close' AND cm.metadata ? 'closed_by_system_agent_id'
    AND cm.created_at >= $1 AND cm.created_at < $2 AND ($3::uuid IS NULL OR cm.workspace_id = $3)`;

const QUERIES = [
  {
    name: 'studio_sessions_by_status',
    note: 'Sessões do Estúdio iniciadas na janela, sem testes ao vivo. Status atual, não resultado final do atendimento.',
    sql: `SELECT s.status, count(*)::int sessions, count(DISTINCT s.chat_id)::int chats FROM ${REAL_SESSIONS} GROUP BY 1 ORDER BY 2 DESC`,
  },
  {
    name: 'chat_outcomes_after_ai',
    note: 'Estado atual dos chats que tiveram sessão do Estúdio. closed_by_system_agent=true quando há mensagem de sistema de encerramento por um agente de sistema.',
    sql: `WITH c AS (SELECT DISTINCT s.workspace_id, s.chat_id FROM ${REAL_SESSIONS})
          SELECT ch.status chat_status,
            EXISTS (SELECT 1 FROM messages cm WHERE cm.chat_id = ch.id AND cm.workspace_id = ch.workspace_id AND cm.type = 'system'
              AND cm.metadata->>'event' = 'close' AND cm.metadata ? 'closed_by_system_agent_id') closed_by_system_agent,
            count(*)::int chats
          FROM c JOIN chats ch ON ch.id = c.chat_id AND ch.workspace_id = c.workspace_id GROUP BY 1, 2 ORDER BY 3 DESC`,
  },
  {
    name: 'session_duration_by_final_status',
    note: 'Segundos entre início e conclusão para sessões resolvidas ou transferidas.',
    sql: `SELECT s.status, count(*)::int sessions,
            round((percentile_cont(.5) WITHIN GROUP (ORDER BY extract(epoch FROM s.completed_at - s.started_at)))::numeric, 1) p50_s,
            round((percentile_cont(.95) WITHIN GROUP (ORDER BY extract(epoch FROM s.completed_at - s.started_at)))::numeric, 1) p95_s
          FROM ${REAL_SESSIONS} AND s.status IN ('resolved', 'transferred') AND s.completed_at IS NOT NULL GROUP BY 1`,
  },
  {
    name: 'handoff_first_human_response',
    note: 'Para sessões transferidas: quantas tiveram resposta humana depois da transferência e em quanto tempo. "never_answered" é o proxy de conversa órfã (o humano pode ter atendido por outro canal).',
    sql: `WITH h AS (
            SELECT s.id, s.completed_at, (SELECT min(m.created_at) FROM messages m
              WHERE m.chat_id = s.chat_id AND m.workspace_id = s.workspace_id AND m.from_me = true
                AND NOT (m.metadata ? 'autopilotSourceMessageId') AND m.type <> 'system' AND m.created_at > s.completed_at) first_human
            FROM ${REAL_SESSIONS} AND s.status = 'transferred' AND s.completed_at IS NOT NULL)
          SELECT count(*)::int handoffs, count(first_human)::int answered, (count(*) - count(first_human))::int never_answered,
            round((percentile_cont(.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_human - completed_at)))::numeric, 0) p50_s,
            round((percentile_cont(.95) WITHIN GROUP (ORDER BY extract(epoch FROM first_human - completed_at)))::numeric, 0) p95_s FROM h`,
  },
  {
    name: 'zombie_sessions_now',
    note: 'Estado atual (não limitado pela janela): sessões em waiting_input há muito tempo cujo chat ainda está aberto.',
    sql: `SELECT count(*) FILTER (WHERE s.updated_at < now() - interval '24 hours')::int older_24h,
            count(*) FILTER (WHERE s.updated_at < now() - interval '72 hours')::int older_72h,
            count(*) FILTER (WHERE s.updated_at < now() - interval '7 days')::int older_7d,
            count(*)::int waiting_total
          FROM agent_studio_sessions s JOIN chats ch ON ch.id = s.chat_id AND ch.workspace_id = s.workspace_id
          WHERE s.status = 'waiting_input' AND ch.status <> 'encerrados' AND ($3::uuid IS NULL OR s.workspace_id = $3)
            AND $1::timestamptz IS NOT NULL AND $2::timestamptz IS NOT NULL`,
  },
  {
    name: 'ai_close_gap_after_last_customer_message',
    note: 'Segundos entre a última mensagem do cliente e o encerramento feito por um agente de sistema (bots e IA). Faixas curtas indicam risco de encerrar sem dar tempo ao cliente.',
    sql: `WITH g AS (SELECT cm.id, extract(epoch FROM cm.created_at - (SELECT max(m.created_at) FROM messages m
              WHERE m.chat_id = cm.chat_id AND m.workspace_id = cm.workspace_id AND m.from_me = false AND m.created_at <= cm.created_at)) gap_s
            FROM ${AI_CLOSE_MESSAGE})
          SELECT count(*)::int ai_closed_chats,
            count(*) FILTER (WHERE gap_s IS NULL)::int no_customer_message,
            count(*) FILTER (WHERE gap_s < 10)::int under_10s,
            count(*) FILTER (WHERE gap_s >= 10 AND gap_s < 60)::int s10_to_60,
            count(*) FILTER (WHERE gap_s >= 60 AND gap_s < 300)::int m1_to_5,
            count(*) FILTER (WHERE gap_s >= 300)::int over_5min FROM g`,
  },
  {
    name: 'ai_close_customer_returned_24h',
    note: 'Dos chats encerrados pela IA, quantos receberam nova mensagem do cliente no mesmo chat em até 24 h. Proxy de encerramento prematuro; não distingue assunto novo de assunto não resolvido.',
    sql: `SELECT count(*)::int ai_closed_chats,
            count(*) FILTER (WHERE returned)::int customer_returned_24h
          FROM (SELECT EXISTS (SELECT 1 FROM messages m WHERE m.chat_id = cm.chat_id AND m.workspace_id = cm.workspace_id AND m.from_me = false
                    AND m.created_at > cm.created_at AND m.created_at <= cm.created_at + interval '24 hours') returned
                FROM ${AI_CLOSE_MESSAGE}) x`,
  },
  {
    name: 'system_agent_closes_by_month_and_tool',
    note: 'Encerramentos feitos por agente de sistema por mês, últimos 6 meses (ignora a janela). tool=close_chat é o caminho do Autopilot; tool nulo costuma ser fluxo/bot. Mostra onde o volume está de fato.',
    sql: `SELECT to_char(date_trunc('month', cm.created_at), 'YYYY-MM') AS close_month, COALESCE(cm.metadata->>'tool', 'none') AS tool, count(*)::int closes
          FROM messages cm WHERE cm.type = 'system' AND cm.metadata->>'event' = 'close' AND cm.metadata ? 'closed_by_system_agent_id'
            AND cm.created_at > now() - interval '6 months' AND ($3::uuid IS NULL OR cm.workspace_id = $3)
            AND $1::timestamptz IS NOT NULL AND $2::timestamptz IS NOT NULL GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC`,
  },
  {
    name: 'ai_reply_volume_by_week',
    note: 'Mensagens enviadas pelo Autopilot/Estúdio (metadata.autopilotSourceMessageId) por semana, últimos 60 dias. Mostra quanto tráfego de IA real existe para medir.',
    sql: `SELECT to_char(date_trunc('week', m.created_at), 'YYYY-MM-DD') week, count(*)::int ai_messages, count(DISTINCT m.chat_id)::int chats
          FROM messages m WHERE m.created_at > now() - interval '60 days' AND m.from_me = true AND m.metadata ? 'autopilotSourceMessageId'
            AND ($3::uuid IS NULL OR m.workspace_id = $3) AND $1::timestamptz IS NOT NULL AND $2::timestamptz IS NOT NULL
          GROUP BY 1 ORDER BY 1 DESC`,
  },
  {
    name: 'handoff_failed_reasons',
    note: 'Motivo (texto de sistema, sem dados do cliente) das falhas HANDOFF_FAILED na janela. Cada uma é uma transferência que não achou dono.',
    sql: `SELECT left(e.failure->>'message', 110) reason, count(*)::int executions FROM workflow_executions e
          WHERE e.started_at >= $1 AND e.started_at < $2 AND e.failure->>'code' = 'HANDOFF_FAILED' AND ($3::uuid IS NULL OR e.workspace_id = $3)
          GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
  },
  {
    name: 'handoff_queued_events',
    note: 'Chats enfileirados na equipe porque ela estava indisponível (mensagem de sistema transfer_queued), por motivo. Só o nó de transferência dos fluxos grava esse evento e ele começa a encher após o deploy (o caminho do Autopilot também enfileira, mas não grava esta mensagem).',
    sql: `SELECT cm.metadata->>'reason' AS reason, count(*)::int queued_chats FROM messages cm
          WHERE cm.type = 'system' AND cm.metadata->>'event' = 'transfer_queued' AND cm.created_at >= $1 AND cm.created_at < $2
            AND ($3::uuid IS NULL OR cm.workspace_id = $3) GROUP BY 1 ORDER BY 2 DESC`,
  },
  {
    name: 'handoff_queue_wait_for_first_human',
    note: 'Dos chats enfileirados: quantos tiveram resposta humana depois e em quantos segundos. never_answered é o que o alerta de SLA precisa pegar.',
    sql: `WITH q AS (
            SELECT cm.chat_id, cm.workspace_id, cm.created_at AS queued_at, (SELECT min(m.created_at) FROM messages m
              WHERE m.chat_id = cm.chat_id AND m.workspace_id = cm.workspace_id AND m.from_me = true
                AND NOT (m.metadata ? 'autopilotSourceMessageId') AND m.type <> 'system' AND m.created_at > cm.created_at) AS first_human
            FROM messages cm WHERE cm.type = 'system' AND cm.metadata->>'event' = 'transfer_queued' AND cm.created_at >= $1 AND cm.created_at < $2
              AND ($3::uuid IS NULL OR cm.workspace_id = $3))
          SELECT count(*)::int queued, count(first_human)::int answered, (count(*) - count(first_human))::int never_answered,
            round((percentile_cont(.5) WITHIN GROUP (ORDER BY extract(epoch FROM first_human - queued_at)))::numeric, 0) p50_s,
            round((percentile_cont(.95) WITHIN GROUP (ORDER BY extract(epoch FROM first_human - queued_at)))::numeric, 0) p95_s FROM q`,
  },
  {
    name: 'handoff_failed_by_week',
    note: 'HANDOFF_FAILED por semana nos últimos 60 dias (ignora a janela).',
    sql: `SELECT to_char(date_trunc('week', e.started_at), 'YYYY-MM-DD') week, count(*)::int executions FROM workflow_executions e
          WHERE e.started_at > now() - interval '60 days' AND e.failure->>'code' = 'HANDOFF_FAILED' AND ($3::uuid IS NULL OR e.workspace_id = $3)
            AND $1::timestamptz IS NOT NULL AND $2::timestamptz IS NOT NULL GROUP BY 1 ORDER BY 1 DESC`,
  },
  {
    name: 'uncertain_outcome_sessions',
    note: 'Sessões com operação de resultado incerto aguardando conferência humana.',
    sql: `SELECT count(*)::int sessions, count(*) FILTER (WHERE s.updated_at < now() - interval '15 minutes')::int older_15min
          FROM ${REAL_SESSIONS} AND COALESCE((s.summary->>'outcomeUnknown')::boolean, false)`,
  },
  {
    name: 'ledger_studio_decisions',
    note: 'Decisões gravadas pelo Estúdio desde que o ledger foi ligado (decision_stage studio_turn). Vazio antes do deploy desta mudança.',
    sql: `SELECT l.decision_type, l.metadata->>'basis' basis, COALESCE(l.metadata->>'suggestionOnly', 'false') suggestion_only,
            count(*)::int decisions, count(l.latency_ms)::int latency_samples,
            round((percentile_cont(.5) WITHIN GROUP (ORDER BY l.latency_ms))::numeric, 0) p50_ms
          FROM agent_decision_ledger l
          WHERE l.created_at >= $1 AND l.created_at < $2 AND ($3::uuid IS NULL OR l.workspace_id = $3)
            AND l.metadata->>'decisionStage' = 'studio_turn' GROUP BY 1, 2, 3 ORDER BY 4 DESC`,
  },
  {
    name: 'ledger_all_decisions',
    note: 'Todas as decisões do ledger na janela, para comparar a cobertura do Estúdio com o Autopilot legado.',
    sql: `SELECT l.decision_type, count(*)::int decisions FROM agent_decision_ledger l
          WHERE l.created_at >= $1 AND l.created_at < $2 AND ($3::uuid IS NULL OR l.workspace_id = $3) GROUP BY 1 ORDER BY 2 DESC`,
  },
  {
    name: 'workflow_failures_by_code',
    note: 'Falhas de execução de workflow por código. HANDOFF_FAILED indica transferência sem destino disponível.',
    sql: `SELECT COALESCE(e.failure->>'code', 'none') code, count(*)::int executions FROM workflow_executions e
          WHERE e.started_at >= $1 AND e.started_at < $2 AND e.status = 'failed' AND ($3::uuid IS NULL OR e.workspace_id = $3)
          GROUP BY 1 ORDER BY 2 DESC LIMIT 15`,
  },
];

async function main() {
  await db.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL statement_timeout = '20s'");
    const observed = (await db.query('SELECT now() observed')).rows[0].observed;
    console.log(JSON.stringify({ baseline: 'ia-decisions', start, end, days, workspaceId, observed,
      caveat: 'Agregados e proxies. Nenhuma métrica aqui prova correção de decisão: isso exige o dataset ouro (Fase 0, passo 2).' }));
    for (const query of QUERIES) {
      await db.query('SAVEPOINT baseline_query');
      try {
        const { rows } = await db.query(query.sql, [start, end, workspaceId]);
        console.log(JSON.stringify({ name: query.name, note: query.note, rows }));
      } catch (error) {
        await db.query('ROLLBACK TO SAVEPOINT baseline_query');
        console.log(JSON.stringify({ name: query.name, error: error.code || error.name, detail: String(error.message).slice(0, 160) }));
      }
      await db.query('RELEASE SAVEPOINT baseline_query');
    }
  } finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
  }
}
main().catch((error) => { console.error(error.code || error.name, String(error.message).slice(0, 160)); process.exitCode = 1; });
