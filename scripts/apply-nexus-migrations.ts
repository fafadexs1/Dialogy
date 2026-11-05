import 'dotenv/config';

import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';

const MIGRATIONS = [
  '20260825130000_nexus_native_workflows',
  '20260825140000_nexus_credentials',
  '20260825150000_nexus_runtime_triggers',
  '20260826120000_nexus_workflow_history',
] as const;

const APPLY = process.argv.includes('--apply');

type NexusSchemaState = {
  workflowsTable: boolean;
  credentialsTable: boolean;
  scheduleRunsTable: boolean;
  webhookTokenColumn: boolean;
  workspaceIndex: boolean;
  publishedIndex: boolean;
  credentialIndex: boolean;
  scheduleCleanupIndex: boolean;
  workflowVersionsTable: boolean;
  workflowVersionsIndex: boolean;
};

async function schemaState(client: PoolClient): Promise<NexusSchemaState> {
  const result = await client.query(`
    SELECT
      to_regclass('public.nexus_workflows') IS NOT NULL AS workflows_table,
      to_regclass('public.nexus_credentials') IS NOT NULL AS credentials_table,
      to_regclass('public.nexus_schedule_runs') IS NOT NULL AS schedule_runs_table,
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'nexus_workflows'
          AND column_name = 'webhook_token_hash'
      ) AS webhook_token_column,
      to_regclass('public.nexus_workflows_workspace_updated_idx') IS NOT NULL AS workspace_index,
      to_regclass('public.nexus_workflows_published_definition_idx') IS NOT NULL AS published_index,
      to_regclass('public.nexus_credentials_workspace_type_idx') IS NOT NULL AS credential_index,
      to_regclass('public.nexus_schedule_runs_cleanup_idx') IS NOT NULL AS schedule_cleanup_index
      ,to_regclass('public.nexus_workflow_versions') IS NOT NULL AS workflow_versions_table
      ,to_regclass('public.nexus_workflow_versions_workspace_flow_idx') IS NOT NULL AS workflow_versions_index
  `);
  const row = result.rows[0] as Record<string, unknown>;
  return {
    workflowsTable: row.workflows_table === true,
    credentialsTable: row.credentials_table === true,
    scheduleRunsTable: row.schedule_runs_table === true,
    webhookTokenColumn: row.webhook_token_column === true,
    workspaceIndex: row.workspace_index === true,
    publishedIndex: row.published_index === true,
    credentialIndex: row.credential_index === true,
    scheduleCleanupIndex: row.schedule_cleanup_index === true,
    workflowVersionsTable: row.workflow_versions_table === true,
    workflowVersionsIndex: row.workflow_versions_index === true,
  };
}

function migrationSatisfied(name: typeof MIGRATIONS[number], state: NexusSchemaState) {
  if (name === MIGRATIONS[0]) {
    return state.workflowsTable && state.workspaceIndex && state.publishedIndex;
  }
  if (name === MIGRATIONS[1]) {
    return state.credentialsTable && state.credentialIndex;
  }
  if (name === MIGRATIONS[2]) {
    return state.scheduleRunsTable && state.webhookTokenColumn && state.scheduleCleanupIndex;
  }
  return state.workflowVersionsTable && state.workflowVersionsIndex;
}

function migrationPartiallyPresent(name: typeof MIGRATIONS[number], state: NexusSchemaState) {
  if (name === MIGRATIONS[0]) {
    return state.workflowsTable || state.workspaceIndex || state.publishedIndex;
  }
  if (name === MIGRATIONS[1]) {
    return state.credentialsTable || state.credentialIndex;
  }
  if (name === MIGRATIONS[2]) {
    return state.scheduleRunsTable || state.webhookTokenColumn || state.scheduleCleanupIndex;
  }
  return state.workflowVersionsTable || state.workflowVersionsIndex;
}

async function migrationSource(name: typeof MIGRATIONS[number]) {
  const path = resolve(process.cwd(), 'prisma/migrations', name, 'migration.sql');
  const sql = await readFile(path, 'utf8');
  return { sql, checksum: createHash('sha256').update(sql).digest('hex') };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente.');
  const sources = new Map(await Promise.all(MIGRATIONS.map(async (name) => [name, await migrationSource(name)] as const)));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const client = await pool.connect();

  try {
    const before = await schemaState(client);
    const ledger = await client.query(
      `SELECT migration_name, checksum, finished_at IS NOT NULL AS applied
       FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])
       ORDER BY migration_name`,
      [[...MIGRATIONS]],
    );
    console.log('PRE-VOO:', JSON.stringify({ schema: before, ledger: ledger.rows }, null, 2));

    if (!APPLY) {
      console.log('Modo verificação. Rode com --apply para executar somente as migrations Nexus.');
      return;
    }

    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('dialogy:nexus:migrations'))");

    for (const name of MIGRATIONS) {
      const source = sources.get(name)!;
      const existing = await client.query(
        `SELECT checksum, finished_at IS NOT NULL AS applied
         FROM public._prisma_migrations
         WHERE migration_name = $1
         LIMIT 1`,
        [name],
      );
      const recorded = existing.rows[0] as Record<string, unknown> | undefined;
      if (recorded) {
        if (recorded.applied !== true) throw new Error(`${name} possui uma entrada incompleta no ledger.`);
        if (String(recorded.checksum) !== source.checksum) throw new Error(`${name} possui checksum divergente no ledger.`);
        const current = await schemaState(client);
        if (!migrationSatisfied(name, current)) throw new Error(`${name} está registrada, mas seus invariantes não existem.`);
        console.log(`[SKIP] ${name} já aplicada e verificada.`);
        continue;
      }

      const current = await schemaState(client);
      const satisfied = migrationSatisfied(name, current);
      if (!satisfied && migrationPartiallyPresent(name, current)) {
        throw new Error(`${name} está parcialmente aplicada; recusando completar um estado ambíguo.`);
      }
      if (!satisfied) {
        console.log(`[APPLY] ${name}`);
        await client.query(source.sql);
      } else {
        console.log(`[RECONCILE] ${name} já existe integralmente; registrando sem reexecutar SQL.`);
      }

      const verified = await schemaState(client);
      if (!migrationSatisfied(name, verified)) throw new Error(`${name} não satisfez os invariantes após aplicação.`);
      await client.query(
        `INSERT INTO public._prisma_migrations
           (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, $4, NULL, now(), 1)`,
        [
          randomUUID(),
          source.checksum,
          name,
          satisfied
            ? 'Reconciled by targeted Nexus migration script after catalog invariants were verified.'
            : 'Applied by targeted Nexus migration script; unrelated pending migrations were intentionally not executed.',
        ],
      );
    }

    const after = await schemaState(client);
    if (!MIGRATIONS.every((name) => migrationSatisfied(name, after))) {
      throw new Error('O schema Nexus não passou na verificação final; revertendo.');
    }
    const finalLedger = await client.query(
      `SELECT count(*)::int AS total
       FROM public._prisma_migrations
       WHERE migration_name = ANY($1::text[])
         AND finished_at IS NOT NULL`,
      [[...MIGRATIONS]],
    );
    if (Number(finalLedger.rows[0]?.total || 0) !== MIGRATIONS.length) {
      throw new Error(`O ledger não contém as ${MIGRATIONS.length} migrations Nexus; revertendo.`);
    }

    await client.query('COMMIT');
    console.log('POS-VOO:', JSON.stringify({ schema: after, ledger: Number(finalLedger.rows[0].total) }, null, 2));
    console.log(`[OK] As ${MIGRATIONS.length} migrations Nexus foram aplicadas e verificadas na mesma transação.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
