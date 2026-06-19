CREATE TABLE IF NOT EXISTS public.agent_ecosystem_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  pattern_type text NOT NULL,
  vertical text NOT NULL,
  insight text NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_fix_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_workspace_count integer NOT NULL DEFAULT 0,
  sample_size integer NOT NULL DEFAULT 0,
  confidence numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'candidate',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  validated_at timestamptz,
  deprecated_at timestamptz,
  CONSTRAINT agent_ecosystem_patterns_status_check
    CHECK (status IN ('candidate', 'validated', 'active', 'deprecated')),
  CONSTRAINT agent_ecosystem_patterns_vertical_fingerprint_key
    UNIQUE (vertical, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_agent_ecosystem_patterns_vertical_status
  ON public.agent_ecosystem_patterns(vertical, status, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_agent_ecosystem_patterns_type_status
  ON public.agent_ecosystem_patterns(pattern_type, status, confidence DESC);

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS vertical text;

CREATE INDEX IF NOT EXISTS idx_workspaces_vertical
  ON public.workspaces(vertical)
  WHERE vertical IS NOT NULL;
