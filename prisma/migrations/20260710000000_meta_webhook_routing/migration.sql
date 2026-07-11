-- Canonical, idempotent Meta WhatsApp inbox/outbox schema.
-- This migration also reconciles the temporary schema created by the first
-- superadmin implementation without deleting operational data.

CREATE TABLE IF NOT EXISTS public.meta_whatsapp_waba_routes (
  waba_id TEXT PRIMARY KEY,
  cluster_id UUID NOT NULL REFERENCES public.whatsapp_clusters(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_waba_routes' AND column_name = 'estado'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_waba_routes' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.meta_whatsapp_waba_routes RENAME COLUMN estado TO status;
  END IF;
END $$;

ALTER TABLE public.meta_whatsapp_waba_routes
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();

CREATE TABLE IF NOT EXISTS public.meta_whatsapp_phone_routes (
  phone_number_id TEXT PRIMARY KEY,
  waba_id TEXT NOT NULL REFERENCES public.meta_whatsapp_waba_routes(waba_id) ON DELETE RESTRICT,
  instance_id UUID NOT NULL UNIQUE REFERENCES public.evolution_api_instances(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_phone_routes' AND column_name = 'estado'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_phone_routes' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.meta_whatsapp_phone_routes RENAME COLUMN estado TO status;
  END IF;
END $$;

ALTER TABLE public.meta_whatsapp_phone_routes
  ALTER COLUMN instance_id SET NOT NULL,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();

CREATE TABLE IF NOT EXISTS public.meta_whatsapp_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  body_hash TEXT NOT NULL UNIQUE,
  encrypted_payload TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT true,
  received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_receipts' AND column_name = 'event_hash'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_receipts' AND column_name = 'body_hash'
  ) THEN
    ALTER TABLE public.meta_whatsapp_receipts RENAME COLUMN event_hash TO body_hash;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_receipts' AND column_name = 'payload'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_receipts' AND column_name = 'encrypted_payload'
  ) THEN
    ALTER TABLE public.meta_whatsapp_receipts RENAME COLUMN payload TO encrypted_payload;
  END IF;
END $$;

ALTER TABLE public.meta_whatsapp_receipts
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS payload_purged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();

CREATE TABLE IF NOT EXISTS public.meta_whatsapp_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  receipt_id UUID REFERENCES public.meta_whatsapp_receipts(id) ON DELETE RESTRICT,
  encrypted_payload TEXT NOT NULL,
  waba_id TEXT,
  phone_number_id TEXT,
  cluster_id UUID REFERENCES public.whatsapp_clusters(id) ON DELETE RESTRICT,
  instance_id UUID REFERENCES public.evolution_api_instances(id) ON DELETE RESTRICT,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  route_version INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  lease_expires_at TIMESTAMPTZ,
  locked_by TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 20,
  available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  errors JSONB,
  accepted_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_deliveries' AND column_name = 'payload'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_deliveries' AND column_name = 'encrypted_payload'
  ) THEN
    ALTER TABLE public.meta_whatsapp_deliveries RENAME COLUMN payload TO encrypted_payload;
  END IF;
END $$;

ALTER TABLE public.meta_whatsapp_deliveries
  ADD COLUMN IF NOT EXISTS receipt_id UUID REFERENCES public.meta_whatsapp_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS waba_id TEXT,
  ADD COLUMN IF NOT EXISTS phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS cluster_id UUID REFERENCES public.whatsapp_clusters(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS instance_id UUID REFERENCES public.evolution_api_instances(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS route_version INTEGER,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by TEXT,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS errors JSONB,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payload_purged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();

ALTER TABLE public.meta_whatsapp_receipts ALTER COLUMN encrypted_payload DROP NOT NULL;
ALTER TABLE public.meta_whatsapp_deliveries ALTER COLUMN encrypted_payload DROP NOT NULL;

-- The temporary superadmin schema stored the frozen route as one mandatory
-- JSON object. The canonical schema freezes the same ownership in dedicated
-- cluster/instance/workspace/version columns. Keep the legacy column readable
-- during rollout, but do not require new deliveries to populate both formats.
ALTER TABLE public.meta_whatsapp_deliveries
  ALTER COLUMN route_frozen DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meta_whatsapp_deliveries' AND column_name = 'error_message'
  ) THEN
    UPDATE public.meta_whatsapp_deliveries
    SET errors = jsonb_build_object('legacy_error', error_message)
    WHERE error_message IS NOT NULL AND errors IS NULL;
  END IF;
END $$;

ALTER TABLE public.meta_whatsapp_waba_routes DROP CONSTRAINT IF EXISTS meta_whatsapp_waba_routes_status_check;
ALTER TABLE public.meta_whatsapp_waba_routes ADD CONSTRAINT meta_whatsapp_waba_routes_status_check
  CHECK (status IN ('active', 'migrating', 'paused'));
ALTER TABLE public.meta_whatsapp_phone_routes DROP CONSTRAINT IF EXISTS meta_whatsapp_phone_routes_status_check;
ALTER TABLE public.meta_whatsapp_phone_routes ADD CONSTRAINT meta_whatsapp_phone_routes_status_check
  CHECK (status IN ('active', 'migrating', 'paused'));
ALTER TABLE public.meta_whatsapp_deliveries DROP CONSTRAINT IF EXISTS meta_whatsapp_deliveries_status_check;
ALTER TABLE public.meta_whatsapp_deliveries ADD CONSTRAINT meta_whatsapp_deliveries_status_check
  CHECK (status IN ('pending', 'delivering', 'retry', 'accepted', 'processed', 'quarantined', 'dead_letter'));
ALTER TABLE public.meta_whatsapp_deliveries DROP CONSTRAINT IF EXISTS meta_whatsapp_deliveries_attempts_check;
ALTER TABLE public.meta_whatsapp_deliveries ADD CONSTRAINT meta_whatsapp_deliveries_attempts_check
  CHECK (attempts >= 0 AND max_attempts > 0);

-- Placeholder WABAs are never valid routing owners.
DELETE FROM public.meta_whatsapp_phone_routes WHERE waba_id = 'waba-unknown';
DELETE FROM public.meta_whatsapp_waba_routes WHERE waba_id = 'waba-unknown';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_whatsapp_waba_routes_cluster_id_fkey') THEN
    ALTER TABLE public.meta_whatsapp_waba_routes ADD CONSTRAINT meta_whatsapp_waba_routes_cluster_id_fkey
      FOREIGN KEY (cluster_id) REFERENCES public.whatsapp_clusters(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_whatsapp_phone_routes_waba_id_fkey') THEN
    ALTER TABLE public.meta_whatsapp_phone_routes ADD CONSTRAINT meta_whatsapp_phone_routes_waba_id_fkey
      FOREIGN KEY (waba_id) REFERENCES public.meta_whatsapp_waba_routes(waba_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_whatsapp_phone_routes_instance_id_fkey') THEN
    ALTER TABLE public.meta_whatsapp_phone_routes ADD CONSTRAINT meta_whatsapp_phone_routes_instance_id_fkey
      FOREIGN KEY (instance_id) REFERENCES public.evolution_api_instances(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_whatsapp_phone_routes_workspace_id_fkey') THEN
    ALTER TABLE public.meta_whatsapp_phone_routes ADD CONSTRAINT meta_whatsapp_phone_routes_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_whatsapp_deliveries_receipt_id_fkey') THEN
    ALTER TABLE public.meta_whatsapp_deliveries ADD CONSTRAINT meta_whatsapp_deliveries_receipt_id_fkey
      FOREIGN KEY (receipt_id) REFERENCES public.meta_whatsapp_receipts(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_whatsapp_deliveries_cluster_id_fkey') THEN
    ALTER TABLE public.meta_whatsapp_deliveries ADD CONSTRAINT meta_whatsapp_deliveries_cluster_id_fkey
      FOREIGN KEY (cluster_id) REFERENCES public.whatsapp_clusters(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_whatsapp_deliveries_instance_id_fkey') THEN
    ALTER TABLE public.meta_whatsapp_deliveries ADD CONSTRAINT meta_whatsapp_deliveries_instance_id_fkey
      FOREIGN KEY (instance_id) REFERENCES public.evolution_api_instances(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meta_whatsapp_deliveries_workspace_id_fkey') THEN
    ALTER TABLE public.meta_whatsapp_deliveries ADD CONSTRAINT meta_whatsapp_deliveries_workspace_id_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.validate_meta_whatsapp_phone_route_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  instance_cluster UUID;
  instance_workspace UUID;
  waba_cluster UUID;
BEGIN
  SELECT cluster_id, workspace_id INTO instance_cluster, instance_workspace
  FROM public.evolution_api_instances WHERE id = NEW.instance_id;
  SELECT cluster_id INTO waba_cluster
  FROM public.meta_whatsapp_waba_routes WHERE waba_id = NEW.waba_id;
  IF instance_cluster IS NULL OR waba_cluster IS NULL OR instance_cluster <> waba_cluster THEN
    RAISE EXCEPTION 'Phone route instance and WABA must belong to the same cluster';
  END IF;
  IF instance_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'Phone route instance and workspace must match';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_meta_whatsapp_phone_route_owner ON public.meta_whatsapp_phone_routes;
CREATE TRIGGER trg_meta_whatsapp_phone_route_owner
  BEFORE INSERT OR UPDATE OF waba_id, instance_id, workspace_id ON public.meta_whatsapp_phone_routes
  FOR EACH ROW EXECUTE FUNCTION public.validate_meta_whatsapp_phone_route_owner();

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_whatsapp_receipts_body_hash ON public.meta_whatsapp_receipts(body_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_whatsapp_deliveries_event_key ON public.meta_whatsapp_deliveries(event_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_whatsapp_phone_routes_instance ON public.meta_whatsapp_phone_routes(instance_id);
CREATE INDEX IF NOT EXISTS idx_meta_waba_routes_cluster ON public.meta_whatsapp_waba_routes(cluster_id);
CREATE INDEX IF NOT EXISTS idx_meta_phone_routes_waba ON public.meta_whatsapp_phone_routes(waba_id);
CREATE INDEX IF NOT EXISTS idx_meta_phone_routes_workspace ON public.meta_whatsapp_phone_routes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_meta_deliveries_claim ON public.meta_whatsapp_deliveries(available_at, created_at)
  WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_meta_deliveries_lease ON public.meta_whatsapp_deliveries(lease_expires_at)
  WHERE status = 'delivering';
CREATE INDEX IF NOT EXISTS idx_meta_deliveries_cluster ON public.meta_whatsapp_deliveries(cluster_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_meta_whatsapp_waba_routes_set_updated_at ON public.meta_whatsapp_waba_routes;
DROP TRIGGER IF EXISTS trg_meta_whatsapp_phone_routes_set_updated_at ON public.meta_whatsapp_phone_routes;
DROP TRIGGER IF EXISTS trg_meta_whatsapp_receipts_set_updated_at ON public.meta_whatsapp_receipts;
DROP TRIGGER IF EXISTS trg_meta_whatsapp_deliveries_set_updated_at ON public.meta_whatsapp_deliveries;
CREATE TRIGGER trg_meta_whatsapp_waba_routes_set_updated_at BEFORE UPDATE ON public.meta_whatsapp_waba_routes
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER trg_meta_whatsapp_phone_routes_set_updated_at BEFORE UPDATE ON public.meta_whatsapp_phone_routes
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER trg_meta_whatsapp_receipts_set_updated_at BEFORE UPDATE ON public.meta_whatsapp_receipts
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER trg_meta_whatsapp_deliveries_set_updated_at BEFORE UPDATE ON public.meta_whatsapp_deliveries
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.meta_whatsapp_waba_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_whatsapp_phone_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_whatsapp_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_whatsapp_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolution_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.whatsapp_clusters FROM anon, authenticated;
REVOKE ALL ON public.evolution_api_instances FROM anon, authenticated;
REVOKE ALL ON public.evolution_webhook_events FROM anon, authenticated;
REVOKE ALL ON public.webhook_logs FROM anon, authenticated;
REVOKE ALL ON public.workspace_logs FROM anon, authenticated;
REVOKE ALL ON public.meta_whatsapp_waba_routes FROM anon, authenticated;
REVOKE ALL ON public.meta_whatsapp_phone_routes FROM anon, authenticated;
REVOKE ALL ON public.meta_whatsapp_receipts FROM anon, authenticated;
REVOKE ALL ON public.meta_whatsapp_deliveries FROM anon, authenticated;

-- Remove credentials accidentally retained by older Evolution payloads.
UPDATE public.evolution_webhook_events
SET payload = payload - 'apikey' - 'api_key' - 'headers' - 'token'
WHERE payload ?| ARRAY['apikey', 'api_key', 'headers', 'token'];

GRANT ALL ON public.meta_whatsapp_waba_routes TO service_role, postgres;
GRANT ALL ON public.meta_whatsapp_phone_routes TO service_role, postgres;
GRANT ALL ON public.meta_whatsapp_receipts TO service_role, postgres;
GRANT ALL ON public.meta_whatsapp_deliveries TO service_role, postgres;
