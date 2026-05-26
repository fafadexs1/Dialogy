CREATE TABLE IF NOT EXISTS "ad_clicks" (
    "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "workspace_id" TEXT NOT NULL,
    "instance_name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "destination_phone" TEXT NOT NULL,
    "destination_url" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'google',
    "medium" TEXT,
    "campaign" TEXT,
    "campaign_id" TEXT,
    "ad_group_id" TEXT,
    "creative_id" TEXT,
    "keyword" TEXT,
    "device" TEXT,
    "match_type" TEXT,
    "gclid" TEXT,
    "gbraid" TEXT,
    "wbraid" TEXT,
    "raw_params" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "clicked_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    "expires_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()) + interval '30 days',
    "matched_at" TIMESTAMPTZ,
    "matched_contact_id" TEXT,
    "matched_chat_id" TEXT,
    "matched_message_id" TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS "ad_clicks_token_key" ON "ad_clicks" ("token");
CREATE INDEX IF NOT EXISTS "idx_ad_clicks_workspace_clicked" ON "ad_clicks" ("workspace_id", "clicked_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_ad_clicks_instance_unmatched" ON "ad_clicks" ("workspace_id", "instance_name", "clicked_at" DESC) WHERE "matched_at" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_ad_clicks_gclid" ON "ad_clicks" ("gclid") WHERE "gclid" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ad_attributions" (
    "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "workspace_id" TEXT NOT NULL,
    "ad_click_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "chat_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'google',
    "medium" TEXT,
    "campaign" TEXT,
    "campaign_id" TEXT,
    "match_type" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "attributed_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS "ad_attributions_click_key" ON "ad_attributions" ("ad_click_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ad_attributions_message_key" ON "ad_attributions" ("message_id");
CREATE INDEX IF NOT EXISTS "idx_ad_attributions_workspace_attributed" ON "ad_attributions" ("workspace_id", "attributed_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_ad_attributions_chat" ON "ad_attributions" ("chat_id");

CREATE TABLE IF NOT EXISTS "conversion_exports" (
    "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "workspace_id" TEXT NOT NULL,
    "ad_attribution_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "conversion_action_id" TEXT,
    "conversion_value" NUMERIC(12, 2) NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "response" JSONB,
    "error_message" TEXT,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE UNIQUE INDEX IF NOT EXISTS "conversion_exports_event_key"
    ON "conversion_exports" ("ad_attribution_id", "event_name");
CREATE INDEX IF NOT EXISTS "idx_conversion_exports_pending"
    ON "conversion_exports" ("workspace_id", "created_at")
    WHERE "status" IN ('pending', 'failed');

ALTER TABLE "workspaces"
    ADD COLUMN IF NOT EXISTS "google_ads_customer_id" TEXT,
    ADD COLUMN IF NOT EXISTS "google_ads_login_customer_id" TEXT,
    ADD COLUMN IF NOT EXISTS "google_ads_conversion_action_whatsapp_message" TEXT,
    ADD COLUMN IF NOT EXISTS "google_ads_conversion_action_lead_qualified" TEXT,
    ADD COLUMN IF NOT EXISTS "google_ads_conversion_action_sale_won" TEXT;
