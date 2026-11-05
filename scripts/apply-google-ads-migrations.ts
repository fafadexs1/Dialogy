import 'dotenv/config';

import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const MIGRATIONS = [
  '20260726130000_google_ads_tracking_hardening',
  '20260726140000_google_ads_customer_match_lists',
  '20260819120000_google_data_manager_api',
  '20260819130000_google_ads_data_manager_views',
];

const APPLY = process.argv.includes('--apply');

/**
 * As tabelas do tracking pertencem a supabase_admin, entao o papel da aplicacao
 * nao consegue alterar o schema delas. Com --admin reutilizamos a mesma senha do
 * DATABASE_URL trocando apenas o papel, e alinhamos o dono com o resto do schema
 * para que migrations futuras nao esbarrem no mesmo problema.
 */
const USE_ADMIN = process.argv.includes('--admin');

const TABELAS_PARA_REALINHAR = ['ad_clicks', 'ad_attributions', 'conversion_exports'];

function connectionString(): string {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL ausente.');
  if (!USE_ADMIN) return base;

  const url = new URL(base);
  url.username = 'supabase_admin';
  return url.toString();
}

async function tableExists(pool: Pool, name: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS present`,
    [name]
  );
  return Boolean(result.rows[0]?.present);
}

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS present`,
    [table, column]
  );
  return Boolean(result.rows[0]?.present);
}

async function main() {
  const pool = new Pool({ connectionString: connectionString(), max: 2 });

  try {
    // Pre-voo: as tabelas base precisam existir, senao a migration de origem
    // tambem esta faltando e o problema e outro.
    const preflight = {
      ad_clicks: await tableExists(pool, 'ad_clicks'),
      ad_attributions: await tableExists(pool, 'ad_attributions'),
      conversion_exports: await tableExists(pool, 'conversion_exports'),
      já_tem_kind: await columnExists(pool, 'conversion_exports', 'kind'),
      já_tem_user_agent: await columnExists(pool, 'ad_clicks', 'user_agent'),
      já_tem_user_lists: await tableExists(pool, 'google_ads_user_lists'),
    };
    console.log('PRE-VOO:', JSON.stringify(preflight, null, 2));

    if (!preflight.ad_clicks || !preflight.ad_attributions || !preflight.conversion_exports) {
      throw new Error('Tabelas base do tracking ausentes. A migration 20260520090000 precisa rodar antes.');
    }
    if (preflight.já_tem_kind || preflight.já_tem_user_agent || preflight.já_tem_user_lists) {
      console.log('AVISO: parte do schema ja existe. As migrations sao idempotentes, seguindo.');
    }

    if (!APPLY) {
      console.log('Modo verificacao. Rode com --apply para executar.');
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const identidade = await client.query('SELECT current_user AS papel');
      console.log(`Conectado como ${identidade.rows[0]?.papel}.`);

      if (USE_ADMIN) {
        for (const tabela of TABELAS_PARA_REALINHAR) {
          await client.query(`ALTER TABLE public.${tabela} OWNER TO postgres`);
        }
        console.log(`Dono realinhado para postgres: ${TABELAS_PARA_REALINHAR.join(', ')}.`);
      }

      for (const name of MIGRATIONS) {
        const path = resolve(process.cwd(), 'prisma/migrations', name, 'migration.sql');
        const sql = await readFile(path, 'utf8');

        console.log(`Executando ${name}...`);
        await client.query(sql);

        await client.query(
          `INSERT INTO public._prisma_migrations
             (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
           VALUES ($1, $2, now(), $3, $4, NULL, now(), 1)`,
          [
            randomUUID(),
            createHash('sha256').update(sql).digest('hex'),
            name,
            'Applied manually by targeted script; unrelated pending migrations were intentionally not executed.',
          ]
        );
        console.log(`  ok, registrada no ledger.`);
      }

      if (USE_ADMIN) {
        // Objetos criados agora nasceriam pertencendo a supabase_admin e
        // recriariam o mesmo bloqueio na proxima migration.
        await client.query(`
          DO $$
          DECLARE t text;
          BEGIN
            FOR t IN
              SELECT tablename FROM pg_tables
              WHERE schemaname = 'public'
                AND tablename IN ('google_ads_user_lists')
                AND tableowner <> 'postgres'
            LOOP
              EXECUTE format('ALTER TABLE public.%I OWNER TO postgres', t);
            END LOOP;
          END $$;
        `);
      }

      await client.query('COMMIT');
      console.log('COMMIT concluido.');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('ROLLBACK executado. Nada foi alterado.');
      throw error;
    } finally {
      client.release();
    }

    const posvoo = {
      conversion_exports_kind: await columnExists(pool, 'conversion_exports', 'kind'),
      conversion_exports_next_attempt_at: await columnExists(pool, 'conversion_exports', 'next_attempt_at'),
      conversion_exports_order_id: await columnExists(pool, 'conversion_exports', 'order_id'),
      ad_clicks_user_agent: await columnExists(pool, 'ad_clicks', 'user_agent'),
      ad_clicks_ip_hash: await columnExists(pool, 'ad_clicks', 'ip_hash'),
      google_ads_user_lists: await tableExists(pool, 'google_ads_user_lists'),
      donos_ainda_desalinhados: (
        await pool.query(
          `SELECT string_agg(tablename, ', ') AS lista FROM pg_tables
            WHERE schemaname = 'public' AND tableowner <> 'postgres'
              AND tablename IN ('ad_clicks','ad_attributions','conversion_exports','google_ads_user_lists')`
        )
      ).rows[0]?.lista ?? 'nenhum',
      ledger: Number(
        (
          await pool.query(
            `SELECT count(*)::int AS total FROM public._prisma_migrations
              WHERE migration_name = ANY($1::text[]) AND finished_at IS NOT NULL`,
            [MIGRATIONS]
          )
        ).rows[0]?.total ?? 0
      ),
    };
    console.log('POS-VOO:', JSON.stringify(posvoo, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
