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
