CREATE TABLE IF NOT EXISTS public.agent_causal_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  agent_id uuid,
  fingerprint text NOT NULL,
  pattern_type text NOT NULL,
  procedure_id text,
  step_id text,
  tool_name text,
  insight text NOT NULL,
  evidence_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_fix_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  impact_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  scope text NOT NULL DEFAULT 'local',
  vertical text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reviewed_at timestamptz,
  applied_at timestamptz,
  CONSTRAINT agent_causal_patterns_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT agent_causal_patterns_agent_id_fkey
    FOREIGN KEY (agent_id) REFERENCES public.system_agents(id) ON DELETE SET NULL,
  CONSTRAINT agent_causal_patterns_workspace_fingerprint_key UNIQUE (workspace_id, fingerprint),
  CONSTRAINT agent_causal_patterns_status_check
    CHECK (status IN ('pending', 'approved', 'applied', 'dismissed', 'conflicted')),
  CONSTRAINT agent_causal_patterns_scope_check
    CHECK (scope IN ('local', 'ecosystem'))
);

CREATE INDEX IF NOT EXISTS idx_agent_causal_patterns_workspace_status
  ON public.agent_causal_patterns(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_causal_patterns_agent_status
  ON public.agent_causal_patterns(agent_id, status, created_at DESC)
  WHERE agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_causal_patterns_type
  ON public.agent_causal_patterns(pattern_type, created_at DESC);
