import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const tables = [
    'agent_causal_patterns',
    'agent_causal_pattern_applications',
    'agent_causal_pattern_review_metadata',
    'agent_causal_pattern_switch_scope'
  ];

  for (const table of tables) {
    const res = await db.query(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables 
         WHERE table_schema = 'public' 
           AND table_name = $1
       )`,
      [table]
    );
    console.log(`Table ${table} exists:`, res.rows[0].exists);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
