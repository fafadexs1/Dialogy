import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const runs = await client.query(
      `SELECT id, chat_id, intent, confidence_level, confidence_score, status, metadata, created_at 
       FROM public.orchestrator_runs 
       WHERE chat_id = '96c1649f-ef93-43d2-8346-bc1bbc937d0b'
       ORDER BY created_at DESC LIMIT 1`
    );
    console.log("=== LATEST RUN ===");
    console.log(JSON.stringify(runs.rows[0], null, 2));

    const runId = runs.rows[0]?.id;
    if (runId) {
      console.log(`\n=== EVENTS FOR LATEST RUN ${runId} ===`);
      const events = await client.query(
        `SELECT run_id, kind, status, payload 
         FROM public.orchestrator_events 
         WHERE run_id = $1 
         ORDER BY created_at ASC`,
        [runId]
      );
      console.log(JSON.stringify(events.rows, null, 2));
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
