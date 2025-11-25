-- Meta channels and webhook plumbing for Instagram Direct + Messenger

DO $$ BEGIN
  CREATE TYPE "meta_channel_type_enum" AS ENUM ('instagram', 'messenger');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "message_direction_enum" AS ENUM ('incoming', 'outgoing');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "platform" "meta_channel_type_enum";
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "external_message_id" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "external_sender_id" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "external_channel_id" TEXT;
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "direction" "message_direction_enum";
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "media_url" TEXT;

CREATE TABLE IF NOT EXISTS "meta_channels" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "type" "meta_channel_type_enum" NOT NULL,
  "external_page_id" TEXT,
  "ig_business_id" TEXT,
  "access_token" TEXT NOT NULL,
  "app_secret" TEXT,
  "verify_token" TEXT NOT NULL,
  "name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "settings" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT "meta_channels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_meta_channels_type_page" ON "meta_channels"("type", "external_page_id");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_meta_channels_type_igbiz" ON "meta_channels"("type", "ig_business_id");
CREATE INDEX IF NOT EXISTS "idx_meta_channels_workspace" ON "meta_channels"("workspace_id");

CREATE TABLE IF NOT EXISTS "meta_contacts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "external_id" TEXT NOT NULL,
  "username" TEXT,
  "name" TEXT,
  "profile_pic" TEXT,
  "last_seen_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT "meta_contacts_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "meta_channels"("id") ON DELETE CASCADE,
  CONSTRAINT "meta_contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_meta_contacts_channel_external" ON "meta_contacts"("channel_id", "external_id");
CREATE INDEX IF NOT EXISTS "idx_meta_contacts_contact" ON "meta_contacts"("contact_id");

CREATE TABLE IF NOT EXISTS "meta_conversations" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel_id" UUID NOT NULL,
  "meta_contact_id" UUID NOT NULL,
  "chat_id" UUID NOT NULL,
  "external_thread_id" TEXT NOT NULL,
  "platform" "meta_channel_type_enum" NOT NULL,
  "last_message_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  "status" TEXT NOT NULL DEFAULT 'open',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT "meta_conversations_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "meta_channels"("id") ON DELETE CASCADE,
  CONSTRAINT "meta_conversations_meta_contact_id_fkey" FOREIGN KEY ("meta_contact_id") REFERENCES "meta_contacts"("id") ON DELETE CASCADE,
  CONSTRAINT "meta_conversations_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_meta_conversations_channel_thread" ON "meta_conversations"("channel_id", "external_thread_id");
CREATE INDEX IF NOT EXISTS "idx_meta_conversations_channel" ON "meta_conversations"("channel_id");
CREATE INDEX IF NOT EXISTS "idx_meta_conversations_chat" ON "meta_conversations"("chat_id");

CREATE TABLE IF NOT EXISTS "webhook_logs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel_id" UUID,
  "source" TEXT NOT NULL,
  "direction" TEXT NOT NULL DEFAULT 'incoming',
  "event" TEXT,
  "status_code" INTEGER,
  "payload" JSONB,
  "headers" JSONB,
  "response_body" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT "webhook_logs_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "meta_channels"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "idx_webhook_logs_channel" ON "webhook_logs"("channel_id");
CREATE INDEX IF NOT EXISTS "idx_webhook_logs_source" ON "webhook_logs"("source");
