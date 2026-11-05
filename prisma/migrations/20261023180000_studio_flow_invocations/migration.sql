-- Independent checkpoints also support task invocations without a chat.
CREATE TABLE IF NOT EXISTS public.studio_flow_invocations (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invocation_id text NOT NULL,
  workflow_id text NOT NULL,
  execution_id text NOT NULL,
  node_id text NOT NULL,
  agent_id uuid NOT NULL,
  release_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'needs_input', 'completed', 'handoff', 'close_requested', 'limit_reached', 'error', 'cancelled')),
  encrypted_state text NOT NULL,
  outcome_unknown boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, invocation_id)
);
CREATE INDEX IF NOT EXISTS studio_flow_invocations_execution_idx
  ON public.studio_flow_invocations(workspace_id, execution_id);
CREATE INDEX IF NOT EXISTS studio_flow_invocations_uncertain_idx
  ON public.studio_flow_invocations(workspace_id, execution_id, node_id) WHERE outcome_unknown;
ALTER TABLE public.studio_flow_invocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_flow_invocations FROM anon, authenticated;

-- Extend the existing publication and deletion guards to every Studio consumer.
-- Existing triggers keep pointing to these functions; terminal handoff is preserved.
CREATE OR REPLACE FUNCTION public.check_published_studio_agent_references()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE node jsonb; agent uuid;
BEGIN
  IF NEW.status <> 'published' THEN RETURN NEW; END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.definition->'nodes', '[]'::jsonb)) LOOP
    IF node->>'type' NOT IN ('ai.published_agent', 'ai.studio_agent', 'integration.studio_procedure', 'tool.studio_agent', 'tool.studio_procedure') THEN CONTINUE; END IF;
    SELECT a.id INTO agent FROM public.autopilot_configs a
      WHERE a.id::text = node->'config'->>'agentId' AND a.workspace_id = NEW.workspace_id AND a.is_active
      FOR KEY SHARE;
    IF agent IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.autopilot_config_versions v WHERE v.config_id = agent AND v.workspace_id = NEW.workspace_id
        AND v.snapshot->'agent_release_manifest'->>'releaseId' = node->'config'->>'releaseId'
        AND v.snapshot->'agent_release_manifest'->>'runtimeVersion' = 'studio-v1'
        AND NOT EXISTS (SELECT 1 FROM public.agent_studio_release_revocations r
          WHERE r.workspace_id = NEW.workspace_id AND r.agent_id = agent
            AND r.release_id::text = node->'config'->>'releaseId')
    ) THEN RAISE EXCEPTION 'O fluxo referencia um agente ou uma versão publicada indisponível'; END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_referenced_studio_agent_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id) AND EXISTS (
    SELECT 1 FROM public.workflow_definitions w WHERE w.workspace_id = OLD.workspace_id AND w.status = 'published'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(w.definition->'nodes', '[]'::jsonb)) node
        WHERE node->>'type' IN ('ai.published_agent', 'ai.studio_agent', 'integration.studio_procedure', 'tool.studio_agent', 'tool.studio_procedure')
          AND node->'config'->>'agentId' = OLD.id::text)
  ) THEN RAISE EXCEPTION 'Este agente é usado por fluxos publicados. Remova essas referências antes de excluí-lo.'; END IF;
  RETURN OLD;
END;
$$;
