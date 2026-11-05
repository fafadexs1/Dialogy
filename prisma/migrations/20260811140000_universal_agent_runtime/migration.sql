-- Universal agent runtime: durable task state, interruptions, checkpoints and
-- versioned domain packs. The application uses the server-side pg pool for
-- these tables; RLS is still enabled as defense in depth for exposed schemas.

CREATE TABLE IF NOT EXISTS public.agent_domain_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT agent_domain_packs_status_check
    CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT agent_domain_packs_version_check
    CHECK (version > 0),
  CONSTRAINT agent_domain_packs_slug_check
    CHECK (slug ~ '^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,119}$'),
  CONSTRAINT agent_domain_packs_definition_object_check
    CHECK (jsonb_typeof(definition) = 'object'),
  CONSTRAINT agent_domain_packs_workspace_slug_version_key
    UNIQUE (workspace_id, slug, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_domain_packs_workspace_status
  ON public.agent_domain_packs(workspace_id, status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_domain_packs_one_published_slug
  ON public.agent_domain_packs(workspace_id, slug)
  WHERE status = 'published';

ALTER TABLE public.autopilot_configs
  ADD COLUMN IF NOT EXISTS agent_domain_pack_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'autopilot_configs_agent_domain_pack_id_fkey'
  ) THEN
    ALTER TABLE public.autopilot_configs
      ADD CONSTRAINT autopilot_configs_agent_domain_pack_id_fkey
      FOREIGN KEY (agent_domain_pack_id)
      REFERENCES public.agent_domain_packs(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_autopilot_configs_agent_domain_pack
  ON public.autopilot_configs(agent_domain_pack_id)
  WHERE agent_domain_pack_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_task_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  chat_id uuid REFERENCES public.chats(id) ON DELETE SET NULL,
  orchestrator_run_id uuid REFERENCES public.orchestrator_runs(id) ON DELETE SET NULL,
  system_agent_id uuid REFERENCES public.system_agents(id) ON DELETE SET NULL,
  autopilot_config_id uuid REFERENCES public.autopilot_configs(id) ON DELETE SET NULL,
  domain_pack_id uuid REFERENCES public.agent_domain_packs(id) ON DELETE SET NULL,
  goal text,
  goal_key text,
  procedure_id text,
  procedure_version integer,
  current_step_id text,
  status text NOT NULL DEFAULT 'active',
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  slots jsonb NOT NULL DEFAULT '{}'::jsonb,
  confirmations jsonb NOT NULL DEFAULT '{}'::jsonb,
  decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_action jsonb,
  active_interruption_id uuid,
  version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  completed_at timestamptz,
  CONSTRAINT agent_task_executions_status_check
    CHECK (status IN ('active', 'waiting_input', 'waiting_confirmation', 'waiting_tool', 'handoff', 'completed', 'failed', 'cancelled')),
  CONSTRAINT agent_task_executions_version_check
    CHECK (version >= 0),
  CONSTRAINT agent_task_executions_json_check
    CHECK (
      jsonb_typeof(state) = 'object'
      AND jsonb_typeof(slots) = 'object'
      AND jsonb_typeof(confirmations) = 'object'
      AND jsonb_typeof(decisions) = 'object'
      AND jsonb_typeof(tool_results) = 'object'
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_task_executions_active_chat
  ON public.agent_task_executions(workspace_id, chat_id)
  WHERE chat_id IS NOT NULL
    AND status IN ('active', 'waiting_input', 'waiting_confirmation', 'waiting_tool');

CREATE INDEX IF NOT EXISTS idx_agent_task_executions_workspace_status
  ON public.agent_task_executions(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_task_executions_chat_updated
  ON public.agent_task_executions(chat_id, updated_at DESC)
  WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_task_executions_run
  ON public.agent_task_executions(orchestrator_run_id)
  WHERE orchestrator_run_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_task_interruptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_execution_id uuid NOT NULL REFERENCES public.agent_task_executions(id) ON DELETE CASCADE,
  parent_interruption_id uuid REFERENCES public.agent_task_interruptions(id) ON DELETE SET NULL,
  kind text NOT NULL,
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  stack_order integer NOT NULL DEFAULT 0,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  resolved_at timestamptz,
  CONSTRAINT agent_task_interruptions_status_check
    CHECK (status IN ('pending', 'resolved', 'cancelled')),
  CONSTRAINT agent_task_interruptions_stack_order_check
    CHECK (stack_order >= 0),
  CONSTRAINT agent_task_interruptions_context_check
    CHECK (jsonb_typeof(context) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_agent_task_interruptions_pending
  ON public.agent_task_interruptions(task_execution_id, status, stack_order DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_task_interruptions_created
  ON public.agent_task_interruptions(task_execution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.agent_task_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_execution_id uuid NOT NULL REFERENCES public.agent_task_executions(id) ON DELETE CASCADE,
  orchestrator_run_id uuid REFERENCES public.orchestrator_runs(id) ON DELETE SET NULL,
  sequence bigint NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT agent_task_checkpoints_status_check
    CHECK (status IN ('active', 'waiting_input', 'waiting_confirmation', 'waiting_tool', 'handoff', 'completed', 'failed', 'cancelled')),
  CONSTRAINT agent_task_checkpoints_state_check
    CHECK (jsonb_typeof(state) = 'object'),
  CONSTRAINT agent_task_checkpoints_metadata_check
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT agent_task_checkpoints_task_sequence_key
    UNIQUE (task_execution_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_agent_task_checkpoints_task_sequence
  ON public.agent_task_checkpoints(task_execution_id, sequence DESC);

CREATE INDEX IF NOT EXISTS idx_agent_task_checkpoints_workspace_created
  ON public.agent_task_checkpoints(created_at DESC)
  INCLUDE (task_execution_id, status, event_type);

CREATE TABLE IF NOT EXISTS public.agent_memory_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
  chat_id uuid REFERENCES public.chats(id) ON DELETE CASCADE,
  task_execution_id uuid REFERENCES public.agent_task_executions(id) ON DELETE CASCADE,
  layer text NOT NULL,
  memory_key text NOT NULL,
  value jsonb NOT NULL,
  source_type text NOT NULL,
  source_ref text,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) NOT NULL DEFAULT 0.5000,
  observed_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  valid_from timestamptz,
  valid_until timestamptz,
  status text NOT NULL DEFAULT 'active',
  conflict_group text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT agent_memory_entries_layer_check
    CHECK (layer IN ('turn_context', 'operational_state', 'contact_fact', 'knowledge', 'case_memory')),
  CONSTRAINT agent_memory_entries_source_type_check
    CHECK (source_type IN ('conversation', 'tool', 'user', 'document', 'case_memory', 'system')),
  CONSTRAINT agent_memory_entries_status_check
    CHECK (status IN ('active', 'superseded', 'conflicted', 'expired')),
  CONSTRAINT agent_memory_entries_key_check
    CHECK (length(btrim(memory_key)) BETWEEN 1 AND 180),
  CONSTRAINT agent_memory_entries_value_object_check
    CHECK (jsonb_typeof(value) IN ('object', 'array', 'string', 'number', 'boolean', 'null')),
  CONSTRAINT agent_memory_entries_scope_object_check
    CHECK (jsonb_typeof(scope) = 'object'),
  CONSTRAINT agent_memory_entries_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT agent_memory_entries_validity_check
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_workspace_layer
  ON public.agent_memory_entries(workspace_id, layer, status, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_contact_key
  ON public.agent_memory_entries(workspace_id, contact_id, memory_key, observed_at DESC)
  WHERE contact_id IS NOT NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_agent_memory_entries_task
  ON public.agent_memory_entries(task_execution_id, observed_at DESC)
  WHERE task_execution_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agent_evaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  domain_pack_id uuid REFERENCES public.agent_domain_packs(id) ON DELETE SET NULL,
  scenario_id text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  observation jsonb NOT NULL DEFAULT '{}'::jsonb,
  passed boolean NOT NULL DEFAULT false,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT agent_evaluation_runs_input_check
    CHECK (jsonb_typeof(input) = 'object'),
  CONSTRAINT agent_evaluation_runs_observation_check
    CHECK (jsonb_typeof(observation) = 'object'),
  CONSTRAINT agent_evaluation_runs_failures_check
    CHECK (jsonb_typeof(failures) = 'array'),
  CONSTRAINT agent_evaluation_runs_metrics_check
    CHECK (jsonb_typeof(metrics) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_agent_evaluation_runs_workspace_created
  ON public.agent_evaluation_runs(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_evaluation_runs_scenario
  ON public.agent_evaluation_runs(workspace_id, scenario_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_task_executions_active_interruption_fkey'
  ) THEN
    ALTER TABLE public.agent_task_executions
      ADD CONSTRAINT agent_task_executions_active_interruption_fkey
      FOREIGN KEY (active_interruption_id)
      REFERENCES public.agent_task_interruptions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- RLS is defense in depth for any future Data API exposure. The application
-- server uses the trusted database connection and still performs workspace
-- authorization at the action/DAL boundary.
ALTER TABLE public.agent_domain_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_task_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_task_interruptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_task_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_memory_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_evaluation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_domain_packs_workspace_access ON public.agent_domain_packs;
CREATE POLICY agent_domain_packs_workspace_access
  ON public.agent_domain_packs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = agent_domain_packs.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = agent_domain_packs.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS agent_task_executions_workspace_access ON public.agent_task_executions;
CREATE POLICY agent_task_executions_workspace_access
  ON public.agent_task_executions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = agent_task_executions.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = agent_task_executions.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS agent_task_interruptions_workspace_access ON public.agent_task_interruptions;
CREATE POLICY agent_task_interruptions_workspace_access
  ON public.agent_task_interruptions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.agent_task_executions task
      JOIN public.workspaces w ON w.id = task.workspace_id
      WHERE task.id = agent_task_interruptions.task_execution_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.agent_task_executions task
      JOIN public.workspaces w ON w.id = task.workspace_id
      WHERE task.id = agent_task_interruptions.task_execution_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS agent_task_checkpoints_workspace_access ON public.agent_task_checkpoints;
CREATE POLICY agent_task_checkpoints_workspace_access
  ON public.agent_task_checkpoints
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.agent_task_executions task
      JOIN public.workspaces w ON w.id = task.workspace_id
      WHERE task.id = agent_task_checkpoints.task_execution_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.agent_task_executions task
      JOIN public.workspaces w ON w.id = task.workspace_id
      WHERE task.id = agent_task_checkpoints.task_execution_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS agent_memory_entries_workspace_access ON public.agent_memory_entries;
CREATE POLICY agent_memory_entries_workspace_access
  ON public.agent_memory_entries
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = agent_memory_entries.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = agent_memory_entries.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS agent_evaluation_runs_workspace_access ON public.agent_evaluation_runs;
CREATE POLICY agent_evaluation_runs_workspace_access
  ON public.agent_evaluation_runs
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = agent_evaluation_runs.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = agent_evaluation_runs.workspace_id
        AND (
          w.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.user_workspace_roles uwr
            WHERE uwr.workspace_id = w.id
              AND uwr.user_id = auth.uid()
          )
        )
    )
  );
