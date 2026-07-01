CREATE TABLE IF NOT EXISTS public.autopilot_response_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  chat_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  orchestrator_run_id uuid,
  delivery_key text NOT NULL DEFAULT 'primary',
  blocks jsonb NOT NULL,
  next_block_index integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT autopilot_response_deliveries_blocks_check
    CHECK (jsonb_typeof(blocks) = 'array' AND jsonb_array_length(blocks) > 0),
  CONSTRAINT autopilot_response_deliveries_next_block_check
    CHECK (next_block_index >= 0),
  CONSTRAINT autopilot_response_deliveries_status_check
    CHECK (status IN ('pending', 'sending', 'sent', 'error')),
  CONSTRAINT autopilot_response_deliveries_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_response_deliveries_chat_id_fkey
    FOREIGN KEY (chat_id) REFERENCES public.chats(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_response_deliveries_source_message_id_fkey
    FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE CASCADE,
  CONSTRAINT autopilot_response_deliveries_orchestrator_run_id_fkey
    FOREIGN KEY (orchestrator_run_id) REFERENCES public.orchestrator_runs(id) ON DELETE SET NULL,
  CONSTRAINT autopilot_response_deliveries_source_key
    UNIQUE (source_message_id, delivery_key)
);

CREATE INDEX IF NOT EXISTS idx_autopilot_response_deliveries_chat_updated
  ON public.autopilot_response_deliveries(chat_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_autopilot_response_deliveries_workspace_status
  ON public.autopilot_response_deliveries(workspace_id, status, updated_at DESC);
