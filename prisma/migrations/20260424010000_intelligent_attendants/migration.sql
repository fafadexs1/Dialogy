-- Allow webhook_url to be NULL (intelligent_attendant agents don't use webhooks)
ALTER TABLE IF EXISTS public.system_agents
  ALTER COLUMN webhook_url DROP NOT NULL;

ALTER TABLE IF EXISTS public.system_agents
  ADD COLUMN IF NOT EXISTS autopilot_config_id uuid,
  ADD COLUMN IF NOT EXISTS team_id uuid;

ALTER TABLE IF EXISTS public.chats
  ADD COLUMN IF NOT EXISTS assigned_system_agent_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_agents_autopilot_config_id_fkey'
  ) THEN
    ALTER TABLE public.system_agents
      ADD CONSTRAINT system_agents_autopilot_config_id_fkey
      FOREIGN KEY (autopilot_config_id) REFERENCES public.autopilot_configs(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'system_agents_team_id_fkey'
  ) THEN
    ALTER TABLE public.system_agents
      ADD CONSTRAINT system_agents_team_id_fkey
      FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chats_assigned_system_agent_id_fkey'
  ) THEN
    ALTER TABLE public.chats
      ADD CONSTRAINT chats_assigned_system_agent_id_fkey
      FOREIGN KEY (assigned_system_agent_id) REFERENCES public.system_agents(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_system_agents_intelligent_attendants
  ON public.system_agents(workspace_id, type, is_active)
  WHERE type = 'intelligent_attendant';

CREATE INDEX IF NOT EXISTS idx_chats_assigned_system_agent
  ON public.chats(assigned_system_agent_id)
  WHERE assigned_system_agent_id IS NOT NULL;
