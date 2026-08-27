-- Migracao para suporte a Google Data Manager API v1 (events:ingest e requestStatus:retrieve)

-- 1. Protecao do Smart Bidding em ad_attributions (apenas atribuicoes deterministas/confiaveis sao elegiveis para export)
ALTER TABLE "ad_attributions"
    ADD COLUMN IF NOT EXISTS "export_eligible" BOOLEAN NOT NULL DEFAULT true;

-- Ajustar historico: proximidade probabilistica fica false por padrao para nao poluir o Smart Bidding
UPDATE "ad_attributions"
SET "export_eligible" = false
WHERE "match_type" = 'proximity' AND "confidence" != 'high';

-- 2. Novos campos de rastreamento assincrono e diagnostico em conversion_exports
ALTER TABLE "conversion_exports"
    ADD COLUMN IF NOT EXISTS "google_ads_customer_id" TEXT,
    ADD COLUMN IF NOT EXISTS "product_destination_id" TEXT,
    ADD COLUMN IF NOT EXISTS "transaction_id" TEXT,
    ADD COLUMN IF NOT EXISTS "request_id" TEXT,
    ADD COLUMN IF NOT EXISTS "processing_status" TEXT,
    ADD COLUMN IF NOT EXISTS "processing_checked_at" TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "last_error_code" TEXT,
    ADD COLUMN IF NOT EXISTS "last_error_message" TEXT;

-- 3. Backfill de transaction_id e product_destination_id para registros legados
UPDATE "conversion_exports"
SET "transaction_id" = COALESCE("order_id", 'dialogy:' || "workspace_id" || ':' || "event_name" || ':' || "id")
WHERE "transaction_id" IS NULL;

UPDATE "conversion_exports"
SET "product_destination_id" = regexp_replace(regexp_replace("conversion_action_id", '^.*/', ''), '\D', '', 'g')
WHERE "product_destination_id" IS NULL AND "conversion_action_id" IS NOT NULL;

-- 4. Indice de Idempotencia estrito para evitar duplicacoes em retry de webhook
DROP INDEX IF EXISTS "conversion_exports_tx_key";
CREATE UNIQUE INDEX IF NOT EXISTS "conversion_exports_tx_key"
    ON "conversion_exports" ("workspace_id", "event_name", "transaction_id")
    WHERE "kind" = 'conversion';

-- 5. Atualizacao dos indices de claim da fila
DROP INDEX IF EXISTS "idx_conversion_exports_claimable";
CREATE INDEX IF NOT EXISTS "idx_conversion_exports_claimable"
    ON "conversion_exports" ("next_attempt_at")
    WHERE "status" IN ('pending', 'failed', 'processing', 'submitted');

DROP INDEX IF EXISTS "idx_conversion_exports_submitted";
CREATE INDEX IF NOT EXISTS "idx_conversion_exports_submitted"
    ON "conversion_exports" ("status", "next_attempt_at")
    WHERE "status" = 'submitted';
