import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const result = await db.query(
    `SELECT id, name, workspace_id, ai_model
     FROM autopilot_configs`
  );
  console.log('Autopilot Configs:', result.rows);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
