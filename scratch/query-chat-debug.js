const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();

  console.log("=== SIMULATION RUNS FOR CHAT ===");
  const res = await client.query(`
    SELECT id, status, error, intent, metadata, created_at
    FROM orchestrator_runs
    WHERE chat_id = '96c1649f-ef93-43d2-8346-bc1bbc937d0b'
    ORDER BY created_at DESC
    LIMIT 3
  `);
  for (const row of res.rows) {
    console.log(`\nRun: ${row.id} at ${row.created_at} | Intent: ${row.intent} | Status: ${row.status}`);
    console.log(`Error:`, row.error);
    console.log(`Metadata:`, JSON.stringify(row.metadata));
    
    const eventsQuery = `
      SELECT kind, status, payload
      FROM orchestrator_events
      WHERE run_id = $1
      ORDER BY created_at ASC
    `;
    const resEvents = await client.query(eventsQuery, [row.id]);
    for (const ev of resEvents.rows) {
      if (ev.kind === 'tool_memory' || ev.kind === 'workflow_plan' || ev.kind === 'response_validator' || ev.kind === 'message_send') {
        console.log(`  -> [${ev.kind}] status=${ev.status} payload=${JSON.stringify(ev.payload)}`);
      }
    }
  }

  await client.end();
}

main().catch(console.error);
