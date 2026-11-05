-- Historical summaries only. Customer values remain in encrypted conversation state.
CREATE TABLE IF NOT EXISTS public.agent_studio_sessions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  chat_id uuid NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  release_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'waiting_input', 'resolved', 'transferred', 'failed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(summary) = 'object')
);

CREATE INDEX IF NOT EXISTS agent_studio_sessions_workspace_agent_started
  ON public.agent_studio_sessions (workspace_id, agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_studio_sessions_chat
  ON public.agent_studio_sessions (chat_id);
CREATE INDEX IF NOT EXISTS agent_studio_sessions_completed_retention
  ON public.agent_studio_sessions (completed_at) WHERE completed_at IS NOT NULL;

-- Server-only history: there is intentionally no browser/Data API write policy.
ALTER TABLE public.agent_studio_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_studio_sessions FROM anon, authenticated;
GRANT ALL ON public.agent_studio_sessions TO service_role;

-- Immutable releases remain stored; revocation is a separate auditable control plane.
CREATE TABLE IF NOT EXISTS public.agent_studio_release_revocations (
  release_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  revoked_by uuid,
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS agent_studio_release_revocations_workspace_agent
  ON public.agent_studio_release_revocations (workspace_id, agent_id, revoked_at DESC);
ALTER TABLE public.agent_studio_release_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_studio_release_revocations FROM anon, authenticated;
GRANT ALL ON public.agent_studio_release_revocations TO service_role;

CREATE TABLE IF NOT EXISTS public.agent_studio_knowledge_revocations (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES public.autopilot_configs(id) ON DELETE CASCADE,
  release_id uuid NOT NULL,
  source_id text NOT NULL CHECK (char_length(source_id) BETWEEN 1 AND 500),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 1000),
  revoked_by uuid,
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, agent_id, release_id, source_id)
);
CREATE INDEX IF NOT EXISTS agent_studio_knowledge_revocations_release
  ON public.agent_studio_knowledge_revocations (release_id, revoked_at DESC);
ALTER TABLE public.agent_studio_knowledge_revocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_studio_knowledge_revocations FROM anon, authenticated;
GRANT ALL ON public.agent_studio_knowledge_revocations TO service_role;

-- Only Studio publications are affected; legacy configuration history is untouched.
CREATE OR REPLACE FUNCTION public.prevent_agent_studio_release_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.snapshot ? 'agent_release_manifest' THEN
    RAISE EXCEPTION 'Published Studio releases are immutable; restore into a new draft';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS prevent_agent_studio_release_update ON public.autopilot_config_versions;
CREATE TRIGGER prevent_agent_studio_release_update BEFORE UPDATE ON public.autopilot_config_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_agent_studio_release_update();

-- Lock referenced agents while publishing a normal flow. This closes the race
-- between publication and deletion without changing the normal flow's editor.
CREATE OR REPLACE FUNCTION public.check_published_studio_agent_references()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE node jsonb; agent uuid;
BEGIN
  IF NEW.status <> 'published' THEN RETURN NEW; END IF;
  FOR node IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.definition->'nodes', '[]'::jsonb)) LOOP
    IF node->>'type' <> 'ai.published_agent' THEN CONTINUE; END IF;
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
DROP TRIGGER IF EXISTS check_published_studio_agent_references ON public.workflow_definitions;
CREATE TRIGGER check_published_studio_agent_references BEFORE INSERT OR UPDATE ON public.workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION public.check_published_studio_agent_references();

CREATE OR REPLACE FUNCTION public.prevent_referenced_studio_agent_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id) AND EXISTS (
    SELECT 1 FROM public.workflow_definitions w WHERE w.workspace_id = OLD.workspace_id AND w.status = 'published'
      AND w.definition->'nodes' @> jsonb_build_array(jsonb_build_object('type', 'ai.published_agent', 'config', jsonb_build_object('agentId', OLD.id::text)))
  ) THEN RAISE EXCEPTION 'Este agente é usado por fluxos publicados. Remova essas referências antes de excluí-lo.'; END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS prevent_referenced_studio_agent_delete ON public.autopilot_configs;
CREATE TRIGGER prevent_referenced_studio_agent_delete BEFORE DELETE ON public.autopilot_configs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_referenced_studio_agent_delete();
