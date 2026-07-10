import 'dotenv/config';

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

import {
  RECONCILIATION_CONFIRMATION,
  auditMigrations,
  checksumMigration,
  inferMigrationInvariants,
  reconcileVerifiedMigrations,
  type LocalMigration,
} from '../src/services/migrations/reconciliation';

async function loadLocalMigrations(): Promise<LocalMigration[]> {
  const root = resolve(process.cwd(), 'prisma/migrations');
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return Promise.all(names.map(async (name) => {
    const sql = await readFile(resolve(root, name, 'migration.sql'), 'utf8');
    const inferred = inferMigrationInvariants(sql);
    return { name, sql, checksum: checksumMigration(sql), ...inferred };
  }));
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const confirmation = args.find((arg) => arg.startsWith('--confirm='))?.slice('--confirm='.length) ?? '';
  const names = args.filter((arg) => arg.startsWith('--migration=')).map((arg) => arg.slice('--migration='.length));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const migrations = await loadLocalMigrations();
    if (apply) {
      const reconciled = await reconcileVerifiedMigrations(pool, migrations, { confirmation, names });
      console.log(JSON.stringify({ mode: 'apply', reconciled }, null, 2));
      return;
    }
    const audit = await auditMigrations(pool, migrations);
    const summary = audit.reduce<Record<string, number>>((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({
      mode: 'read-only-audit',
      summary,
      migrations: audit.filter((item) => item.status !== 'applied').map((item) => ({
        name: item.name,
        status: item.status,
        blockers: item.blockers,
        invariantsPassed: item.invariantResults.filter((result) => result.passed).length,
        invariantsTotal: item.invariantResults.length,
      })),
      applyHint: `--apply --confirm=${RECONCILIATION_CONFIRMATION} --migration=<verified-name>`,
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[PRISMA_RECONCILIATION]', error);
  process.exitCode = 1;
});
