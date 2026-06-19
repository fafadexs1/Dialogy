import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const result = await db.query(
    `SELECT * FROM public.system_settings WHERE key = 'ai_model_catalog' LIMIT 1`
  );
  console.log('Catalog value:', result.rows[0]);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
