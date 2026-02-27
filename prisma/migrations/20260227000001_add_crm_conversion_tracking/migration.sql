-- CRM conversion tracking
ALTER TABLE "workspaces"
ADD COLUMN IF NOT EXISTS "conversion_counter_mode" TEXT NOT NULL DEFAULT 'won_deals';

ALTER TABLE "workspaces"
ADD COLUMN IF NOT EXISTS "conversion_custom_field_id" UUID,
ADD COLUMN IF NOT EXISTS "conversion_custom_field_value" TEXT;

ALTER TABLE "contacts"
ADD COLUMN IF NOT EXISTS "converted_at" TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS "idx_contacts_workspace_converted_at"
ON "contacts" ("workspace_id", "converted_at");

CREATE INDEX IF NOT EXISTS "idx_workspaces_conversion_custom_field_id"
ON "workspaces" ("conversion_custom_field_id");
