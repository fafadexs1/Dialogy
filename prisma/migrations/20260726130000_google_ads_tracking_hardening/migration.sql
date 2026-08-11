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
