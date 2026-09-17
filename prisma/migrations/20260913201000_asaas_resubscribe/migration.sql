-- Keep prior contracts and invoices while allowing one current contract per workspace.
-- status is free text; superseded contracts remain addressable by provider ID.
CREATE UNIQUE INDEX IF NOT EXISTS asaas_subscriptions_current_workspace_key
  ON asaas_subscriptions(workspace_id) WHERE status <> 'superseded';
ALTER TABLE asaas_subscriptions DROP CONSTRAINT IF EXISTS asaas_subscriptions_workspace_id_key;
CREATE INDEX IF NOT EXISTS asaas_subscriptions_workspace_history_idx ON asaas_subscriptions(workspace_id);
