import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const result = await db.query(
    `SELECT *
     FROM autopilot_configs
     WHERE id = '475cc308-03a6-483f-8fdd-10084f0c73b8'
     LIMIT 1`
  );
  console.log('Agent Detail:', result.rows[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
