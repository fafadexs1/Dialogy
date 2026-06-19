import 'dotenv/config';
import { db } from '../src/lib/db';
import { SYSTEM_AI_MODEL_CATALOG_KEY } from '../src/lib/ai-models';

async function main() {
  const result = await db.query(
    'SELECT value FROM public.system_settings WHERE key = $1 LIMIT 1',
    [SYSTEM_AI_MODEL_CATALOG_KEY]
  );
  const rowCount = result.rowCount ?? 0;
  console.log('Row count:', rowCount);
  if (rowCount > 0) {
    console.log('Catalog Value:', JSON.stringify(JSON.parse(result.rows[0].value), null, 2));
  } else {
    console.log('No catalog found in system_settings.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
