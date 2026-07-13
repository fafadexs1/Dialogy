import 'dotenv/config';

import { Pool } from 'pg';

import { localProductUpdateDemo } from '../src/lib/product-updates-demo';

const REQUIRED_MIGRATIONS = [
  '20260713153000_product_updates',
  '20260713190000_product_update_rich_content',
  '20260713210000_seed_welcome_product_update',
] as const;

type ResultLevel = 'ok' | 'warning' | 'error';

const results: Array<{ level: ResultLevel; message: string }> = [];

function report(level: ResultLevel, message: string): void {
  results.push({ level, message });
  const marker = level === 'ok' ? 'OK' : level === 'warning' ? 'AVISO' : 'ERRO';
  console.log(`[${marker}] ${message}`);
}

function validateRuntimeConfiguration(): void {
  const serverEnabled = process.env.PRODUCT_UPDATES_ENABLED === 'true';
  const clientEnabled = process.env.NEXT_PUBLIC_PRODUCT_UPDATES_ENABLED === 'true';

  report(serverEnabled ? 'ok' : 'error', `PRODUCT_UPDATES_ENABLED=${serverEnabled}`);
  report(clientEnabled ? 'ok' : 'error', `NEXT_PUBLIC_PRODUCT_UPDATES_ENABLED=${clientEnabled}`);
}

function validateLocalDemo(): void {
  const interactions = localProductUpdateDemo.reactions.likes
    + localProductUpdateDemo.reactions.dislikes
    + localProductUpdateDemo.commentsCount
    + (localProductUpdateDemo.poll?.totalVotes ?? 0);

  const valid = Boolean(
    localProductUpdateDemo.id
      && localProductUpdateDemo.slug
      && localProductUpdateDemo.title
      && localProductUpdateDemo.isDemo
      && localProductUpdateDemo.contentBlocks.length > 0,
  );

  report(
    valid ? 'ok' : 'error',
    `Demo local: 1 publicação, ${interactions} interações, ${localProductUpdateDemo.contentBlocks.length} blocos de conteúdo.`,
  );

  for (const host of ['localhost', '127.0.0.1']) {
    report('ok', `http://${host}:9002/novidades deve usar a demo local sem consultar o banco.`);
  }
  report(
    'warning',
    'Acesso por IP da rede ou nome da máquina não é preview local; nesse caso o feed depende do banco e das migrations.',
  );
}

async function validateDatabase(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    report('warning', 'DATABASE_URL não está definida; diagnóstico do banco ignorado.');
    return;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 8_000,
  });

  try {
    const schema = await pool.query<{
      updates: string | null;
      reactions: string | null;
      comments: string | null;
      polls: string | null;
      content_blocks: boolean;
      migration_table: string | null;
    }>(`
      SELECT
        to_regclass('public.product_updates')::text AS updates,
        to_regclass('public.product_update_reactions')::text AS reactions,
        to_regclass('public.product_update_comments')::text AS comments,
        to_regclass('public.product_update_polls')::text AS polls,
        EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'product_updates'
            AND column_name = 'content_blocks'
        ) AS content_blocks,
        to_regclass('public._prisma_migrations')::text AS migration_table
    `);

    const state = schema.rows[0];
    const baseSchemaReady = Boolean(state.updates && state.reactions && state.comments);
    const richContentReady = Boolean(state.polls && state.content_blocks);
    report(baseSchemaReady ? 'ok' : 'error', 'Tabelas base de product updates no banco.');
    report(richContentReady ? 'ok' : 'error', 'Tabelas/coluna de conteúdo rico e enquete no banco.');

    if (state.migration_table) {
      const migrations = await pool.query<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(`
        SELECT migration_name, finished_at, rolled_back_at
        FROM public._prisma_migrations
        WHERE migration_name = ANY($1::text[])
      `, [REQUIRED_MIGRATIONS]);
      const applied = new Set(
        migrations.rows
          .filter((migration) => migration.finished_at && !migration.rolled_back_at)
          .map((migration) => migration.migration_name),
      );
      for (const migration of REQUIRED_MIGRATIONS) {
        report(applied.has(migration) ? 'ok' : 'error', `Migration ${migration} aplicada.`);
      }
    } else {
      report('error', 'Tabela public._prisma_migrations não existe.');
    }

    if (state.updates) {
      const counts = await pool.query<{ total: string; published: string }>(`
        SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE is_published = TRUE AND published_at <= NOW())::text AS published
        FROM public.product_updates
      `);
      const { total, published } = counts.rows[0];
      report(Number(published) > 0 ? 'ok' : 'warning', `Banco: ${total} publicação(ões), ${published} publicada(s).`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report('error', `Falha ao consultar o banco: ${message}`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  console.log('Diagnóstico de /novidades\n');
  validateRuntimeConfiguration();
  validateLocalDemo();
  await validateDatabase();

  const errors = results.filter((result) => result.level === 'error').length;
  const warnings = results.filter((result) => result.level === 'warning').length;
  console.log(`\nResumo: ${errors} erro(s), ${warnings} aviso(s).`);
  if (errors > 0) process.exitCode = 1;
}

void main();
