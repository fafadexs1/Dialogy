-- ============================================================================
-- Google Ads: aplicacao manual das duas migrations pendentes.
--
-- COMO USAR: cole tudo no SQL Editor do Supabase e execute de uma vez.
-- Tudo roda dentro de uma transacao: se qualquer passo falhar, nada e aplicado.
--
-- Pre-requisito: o papel que executa precisa ser dono das tabelas ad_clicks,
-- ad_attributions e conversion_exports (hoje elas pertencem a supabase_admin).
-- O passo 1 resolve isso. Se ele falhar por permissao, rode este script com um
-- papel superuser ou com supabase_admin.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- PASSO 1: alinhar o dono das tabelas do tracking com o resto do schema.
-- Sem isso o app (que conecta como postgres) nunca consegue alterar essas
-- tabelas, e toda migration futura que as toque vai falhar do mesmo jeito.
-- ----------------------------------------------------------------------------
ALTER TABLE public.ad_clicks          OWNER TO postgres;
ALTER TABLE public.ad_attributions    OWNER TO postgres;
ALTER TABLE public.conversion_exports OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- PASSO 2: migration 20260726130000_google_ads_tracking_hardening
-- ----------------------------------------------------------------------------

-- Janela de conversao alinhada ao limite real do Google Ads (90 dias apos o clique).
ALTER TABLE "ad_clicks"
    ALTER COLUMN "expires_at" SET DEFAULT timezone('utc', now()) + interval '90 days';

UPDATE "ad_clicks"
SET "expires_at" = "clicked_at" + interval '90 days'
WHERE "expires_at" < "clicked_at" + interval '90 days';

-- Sinais extras do clique, usados no casamento probabilistico e no expurgo.
ALTER TABLE "ad_clicks"
    ADD COLUMN IF NOT EXISTS "user_agent" TEXT,
    ADD COLUMN IF NOT EXISTS "ip_hash" TEXT;

CREATE INDEX IF NOT EXISTS "idx_ad_clicks_expires_at" ON "ad_clicks" ("expires_at");

-- Fila de exportacao: backoff, dead-letter, lease de worker, valor real e ajustes.
ALTER TABLE "conversion_exports"
    ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'conversion',
    ADD COLUMN IF NOT EXISTS "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    ADD COLUMN IF NOT EXISTS "deal_id" TEXT,
    ADD COLUMN IF NOT EXISTS "order_id" TEXT,
    ADD COLUMN IF NOT EXISTS "adjustment_type" TEXT,
    ADD COLUMN IF NOT EXISTS "custom_variables" JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS "locked_by" TEXT,
    ADD COLUMN IF NOT EXISTS "lease_expires_at" TIMESTAMPTZ;

-- A unicidade por evento vale apenas para a conversao original. Ajustes
-- (RESTATEMENT/RETRACTION) sao lancamentos novos e podem repetir o evento.
DROP INDEX IF EXISTS "conversion_exports_event_key";
CREATE UNIQUE INDEX IF NOT EXISTS "conversion_exports_event_key"
    ON "conversion_exports" ("ad_attribution_id", "event_name")
    WHERE "kind" = 'conversion';

-- A fila e varrida por data de proxima tentativa, nao por data de criacao.
DROP INDEX IF EXISTS "idx_conversion_exports_pending";
CREATE INDEX IF NOT EXISTS "idx_conversion_exports_claimable"
    ON "conversion_exports" ("next_attempt_at")
    WHERE "status" IN ('pending', 'failed', 'processing');

CREATE INDEX IF NOT EXISTS "idx_conversion_exports_workspace_status"
    ON "conversion_exports" ("workspace_id", "status", "created_at" DESC);

-- Backfill: linhas antigas ficam elegiveis imediatamente.
UPDATE "conversion_exports"
SET "next_attempt_at" = COALESCE("updated_at", "created_at")
WHERE "status" IN ('pending', 'failed');

-- Exportacoes que ja estouraram o limite de tentativas viram dead-letter
-- explicito, em vez de ficarem presas em 'failed' para sempre.
UPDATE "conversion_exports"
SET "status" = 'dead'
WHERE "status" = 'failed'
  AND "attempt_count" >= 5;

-- ----------------------------------------------------------------------------
-- PASSO 3: migration 20260726140000_google_ads_customer_match_lists
-- ----------------------------------------------------------------------------

-- Vinculo entre um segmento do CRM e a lista de Customer Match criada no Google
-- Ads, para que a sincronizacao seja incremental em vez de criar lista nova a
-- cada envio.
CREATE TABLE IF NOT EXISTS "google_ads_user_lists" (
    "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "workspace_id" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "user_list_resource_name" TEXT NOT NULL,
    "user_list_name" TEXT NOT NULL,
    "last_synced_at" TIMESTAMPTZ,
    "last_uploaded_count" INTEGER NOT NULL DEFAULT 0,
    "last_skipped_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS "google_ads_user_lists_segment_key"
    ON "google_ads_user_lists" ("workspace_id", "segment_id", "customer_id");

CREATE INDEX IF NOT EXISTS "idx_google_ads_user_lists_workspace"
    ON "google_ads_user_lists" ("workspace_id", "updated_at" DESC);

ALTER TABLE public.google_ads_user_lists OWNER TO postgres;

-- ----------------------------------------------------------------------------
-- PASSO 4: registrar as duas no ledger do Prisma, para que `migrate status`
-- pare de apontar as duas como pendentes. Os checksums abaixo sao o SHA-256 do
-- conteudo exato de cada arquivo migration.sql do repositorio.
-- ----------------------------------------------------------------------------
INSERT INTO public._prisma_migrations
    (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT
    gen_random_uuid()::text,
    '5f75c6da2adfbe749408122435761c4a84a5477bbe33fde616729c600b0db1c9',
    now(),
    '20260726130000_google_ads_tracking_hardening',
    'Aplicada manualmente via SQL Editor do Supabase.',
    NULL,
    now(),
    1
WHERE NOT EXISTS (
    SELECT 1 FROM public._prisma_migrations
    WHERE migration_name = '20260726130000_google_ads_tracking_hardening'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
);

INSERT INTO public._prisma_migrations
    (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
SELECT
    gen_random_uuid()::text,
    '8ca4bbad29fc980f32311a3e4fa40561922388382eb176b130792c03ebdfae9c',
    now(),
    '20260726140000_google_ads_customer_match_lists',
    'Aplicada manualmente via SQL Editor do Supabase.',
    NULL,
    now(),
    1
WHERE NOT EXISTS (
    SELECT 1 FROM public._prisma_migrations
    WHERE migration_name = '20260726140000_google_ads_customer_match_lists'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
);

COMMIT;

-- ============================================================================
-- CONFERENCIA: rode depois do COMMIT. Todas as colunas devem vir como true.
-- ============================================================================
SELECT
    to_regclass('public.google_ads_user_lists') IS NOT NULL AS tabela_user_lists,
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='conversion_exports' AND column_name='kind') AS coluna_kind,
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='conversion_exports' AND column_name='next_attempt_at') AS coluna_next_attempt_at,
    EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='ad_clicks' AND column_name='ip_hash') AS coluna_ip_hash,
    (SELECT tableowner FROM pg_tables
      WHERE schemaname='public' AND tablename='ad_clicks') = 'postgres' AS dono_corrigido,
    (SELECT count(*) FROM public._prisma_migrations
      WHERE migration_name LIKE '202607261%google_ads%') AS registros_no_ledger;
