CREATE INDEX IF NOT EXISTS idx_chats_workspace_created_at
  ON public.chats (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chats_workspace_assigned_at_agent
  ON public.chats (workspace_id, assigned_at, agent_id)
  WHERE assigned_at IS NOT NULL AND agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chats_workspace_closed_at_agent
  ON public.chats (workspace_id, closed_at, agent_id)
  WHERE closed_at IS NOT NULL AND agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_workspace_created_chat
  ON public.messages (workspace_id, created_at, chat_id);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_created_sender
  ON public.messages (workspace_id, created_at, sender_user_id)
  WHERE sender_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_workspace_created_metadata_event
  ON public.messages (workspace_id, created_at, (metadata->>'event'))
  WHERE metadata ? 'event';
