import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
});

async function main() {
  const client = await pool.connect();
  try {
    const ap = await client.query(
      "SELECT id, name, workflow_runtime_v2_mode, workflow_builder_mode, active_workflow_id, active_workflow_version, default_fallback_reply FROM autopilot_configs WHERE id = '7d7259ab-a6c3-4057-a9ca-28ddbb15db95'"
    );
    console.log('Lucas autopilot row:', JSON.stringify(ap.rows[0], null, 2));

    const runId = '7834db2b-31c1-41d8-8054-ff62fce80b9a';
    console.log(`=== ORCHESTRATOR RUN: ${runId} ===`);

    const run = await client.query('SELECT * FROM orchestrator_runs WHERE id = $1', [runId]);
    console.log('Run details:', JSON.stringify(run.rows[0], null, 2));

    const events = await client.query(
      'SELECT * FROM orchestrator_events WHERE run_id = $1 ORDER BY created_at ASC',
      [runId]
    );
    console.log(`Events count: ${events.rows.length}`);
    for (const ev of events.rows) {
      console.log(`\n[${ev.created_at?.toISOString()}] Kind: ${ev.kind} | Status: ${ev.status} | Duration: ${ev.duration_ms}ms`);
      console.log('Payload:', JSON.stringify(ev.payload, null, 2));
    }

    console.log('\n=== ALSO CHECK PREVIOUS RUN: 52605e00-23ee-4e6a-a691-27ebd8119c5b ===');
    const runPrev = await client.query('SELECT * FROM orchestrator_runs WHERE id = $1', ['52605e00-23ee-4e6a-a691-27ebd8119c5b']);
    console.log('Prev run details:', JSON.stringify(runPrev.rows[0], null, 2));

    const eventsPrev = await client.query(
      'SELECT * FROM orchestrator_events WHERE run_id = $1 ORDER BY created_at ASC',
      ['52605e00-23ee-4e6a-a691-27ebd8119c5b']
    );
    for (const ev of eventsPrev.rows) {
      console.log(`[${ev.created_at?.toISOString()}] Kind: ${ev.kind} | Status: ${ev.status} | Duration: ${ev.duration_ms}ms`);
      console.log('Payload:', JSON.stringify(ev.payload, null, 2));
    }

    // Check intelligent_attendant_responses or similar
    try {
      const logs = await client.query(
        "SELECT * FROM intelligent_attendant_responses WHERE chat_id = 'ef8de861-3f70-4202-8778-7e42e2dd250b' ORDER BY created_at DESC LIMIT 5"
      );
      console.log('\n=== INTELLIGENT ATTENDANT RESPONSES ===');
      for (const l of logs.rows) {
        console.log(`[${l.created_at?.toISOString()}] Model: ${l.model_name} | Status: ${l.status}`);
        console.log(`Cust Msg: ${l.customer_message}`);
        console.log(`Response: ${l.response}`);
        console.log(`Metadata:`, JSON.stringify(l.metadata, null, 2));
      }
    } catch {}

    // Check workflow_executions if any
    try {
      const wfExecs = await client.query(
        "SELECT * FROM workflow_executions WHERE chat_id = 'ef8de861-3f70-4202-8778-7e42e2dd250b' ORDER BY created_at DESC LIMIT 5"
      );
      console.log('\n=== WORKFLOW EXECUTIONS ===');
      for (const wf of wfExecs.rows) {
        console.log(JSON.stringify(wf, null, 2));
      }
    } catch (e: any) {
      console.log('workflow_executions query error or table not present:', e.message);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
