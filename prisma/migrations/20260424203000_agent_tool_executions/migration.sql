CREATE TABLE IF NOT EXISTS public.agent_tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  chat_id uuid,
  system_agent_id uuid,
  autopilot_config_id uuid,
  tool_name text NOT NULL,
  status text NOT NULL,
  input jsonb,
  output jsonb,
  error text,
  requires_human_approval boolean NOT NULL DEFAULT false,
  approved_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT agent_tool_executions_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT agent_tool_executions_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE SET NULL,
  CONSTRAINT agent_tool_executions_system_agent_id_fkey
    FOREIGN KEY (system_agent_id) REFERENCES public.system_agents(id) ON DELETE SET NULL,
  CONSTRAINT agent_tool_executions_autopilot_config_id_fkey
    FOREIGN KEY (autopilot_config_id) REFERENCES public.autopilot_configs(id) ON DELETE SET NULL,
  CONSTRAINT agent_tool_executions_approved_by_user_id_fkey
    FOREIGN KEY (approved_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_workspace_created
  ON public.agent_tool_executions(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_chat
  ON public.agent_tool_executions(chat_id)
  WHERE chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_tool_executions_system_agent
  ON public.agent_tool_executions(system_agent_id)
  WHERE system_agent_id IS NOT NULL;
