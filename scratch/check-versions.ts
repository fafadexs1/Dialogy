import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const result = await db.query(
    `SELECT version_number, label, created_at, snapshot->>'ai_model' as model
     FROM autopilot_config_versions
     WHERE config_id = '475cc308-03a6-483f-8fdd-10084f0c73b8'
     ORDER BY version_number DESC`
  );
  console.log('Versions found:', result.rowCount);
  for (const row of result.rows) {
    console.log(`- Version v${row.version_number}: ${row.label} | Model: ${row.model} | Created at: ${row.created_at}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
