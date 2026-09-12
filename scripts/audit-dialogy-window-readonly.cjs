// Operational collection only. Never sends messages or mutates production.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const end = new Date(process.argv[2]);
if (!Number.isFinite(end.getTime())) throw new Error('Pass an ISO reporting cutoff');
const start = new Date(end.getTime() - 86400000);
const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
async function main() {
  await db.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await db.query("SET LOCAL statement_timeout='8s'");
    console.log(JSON.stringify({ start, end, observed: (await db.query('SELECT now() observed')).rows[0].observed }));
    const run = async (name, sql, args = [start, end]) => {
      await db.query('SAVEPOINT audit_query');
      try { console.log(JSON.stringify({ name, rows: (await db.query(sql, args)).rows })); }
      catch (e) { await db.query('ROLLBACK TO SAVEPOINT audit_query'); console.log(JSON.stringify({ name, error: e.code })); }
      await db.query('RELEASE SAVEPOINT audit_query');
    };
    if (process.argv.includes('--detail')) {
      await run('conversation', `WITH cohort AS (SELECT DISTINCT workspace_id,chat_id FROM messages WHERE created_at >= $1 AND created_at < $2 AND from_me=true AND metadata ? 'autopilotSourceMessageId') SELECT m.chat_id,m.created_at,m.from_me,left(m.content,1400) content,m.api_message_status FROM messages m JOIN cohort c USING(workspace_id,chat_id) WHERE m.created_at >= $1 AND m.created_at < $2 ORDER BY m.chat_id,m.created_at LIMIT 160`);
      await run('session_events', `SELECT id,summary - 'recoveryCheckpoint' AS summary FROM agent_studio_sessions WHERE updated_at >= $1 AND updated_at < $2 ORDER BY updated_at DESC LIMIT 10`);
      await run('correlation', `SELECT e.status,count(*) FROM evolution_webhook_events e WHERE e.created_at >= $1 AND e.created_at < $2 AND EXISTS(SELECT 1 FROM messages src JOIN messages m ON m.chat_id=src.chat_id AND m.workspace_id=src.workspace_id AND m.metadata->>'autopilotSourceMessageId'=src.id::text WHERE m.created_at >= $1 AND m.created_at < $2 AND src.workspace_id=e.workspace_id AND src.message_id_from_api=e.payload->'data'->'key'->>'id') GROUP BY 1`);
      await run('published', `SELECT v.version_number,v.created_at,v.snapshot->'agent_release_manifest'->>'releaseId' release_id,v.snapshot->'agent_release_manifest'->'runtimeConfig'->>'aiModel' model FROM autopilot_config_versions v WHERE v.snapshot->'agent_release_manifest'->>'releaseId' IN (SELECT release_id::text FROM agent_studio_sessions WHERE updated_at >= $1 AND updated_at < $2) ORDER BY v.created_at`);
      return;
    }
    await run('tickets', `SELECT t.id,t.subject,t.status,t.updated_at,
      (SELECT jsonb_agg(x) FROM (SELECT is_staff,created_at,left(message,1600) message FROM support_messages WHERE ticket_id=t.id ORDER BY created_at DESC LIMIT 5)x) recent
      FROM support_tickets t WHERE t.status NOT IN ('closed','resolved') OR (t.updated_at >= $1 AND t.updated_at < $2) ORDER BY t.updated_at DESC LIMIT 40`);
    await run('ai_delivery', `SELECT api_message_status,count(*) messages,count(DISTINCT (workspace_id,chat_id)) chats FROM messages WHERE created_at >= $1 AND created_at < $2 AND from_me=true AND metadata ? 'autopilotSourceMessageId' GROUP BY 1`);
    await run('ai_cohort', `SELECT m.workspace_id,m.chat_id,count(*) replies,
      EXISTS(SELECT 1 FROM agent_studio_live_tests t WHERE t.workspace_id=m.workspace_id AND t.chat_id=m.chat_id) known_live_test
      FROM messages m WHERE m.created_at >= $1 AND m.created_at < $2 AND m.from_me=true AND m.metadata ? 'autopilotSourceMessageId' GROUP BY 1,2`);
    await run('latency', `SELECT count(*) pairs,round(avg(seconds)::numeric,2) avg_s,percentile_cont(.95) WITHIN GROUP (ORDER BY seconds) p95_s FROM (SELECT src.id,extract(epoch from min(m.created_at)-src.created_at) seconds FROM messages m JOIN messages src ON src.id::text=m.metadata->>'autopilotSourceMessageId' AND src.chat_id=m.chat_id AND src.workspace_id=m.workspace_id WHERE m.created_at >= $1 AND m.created_at < $2 AND m.from_me=true GROUP BY src.id,src.created_at)q`);
    await run('sessions', `SELECT id,workspace_id,chat_id,release_id,status,started_at,updated_at FROM agent_studio_sessions WHERE updated_at >= $1 AND updated_at < $2 ORDER BY updated_at DESC LIMIT 50`);
    await run('workflows', `SELECT status,waiting_reason,failure->>'code' code,count(*) FROM workflow_executions WHERE started_at >= $1 AND started_at < $2 GROUP BY 1,2,3`);
    await run('failures', `SELECT failure->>'code' code,left(failure->>'message',250) reason,count(*) FROM workflow_executions WHERE started_at >= $1 AND started_at < $2 AND status='failed' GROUP BY 1,2`);
    await run('nodes', `SELECT n.node_type,n.status,count(*) FROM workflow_node_runs n JOIN workflow_executions e ON e.id=n.execution_id WHERE e.started_at >= $1 AND e.started_at < $2 AND e.status='failed' GROUP BY 1,2`);
    await run('events', `SELECT ev.event_type,count(*) FROM workflow_events ev JOIN workflow_executions e ON e.id=ev.execution_id WHERE e.started_at >= $1 AND e.started_at < $2 AND e.status='failed' GROUP BY 1`);
    await run('webhooks', `SELECT status,count(*) FROM evolution_webhook_events WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`);
    await run('ledger', `SELECT decision_type,count(*),count(latency_ms) latency_samples FROM agent_decision_ledger WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`);
    await run('live_tests', `SELECT count(*) FROM agent_studio_live_tests WHERE updated_at >= $1 AND updated_at < $2`);
  } finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
}
main().catch(e => { console.error(e.code || e.name); process.exitCode = 1; });
