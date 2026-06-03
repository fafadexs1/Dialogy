import { Pool } from 'pg';
import 'dotenv/config';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT jsonb_path_query(knowledge_base_documents, '$[*] ? (@.name == "Diagnostico tecnico - sem conexao, lentidao e instabilidade")') as doc
       FROM public.autopilot_configs 
       WHERE id = '7d7259ab-a6c3-4057-a9ca-28ddbb15db95'`
    );
    console.log(JSON.stringify(res.rows[0]?.doc, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
