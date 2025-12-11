-- Create subscription_plan enum
CREATE TYPE "subscription_plan" AS ENUM ('starter', 'pro', 'business', 'enterprise');

-- Add columns to workspaces table
ALTER TABLE "public"."workspaces" 
ADD COLUMN IF NOT EXISTS "plan" "subscription_plan" DEFAULT 'starter' NOT NULL,
ADD COLUMN IF NOT EXISTS "subscription_status" TEXT DEFAULT 'active',
ADD COLUMN IF NOT EXISTS "custom_limits" JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS "billing_cycle_anchor" TIMESTAMPTZ DEFAULT NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS "idx_workspaces_plan" ON "public"."workspaces" ("plan");

-- Comment describing the columns
COMMENT ON COLUMN "public"."workspaces"."custom_limits" IS 'JSON object to override default plan limits. e.g. {"users": 50, "whatsapp": 10}';
