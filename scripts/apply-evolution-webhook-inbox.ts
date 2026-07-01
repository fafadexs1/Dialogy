import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { db } from '../src/lib/db';

async function main() {
  const migrationPath = resolve(
    process.cwd(),
    'prisma/migrations/20260701010000_evolution_webhook_inbox/migration.sql',
  );
  const sql = await readFile(migrationPath, 'utf8');
  await db.query(sql);
  const verification = await db.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'evolution_webhook_events'`,
  );
  if ((verification.rowCount ?? 0) !== 1) {
    throw new Error('evolution_webhook_events was not created.');
  }
  console.log('[EVOLUTION_INBOX_MIGRATION] evolution_webhook_events is ready.');
}

main()
  .catch((error) => {
    console.error('[EVOLUTION_INBOX_MIGRATION] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
