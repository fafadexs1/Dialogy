require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const tables = ['support_tickets','support_messages','messages','agent_studio_sessions','agent_studio_live_tests','agent_decision_ledger','workflow_executions','workflow_events','workflow_node_runs','evolution_webhook_events'];
async function main() {
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout='8s'");
    console.log(JSON.stringify((await client.query('SELECT now() AS observed_at')).rows));
    const end='2026-09-07T12:34:52.179Z', start='2026-09-06T12:34:52.179Z';
    const run = async(name,sql,args=[]) => { await client.query('SAVEPOINT audit_query'); try { console.log(JSON.stringify({name,rows:(await client.query(sql,args)).rows})); } catch(e) { await client.query('ROLLBACK TO SAVEPOINT audit_query'); console.log(JSON.stringify({name,error:e.code})); } };
    if(process.argv.includes('--schema')) return run('schema',`SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1) ORDER BY table_name,ordinal_position`,[tables]);
    if(process.argv.includes('--detail')) {
      await run('conversation',`SELECT created_at,from_me,left(content,1600) content,api_message_status,message_id_from_api IS NOT NULL provider_id,metadata->>'autopilotSourceMessageId' source FROM messages WHERE chat_id=$1 AND workspace_id=$2 AND created_at >= $3 AND created_at < $4 ORDER BY created_at LIMIT 70`,['8a7d29dc-37f9-41f3-92cf-1394df81a6a6','e3b476a1-5de8-4744-80b5-a5d23fe15fab',start,end]);
      await run('failures',`SELECT failure->>'code' code,failure->>'message' reason,count(*) FROM workflow_executions WHERE started_at >= $1 AND started_at < $2 AND status='failed' GROUP BY 1,2`,[start,end]);
      await run('latency',`SELECT count(*) pairs,round(avg(seconds)::numeric,2) avg_s,percentile_cont(.95) WITHIN GROUP (ORDER BY seconds) p95_s FROM (SELECT src.id,extract(epoch from min(m.created_at)-src.created_at) seconds FROM messages m JOIN messages src ON src.id::text=m.metadata->>'autopilotSourceMessageId' AND src.chat_id=m.chat_id AND src.workspace_id=m.workspace_id WHERE m.created_at >= $1 AND m.created_at < $2 AND m.from_me=true GROUP BY src.id,src.created_at)q`,[start,end]);
      await run('published',`SELECT version_number,created_at,snapshot->'agent_release_manifest'->>'releaseId' release_id,snapshot->'agent_release_manifest'->'runtimeConfig'->>'aiModel' model FROM autopilot_config_versions WHERE config_id=$1 AND workspace_id=$2 ORDER BY version_number DESC LIMIT 1`,['0a952e14-2fdc-47eb-99d6-733a2d4868a5','e3b476a1-5de8-4744-80b5-a5d23fe15fab']);
      await run('test_exclusion',`SELECT count(*) FROM agent_studio_live_tests WHERE chat_id=ANY($1::uuid[])`,[['8a7d29dc-37f9-41f3-92cf-1394df81a6a6','31bad27e-4a18-4ed1-8dbc-2971bb35e6af']]);
      await run('correlation',`SELECT e.status,count(*) FROM evolution_webhook_events e WHERE e.created_at >= $1 AND e.created_at < $2 AND EXISTS (SELECT 1 FROM messages m WHERE m.workspace_id=e.workspace_id AND m.chat_id=ANY($3::uuid[]) AND m.created_at >= $1 AND m.created_at < $2 AND m.from_me=false AND m.message_id_from_api=e.payload->'data'->'key'->>'id') GROUP BY 1`,[start,end,['8a7d29dc-37f9-41f3-92cf-1394df81a6a6','31bad27e-4a18-4ed1-8dbc-2971bb35e6af']]);
      await run('workflow_nodes',`SELECT n.node_type,n.status,count(*) FROM workflow_node_runs n JOIN workflow_executions e ON e.id=n.execution_id WHERE e.started_at >= $1 AND e.started_at < $2 AND e.status='failed' GROUP BY 1,2`,[start,end]);
      await run('workflow_events',`SELECT ev.event_type,count(*) FROM workflow_events ev JOIN workflow_executions e ON e.id=ev.execution_id WHERE e.started_at >= $1 AND e.started_at < $2 AND e.status='failed' GROUP BY 1`,[start,end]);
      return;
    }
    await run('tickets',`SELECT t.id,t.subject,t.status,t.updated_at,t.description,(SELECT jsonb_agg(x) FROM (SELECT is_staff,created_at,left(message,1800) message FROM support_messages WHERE ticket_id=t.id ORDER BY created_at DESC LIMIT 3)x) recent FROM support_tickets t WHERE t.status NOT IN ('closed','resolved') OR t.updated_at >= $1 ORDER BY t.updated_at DESC LIMIT 20`,[start]);
    await run('ai_delivery',`SELECT api_message_status,status_from_api,count(*) messages,count(DISTINCT chat_id) chats FROM messages WHERE created_at >= $1 AND created_at < $2 AND from_me=true AND metadata ? 'autopilotSourceMessageId' GROUP BY 1,2`,[start,end]);
    await run('sessions',`SELECT id,workspace_id,chat_id,release_id,status,started_at,updated_at,summary FROM agent_studio_sessions WHERE updated_at >= $1 AND updated_at < $2 ORDER BY updated_at DESC LIMIT 30`,[start,end]);
    await run('workflows',`SELECT status,waiting_reason,failure->>'code' code,count(*) FROM workflow_executions WHERE started_at >= $1 AND started_at < $2 GROUP BY 1,2,3`,[start,end]);
    await run('webhooks',`SELECT status,count(*) FROM evolution_webhook_events WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`,[start,end]);
    await run('ledger',`SELECT decision_type,count(*),count(latency_ms) latency_samples FROM agent_decision_ledger WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`,[start,end]);
    await run('live_tests',`SELECT count(*) FROM agent_studio_live_tests WHERE updated_at >= $1 AND updated_at < $2`,[start,end]);
  } finally { await client.query('ROLLBACK').catch(()=>{}); await client.end(); }
}
main().catch(e=>{console.error(e.code || e.name);process.exitCode=1});
