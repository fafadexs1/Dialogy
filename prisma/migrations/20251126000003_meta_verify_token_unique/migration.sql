-- Evita reutilizar verify_token no mesmo workspace (boa prática de isolamento)
CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_channels_workspace_verify_token
ON "meta_channels" ("workspace_id", "verify_token");
