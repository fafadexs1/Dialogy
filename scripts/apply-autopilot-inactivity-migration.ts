import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

import { checksumMigration } from '../src/services/migrations/reconciliation';

/**
 * Cria autopilot_inactivity_schedules.
 *
 * O worker-ai consulta essa tabela a cada ciclo e falha com 42P01 sem ela. O
 * reconciliador (db:migrations:reconcile) nao serve aqui: ele so registra
 * migrations cujo schema ja existe, e esta bloqueia justamente porque a tabela
 * nao foi criada. As demais migrations pendentes ficam de fora de proposito.
 */

const MIGRATION = '20260726120000_autopilot_inactivity_schedules';
const APPLY = process.argv.includes('--apply');

/** Tabelas referenciadas pelas foreign keys da migration. */
const DEPENDENCIAS = [
  'chats',
  'workspaces',
  'autopilot_configs',
  'system_agents',
  'messages',
  'orchestrator_runs',
];

async function tableExists(pool: Pool, name: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS present`,
    [name],
  );
  return Boolean(result.rows[0]?.present);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL ausente.');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

  try {
    const alvoPresente = await tableExists(pool, 'autopilot_inactivity_schedules');
    const dependencias: Record<string, boolean> = {};
    for (const nome of DEPENDENCIAS) {
      dependencias[nome] = await tableExists(pool, nome);
    }

    console.log('PRE-VOO:', JSON.stringify({
      autopilot_inactivity_schedules: alvoPresente,
      dependencias,
    }, null, 2));

    const faltando = DEPENDENCIAS.filter((nome) => !dependencias[nome]);
    if (faltando.length > 0) {
      throw new Error(`Dependencias ausentes: ${faltando.join(', ')}. Uma migration anterior nao rodou.`);
    }

    const ledger = await pool.query(
      'SELECT 1 FROM public._prisma_migrations WHERE migration_name = $1 LIMIT 1',
      [MIGRATION],
    );
    if (ledger.rowCount && alvoPresente) {
      console.log('Nada a fazer: tabela existe e migration ja registrada.');
      return;
    }

    if (!APPLY) {
      console.log('Modo verificacao. Rode com --apply para executar.');
      return;
    }

    const path = resolve(process.cwd(), 'prisma/migrations', MIGRATION, 'migration.sql');
    const sql = await readFile(path, 'utf8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const identidade = await client.query('SELECT current_user AS papel');
      console.log(`Conectado como ${identidade.rows[0]?.papel}.`);

      console.log(`Executando ${MIGRATION}...`);
      await client.query(sql);

      if (!ledger.rowCount) {
        await client.query(
          `INSERT INTO public._prisma_migrations
             (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
           VALUES ($1, $2, now(), $3, $4, NULL, now(), 1)`,
          [
            randomUUID(),
            checksumMigration(sql),
            MIGRATION,
            'Applied manually by targeted script; unrelated pending migrations were intentionally not executed.',
          ],
        );
        console.log('  registrada no ledger.');
      }

      await client.query('COMMIT');
      console.log('OK, commit concluido.');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const conferencia = await tableExists(pool, 'autopilot_inactivity_schedules');
    console.log(`POS-VOO: autopilot_inactivity_schedules presente = ${conferencia}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
