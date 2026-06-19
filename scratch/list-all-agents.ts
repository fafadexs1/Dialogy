import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const result = await db.query(
    `SELECT id, name, is_active, is_primary, ai_model, created_at
     FROM autopilot_configs
     WHERE workspace_id = '5c3a91e9-b243-4436-80ba-42434bc5ca97'
     ORDER BY created_at ASC`
  );
  console.log('Total agents found:', result.rowCount);
  for (const row of result.rows) {
    console.log(`- Agent "${row.name}" (ID: ${row.id}):`);
    console.log(`  * Active: ${row.is_active} | Primary: ${row.is_primary}`);
    console.log(`  * Model: ${row.ai_model}`);
    console.log(`  * Created at: ${row.created_at}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
