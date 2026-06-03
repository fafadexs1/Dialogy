import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const CHAT_ID = '96c1649f-ef93-43d2-8346-bc1bbc937d0b';

    // Get latest orchestrator run
    const runs = await client.query(`
      SELECT r.id, r.status, r.created_at, r.metadata
      FROM public.orchestrator_runs r
      WHERE r.chat_id = $1
      ORDER BY r.created_at DESC
      LIMIT 1
    `, [CHAT_ID]);

    if (runs.rows.length === 0) {
      console.log('No runs found.');
      return;
    }

    const r = runs.rows[0];
    console.log(`\n=== LATEST ORCHESTRATOR RUN (ETAPA 2) ===`);
    console.log(`Run ID: ${r.id}, Status: ${r.status}, Created: ${r.created_at}`);
    console.log(`Metadata: ${JSON.stringify(r.metadata, null, 2)}`);

    // Get events for this run
    const events = await client.query(`
      SELECT kind, status, payload, created_at
      FROM public.orchestrator_events
      WHERE run_id = $1
      ORDER BY created_at ASC
    `, [r.id]);

    console.log('--- Events:');
    for (const ev of events.rows) {
      console.log(`  [${ev.created_at.toLocaleTimeString()}] Kind: ${ev.kind}, Status: ${ev.status}`);
      console.log(`  Payload: ${JSON.stringify(ev.payload)}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
