CREATE TABLE IF NOT EXISTS public.autopilot_chat_leases (
  chat_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  owner_token uuid NOT NULL,
  source_message_id uuid,
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT autopilot_chat_leases_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_chat_leases_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_chat_leases_source_message_id_fkey
    FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_autopilot_chat_leases_workspace_expires
  ON public.autopilot_chat_leases(workspace_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_autopilot_chat_leases_source_message
  ON public.autopilot_chat_leases(source_message_id)
  WHERE source_message_id IS NOT NULL;
