-- Repair databases where earlier CREATE TABLE IF NOT EXISTS migrations found
-- legacy pattern tables and therefore did not add the newer columns.

ALTER TABLE IF EXISTS public.agent_causal_patterns
  ADD COLUMN IF NOT EXISTS fingerprint text;

UPDATE public.agent_causal_patterns
SET fingerprint = md5(id::text) || md5('dialogy:causal:' || id::text)
WHERE fingerprint IS NULL OR btrim(fingerprint) = '';

ALTER TABLE IF EXISTS public.agent_causal_patterns
  ALTER COLUMN fingerprint SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agent_causal_patterns_workspace_fingerprint_key
  ON public.agent_causal_patterns(workspace_id, fingerprint);

ALTER TABLE IF EXISTS public.agent_ecosystem_patterns
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS sample_size integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deprecated_at timestamptz;

UPDATE public.agent_ecosystem_patterns
SET fingerprint = md5(id::text) || md5('dialogy:ecosystem:' || id::text)
WHERE fingerprint IS NULL OR btrim(fingerprint) = '';

ALTER TABLE IF EXISTS public.agent_ecosystem_patterns
  ALTER COLUMN fingerprint SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agent_ecosystem_patterns_vertical_fingerprint_key
  ON public.agent_ecosystem_patterns(vertical, fingerprint);

CREATE INDEX IF NOT EXISTS idx_agent_causal_patterns_agent_status
  ON public.agent_causal_patterns(agent_id, status, created_at DESC)
  WHERE agent_id IS NOT NULL;
