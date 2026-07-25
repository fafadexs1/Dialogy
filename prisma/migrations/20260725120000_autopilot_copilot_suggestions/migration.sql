-- Copilot suggestions produced by the autopilot orchestrator for human-owned chats.
-- The human agent stays the owner of the conversation; the AI proposes the reply and
-- the operator accepts, edits or dismisses it from the inbox.
CREATE TABLE IF NOT EXISTS public.autopilot_chat_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL,
    chat_id UUID NOT NULL,
    autopilot_config_id UUID,
    system_agent_id UUID,
    source_message_id UUID,
    orchestrator_run_id UUID,
    stage TEXT NOT NULL DEFAULT 'response',
    suggestion TEXT NOT NULL,
    message_blocks JSONB NOT NULL DEFAULT '[]'::JSONB,
    insights JSONB NOT NULL DEFAULT '{}'::JSONB,
    status TEXT NOT NULL DEFAULT 'pending',
    resolved_at TIMESTAMPTZ,
    resolved_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT autopilot_chat_suggestions_status_check
      CHECK (status IN ('pending', 'sent', 'edited', 'dismissed', 'superseded')),
    CONSTRAINT autopilot_chat_suggestions_workspace_fkey
      FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
    CONSTRAINT autopilot_chat_suggestions_chat_fkey
      FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE,
    CONSTRAINT autopilot_chat_suggestions_config_fkey
      FOREIGN KEY (autopilot_config_id) REFERENCES public.autopilot_configs(id) ON DELETE SET NULL,
    CONSTRAINT autopilot_chat_suggestions_system_agent_fkey
      FOREIGN KEY (system_agent_id) REFERENCES public.system_agents(id) ON DELETE SET NULL,
    CONSTRAINT autopilot_chat_suggestions_source_message_fkey
      FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE SET NULL,
    CONSTRAINT autopilot_chat_suggestions_resolved_by_fkey
      FOREIGN KEY (resolved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL
);

-- Only one live suggestion per chat: a new turn supersedes the previous one.
CREATE UNIQUE INDEX IF NOT EXISTS autopilot_chat_suggestions_pending_unique
    ON public.autopilot_chat_suggestions (chat_id)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS autopilot_chat_suggestions_chat_created_idx
    ON public.autopilot_chat_suggestions (chat_id, created_at DESC);

-- Acceptance analytics: how often operators keep what the AI proposed.
CREATE INDEX IF NOT EXISTS autopilot_chat_suggestions_workspace_status_idx
    ON public.autopilot_chat_suggestions (workspace_id, status, created_at DESC);
